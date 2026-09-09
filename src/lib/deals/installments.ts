import type { SupabaseClient } from '@supabase/supabase-js';

import { addDays, fromISO, toISO } from '@/lib/calendar';

/**
 * AS PARCELAS DE UM PEDIDO — o bloco "Condição de pagamento" do Bling.
 *
 * ------------------------------------------------------------------
 * DUAS COISAS COM O MESMO NOME
 * ------------------------------------------------------------------
 *
 * No Bling, "condição de pagamento" é um ATALHO: alguém digita `30/60/90`
 * e aperta "Gerar parcelas". O que sai são três LINHAS — parcela, dias,
 * data, valor, forma e observação — e cada uma delas é editável depois.
 *
 * A distinção decide o modelo. Guardar só o atalho e recalcular na hora
 * de exibir seria perder toda edição posterior: a operação muda uma data
 * para cair na sexta, arredonda um valor, troca a forma de uma parcela
 * só. `deal_installments` (migração 075) guarda as linhas; `payment_terms`
 * guarda o atalho, porque é o que a pessoa digitou e é o que o Bling vai
 * querer receber de volta.
 *
 * ------------------------------------------------------------------
 * O CENTAVO QUE SOBRA
 * ------------------------------------------------------------------
 *
 * R$ 100,00 em três não dá três valores iguais. `dividir` põe a sobra na
 * ÚLTIMA parcela, que é a convenção de todo sistema fiscal brasileiro e a
 * única que garante a propriedade que importa: a soma das parcelas é
 * exatamente o total do pedido. Sem isso o documento imprime três valores
 * que não fecham com o número em negrito logo acima — e quem confere é o
 * cliente.
 */

export interface Installment {
  id: string;
  account_id: string;
  deal_id: string;
  position: number;
  days: number;
  due_on: string | null;
  amount: number;
  method: string | null;
  note: string | null;
}

export interface InstallmentDraft {
  days: number;
  dueOn: string | null;
  amount: number;
  method: string | null;
  note: string | null;
}

/** Quantas parcelas cabem numa tela antes de o formulário virar planilha. */
export const MAX_INSTALLMENTS = 36;

/**
 * `30/60/90` vira `[30, 60, 90]`.
 *
 * Aceita barra, vírgula, ponto-e-vírgula ou espaço, porque as quatro
 * aparecem quando se copia a condição de um e-mail. `0` é à vista e é um
 * número legítimo — a parcela existe, vence hoje.
 *
 * Devolve `[]` quando não há número nenhum, e aí o botão de gerar não faz
 * nada: `à combinar` é uma condição de pagamento perfeitamente válida de
 * se escrever e não descreve parcela alguma.
 */
export function parseTerms(terms: string): number[] {
  const numeros = (terms ?? '')
    .split(/[^0-9]+/)
    .filter((p) => p !== '')
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return numeros.slice(0, MAX_INSTALLMENTS);
}

/**
 * O total em `n` partes, em centavos, com a sobra na última.
 *
 * Em centavos e não em reais porque `100 / 3` em ponto flutuante é
 * `33.333333333333336`, e três desses arredondados para baixo somam
 * R$ 99,99. Inteiros não têm esse problema, e a última parcela recebe
 * exatamente o que falta para fechar.
 */
export function dividir(total: number, partes: number): number[] {
  if (partes <= 0) return [];
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / partes);
  const valores = Array.from({ length: partes }, () => base / 100);
  const sobra = centavos - base * partes;
  if (sobra !== 0) valores[partes - 1] = (base + sobra) / 100;
  return valores;
}

/**
 * As parcelas que o atalho descreve.
 *
 * `issuedOn` é a data do pedido, e `fromISO` — nunca `new Date(iso)`, que
 * é meia-noite UTC e no Brasil é o dia anterior. A regra está no topo de
 * `lib/calendar.ts` e tem um guarda em `src/app/date-only.test.ts`.
 *
 * `method` vem junto para as parcelas nascerem com a forma que a empresa
 * usa, em vez de a pessoa preencher a mesma palavra três vezes.
 */
export function generateInstallments(args: {
  terms: string;
  total: number;
  issuedOn: string;
  method?: string | null;
}): InstallmentDraft[] {
  const dias = parseTerms(args.terms);
  if (dias.length === 0) return [];

  const valores = dividir(args.total, dias.length);
  const emissao = fromISO(args.issuedOn);

  return dias.map((d, i) => ({
    days: d,
    dueOn: emissao ? toISO(addDays(emissao, d)) : null,
    amount: valores[i] ?? 0,
    method: args.method?.trim() || null,
    note: null,
  }));
}

/** O que as parcelas somam — para dizer, na tela, se elas fecham. */
export function installmentsTotal(parcelas: { amount: number }[]): number {
  return (
    Math.round(parcelas.reduce((soma, p) => soma + (p.amount || 0), 0) * 100) /
    100
  );
}

/**
 * `deal_installments` chega com a 075, aplicada à mão como todas as
 * outras. Até lá o bloco inteiro simplesmente não é desenhado — o mesmo
 * `missing-table` que o catálogo de produtos usa desde a 054.
 */
export function isMissingInstallments(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return (
    /deal_installments/i.test(error.message ?? '') &&
    /(does not exist|could not find)/i.test(error.message ?? '')
  );
}

const SELECT = 'id, account_id, deal_id, position, days, due_on, amount, method, note';

export async function loadInstallments(
  db: SupabaseClient,
  dealId: string
): Promise<Installment[] | 'missing-table'> {
  const { data, error } = await db
    .from('deal_installments')
    .select(SELECT)
    .eq('deal_id', dealId)
    .order('position', { ascending: true });

  if (error) {
    if (isMissingInstallments(error)) return 'missing-table';
    console.error('Failed to load installments:', error.message);
    return [];
  }
  return (data ?? []) as unknown as Installment[];
}

/**
 * Troca as parcelas de um pedido pelo conjunto que está na tela.
 *
 * Apaga-e-insere, e a razão é a mesma escrita em `replaceDealItems`: o
 * editor devolve a lista como ela deve terminar, e um diff seriam três
 * caminhos para chegar ao mesmo estado. Diferente das linhas de produto,
 * aqui não há trigger nenhum dependendo do resultado — as parcelas não
 * somam para `deals.value`, elas dividem o que ele já é.
 */
export async function replaceInstallments(
  db: SupabaseClient,
  args: { accountId: string; dealId: string; items: InstallmentDraft[] }
): Promise<{ error: string | null }> {
  const rows = args.items.map((p, index) => ({
    account_id: args.accountId,
    deal_id: args.dealId,
    position: index,
    days: Math.max(0, Math.round(p.days || 0)),
    due_on: p.dueOn || null,
    amount: p.amount || 0,
    method: (p.method ?? '').trim().slice(0, 80) || null,
    note: (p.note ?? '').trim().slice(0, 240) || null,
  }));

  const { error: erroApagar } = await db
    .from('deal_installments')
    .delete()
    .eq('deal_id', args.dealId);
  if (erroApagar) {
    if (isMissingInstallments(erroApagar)) return { error: null };
    return { error: erroApagar.message };
  }

  if (rows.length === 0) return { error: null };

  const { error } = await db.from('deal_installments').insert(rows);
  return { error: error ? error.message : null };
}
