import { describe, expect, it } from 'vitest';

import {
  fromCents,
  lineTotalCents,
  percentOfCents,
  sumCents,
  toCents,
} from './money';

/**
 * A PARIDADE COM O POSTGRES.
 *
 * Os casos abaixo não são inventados: são linhas gravadas em `deal_items`
 * no banco de teste em 14 de setembro de 2026, com o `total` que a coluna
 * GENERATED da 054 devolveu. Se esta conta mudar, é o banco que ela deixa
 * de imitar.
 *
 * Os três primeiros são os que a conta em float errava — todos no meio
 * centavo exato. Estão aqui para que ninguém "simplifique" `lineTotalCents`
 * de volta para `Math.round(q * p * (1 - d / 100) * 100)`: com essa versão,
 * os três falham.
 */
const DO_BANCO: Array<[number, number, number, number]> = [
  // quantidade, preço, desconto %, total gravado pelo Postgres
  [1, 2.01, 50, 1.01],
  [1, 1.15, 10, 1.04],
  [3, 0.35, 50, 0.53],
  [0.5, 0.01, 0, 0.01],
  [8, 15, 6.25, 112.5],
  [8, 115, 0, 920],
  [2.5, 19.99, 12.5, 43.73],
  [1.333, 3.33, 33.33, 2.96],
];

describe('lineTotalCents — igual à coluna GENERATED da 054', () => {
  it.each(DO_BANCO)('%s × %s com desconto de %s → %s', (q, p, d, banco) => {
    expect(
      lineTotalCents({ quantity: q, unitPrice: p, discountPercent: d })
    ).toBe(Math.round(banco * 100));
  });

  it('a conta em float erra onde esta acerta (o motivo deste arquivo)', () => {
    const emFloat = (q: number, p: number, d: number) =>
      Math.round(q * p * (1 - d / 100) * 100);
    const errados = DO_BANCO.filter(
      ([q, p, d, banco]) => emFloat(q, p, d) !== Math.round(banco * 100)
    );
    // Se isto virar zero, o float passou a acertar por acaso — e o teste
    // de cima deixou de provar alguma coisa.
    expect(errados.length).toBeGreaterThan(0);
  });

  /*
   * O BigInt, e por que ele não é enfeite.
   *
   * Em inteiros o numerador passa de 2^53 com quantidade e preço altos —
   * e ainda assim a versão em `number` costuma acertar, porque o erro do
   * float some na divisão por 10^7. Um primeiro teste com 999.999,999 ×
   * R$ 9.999,99 PASSAVA sem BigInt, e foi a prova por mutação que mostrou
   * que ele não guardava nada.
   *
   * O que derruba a versão em `number` é um caso grande que cai
   * exatamente no meio centavo: o float arredonda o numerador para baixo
   * e o meio vira "menos da metade". Os dois abaixo foram achados por
   * busca e gravados no banco de teste; os totais são os que o Postgres
   * devolveu. Sem BigInt, os dois saem um centavo abaixo.
   */
  it.each([
    [982507.932, 9375, 85.08, 137428296989],
    [918302.375, 9672, 88.5, 102140936567],
  ])(
    'meio centavo com numerador acima de 2^53: %s × %s com desconto de %s',
    (q, p, d, centavosDoBanco) => {
      expect(
        lineTotalCents({ quantity: q, unitPrice: p, discountPercent: d })
      ).toBe(centavosDoBanco);
    }
  );

  it('desconto de 100% zera a linha', () => {
    expect(
      lineTotalCents({ quantity: 3, unitPrice: 10, discountPercent: 100 })
    ).toBe(0);
  });
});

describe('toCents / fromCents', () => {
  it('lê o que o banco manda, número ou texto', () => {
    expect(toCents(2.01)).toBe(201);
    expect(toCents('2.01')).toBe(201);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('vazio e lixo valem zero numa soma', () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents('')).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
  });

  it('ida e volta preserva as duas casas', () => {
    for (const v of [0, 0.01, 0.1, 19.99, 1117, 1234.56]) {
      expect(fromCents(toCents(v)).toFixed(2)).toBe(v.toFixed(2));
    }
  });

  it('a soma em centavos fecha onde a soma em reais não fecha', () => {
    const emReais = 0.1 + 0.2;
    expect(emReais).not.toBe(0.3);
    expect(fromCents(sumCents([toCents(0.1), toCents(0.2)]))).toBe(0.3);
  });
});

describe('percentOfCents — o desconto geral em PERCENTUAL', () => {
  it('arredonda o meio para cima, como o NUMERIC', () => {
    // 10% de R$ 0,05 = 0,005 → 0,01
    expect(percentOfCents(5, 10)).toBe(1);
    // 2,5% de R$ 1.040,00 = 26,00
    expect(percentOfCents(104000, 2.5)).toBe(2600);
  });

  it('zero e cem', () => {
    expect(percentOfCents(104000, 0)).toBe(0);
    expect(percentOfCents(104000, 100)).toBe(104000);
  });
});
