import { describe, expect, it } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import { fakeDb } from './fake-db';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';
import { externalKey } from './order-payload';
import { BlingApiError } from './errors';
import {
  loadOrderForBling,
  orderIsSynced,
  orderMatchesBling,
  orderSourceHash,
  readinessOfLoaded,
  syncOrder,
  textoDoErro,
} from './orders';

const CONFIG = { clientId: 'id', clientSecret: 's', redirectUri: 'https://crm.example.com/cb' };
const AGORA = Date.parse('2026-09-15T12:00:00.000Z');
const DEAL = '671f940a-0000-4000-8000-00000000abcd';
const CNPJ = '11222333000181';

type Linha = Record<string, unknown>;

function banco(extras: { deal?: Linha; settings?: Linha | null } = {}) {
  return fakeDb({
    tables: {
      bling_connections: [
        {
          id: 'conn-1',
          account_id: 'acc-1',
          company_id: 'emp-1',
          company_name: 'Empresa',
          status: 'connected',
          access_token: encrypt('access'),
          access_expires_at: new Date(AGORA + 3_600_000).toISOString(),
          refresh_token: encrypt('refresh'),
          refresh_lock_until: null,
          consecutive_failures: 0,
        },
      ],
      bling_settings:
        extras.settings === null
          ? []
          : [{ account_id: 'acc-1', company_id: 'emp-1', orders_enabled: true, status_open_id: '6', ...(extras.settings ?? {}) }],
      deals: [
        {
          id: DEAL,
          account_id: 'acc-1',
          contact_id: 'c-1',
          assigned_to: 'prof-1',
          carrier_id: 'car-1',
          sale_date: '2026-09-15',
          shipping_cost: 0,
          freight_mode: '9',
          notes: null,
          internal_notes: null,
          order_status: null,
          bling_order_id: null,
          bling_external_key: null,
          sync_version: 0,
          ...(extras.deal ?? {}),
        },
      ],
      deal_items: [
        {
          account_id: 'acc-1',
          deal_id: DEAL,
          product_id: 'p-1',
          name: 'Lona 4x5',
          sku: 'LONA-45',
          unit: 'UN',
          quantity: 2,
          unit_price: 50,
          discount_percent: 0,
          position: 0,
          bling_product_id: '1600',
          revenue_category_bling_id: '901',
          defines_order_category: true,
        },
      ],
      deal_installments: [
        { account_id: 'acc-1', deal_id: DEAL, position: 0, due_on: '2026-10-15', amount: 100, note: null, payment_method_bling_id: '7001' },
      ],
      contacts: [
        {
          id: 'c-1',
          account_id: 'acc-1',
          name: 'Cliente Exemplo',
          company: 'Empresa Exemplo',
          tax_id: CNPJ,
          person_type: 'J',
          zip_code: '90000000',
          street: 'Rua de Teste',
          street_number: '1',
          district: 'Centro',
          city: 'Cidade',
          state: 'RS',
          bling_contact_id: '5551',
        },
      ],
      carriers: [
        { id: 'car-1', account_id: 'acc-1', name: 'Cliente retira', bling_contact_id: null, bling_contact_name: null, default_freight_payer_code: '9', is_customer_pickup: true },
      ],
      profiles: [{ id: 'prof-1', account_id: 'acc-1', user_id: 'user-1' }],
      // O produto como está agora: o snapshot da linha tem de bater (090).
      products: [
        { id: 'p-1', account_id: 'acc-1', active: true, bling_product_id: '1600', bling_product_type: null, bling_family_id: null, revenue_category_bling_id: '901', defines_order_category: true },
      ],
      bling_seller_links: [{ account_id: 'acc-1', user_id: 'user-1', bling_seller_id: '321', company_id: 'emp-1' }],
      bling_references: [{ account_id: 'acc-1', kind: 'contact_type', bling_id: '44', label: 'Cliente', removed_at: null }],
    },
    rpcs: { bling_take_request: () => 0 },
  });
}

interface Opcoes {
  /** Pedidos que o Bling já tem, por `numeroLoja`. */
  existentes?: Array<{ id: number; numero: number; numeroLoja: string; situacao?: number }>;
  /** O POST grava e a resposta se perde. */
  postPerdeResposta?: boolean;
  postRecusa?: boolean;
  situacaoRemota?: number;
  eventos?: string[];
}

function blingFalso(op: Opcoes = {}) {
  const pedidos = new Map<number, Linha>();
  for (const e of op.existentes ?? []) {
    pedidos.set(e.id, { id: e.id, numero: e.numero, numeroLoja: e.numeroLoja, total: 100, itens: [{}], contato: { id: 5551 }, situacao: { id: e.situacao ?? 6 } });
  }
  const chamadas: string[] = [];
  const corpos: Array<Linha> = [];
  let proximo = 5000;
  const impl: FetchLike = async (url, init) => {
    if (url === BLING_TOKEN_URL) throw new Error('não deveria renovar');
    const u = new URL(url);
    const caminho = u.pathname.replace('/Api/v3', '');
    const metodo = init?.method ?? 'GET';
    chamadas.push(`${metodo} ${caminho}`);
    op.eventos?.push(`bling ${metodo} ${caminho}`);
    if (init?.body) corpos.push(JSON.parse(String(init.body)) as Linha);

    if (caminho.startsWith('/contatos')) {
      return new Response(
        JSON.stringify({ data: { id: 5551, nome: 'Empresa Exemplo', numeroDocumento: CNPJ, tipo: 'J', situacao: 'A', email: 'x@y.test', celular: '1', endereco: { geral: { endereco: 'R', numero: '1', bairro: 'B', cep: '9', municipio: 'C', uf: 'RS' } } } }),
        { status: 200 }
      );
    }
    if (caminho === '/pedidos/vendas' && metodo === 'GET') {
      const chave = u.searchParams.get('numerosLojas[]');
      const achados = [...pedidos.values()].filter((p) => p.numeroLoja === chave);
      return new Response(JSON.stringify({ data: achados }), { status: 200 });
    }
    if (caminho === '/pedidos/vendas' && metodo === 'POST') {
      if (op.postRecusa) {
        return new Response(
          JSON.stringify({ error: { type: 'VALIDATION_ERROR', description: 'Não foi possível salvar a venda', fields: [{ code: 12, msg: 'Id da forma de pagamento inválido.', element: 'formaPagamento' }] } }),
          { status: 400 }
        );
      }
      const corpo = JSON.parse(String(init?.body)) as Linha;
      const id = ++proximo;
      pedidos.set(id, { ...corpo, id, numero: 14500 + id - 5000, total: 100, contato: corpo.contato });
      if (op.postPerdeResposta) {
        op.postPerdeResposta = false;
        throw new TypeError('fetch failed');
      }
      return new Response(JSON.stringify({ data: { id } }), { status: 201 });
    }
    const id = Number(caminho.split('/').pop());
    const pedido = pedidos.get(id);
    if (metodo === 'GET') {
      if (!pedido) return new Response(JSON.stringify({ error: { type: 'RESOURCE_NOT_FOUND', description: 'x' } }), { status: 404 });
      return new Response(JSON.stringify({ data: { ...pedido, situacao: { id: op.situacaoRemota ?? (pedido.situacao as { id: number })?.id ?? 6 } } }), { status: 200 });
    }
    if (metodo === 'PUT') {
      pedidos.set(id, { ...pedido, ...(JSON.parse(String(init?.body)) as Linha), id });
      return new Response(JSON.stringify({ data: { id } }), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  };
  return { impl, chamadas, corpos, pedidos };
}

const opcoes = (impl: FetchLike) => ({
  today: '2026-09-15',
  deps: { config: CONFIG, fetchImpl: impl, now: () => AGORA, sleep: async () => {} },
  now: () => AGORA,
});

describe('loadOrderForBling', () => {
  it('lê o pedido gravado, o vendedor pelo responsável e o tipo "Cliente"', async () => {
    const db = banco();
    const pedido = await loadOrderForBling(db.client, 'acc-1', DEAL);
    expect(pedido?.sellerBlingId).toBe('321');
    expect(pedido?.clientTypeId).toBe('44');
    expect(pedido?.items).toHaveLength(1);
    expect(await loadOrderForBling(db.client, 'outra-conta', DEAL)).toBeNull();
  });

  it('o resumo muda quando o pedido gravado muda', async () => {
    const db = banco();
    const a = orderSourceHash((await loadOrderForBling(db.client, 'acc-1', DEAL))!);
    db.tables.deal_items[0].quantity = 3;
    const b = orderSourceHash((await loadOrderForBling(db.client, 'acc-1', DEAL))!);
    expect(a).not.toBe(b);
  });
});

describe('syncOrder — criar', () => {
  it('consulta pela chave, cria, confere e liga o número do Bling', async () => {
    const eventos: string[] = [];
    const db = banco();
    const bling = blingFalso({ eventos });
    const pedido = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    const r = await syncOrder(db.client, pedido, 'create_order', opcoes(bling.impl));

    expect(r.status).toBe('succeeded');
    expect(bling.chamadas.filter((c) => c.startsWith('POST /pedidos'))).toHaveLength(1);
    // A chave foi gravada no banco antes de qualquer escrita no Bling.
    expect(db.tables.deals[0].bling_external_key).toBe(externalKey(DEAL));
    if (r.status === 'succeeded') {
      expect(r.dealPatch).toMatchObject({
        bling_order_id: '5001',
        bling_order_number: '14501',
        order_status: 'em_aberto',
        sync_status: 'synced',
        sync_error: null,
        sync_version: 1,
      });
    }
    const post = bling.corpos.find((c) => c.numeroLoja) as Linha;
    expect(post.situacao).toEqual({ id: 6 });
    expect(post.vendedor).toEqual({ id: 321 });
  });

  it('timeout DEPOIS do POST: incerto, e a repetição acha o pedido em vez de criar outro', async () => {
    const db = banco();
    const bling = blingFalso({ postPerdeResposta: true });

    const primeira = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'create_order', opcoes(bling.impl));
    expect(primeira).toMatchObject({ status: 'retry', uncertain: true });

    const segunda = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'create_order', opcoes(bling.impl));
    expect(segunda.status).toBe('succeeded');
    // Um pedido só no Bling, e um POST só.
    expect(bling.pedidos.size).toBe(1);
    expect(bling.chamadas.filter((c) => c.startsWith('POST /pedidos'))).toHaveLength(1);
  });

  it('já ligado: termina sem chamar o Bling', async () => {
    const db = banco({ deal: { bling_order_id: '77' } });
    const bling = blingFalso();
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'create_order', opcoes(bling.impl));
    expect(r.status).toBe('succeeded');
    expect(bling.chamadas).toEqual([]);
  });

  it('dois pedidos com a mesma chave lá: divergente, sem criar', async () => {
    const db = banco();
    const chave = externalKey(DEAL);
    const bling = blingFalso({
      existentes: [
        { id: 1, numero: 10, numeroLoja: chave },
        { id: 2, numero: 11, numeroLoja: chave },
      ],
    });
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'create_order', opcoes(bling.impl));
    expect(r).toMatchObject({ status: 'failed', error: 'duplicate_remote', dealPatch: { sync_status: 'divergent' } });
    expect(bling.chamadas.some((c) => c.startsWith('POST /pedidos'))).toBe(false);
  });

  it('recusa do Bling: falha com o que ele disse de cada campo', async () => {
    const db = banco();
    const bling = blingFalso({ postRecusa: true });
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'create_order', opcoes(bling.impl));
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.error).toContain('bling:400');
      expect(r.error).toContain('formaPagamento');
    }
  });

  it('com a chave geral desligada, nada vai ao Bling', async () => {
    const db = banco({ settings: { orders_enabled: false } });
    const bling = blingFalso();
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'create_order', opcoes(bling.impl));
    expect(r).toMatchObject({ status: 'failed', error: 'orders_disabled' });
    expect(bling.chamadas).toEqual([]);
  });

  it('pedido que não fecha não sai: parcelas abaixo do total', async () => {
    const db = banco();
    db.tables.deal_installments[0].amount = 99.99;
    const bling = blingFalso();
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'create_order', opcoes(bling.impl));
    expect(r).toMatchObject({ status: 'failed', error: 'payload:installments_mismatch' });
    expect(bling.chamadas.some((c) => c.includes('/pedidos'))).toBe(false);
  });
});

describe('syncOrder — atualizar', () => {
  it('Em aberto: PUT sem situação, e confere', async () => {
    const db = banco({ deal: { bling_order_id: '5001', order_status: 'em_aberto', sync_version: 3 } });
    const bling = blingFalso({ existentes: [{ id: 5001, numero: 14501, numeroLoja: externalKey(DEAL) }] });
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'update_order', opcoes(bling.impl));
    expect(r.status).toBe('succeeded');
    const put = bling.corpos.find((c) => c.itens) as Linha;
    expect(put).not.toHaveProperty('situacao');
    expect(bling.chamadas.filter((c) => c.startsWith('PUT /pedidos'))).toHaveLength(1);
    if (r.status === 'succeeded') expect(r.dealPatch.sync_version).toBe(4);
  });

  it('o pedido andou no Bling: não atualiza, marca divergente', async () => {
    const db = banco({ deal: { bling_order_id: '5001', order_status: 'em_aberto' } });
    const bling = blingFalso({ existentes: [{ id: 5001, numero: 14501, numeroLoja: externalKey(DEAL) }], situacaoRemota: 9 });
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'update_order', opcoes(bling.impl));
    expect(r).toMatchObject({ status: 'failed', error: 'remote_not_open' });
    expect(bling.chamadas.some((c) => c.startsWith('PUT /pedidos'))).toBe(false);
  });

  it('com contas lançadas, nem consulta', async () => {
    const db = banco({ deal: { bling_order_id: '5001', accounts_launched_at: '2026-09-15T10:00:00Z' } });
    const bling = blingFalso();
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'update_order', opcoes(bling.impl));
    expect(r).toMatchObject({ status: 'failed', error: 'order_launched' });
    expect(bling.chamadas).toEqual([]);
  });
});

describe('auditoria da 0.11.0 — o que o servidor confere antes de mandar', () => {
  it('cadastro de outra conta apontado pela oportunidade não entra no pedido', async () => {
    const db = banco();
    db.tables.contacts[0].account_id = 'outra-conta';
    db.tables.carriers[0].account_id = 'outra-conta';
    db.tables.deal_items[0].account_id = 'outra-conta';
    const pedido = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    expect(pedido.contact).toBeNull();
    expect(pedido.carrier).toBeNull();
    expect(pedido.items).toHaveLength(0);
  });

  it('snapshot que não bate com o produto de agora: a linha conta como sem vínculo, e nada vai ao Bling', async () => {
    const db = banco();
    // O navegador gravou outro produto do Bling na linha.
    db.tables.deal_items[0].bling_product_id = '9999';
    const bling = blingFalso();
    const pedido = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    expect(readinessOfLoaded(pedido).staleLines).toEqual([0]);
    const r = await syncOrder(db.client, pedido, 'create_order', opcoes(bling.impl));
    expect(r).toMatchObject({ status: 'failed', error: 'payload:item_not_linked' });
    expect(bling.chamadas).toEqual([]);
  });

  it('categoria forjada na linha também não passa', async () => {
    const db = banco();
    db.tables.deal_items[0].revenue_category_bling_id = '902';
    const pedido = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    expect(readinessOfLoaded(pedido).unlinkedLines).toEqual([0]);
  });

  it('produto inativo ou texto livre com vínculo forjado: sem vínculo', async () => {
    const db = banco();
    db.tables.products[0].active = false;
    let pedido = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    expect(readinessOfLoaded(pedido).unlinkedLines).toEqual([0]);
    db.tables.products[0].active = true;
    db.tables.deal_items[0].product_id = null;
    pedido = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    expect(readinessOfLoaded(pedido).unlinkedLines).toEqual([0]);
  });

  it('exceção de peso só vale autorizada por admin da conta', async () => {
    const db = banco({ deal: { weight_exception_note: 'sem balança hoje', weight_exception_by: 'user-1' } });
    const itemSemPeso = (p: Awaited<ReturnType<typeof loadOrderForBling>>) =>
      readinessOfLoaded(p!).items.find((i) => i.key === 'weight')?.ok;
    // user-1 é agente (sem papel de admin no perfil).
    db.tables.profiles[0].account_role = 'agent';
    expect(itemSemPeso(await loadOrderForBling(db.client, 'acc-1', DEAL))).toBe(false);
    db.tables.profiles[0].account_role = 'admin';
    expect(itemSemPeso(await loadOrderForBling(db.client, 'acc-1', DEAL))).toBe(true);
  });

  it('o resumo ignora o vínculo do contato e as colunas que não vão ao Bling', async () => {
    const db = banco();
    const a = orderSourceHash((await loadOrderForBling(db.client, 'acc-1', DEAL))!);
    db.tables.contacts[0].bling_contact_id = '7777';
    db.tables.contacts[0].last_message_at = '2026-09-15T12:00:00Z';
    db.tables.contacts[0].tags = ['vip'];
    db.tables.carriers[0].updated_at = '2026-09-15T12:00:00Z';
    expect(orderSourceHash((await loadOrderForBling(db.client, 'acc-1', DEAL))!)).toBe(a);
    db.tables.contacts[0].street_number = '2';
    expect(orderSourceHash((await loadOrderForBling(db.client, 'acc-1', DEAL))!)).not.toBe(a);
  });

  it('criar grava o resumo do que o Bling recebeu; mudar o pedido depois dessincroniza', async () => {
    const db = banco();
    const bling = blingFalso();
    const pedido = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    const r = await syncOrder(db.client, pedido, 'create_order', opcoes(bling.impl));
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    expect(r.dealPatch.bling_source_hash).toBe(orderSourceHash(pedido));

    Object.assign(db.tables.deals[0], r.dealPatch);
    expect(orderIsSynced((await loadOrderForBling(db.client, 'acc-1', DEAL))!)).toBe(true);
    db.tables.deal_installments[0].due_on = '2026-10-20';
    const mudado = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    expect(orderMatchesBling(mudado)).toBe(false);
    expect(orderIsSynced(mudado)).toBe(false);
  });

  it('Compra futura: atualizar não consulta o Bling nem marca divergente', async () => {
    const db = banco({ deal: { bling_order_id: '5001', order_status: 'compra_futura' } });
    const bling = blingFalso({ existentes: [{ id: 5001, numero: 14501, numeroLoja: externalKey(DEAL) }] });
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'update_order', opcoes(bling.impl));
    expect(r).toEqual({ status: 'failed', error: 'order_not_open' });
    expect(bling.chamadas).toEqual([]);
  });

  it('já ligado pela reconciliação: termina sincronizado e Em aberto', async () => {
    const db = banco({ deal: { bling_order_id: '77' } });
    const r = await syncOrder(db.client, (await loadOrderForBling(db.client, 'acc-1', DEAL))!, 'create_order', opcoes(blingFalso().impl));
    expect(r).toMatchObject({ status: 'succeeded', dealPatch: { sync_status: 'synced', order_status: 'em_aberto' } });
  });
});

describe('textoDoErro — sem dado do cliente', () => {
  it('mensagem de campo do contato ou do endereço sai só com o nome do campo', () => {
    const erro = new BlingApiError(400, 'VALIDATION_ERROR', 'Não foi possível salvar', {
      fields: [
        { code: 1, message: 'CEP 90000000 da Rua de Teste inválido', element: 'contato.endereco.cep' },
        { code: 2, message: 'IE não confere com a UF', element: 'ie' },
        { code: 3, message: 'Id da forma de pagamento inválido.', element: 'parcelas[0].formaPagamento' },
      ],
    });
    const texto = textoDoErro(erro);
    expect(texto).toContain('contato.endereco.cep: [omitido]');
    expect(texto).toContain('ie: [omitido]');
    expect(texto).not.toContain('Rua de Teste');
    expect(texto).toContain('Id da forma de pagamento inválido.');
  });
});
