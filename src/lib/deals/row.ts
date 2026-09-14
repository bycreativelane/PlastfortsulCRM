/**
 * A linha de `deals` que a gaveta grava, separada em duas metades.
 *
 * ------------------------------------------------------------------
 * POR QUE DUAS
 * ------------------------------------------------------------------
 *
 * `base` é o que existe em qualquer banco que esta versão do app aceita;
 * `orderShape` é o que a migração 075 acrescentou — condição de pagamento,
 * frete por conta, volumes e peso bruto.
 *
 * A separação existe por causa de um defeito medido. Um `update` que cite
 * UMA coluna inexistente é recusado INTEIRO pelo PostgREST (`PGRST204`),
 * e o commit `2dd02e3` mandava as quatro colunas sempre. Em 14 de setembro
 * de 2026, com a 075 ainda por aplicar, isso quer dizer que NENHUMA
 * oportunidade salvava — inclusive as que ninguém tinha tocado nos campos
 * novos. O payload com as colunas voltou 400; o mesmo sem elas, 204.
 *
 * A gaveta pergunta ao banco (`hasOrderShape`) e só junta `orderShape`
 * quando ele existe. `src/lib/supabase/unapplied-columns.test.ts` lê as
 * migrações e confere que nenhuma coluna nova escorregou para `base`.
 */

export const ORDER_SHAPE_MIGRATION = 75;

export interface DealFields {
  title: string;
  salesOrder: string;
  value: number;
  shipping: number | null;
  carrier: string;
  currency: string;
  contactId: string;
  pipelineId: string;
  stageId: string;
  assignedTo: string;
  notes: string;
  expectedCloseDate: string;
  freightMode: string;
  freightVolumes: number | null;
  grossWeight: number | null;
  paymentTerms: string;
}

export function dealRow(f: DealFields) {
  const base = {
    title: f.title,
    sales_order_number: f.salesOrder.trim() || null,
    value: f.value,
    shipping_cost: f.shipping,
    carrier: f.carrier.trim() || null,
    currency: f.currency,
    contact_id: f.contactId,
    pipeline_id: f.pipelineId,
    stage_id: f.stageId,
    assigned_to: f.assignedTo || null,
    notes: f.notes.trim() || null,
    expected_close_date: f.expectedCloseDate || null,
  };

  const orderShape = {
    // A CHAVE, e não o rótulo traduzido: `freight_mode` é código de domínio
    // de outro sistema, e guardar "Frete por conta do remetente" faria a
    // coluna mudar de conteúdo com o idioma da interface. O documento
    // traduz na hora de imprimir.
    freight_mode: f.freightMode || null,
    freight_volumes: f.freightVolumes,
    gross_weight: f.grossWeight,
    payment_terms: f.paymentTerms.trim() || null,
  };

  return { base, orderShape };
}
