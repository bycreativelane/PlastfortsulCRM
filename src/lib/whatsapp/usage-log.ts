import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';

// ============================================================
// whatsapp_usage_log — as duas escritas (migração 062).
//
// Este arquivo é o único lugar que conhece a forma da tabela. Os quatro
// caminhos de envio chamam `logTemplateSend`; o webhook de status chama
// `applyMetaPricing`. Ninguém mais toca no log.
//
// ------------------------------------------------------------
// REGRA 1: NUNCA LANÇAR
// ------------------------------------------------------------
//
// Copiada de `logAiUsage` (src/lib/ai/usage.ts) e pela mesma razão.
// Contabilidade de uso não pode derrubar um disparo que o cliente está
// esperando, nem um webhook cuja falha faz a Meta reenviar o evento a
// tarde inteira. Um erro aqui vira `console.error` e a vida segue — o
// custo é uma linha faltando num relatório, e o custo da alternativa é
// uma mensagem que não sai.
//
// ------------------------------------------------------------
// REGRA 2: `logTemplateSend` NÃO ACEITA UM CLIENT
// ------------------------------------------------------------
//
// E é a diferença deliberada em relação a `logAiUsage`, que aceita.
//
// A 062 não cria política de INSERT para `authenticated` — a escrita é
// do service role, ponto. Só que dos quatro caminhos de envio, TRÊS
// chegam aqui com um client sob RLS (a caixa de entrada e as duas rotas
// de campanha usam o client do usuário; só a automação já usa o
// admin). Passar esse client faria o insert ser recusado pelo Postgres,
// e a regra 1 transformaria a recusa em `console.error` — ou seja: o
// relatório de custo nasceria vazio para todo disparo feito pela
// interface, sem nada quebrar em lugar nenhum.
//
// Um parâmetro cuja única resposta certa é sempre a mesma não é uma
// escolha, é uma armadilha. O helper resolve o client sozinho.
//
// `applyMetaPricing` continua recebendo o dele porque quem chama é o
// webhook, que já é service role em todas as suas escritas e já passa o
// próprio client para todo o resto — tirar isso dele criaria uma
// exceção onde não há problema a resolver.
// ============================================================

/** De onde partiu o disparo. Espelha o CHECK de `origin` na 062. */
export type UsageOrigin = 'inbox' | 'broadcast' | 'automation' | 'flow' | 'api';

/**
 * O objeto `pricing` do webhook de status da Meta.
 *
 * Todos os campos são opcionais porque todos já foram opcionais em
 * alguma versão da API: `pricing` inteiro não vem em `failed`, `type`
 * não existia antes do modelo por mensagem, e `category` mudou de
 * vocabulário no caminho. Tipar isso como obrigatório seria descrever a
 * documentação, não o tráfego.
 */
export interface MetaPricing {
  billable?: boolean;
  pricing_model?: string;
  category?: string;
  type?: string;
}

/** O objeto `conversation`, quando a Meta ainda o manda (modelo CBP). */
export interface MetaConversation {
  id?: string;
  origin?: { type?: string };
}

export interface LogTemplateSendArgs {
  accountId: string;
  /** Id da mensagem devolvido pela Meta. Sem ele não há o que registrar. */
  wamid: string;
  templateName: string;
  templateLanguage?: string | null;
  origin: UsageOrigin;
  /** Categoria arquivada localmente, em qualquer caixa. Normalizada aqui. */
  declaredCategory?: string | null;
  templateId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  broadcastId?: string | null;
}

/**
 * A categoria local em minúscula, ou null.
 *
 * `message_templates.category` é TitleCase desde a 001 ('Marketing');
 * o webhook devolve minúscula ('marketing'). O log guarda as duas
 * colunas no vocabulário da Meta para que compará-las seja um `!==` e
 * não uma tradução em cada leitura.
 *
 * Devolve null para qualquer coisa fora das quatro conhecidas, em vez
 * de repassar: o CHECK da coluna recusaria a linha inteira, e perder o
 * disparo para salvar a categoria é a troca errada.
 */
export function normalizeDeclaredCategory(
  category: string | null | undefined
): string | null {
  if (!category) return null;
  const lower = category.trim().toLowerCase();
  return ['marketing', 'utility', 'authentication', 'service'].includes(lower)
    ? lower
    : null;
}

/**
 * Registra um template que acabou de sair (escrita 1 de 2).
 *
 * Chamada logo depois do envio à Meta e ANTES de qualquer coisa que
 * possa falhar depois — no caminho manual, por exemplo, o insert em
 * `messages` pode estourar e lançar; se o log viesse depois, todo
 * disparo com erro de persistência sumiria do relatório de custo,
 * apesar de ter sido cobrado.
 */
export async function logTemplateSend(
  args: LogTemplateSendArgs
): Promise<void> {
  if (!args.wamid) return;
  try {
    const { error } = await supabaseAdmin()
      .from('whatsapp_usage_log')
      .insert({
        account_id: args.accountId,
        wamid: args.wamid,
        conversation_id: args.conversationId ?? null,
        contact_id: args.contactId ?? null,
        broadcast_id: args.broadcastId ?? null,
        template_id: args.templateId ?? null,
        template_name: args.templateName,
        template_language: args.templateLanguage ?? null,
        declared_category: normalizeDeclaredCategory(args.declaredCategory),
        origin: args.origin,
        sent_at: new Date().toISOString(),
        last_status: 'sent',
      });
    if (error) {
      console.error('[whatsapp usage] insert failed:', error);
    }
  } catch (err) {
    console.error('[whatsapp usage] insert threw:', err);
  }
}

export interface ApplyMetaPricingArgs {
  wamid: string;
  /** sent | delivered | read | failed, como a Meta mandou. */
  status: string;
  pricing?: MetaPricing | null;
  conversation?: MetaConversation | null;
}

/**
 * Completa a linha com o que a Meta cobrou (escrita 2 de 2).
 *
 * UPDATE, NUNCA INSERT. Uma linha sem par no disparo é uma mensagem que
 * este produto não mandou — outro sistema no mesmo número, um teste
 * pelo painel da Meta — e criá-la aqui produziria um total que não bate
 * com nenhuma tela do produto.
 *
 * Lê a linha antes de escrever, por duas razões:
 *
 *   * pegar o `id`, para escrever UMA linha — `wamid` não é único
 *     (migração 009: "Meta IDs aren't unique across phone numbers"), e
 *     um UPDATE por `wamid` marcaria todas as homônimas de uma vez;
 *   * ler o `last_status` atual, para não deixar um `sent` atrasado
 *     rebaixar uma mensagem que já foi lida.
 *
 * ------------------------------------------------------------
 * O QUE ISTO NÃO RESOLVE
 * ------------------------------------------------------------
 *
 * A busca NÃO É ESCOPADA POR CONTA — o handler de status chama isto
 * antes de resolver de qual conta é o número, e não há `account_id` na
 * mão. Se duas contas desta instalação tiverem linhas com o mesmo
 * `wamid`, a atualização pode cair na conta errada.
 *
 * Está escrito aqui porque é uma limitação, não um descuido: é
 * exatamente a mesma exposição que o espelhamento em `messages` e em
 * `broadcast_recipients` já tem no mesmo handler, pelo mesmo motivo, e
 * consertar uma das três sozinha daria a impressão de que as outras
 * duas estão certas. O conserto é resolver a conta uma vez por evento
 * e escopar as três — trabalho de webhook, não de relatório.
 *
 * Numa instalação de conta única — que é o caso hoje — a colisão não
 * existe.
 */
export async function applyMetaPricing(
  db: SupabaseClient,
  args: ApplyMetaPricingArgs
): Promise<void> {
  if (!args.wamid) return;
  try {
    // A mais recente com este wamid. Um id reaproveitado meses depois
    // pertence ao disparo novo, não ao antigo.
    const { data: row, error: findErr } = await db
      .from('whatsapp_usage_log')
      .select('id, last_status, priced_at')
      .eq('wamid', args.wamid)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) {
      console.error('[whatsapp usage] lookup failed:', findErr);
      return;
    }
    // Não é erro: a maioria dos status que chegam é de mensagem de
    // texto, que não tem linha aqui.
    if (!row) return;

    const update: Record<string, unknown> = {};

    if (advancesStatus(row.last_status as string | null, args.status)) {
      update.last_status = args.status;
    }

    // O objeto `pricing` só vem uma vez, no primeiro status faturável.
    // `priced_at` já preenchido significa que ele já veio; sobrescrever
    // com um evento posterior (que traz `pricing` vazio) apagaria o
    // dado que a tabela existe para guardar.
    if (args.pricing && !row.priced_at) {
      update.billable = args.pricing.billable ?? null;
      update.billable_category = args.pricing.category ?? null;
      update.pricing_model = args.pricing.pricing_model ?? null;
      update.pricing_type = args.pricing.type ?? null;
      update.priced_at = new Date().toISOString();
    }

    if (args.conversation && !row.priced_at) {
      update.meta_conversation_id = args.conversation.id ?? null;
      update.conversation_origin = args.conversation.origin?.type ?? null;
    }

    if (Object.keys(update).length === 0) return;

    const { error: updErr } = await db
      .from('whatsapp_usage_log')
      .update(update)
      .eq('id', row.id);

    if (updErr) {
      console.error('[whatsapp usage] pricing update failed:', updErr);
    }
  } catch (err) {
    console.error('[whatsapp usage] pricing update threw:', err);
  }
}

/**
 * A escada de entrega, só para frente.
 *
 * Mesma regra que `broadcast_recipients` já aplica no webhook, pela
 * mesma razão: a Meta não promete ordem, e um `sent` que chega depois
 * do `read` não pode desfazer o `read`.
 *
 * `failed` é o único que sai da escada — ele encerra a mensagem, e só é
 * aceito antes de qualquer sucesso de entrega.
 */
function advancesStatus(current: string | null, incoming: string): boolean {
  const ladder = ['sent', 'delivered', 'read'];
  if (incoming === 'failed') {
    return current === null || current === 'sent';
  }
  if (current === 'failed') return false;
  const ii = ladder.indexOf(incoming);
  if (ii < 0) return false;
  const ci = current === null ? -1 : ladder.indexOf(current);
  return ii > ci;
}
