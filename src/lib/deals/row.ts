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

import { freightCode } from './freight';

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
    // O CÓDIGO do Bling (0, 1, 2, 3, 4, 9), e nem o rótulo traduzido nem a
    // chave do catálogo. O comentário anterior dizia "a chave", e ela era
    // detalhe de interface gravado como dado: renomear a mensagem mudaria
    // o que as linhas significam. `freightCode` também aceita a chave
    // antiga, então nada gravado antes da 078 se perde. O documento traduz
    // na hora de imprimir.
    freight_mode: freightCode(f.freightMode),
    freight_volumes: f.freightVolumes,
    gross_weight: f.grossWeight,
    payment_terms: f.paymentTerms.trim() || null,
  };

  return { base, orderShape };
}
