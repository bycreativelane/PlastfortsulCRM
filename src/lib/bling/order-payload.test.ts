import { describe, expect, it } from 'vitest';

import {
  buildOrderPayload,
  compareRemoteOrder,
  externalKey,
  stableJson,
  type OrderSource,
} from './order-payload';

/** O formato que o teste lê — o do POST, só com o que é conferido. */
interface PayloadDeTeste {
  numeroLoja: string;
  data: string;
  dataPrevista: string;
  dataSaida?: string;
  contato: unknown;
  situacao?: unknown;
  vendedor?: unknown;
  categoria: unknown;
  itens: Array<Record<string, unknown>>;
  parcelas: Array<Record<string, unknown>>;
  outrasDespesas?: number;
  desconto?: unknown;
  transporte: Record<string, unknown>;
  observacoes?: string;
  observacoesInternas?: string;
}

const DEAL_ID = '671f940a-0000-4000-8000-00000000abcd';
const ITEM_UUID = 'b1b1b1b1-0000-4000-8000-000000000001';

/** Um pedido de exemplo, sem dado real de cliente. */
const BASE: OrderSource = {
  deal: {
    id: DEAL_ID,
    sale_date: '2026-09-15',
    departure_date: null,
    expected_date: null,
    delivery_days: 10,
    notes: 'Entregar no galpão',
    internal_notes: 'margem apertada',
    shipping_cost: '80.00',
    other_expenses: '20.00',
    general_discount: '3.00',
    general_discount_unit: 'REAL',
    freight_mode: '0',
    freight_volumes: '3.000',
    gross_weight: '72.5004',
    revenue_category_bling_id: null,
    bling_external_key: null,
  },
  items: [
    {
      product_id: ITEM_UUID,
      name: 'Sacos para silagem 51x110',
      sku: 'SIL-51110',
      unit: 'PCT',
      quantity: '8.000',
      unit_price: '115.00',
      discount_percent: '0',
      bling_product_id: '16000001',
      revenue_category_bling_id: '901',
      defines_order_category: true,
    },
    {
      product_id: 'b1b1b1b1-0000-4000-8000-000000000002',
      name: 'Abraçadeira UV',
      sku: 'ABR-UV',
      unit: 'PCT',
      quantity: 8,
      unit_price: 16,
      discount_percent: 6.25,
      bling_product_id: '16000002',
      revenue_category_bling_id: '902',
      defines_order_category: false,
    },
  ],
  // 920 + 120 = 1040 produtos; + 20 despesas + 80 frete − 3 desconto = 1137
  installments: [
    { due_on: '2026-10-15', amount: '568.50', note: null, payment_method_bling_id: '7001' },
    { due_on: '2026-11-14', amount: '568.50', note: 'boleto', payment_method_bling_id: '7001' },
  ],
  contactBlingId: '5551234',
  carrier: {
    name: 'Transportadora Exemplo',
    bling_contact_id: '888',
    bling_contact_name: 'Transp. Exemplo Ltda',
    default_freight_payer_code: '1',
    is_customer_pickup: false,
  },
  sellerBlingId: '321',
  statusOpenId: '6',
  today: '2026-09-20',
};

describe('buildOrderPayload — o contrato do POST /pedidos/vendas', () => {
  const r = buildOrderPayload(BASE, 'create');
  if (!r.ok) throw new Error(`esperava payload: ${r.problems}`);
  const p = r.payload as unknown as PayloadDeTeste;

  it('cabeçalho: chave do CRM, datas, cliente e situação Em aberto', () => {
    expect(p.numeroLoja).toBe(externalKey(DEAL_ID));
    expect(p.numeroLoja).toMatch(/^CRM-ORC-[0-9A-F]{16}$/);
    expect(p.data).toBe('2026-09-15');
    // Prevista = venda + prazo (sem data de saída).
    expect(p.dataPrevista).toBe('2026-09-25');
    expect(p.dataSaida).toBeUndefined();
    expect(p.contato).toEqual({ id: 5551234 });
    expect(p.situacao).toEqual({ id: 6 });
    expect(p.vendedor).toEqual({ id: 321 });
  });

  it('itens: preço unitário, desconto PERCENTUAL e o produto do Bling — nenhum id do CRM', () => {
    expect(p.itens).toEqual([
      { codigo: 'SIL-51110', unidade: 'PCT', quantidade: 8, desconto: 0, valor: 115, descricao: 'Sacos para silagem 51x110', produto: { id: 16000001 } },
      { codigo: 'ABR-UV', unidade: 'PCT', quantidade: 8, desconto: 6.25, valor: 16, descricao: 'Abraçadeira UV', produto: { id: 16000002 } },
    ]);
    for (const item of p.itens) expect(item).not.toHaveProperty('id');
    for (const parcela of p.parcelas) expect(parcela).not.toHaveProperty('id');
    expect(JSON.stringify(p)).not.toContain(ITEM_UUID);
    expect(p).not.toHaveProperty('valorLista');
  });

  it('categoria pela regra do misto: a abraçadeira (auxiliar) não decide', () => {
    expect(p.categoria).toEqual({ id: 901 });
  });

  it('valores: despesas, desconto e o transporte com o transportador', () => {
    expect(p.outrasDespesas).toBe(20);
    expect(p.desconto).toEqual({ valor: 3, unidade: 'REAL' });
    expect(p.transporte).toEqual({
      fretePorConta: 0,
      frete: 80,
      quantidadeVolumes: 3,
      pesoBruto: 72.5,
      prazoEntrega: 10,
      contato: { id: 888, nome: 'Transp. Exemplo Ltda' },
    });
    expect(r.totalCents).toBe(113700);
  });

  it('parcelas com forma por id e observação', () => {
    expect(p.parcelas).toEqual([
      { dataVencimento: '2026-10-15', valor: 568.5, formaPagamento: { id: 7001 } },
      { dataVencimento: '2026-11-14', valor: 568.5, observacoes: 'boleto', formaPagamento: { id: 7001 } },
    ]);
  });

  it('observações vão como observações; as internas, como internas', () => {
    expect(p.observacoes).toBe('Entregar no galpão');
    expect(p.observacoesInternas).toBe('margem apertada');
  });

  it('atualizar vai sem situação', () => {
    const u = buildOrderPayload(BASE, 'update');
    expect(u.ok && (u.payload as Record<string, unknown>).situacao).toBeUndefined();
  });

  it('sem prazo nem prevista, a prevista é a data do pedido (D12); sem data de venda, hoje', () => {
    const semPrazo = buildOrderPayload(
      { ...BASE, deal: { ...BASE.deal, delivery_days: null, sale_date: null } },
      'create'
    );
    expect(semPrazo.ok && (semPrazo.payload as Record<string, unknown>).data).toBe('2026-09-20');
    expect(semPrazo.ok && (semPrazo.payload as Record<string, unknown>).dataPrevista).toBe('2026-09-20');
  });

  it('frete por conta cai no padrão da transportadora quando a oportunidade não diz', () => {
    const r2 = buildOrderPayload({ ...BASE, deal: { ...BASE.deal, freight_mode: null } }, 'create');
    expect(r2.ok && (r2.payload as unknown as PayloadDeTeste).transporte.fretePorConta).toBe(1);
  });
});

describe('buildOrderPayload — o que impede de montar', () => {
  const problemas = (src: OrderSource, modo: 'create' | 'update' = 'create') => {
    const r = buildOrderPayload(src, modo);
    return r.ok ? [] : r.problems;
  };

  it('parcelas um centavo abaixo do total', () => {
    expect(
      problemas({
        ...BASE,
        installments: [{ ...BASE.installments[0], amount: '1136.99' }],
      })
    ).toEqual(['installments_mismatch']);
  });

  it('item sem produto do Bling, cliente sem id, forma sem id', () => {
    expect(
      problemas({
        ...BASE,
        contactBlingId: null,
        items: [{ ...BASE.items[0], bling_product_id: null }, BASE.items[1]],
        installments: [{ ...BASE.installments[0], payment_method_bling_id: 'x' }, BASE.installments[1]],
      }).sort()
    ).toEqual(['installment_without_method', 'item_not_linked', 'no_contact'].sort());
  });

  it('misto sem escolha não tem categoria; com escolha entre as opções, tem', () => {
    const misto = {
      ...BASE,
      items: [BASE.items[0], { ...BASE.items[1], defines_order_category: true }],
    };
    expect(problemas(misto)).toEqual(['no_category']);
    expect(problemas({ ...misto, deal: { ...misto.deal, revenue_category_bling_id: '902' } })).toEqual([]);
  });

  it('criar exige a situação Em aberto confirmada; atualizar não', () => {
    expect(problemas({ ...BASE, statusOpenId: null })).toEqual(['no_open_status']);
    expect(problemas({ ...BASE, statusOpenId: null }, 'update')).toEqual([]);
  });
});

describe('resumo e conferência', () => {
  it('o resumo não depende da ordem das chaves e muda com o valor', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
    const a = buildOrderPayload(BASE, 'update');
    const b = buildOrderPayload({ ...BASE, deal: { ...BASE.deal, notes: 'outra' } }, 'update');
    expect(a.ok && b.ok && a.hash !== b.hash).toBe(true);
    const c = buildOrderPayload(BASE, 'update');
    expect(a.ok && c.ok && a.hash === c.hash).toBe(true);
  });

  it('compareRemoteOrder acusa total, itens e cliente', () => {
    const esperado = { totalCents: 113700, itemCount: 2, contactId: 5551234 };
    expect(compareRemoteOrder({ total: 1137, itens: [{}, {}], contato: { id: 5551234 } }, esperado)).toEqual([]);
    expect(compareRemoteOrder({ total: 1137.01, itens: [{}], contato: { id: 1 } }, esperado)).toEqual([
      'total',
      'items',
      'contact',
    ]);
    expect(compareRemoteOrder(null, esperado)).toEqual(['missing']);
  });
});
