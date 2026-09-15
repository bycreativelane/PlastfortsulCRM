import { afterEach, describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import { fakeDb } from './fake-db';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';
import { importProducts, isVariationParent, listHash, productFromBling } from './products';

const CONFIG = { clientId: 'id', clientSecret: 's', redirectUri: 'https://crm.example.com/cb' };
const AGORA = Date.parse('2026-09-15T12:00:00.000Z');

type Linha = Record<string, unknown>;

describe('productFromBling', () => {
  it('junta listagem e detalhe; peso em 3 casas, preço em centavos', () => {
    const p = productFromBling(
      { id: 10, nome: 'Saco para silagem 200mic', codigo: 'SIL-200', preco: 16.005, situacao: 'A', tipo: 'P' },
      { id: 10, unidade: 'UN', pesoBruto: 1.23456, pesoLiquido: 1.2, categoria: { id: 77 } }
    );
    expect(p).toEqual({
      id: '10',
      name: 'Saco para silagem 200mic',
      code: 'SIL-200',
      price: 16.01,
      unit: 'UN',
      type: 'P',
      active: true,
      grossWeightKg: 1.235,
      netWeightKg: 1.2,
      familyId: '77',
    });
  });

  it('peso negativo ou lixo vira nulo; sem id ou nome, não há produto', () => {
    expect(productFromBling({ id: 1, nome: 'X' }, { pesoBruto: -2 })?.grossWeightKg).toBeNull();
    expect(productFromBling({ nome: 'X' }, null)).toBeNull();
    expect(productFromBling({ id: 1 }, null)).toBeNull();
  });

  it('pai com variações não é vendável; a variação é', () => {
    expect(isVariationParent({ formato: 'V', idProdutoPai: 0 })).toBe(true);
    expect(isVariationParent({ formato: 'V', idProdutoPai: 99 })).toBe(false);
    expect(isVariationParent({ formato: 'S' })).toBe(false);
  });

  it('o resumo muda quando a listagem muda', () => {
    expect(listHash({ nome: 'A', preco: 1 })).not.toBe(listHash({ nome: 'A', preco: 2 }));
    expect(listHash({ nome: 'A', preco: 1 })).toBe(listHash({ nome: 'A', preco: 1 }));
  });
});

/** O Bling de mentira: a listagem por critério e saldo, e o detalhe por id. */
function blingFalso(
  catalogo: Array<{ item: Linha; detalhe?: Linha; criterio?: number; saldo?: number }>,
  opcoes: { detalheFalha?: string[] } = {}
) {
  const chamadas: string[] = [];
  const impl: FetchLike = async (url) => {
    if (url === BLING_TOKEN_URL) throw new Error('não deveria renovar');
    const u = new URL(url);
    const caminho = u.pathname.replace('/Api/v3', '');
    chamadas.push(`${caminho}${u.search}`);
    if (caminho === '/produtos') {
      const criterio = Number(u.searchParams.get('criterio'));
      const saldo = Number(u.searchParams.get('filtroSaldoEstoque'));
      const pagina = Number(u.searchParams.get('pagina'));
      const itens = catalogo
        .filter((c) => (c.criterio ?? 2) === criterio && (c.saldo ?? 1) === saldo)
        .map((c) => c.item);
      return new Response(JSON.stringify({ data: pagina === 1 ? itens : [] }), { status: 200 });
    }
    const id = caminho.split('/').pop() as string;
    if (opcoes.detalheFalha?.includes(id)) {
      return new Response(JSON.stringify({ error: { type: 'SERVER_ERROR', description: 'fora' } }), { status: 503 });
    }
    const achado = catalogo.find((c) => String(c.item.id) === id);
    return new Response(JSON.stringify({ data: { ...achado?.item, ...(achado?.detalhe ?? {}) } }), { status: 200 });
  };
  return { impl, chamadas };
}

function banco(produtos: Linha[] = [], extras: Record<string, Linha[]> = {}) {
  return fakeDb({
    tables: {
      bling_connections: [
        {
          id: 'conn-1',
          account_id: 'acc-1',
          status: 'connected',
          access_token: encrypt('access'),
          access_expires_at: new Date(AGORA + 3_600_000).toISOString(),
          refresh_token: encrypt('refresh'),
          refresh_lock_until: null,
          consecutive_failures: 0,
        },
      ],
      bling_references: [
        { connection_id: 'conn-1', kind: 'product_category', bling_id: '77', label: 'Sacos para silagem' },
      ],
      products: produtos,
      bling_product_matches: [],
      ...extras,
    },
    unique: { bling_product_matches: ['connection_id,bling_product_id'] },
    rpcs: { bling_take_request: () => 0 },
  });
}

const deps = (impl: FetchLike) => ({ config: CONFIG, fetchImpl: impl, now: () => AGORA });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('importProducts', () => {
  it('pede as seis listagens: ativos e inativos, com saldo zerado, positivo e negativo', async () => {
    const db = banco();
    const bling = blingFalso([]);
    await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl));
    const listagens = bling.chamadas.filter((c) => c.startsWith('/produtos?')).map((c) => {
      const q = new URLSearchParams(c.split('?')[1]);
      return `${q.get('criterio')}/${q.get('filtroSaldoEstoque')}/${q.get('tipo')}`;
    });
    expect(listagens.sort()).toEqual(['2/0/T', '2/1/T', '2/2/T', '3/0/T', '3/1/T', '3/2/T']);
  });

  it('produto sem estoque (saldo zerado) entra — o padrão do Bling o esconderia', async () => {
    const db = banco();
    const bling = blingFalso([{ item: { id: 1, nome: 'Lona sem saldo', codigo: 'LONA-1', preco: 10, situacao: 'A', tipo: 'P' }, saldo: 0 }]);
    const stats = await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl));
    expect(stats.created).toBe(1);
    expect(db.tables.products[0]).toMatchObject({ sku: 'LONA-1', bling_product_id: '1', account_id: 'acc-1' });
  });

  it('vincula ao produto existente pelo código, sem caixa, e o preço do Bling vira o de lista', async () => {
    const db = banco([{ id: 'p-1', account_id: 'acc-1', name: 'Saco silagem', sku: 'sil-200', price: 12, active: true, bling_product_id: null }]);
    const bling = blingFalso([
      {
        item: { id: 10, nome: 'Saco para silagem 200mic', codigo: 'SIL-200', preco: 16, situacao: 'A', tipo: 'P' },
        detalhe: { unidade: 'UN', pesoBruto: 1.5, categoria: { id: 77 } },
      },
    ]);
    const stats = await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl));
    expect(stats).toMatchObject({ linked: 1, created: 0, pending: 0 });
    expect(db.tables.products).toHaveLength(1);
    expect(db.tables.products[0]).toMatchObject({
      bling_product_id: '10',
      price: 16,
      gross_weight_kg: 1.5,
      bling_family_id: '77',
      category: 'Sacos para silagem',
    });
  });

  it('sem código e com código já vinculado a outro: pendência, nunca duplicata', async () => {
    const db = banco([{ id: 'p-9', account_id: 'acc-1', name: 'Outro', sku: 'X-1', active: true, bling_product_id: '999' }]);
    const bling = blingFalso([
      { item: { id: 20, nome: 'Sem código', situacao: 'A', tipo: 'P' } },
      { item: { id: 21, nome: 'Mesmo código', codigo: 'x-1', situacao: 'A', tipo: 'P' } },
    ]);
    const stats = await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl));
    expect(stats.pending).toBe(2);
    expect(db.tables.products).toHaveLength(1);
    expect(db.tables.bling_product_matches.map((m) => [m.bling_product_id, m.reason, m.candidate_product_id])).toEqual([
      ['20', 'no_sku', null],
      ['21', 'sku_linked_elsewhere', 'p-9'],
    ]);
  });

  it('pendência que um admin ignorou continua ignorada na importação seguinte', async () => {
    const db = banco([], {
      bling_product_matches: [
        { id: 'm-1', connection_id: 'conn-1', bling_product_id: '20', reason: 'no_sku', status: 'ignored' },
      ],
    });
    const bling = blingFalso([{ item: { id: 20, nome: 'Sem código', situacao: 'A', tipo: 'P' } }]);
    const stats = await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl));
    expect(stats.pending).toBe(0);
    expect(db.tables.bling_product_matches).toHaveLength(1);
    expect(db.tables.bling_product_matches[0].status).toBe('ignored');
  });

  it('não pede detalhe do que não mudou e foi lido há pouco', async () => {
    const item = { id: 30, nome: 'Estável', codigo: 'EST', preco: 5, situacao: 'A', tipo: 'P' };
    const db = banco([
      {
        id: 'p-3',
        account_id: 'acc-1',
        name: 'Estável',
        sku: 'EST',
        active: true,
        bling_product_id: '30',
        bling_list_hash: listHash(item),
        bling_synced_at: new Date(AGORA - 86_400_000).toISOString(),
      },
    ]);
    const bling = blingFalso([{ item }]);
    const stats = await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl));
    expect(stats.unchanged).toBe(1);
    expect(bling.chamadas.some((c) => c === '/produtos/30')).toBe(false);
  });

  it('teto de detalhe por rodada: o resto fica para a próxima', async () => {
    const db = banco();
    const bling = blingFalso(
      Array.from({ length: 5 }, (_, i) => ({ item: { id: 100 + i, nome: `P${i}`, codigo: `C${i}`, situacao: 'A', tipo: 'P' } }))
    );
    const stats = await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl), { detailBudget: 2 });
    expect(stats.detailed).toBe(2);
    expect(stats.remaining).toBe(3);
    expect(db.tables.products).toHaveLength(2);
  });

  it('detalhe que falha não apaga o peso que o vinculado já tinha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = banco([
      { id: 'p-4', account_id: 'acc-1', name: 'Pesado', sku: 'PES', active: true, bling_product_id: '40', gross_weight_kg: 2.5, bling_family_id: '77', unit: 'CX', bling_list_hash: 'velho' },
    ]);
    const bling = blingFalso([{ item: { id: 40, nome: 'Pesado novo nome', codigo: 'PES', preco: 9, situacao: 'A', tipo: 'P' } }], {
      detalheFalha: ['40'],
    });
    const stats = await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl));
    expect(stats.updated).toBe(1);
    expect(db.tables.products[0]).toMatchObject({
      name: 'Pesado novo nome',
      gross_weight_kg: 2.5,
      bling_family_id: '77',
      unit: 'CX',
      bling_list_hash: 'velho',
    });
  });

  it('vinculado que sumiu do Bling vira inativo; pai com variações não entra', async () => {
    const db = banco([{ id: 'p-5', account_id: 'acc-1', name: 'Some', sku: 'SOME', active: true, bling_product_id: '50' }]);
    const bling = blingFalso([{ item: { id: 60, nome: 'Pai', formato: 'V', idProdutoPai: 0, situacao: 'A', tipo: 'P' } }]);
    const stats = await importProducts(db.client, { id: 'conn-1', account_id: 'acc-1' }, deps(bling.impl));
    expect(stats).toMatchObject({ deactivated: 1, skippedParents: 1, created: 0 });
    expect(db.tables.products[0].active).toBe(false);
  });
});
