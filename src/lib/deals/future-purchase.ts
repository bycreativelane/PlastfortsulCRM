import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * "Volte a falar comigo em setembro" também move a oportunidade.
 *
 * ------------------------------------------------------------------
 * O QUE ESTAVA FALTANDO
 * ------------------------------------------------------------------
 *
 * A ação rápida **Compra futura** gravava a data em
 * `contacts.next_purchase_expected_at` e parava aí. O texto do diálogo
 * dizia a verdade — "a data fica na ficha do contato" — e a verdade era o
 * problema: o vendedor registrava a compra futura na conversa e a
 * oportunidade continuava parada na etapa em que estava, até alguém abrir o
 * Kanban e arrastá-la à mão.
 *
 * O item 5 do pacote de 7 de setembro fecha isso: confirmar uma compra
 * futura move a oportunidade para **VENDAS → Compra Futura**, sem o
 * vendedor sair da conversa.
 *
 * ------------------------------------------------------------------
 * E NÃO CRIA DUPLICATA
 * ------------------------------------------------------------------
 *
 * É o item 35 sob "não fazer": nunca criar oportunidade duplicada. A regra
 * aqui é procurar primeiro — qualquer oportunidade ABERTA do contato no
 * funil de Vendas serve, e a mais recente ganha. Só quando não há nenhuma é
 * que se cria, e aí ela já nasce na etapa certa em vez de nascer em Novo
 * Lead e ser movida em seguida (o que produziria dois eventos de etapa para
 * uma coisa que aconteceu uma vez).
 */

/**
 * Nomes que valem por "a mesma etapa".
 *
 * O pacote escreve "Compra-futura", o produto grava "Compra Futura", e
 * alguém em algum momento vai digitar "compra futura". Comparar sem
 * acento, sem hífen e sem caixa é o que faz os três casarem — e é mais
 * barato do que exigir que a conta renomeie a etapa.
 */
export function normalizeStageName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface StageRow {
  id: string;
  name: string;
  pipeline_id: string;
}

/**
 * A etapa cujo nome bate com um dos aceitos, dentro do funil dado.
 *
 * Devolve `null` quando não existe — e quem chama trata isso como "não
 * mover" em vez de inventar uma etapa. Uma conta que ainda não montou o
 * funil oficial não deve ver a compra futura falhar; ela deve ver a data
 * ser salva, que é o que sempre funcionou.
 */
export function findStage(
  stages: StageRow[],
  pipelineId: string,
  accepted: string[]
): StageRow | null {
  const wanted = accepted.map(normalizeStageName);
  return (
    stages.find(
      (s) =>
        s.pipeline_id === pipelineId &&
        wanted.includes(normalizeStageName(s.name))
    ) ?? null
  );
}

/** Os nomes que este produto aceita para a etapa de compra futura. */
export const FUTURE_PURCHASE_STAGE_NAMES = [
  'Compra Futura',
  'Compra-futura',
  'Compra futura',
];

/** E os do funil comercial. */
export const SALES_PIPELINE_NAMES = ['Vendas', 'VENDAS', 'Comercial'];

export interface MoveOutcome {
  /** `moved` mexeu numa que existia, `created` abriu uma nova. */
  action: 'moved' | 'created' | 'skipped';
  dealId: string | null;
  /** Por que não fez nada — só quando `skipped`. */
  reason?: 'no_pipeline' | 'no_stage' | 'failed';
}

/**
 * Põe a oportunidade do contato em Compra Futura.
 *
 * Escreve pelo navegador, sob RLS, como o resto do CRM faz com `deals`
 * (`lib/dashboard/agenda.ts` já reagenda assim). Não há rota nova: mover
 * uma oportunidade é coisa que um agente pode fazer, e a RLS da 002 é quem
 * decide isso.
 */
export async function moveContactToFuturePurchase(
  db: SupabaseClient,
  contactId: string,
  accountId: string,
  /** `auth.uid()` — `deals.user_id` é NOT NULL desde a 001. */
  userId: string
): Promise<MoveOutcome> {
  const { data: pipelineRows } = await db
    .from('pipelines')
    .select('id, name')
    .eq('account_id', accountId);

  const pipelines = (pipelineRows ?? []) as Array<{ id: string; name: string }>;
  const wantedPipelines = SALES_PIPELINE_NAMES.map(normalizeStageName);
  const pipeline =
    pipelines.find((p) => wantedPipelines.includes(normalizeStageName(p.name)))
    // Conta com um funil só: é ele, qualquer que seja o nome.
    ?? (pipelines.length === 1 ? pipelines[0] : null);

  if (!pipeline) return { action: 'skipped', dealId: null, reason: 'no_pipeline' };

  const { data: stageRows } = await db
    .from('pipeline_stages')
    .select('id, name, pipeline_id')
    .eq('pipeline_id', pipeline.id);

  const stage = findStage(
    (stageRows ?? []) as StageRow[],
    pipeline.id,
    FUTURE_PURCHASE_STAGE_NAMES
  );
  if (!stage) return { action: 'skipped', dealId: null, reason: 'no_stage' };

  // A oportunidade aberta mais recente do contato neste funil. Aberta
  // porque mover uma ganha ou perdida reescreveria história, e a mais
  // recente porque é a que a conversa de agora é sobre.
  const { data: dealRows } = await db
    .from('deals')
    .select('id, stage_id')
    .eq('contact_id', contactId)
    .eq('pipeline_id', pipeline.id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1);

  const existing = (dealRows ?? [])[0] as
    | { id: string; stage_id: string }
    | undefined;

  if (existing) {
    // Já está lá: nada a fazer, e sobretudo nenhum evento de etapa novo.
    if (existing.stage_id === stage.id) {
      return { action: 'moved', dealId: existing.id };
    }
    const { error } = await db
      .from('deals')
      .update({ stage_id: stage.id, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return { action: 'skipped', dealId: null, reason: 'failed' };
    return { action: 'moved', dealId: existing.id };
  }

  // Nenhuma aberta: cria já na etapa certa. Criar em Novo Lead e mover em
  // seguida produziria dois eventos de etapa para uma coisa que aconteceu
  // uma vez, e a automação de Novo Lead dispararia sem motivo.
  const { data: contact } = await db
    .from('contacts')
    .select('name, phone')
    .eq('id', contactId)
    .maybeSingle();

  const row = contact as { name?: string | null; phone?: string | null } | null;
  const title = row?.name?.trim() || row?.phone?.trim() || 'Oportunidade';

  const { data: created, error } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      // NOT NULL na 001, e a política "Users can manage own deals" compara
      // com `auth.uid()` — sem isto o insert é recusado pela RLS antes de
      // chegar na constraint.
      user_id: userId,
      contact_id: contactId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      title,
      status: 'open',
    })
    .select('id')
    .maybeSingle();

  if (error || !created) {
    return { action: 'skipped', dealId: null, reason: 'failed' };
  }
  return { action: 'created', dealId: (created as { id: string }).id };
}
