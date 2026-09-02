import type { SupabaseClient } from '@supabase/supabase-js';

import { localDayKey } from '@/lib/dashboard/date-utils';
import { dayKeysBetween, type Period } from '@/lib/dashboard/period';
import { fetchAllPages } from '@/lib/supabase/paged';

// ============================================================
// Templates disparados — a leitura de `whatsapp_usage_log` (062).
//
// Agrega no cliente, como todo o resto de /relatórios, e pelas mesmas
// razões: a página já é uma sequência de leituras paginadas com um teto
// barulhento (`fetchAllPages`), e um RPC a mais seria uma forma nova de
// fazer a mesma coisa numa tela só.
//
// ------------------------------------------------------------
// NÃO CONVERTE EM DINHEIRO — E ISSO É O DESENHO
// ------------------------------------------------------------
//
// A pergunta que originou isto é de custo, e a resposta honesta hoje é
// volume: o modelo de cobrança da Meta está em movimento e uma tarifa
// fixada agora estaria errada em silêncio, que é o pior estado possível
// para um número que alguém vai levar para uma reunião.
//
// O que fica pronto é tudo que a tarifa precisa para entrar depois sem
// reescrever nada: o volume separado POR CATEGORIA COBRADA e por dia.
// Multiplicar isso por uma tabela de tarifas com vigência é a última
// etapa, e é aditiva.
// ============================================================

/**
 * Em que pé está a cobrança de um disparo.
 *
 * Quatro estados, e a distinção entre os dois últimos é a que a
 * interface não pode perder: `pending` é "a Meta ainda não respondeu" e
 * `failed` é "não saiu". Somar os dois como zero faria uma semana ruim
 * parecer uma semana barata.
 */
export type BillingState = 'billable' | 'free' | 'pending' | 'failed';

/** Bucket de categoria. `unknown` é literal: a Meta mandou algo novo. */
export interface CategoryUsage {
  category: string;
  total: number;
  billable: number;
  free: number;
  pending: number;
  failed: number;
}

export interface OriginUsage {
  origin: string;
  total: number;
  billable: number;
}

export interface TemplateUsageRow {
  name: string;
  total: number;
  billable: number;
  /** Categoria efetiva mais frequente deste template no período. */
  category: string;
}

export interface TemplateUsageDay {
  /** YYYY-MM-DD local. */
  day: string;
  billable: number;
  free: number;
  pending: number;
}

export interface TemplateUsageSummary {
  total: number;
  billable: number;
  free: number;
  pending: number;
  failed: number;
  /**
   * Disparos em que a Meta cobrou uma categoria diferente da que
   * arquivamos.
   *
   * O número mais interessante da tela, e o único que nenhuma outra
   * parte do produto sabe calcular: a Meta recategoriza templates por
   * conta própria, e essa é a única evidência disso que passa por aqui.
   * Só conta linhas que já têm resposta — divergência exige as duas
   * pontas.
   */
  recategorized: number;
  byCategory: CategoryUsage[];
  byOrigin: OriginUsage[];
  topTemplates: TemplateUsageRow[];
  daily: TemplateUsageDay[];
}

/**
 * Quantos templates a lista mostra.
 *
 * Uma lista curta responde "quem gastou o quê"; uma lista completa vira
 * a tela de templates, que já existe. Dez cabe sem rolagem e cobre a
 * cauda de qualquer conta real — as contas que disparam mais de dez
 * templates distintos por mês têm poucos dominando o volume.
 */
const TOP_TEMPLATES = 10;

interface UsageRow {
  sent_at: string;
  template_name: string;
  declared_category: string | null;
  billable_category: string | null;
  billable: boolean | null;
  priced_at: string | null;
  last_status: string | null;
  origin: string;
}

/**
 * A categoria que vale para o relatório.
 *
 * A COBRADA GANHA DA ARQUIVADA, sempre que existe. A arquivada é a
 * nossa intenção no momento do envio; a cobrada é o que entra na
 * fatura, e quando as duas discordam quem manda é a fatura.
 *
 * Cai para a declarada enquanto a resposta não chegou, para que um
 * disparo recente apareça no gráfico com a categoria mais provável em
 * vez de num balde "desconhecida" que se esvazia sozinho horas depois.
 */
export function effectiveCategory(row: {
  billable_category: string | null;
  declared_category: string | null;
}): string {
  return row.billable_category ?? row.declared_category ?? 'unknown';
}

/**
 * O estado de cobrança de uma linha.
 *
 * `billable` é a palavra da Meta e vem antes de tudo — inclusive antes
 * do status, porque uma mensagem pode ser marcada como faturável já no
 * `sent` e nunca ser entregue.
 */
export function billingState(row: {
  billable: boolean | null;
  last_status: string | null;
}): BillingState {
  if (row.billable === true) return 'billable';
  if (row.billable === false) return 'free';
  if (row.last_status === 'failed') return 'failed';
  return 'pending';
}

export interface TemplateUsageResult {
  summary: TemplateUsageSummary;
  /**
   * O disparo mais antigo que existe no log, em toda a conta.
   *
   * ESTE CAMPO EXISTE PARA A TELA NÃO MENTIR NO PRIMEIRO MÊS.
   *
   * O registro começa quando a 062 é aplicada — não há como
   * reconstruir o que a Meta cobrou antes disso, porque o webhook de
   * status passa uma vez só. Sem esta data, abrir "últimos 90 dias" na
   * semana da estreia mostra um painel quase vazio, e "quase vazio" lido
   * numa tela de custo significa "quase não disparamos", que é falso.
   *
   * Com ela, a tela consegue dizer de onde o dado começa, e um número
   * parcial vira um número parcial declarado.
   *
   * `null` quando o log está vazio: a conta nunca disparou um template
   * desde que a medição existe.
   */
  coverageStart: string | null;
}

/**
 * Carrega e agrega os disparos de template da janela.
 *
 * Ordenado por `sent_at` porque `fetchAllPages` pagina com OFFSET e
 * Postgres não promete ordem sem ORDER BY — sem isso duas páginas podem
 * repetir uma linha e pular outra, o que aqui não é uma ordem errada, é
 * um total errado. Ver a regra 1 em `@/lib/supabase/paged`.
 *
 * Lança `TooManyRowsError` quando a janela é grande demais para somar no
 * navegador; a página traduz isso na mesma frase que já usa para o
 * gráfico de conversas.
 */
export async function loadTemplateUsage(
  db: SupabaseClient,
  period: Period
): Promise<TemplateUsageResult> {
  const [rows, coverage] = await Promise.all([
    fetchAllPages<UsageRow>((from, to) =>
      db
        .from('whatsapp_usage_log')
        .select(
          'sent_at, template_name, declared_category, billable_category, billable, priced_at, last_status, origin'
        )
        .gte('sent_at', period.from.toISOString())
        // EXCLUSIVO — ver a nota sobre janelas semiabertas em
        // `@/lib/dashboard/period`.
        .lt('sent_at', period.to.toISOString())
        .order('sent_at', { ascending: true })
        .range(from, to)
    ),
    // Uma linha, pelo índice (account_id, sent_at DESC) — o mesmo que
    // serve à consulta acima, lido do outro lado.
    db
      .from('whatsapp_usage_log')
      .select('sent_at')
      .order('sent_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    summary: aggregateTemplateUsage(rows, period),
    coverageStart:
      (coverage.data as { sent_at: string } | null)?.sent_at ?? null,
  };
}

/**
 * A agregação, separada da consulta.
 *
 * Função pura sobre as linhas, para que os casos que importam — a
 * recategorização, o pendente que não é zero, a categoria que o produto
 * nunca viu — sejam testáveis sem um banco falso de sete níveis.
 */
export function aggregateTemplateUsage(
  rows: UsageRow[],
  period: Period
): TemplateUsageSummary {
  const summary: TemplateUsageSummary = {
    total: 0,
    billable: 0,
    free: 0,
    pending: 0,
    failed: 0,
    recategorized: 0,
    byCategory: [],
    byOrigin: [],
    topTemplates: [],
    daily: [],
  };

  const categories = new Map<string, CategoryUsage>();
  const origins = new Map<string, OriginUsage>();
  const templates = new Map<
    string,
    { total: number; billable: number; categories: Map<string, number> }
  >();

  // Dias pré-preenchidos com zero: um dia sem disparo é informação, e um
  // gráfico que simplesmente pula a data mente sobre o ritmo.
  const dayKeys = dayKeysBetween(period.from, period.to);
  const days = new Map<string, TemplateUsageDay>(
    dayKeys.map((day) => [day, { day, billable: 0, free: 0, pending: 0 }])
  );

  for (const row of rows) {
    const state = billingState(row);
    const category = effectiveCategory(row);

    summary.total += 1;
    summary[state] += 1;

    // Divergência só existe com as duas pontas na mão. Sem
    // `billable_category` ainda não há o que comparar, e sem
    // `declared_category` a comparação seria contra um vazio.
    if (
      row.billable_category &&
      row.declared_category &&
      row.billable_category !== row.declared_category
    ) {
      summary.recategorized += 1;
    }

    const cat = categories.get(category) ?? {
      category,
      total: 0,
      billable: 0,
      free: 0,
      pending: 0,
      failed: 0,
    };
    cat.total += 1;
    cat[state] += 1;
    categories.set(category, cat);

    const org = origins.get(row.origin) ?? {
      origin: row.origin,
      total: 0,
      billable: 0,
    };
    org.total += 1;
    if (state === 'billable') org.billable += 1;
    origins.set(row.origin, org);

    const tpl = templates.get(row.template_name) ?? {
      total: 0,
      billable: 0,
      categories: new Map<string, number>(),
    };
    tpl.total += 1;
    if (state === 'billable') tpl.billable += 1;
    tpl.categories.set(category, (tpl.categories.get(category) ?? 0) + 1);
    templates.set(row.template_name, tpl);

    // `failed` fica fora da série: o gráfico responde "quanto saiu por
    // dia", e o que não saiu não pertence a essa pergunta. O total de
    // falhas continua no cabeçalho.
    const bucket = days.get(localDayKey(row.sent_at));
    if (bucket && state !== 'failed') bucket[state] += 1;
  }

  summary.byCategory = [...categories.values()].sort(
    (a, b) => b.total - a.total
  );
  summary.byOrigin = [...origins.values()].sort((a, b) => b.total - a.total);
  summary.topTemplates = [...templates.entries()]
    .map(([name, t]) => ({
      name,
      total: t.total,
      billable: t.billable,
      category: dominant(t.categories),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_TEMPLATES);
  summary.daily = dayKeys.map(
    (day) => days.get(day) ?? { day, billable: 0, free: 0, pending: 0 }
  );

  return summary;
}

/** A categoria mais frequente de um template, com desempate estável. */
function dominant(counts: Map<string, number>): string {
  let best = 'unknown';
  let bestCount = -1;
  for (const [category, count] of counts) {
    // `>` e não `>=`: no empate fica a primeira vista, que é a mais
    // antiga, para que a mesma janela não mude de rótulo entre
    // recarregamentos.
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}
