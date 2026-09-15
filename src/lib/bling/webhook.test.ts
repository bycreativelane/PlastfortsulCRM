import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import { fakeDb } from './fake-db';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';
import { parseWebhook, processWebhookEvents, receiveWebhook, verifyBlingSignature, webhookSummary } from './webhook';

const SEGREDO = 'segredo-de-teste';
const AGORA = Date.parse('2026-09-15T12:00:00.000Z');
const CONFIG = { clientId: 'id', clientSecret: SEGREDO, redirectUri: 'https://crm.example.com/cb' };

const assinar = (corpo: string, segredo = SEGREDO) => `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`;

/* Um pedido de exemplo como o Bling manda — com dado pessoal FICTÍCIO, para
   provar que ele não chega à tabela. */
const PEDIDO = {
  id: 5001,
  numero: 14501,
  numeroLoja: 'CRM-ORC-671F940A00004000',
  total: 100,
  situacao: { id: 15, valor: 1 },
  contato: { id: 5551, nome: 'Fulano de Exemplo', numeroDocumento: '52998224725' },
};

const corpoDe = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    eventId: 'ev-1',
    date: '2026-09-15T11:59:00Z',
    version: 'v1',
    event: 'order.updated',
    companyId: 'emp-1',
    data: PEDIDO,
    ...extra,
  });

describe('assinatura e envelope', () => {
  it('HMAC-SHA256 do corpo cru com o client secret, no formato sha256=<hex>', () => {
    const corpo = corpoDe();
    expect(verifyBlingSignature(corpo, assinar(corpo), SEGREDO)).toBe(true);
    // Um espaço a mais no corpo é outra assinatura.
    expect(verifyBlingSignature(`${corpo} `, assinar(corpo), SEGREDO)).toBe(false);
    expect(verifyBlingSignature(corpo, assinar(corpo, 'outro'), SEGREDO)).toBe(false);
    expect(verifyBlingSignature(corpo, assinar(corpo).slice('sha256='.length), SEGREDO)).toBe(false);
    expect(verifyBlingSignature(corpo, null, SEGREDO)).toBe(false);
    expect(verifyBlingSignature(corpo, assinar(corpo, ''), '')).toBe(false);
  });

  it('lê o envelope, e sem eventId usa o resumo do corpo (a repetição continua uma linha)', () => {
    expect(parseWebhook(corpoDe())).toMatchObject({ eventId: 'ev-1', event: 'order.updated', companyId: 'emp-1' });
    const semId = corpoDe({ eventId: undefined });
    expect(parseWebhook(semId)?.eventId).toBe(parseWebhook(semId)?.eventId);
    expect(parseWebhook(semId)?.eventId).toMatch(/^sha256:/);
    expect(parseWebhook('não é json')).toBeNull();
    expect(parseWebhook(JSON.stringify({ event: 'order.updated' }))).toBeNull();
  });

  it('o resumo guarda ids e números — nunca nome ou documento', () => {
    const r = webhookSummary(parseWebhook(corpoDe())!);
    expect(r.resourceId).toBe('5001');
    const texto = JSON.stringify(r.summary);
    expect(texto).not.toContain('Fulano');
    expect(texto).not.toContain('52998224725');
    expect(r.summary).toMatchObject({ id: '5001', situacaoId: '15', numeroLoja: 'CRM-ORC-671F940A00004000' });
  });
});

function banco(extras: Record<string, Array<Record<string, unknown>>> = {}) {
  return fakeDb({
    tables: {
      bling_connections: [
        {
          id: 'conn-1',
          account_id: 'acc-1',
          company_id: 'emp-1',
          status: 'connected',
          access_token: encrypt('access'),
          access_expires_at: new Date(AGORA + 3_600_000).toISOString(),
          refresh_token: encrypt('refresh'),
          refresh_lock_until: null,
          consecutive_failures: 0,
        },
      ],
      bling_webhook_events: [],
      bling_settings: [{ account_id: 'acc-1', orders_enabled: true, status_open_id: '6', status_in_progress_id: '15', status_fulfilled_id: '9', status_canceled_id: '12', status_future_purchase_id: '400' }],
      deals: [
        {
          id: 'd-1',
          account_id: 'acc-1',
          user_id: 'u-criador',
          assigned_to: 'prof-1',
          contact_id: 'c-1',
          pipeline_id: 'p-1',
          order_status: 'em_aberto',
          bling_order_id: '5001',
          bling_order_number: '14501',
          sync_status: 'synced',
          sync_version: 3,
          shipping_cost: 0,
        },
      ],
      deal_items: [{ deal_id: 'd-1', name: 'Lona', quantity: 2, unit_price: 50, discount_percent: 0 }],
      pipeline_stages: [{ id: 's-andamento', name: 'Em Andamento', pipeline_id: 'p-1' }],
      profiles: [{ id: 'prof-1', user_id: 'u-vendedor' }],
      bling_operations: [],
      deal_order_events: [],
      notifications: [],
      products: [{ id: 'p-9', account_id: 'acc-1', bling_product_id: '777', bling_list_hash: 'abc' }],
      ...extras,
    },
    unique: { bling_webhook_events: ['event_id'] },
    rpcs: {
      bling_take_request: () => 0,
      bling_claim_webhook_events: (args, tables) =>
        tables.bling_webhook_events
          .filter((e) => (args.p_event_id ? e.id === args.p_event_id : true) && e.status === undefined)
          .map((e) => {
            e.status = 'processing';
            return e.id;
          }),
    },
  });
}

describe('receiveWebhook', () => {
  it('assinatura inválida: 401 e nada gravado', async () => {
    const db = banco();
    const r = await receiveWebhook(db.client, corpoDe(), 'sha256=00', SEGREDO, () => AGORA);
    expect(r.status).toBe(401);
    expect(db.tables.bling_webhook_events).toHaveLength(0);
  });

  it('grava antes de responder; a mesma entrega de novo é 2xx e uma linha só', async () => {
    const db = banco();
    const corpo = corpoDe();
    const primeira = await receiveWebhook(db.client, corpo, assinar(corpo), SEGREDO, () => AGORA);
    expect(primeira).toMatchObject({ status: 200, body: { accepted: true } });
    const segunda = await receiveWebhook(db.client, corpo, assinar(corpo), SEGREDO, () => AGORA);
    expect(segunda).toEqual({ status: 200, body: { duplicate: true } });
    expect(db.tables.bling_webhook_events).toHaveLength(1);
    expect(db.tables.bling_webhook_events[0]).toMatchObject({ account_id: 'acc-1', connection_id: 'conn-1', event: 'order.updated', resource_id: '5001' });
    expect(db.tables.bling_connections[0].last_webhook_at).toBe(new Date(AGORA).toISOString());
  });

  it('empresa que ninguém conectou: 2xx, ignorado, nada gravado', async () => {
    const db = banco();
    const corpo = corpoDe({ companyId: 'outra' });
    const r = await receiveWebhook(db.client, corpo, assinar(corpo), SEGREDO, () => AGORA);
    expect(r).toEqual({ status: 200, body: { ignored: 'unknown_company' } });
    expect(db.tables.bling_webhook_events).toHaveLength(0);
  });
});

function blingFalso(situacao: number, opcoes: { falha503?: boolean } = {}) {
  const chamadas: string[] = [];
  const impl: FetchLike = async (url) => {
    if (url === BLING_TOKEN_URL) throw new Error('não deveria renovar');
    const caminho = new URL(url).pathname.replace('/Api/v3', '');
    chamadas.push(caminho);
    if (opcoes.falha503) return new Response(JSON.stringify({ error: { type: 'SERVER_ERROR', description: 'fora' } }), { status: 503 });
    return new Response(JSON.stringify({ data: { ...PEDIDO, situacao: { id: situacao } } }), { status: 200 });
  };
  return { impl, chamadas };
}

async function receber(db: ReturnType<typeof banco>, extra: Record<string, unknown> = {}) {
  const corpo = corpoDe(extra);
  const r = await receiveWebhook(db.client, corpo, assinar(corpo), SEGREDO, () => AGORA);
  // O fake do claim pega linhas sem status; o insert real nasce 'pending'.
  for (const e of db.tables.bling_webhook_events) if (e.status === 'pending') delete e.status;
  return r;
}

const opcoes = (impl: FetchLike) => ({ deps: { config: CONFIG, fetchImpl: impl, now: () => AGORA, sleep: async () => {} }, now: () => AGORA });

describe('processWebhookEvents', () => {
  it('mudança manual no Bling: relê o pedido, a situação e a etapa acompanham, registra e avisa', async () => {
    const db = banco();
    await receber(db);
    const bling = blingFalso(15);
    expect(await processWebhookEvents(db.client, {}, opcoes(bling.impl))).toBe(1);

    expect(bling.chamadas).toEqual(['/pedidos/vendas/5001']);
    expect(db.tables.deals[0]).toMatchObject({ order_status: 'em_andamento', stage_id: 's-andamento', status: 'won', sync_version: 4 });
    expect(db.tables.deal_order_events[0]).toMatchObject({ kind: 'status_changed', source: 'bling', from_status: 'em_aberto', to_status: 'em_andamento' });
    expect(db.tables.notifications[0]).toMatchObject({ user_id: 'u-vendedor', type: 'bling_order', deal_id: 'd-1', body: 'manual_change' });
    expect(db.tables.bling_webhook_events[0].status).toBe('processed');
  });

  it('fora de ordem: vale o que o pedido diz AGORA, não o que o evento trouxe', async () => {
    const db = banco({ pipeline_stages: [{ id: 's-atendido', name: 'Atendido', pipeline_id: 'p-1' }] });
    // O evento velho diz Em andamento; o pedido, relido, já está Atendido.
    await receber(db);
    await processWebhookEvents(db.client, {}, opcoes(blingFalso(9).impl));
    expect(db.tables.deals[0]).toMatchObject({ order_status: 'atendido', stage_id: 's-atendido' });
  });

  it('eco do próprio CRM (operação na fila): não mexe', async () => {
    const db = banco({ bling_operations: [{ id: 'op-1', deal_id: 'd-1', status: 'running' }] });
    await receber(db);
    await processWebhookEvents(db.client, {}, opcoes(blingFalso(15).impl));
    expect(db.tables.deals[0].order_status).toBe('em_aberto');
    expect(db.tables.notifications).toHaveLength(0);
  });

  it('pedido que não nasceu no CRM: ignorado sem gastar chamada', async () => {
    const db = banco();
    await receber(db, { data: { ...PEDIDO, id: 9999, numeroLoja: 'LOJA-1' } });
    const bling = blingFalso(15);
    await processWebhookEvents(db.client, {}, opcoes(bling.impl));
    expect(bling.chamadas).toEqual([]);
    expect(db.tables.bling_webhook_events[0].status).toBe('ignored');
  });

  it('produto: a próxima importação relê o detalhe', async () => {
    const db = banco();
    await receber(db, { event: 'product.updated', data: { id: 777 } });
    await processWebhookEvents(db.client, {}, opcoes(blingFalso(15).impl));
    expect(db.tables.products[0].bling_list_hash).toBeNull();
  });

  it('Bling fora do ar: o evento volta a pendente, com o erro', async () => {
    const db = banco();
    await receber(db);
    await processWebhookEvents(db.client, {}, opcoes(blingFalso(15, { falha503: true }).impl));
    expect(db.tables.bling_webhook_events[0]).toMatchObject({ status: 'pending' });
    expect(String(db.tables.bling_webhook_events[0].error)).toContain('503');
    expect(db.tables.deals[0].order_status).toBe('em_aberto');
  });
});
