import { describe, expect, it } from 'vitest';

import { buildQuote } from './quote';
import { quoteFingerprint } from './fingerprint';
import type { DealItemDraft } from '@/lib/products/catalog';

/**
 * A REGRA QUE O GABRIEL DESCREVEU: guardado por data × produto × cliente
 * × e o resto. Mesmo documento, mesma linha; qualquer coisa diferente,
 * linha nova.
 *
 * O defeito que isto fecha veio com print: apertar "Gerar PDF" oito vezes
 * produzia oito linhas idênticas no arquivo, no mesmo segundo.
 */

const LINHA: DealItemDraft = {
  productId: 'p1',
  name: 'Sacos para silagem 51x110 branco',
  quantity: 100,
  unitPrice: 4.25,
  discountPercent: 0,
};

const BASE = {
  issuedOn: '2026-09-08',
  company: 'PlastfortSul',
  customerName: 'Euclides Fernando Goncalves',
  items: [LINHA],
  currency: 'BRL',
  shipping: 120 as number | null,
  carrier: 'Rodoexpress',
  owner: 'Juliana Prestes',
  notes: 'Prazo 10 dias.',
  orderNumber: '14349',
};

const digital = (extra: Record<string, unknown> = {}, deal = 'd-1') =>
  quoteFingerprint(buildQuote({ ...BASE, ...extra }), deal);

describe('quoteFingerprint', () => {
  it('o mesmo documento dá a mesma impressão — oito cliques, uma linha', () => {
    expect(digital()).toBe(digital());
  });

  it.each([
    ['a data', { issuedOn: '2026-09-09' }],
    ['o número do pedido', { orderNumber: '14350' }],
    ['o cliente', { customerName: 'Marcos Beal' }],
    ['a empresa do cliente', { customerCompany: 'Cotrisel' }],
    ['o frete', { shipping: 130 }],
    ['o transportador', { carrier: 'Cliente retira' }],
    ['o responsável', { owner: 'Vitor' }],
    ['a observação', { notes: 'Prazo 15 dias.' }],
    ['a quantidade', { items: [{ ...LINHA, quantity: 101 }] }],
    ['o preço unitário', { items: [{ ...LINHA, unitPrice: 4.26 }] }],
    ['o desconto', { items: [{ ...LINHA, discountPercent: 5 }] }],
    ['o nome do produto', { items: [{ ...LINHA, name: 'Outro saco' }] }],
    ['o código do produto', { items: [{ ...LINHA, sku: 'SIL-51110' }] }],
    ['a unidade', { items: [{ ...LINHA, unit: 'KG' }] }],
    ['a condição de pagamento', { paymentTerms: '30/60/90' }],
    ['o frete por conta', { freightMode: 'FOB' }],
    ['os volumes', { freightVolumes: 4 }],
    ['o peso bruto', { grossWeight: 128.5 }],
    [
      'uma parcela',
      {
        installments: [
          { days: 30, dueOn: '2026-10-08', amount: 425, method: null, note: null },
        ],
      },
    ],
  ])('muda quando muda %s', (_nome, extra) => {
    expect(digital(extra)).not.toBe(digital());
  });

  it('muda de oportunidade — dois pedidos iguais são dois negócios', () => {
    expect(digital({}, 'd-2')).not.toBe(digital({}, 'd-1'));
  });

  it('a ordem das linhas faz parte do documento', () => {
    const outra: DealItemDraft = { ...LINHA, name: 'Abraçadeira', quantity: 1 };
    expect(digital({ items: [LINHA, outra] })).not.toBe(
      digital({ items: [outra, LINHA] })
    );
  });

  it('frete não definido não é frete zero', () => {
    expect(digital({ shipping: null })).not.toBe(digital({ shipping: 0 }));
  });

  it('um campo não consegue imitar a fronteira entre dois', () => {
    // O separador é ``, que não aparece em texto vindo do banco.
    // Com um separador comum — `|`, por exemplo — um produto chamado
    // "a|100|4.25" produziria a mesma sequência que os campos ao lado, e
    // dois orçamentos DIFERENTES colidiriam numa linha só. Colidir é
    // pior do que duplicar: some um documento que foi enviado.
    const a = digital({
      items: [{ ...LINHA, name: 'a|100|4.25|0|425.00', quantity: 1 }],
    });
    const b = digital({ items: [{ ...LINHA, name: 'a' }] });
    expect(a).not.toBe(b);
  });

  it('a data de uma parcela conta — remarcar é outro documento', () => {
    const parcela = {
      days: 30,
      dueOn: '2026-10-08',
      amount: 425,
      method: 'AGRO sicredi',
      note: null,
    };
    expect(digital({ installments: [parcela] })).not.toBe(
      digital({ installments: [{ ...parcela, dueOn: '2026-10-15' }] })
    );
  });

  it('parcela vazia não é parcela — buildQuote a descarta antes', () => {
    // O formulário cria a linha antes de a pessoa digitar o valor. Ela não
    // pode virar uma impressão digital diferente, ou o botão geraria um PDF
    // novo por causa de uma linha em branco.
    expect(
      digital({
        installments: [
          { days: 0, dueOn: null, amount: 0, method: null, note: null },
        ],
      })
    ).toBe(digital());
  });

  it('é um sha256 em hexadecimal', () => {
    expect(digital()).toMatch(/^[0-9a-f]{64}$/);
  });
});
