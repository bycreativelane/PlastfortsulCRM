import { describe, expect, it } from 'vitest';

import {
  dividir,
  generateInstallments,
  installmentsTotal,
  parseTerms,
} from './installments';

/**
 * A propriedade que este arquivo existe para defender: AS PARCELAS SOMAM O
 * TOTAL. Um documento que imprime R$ 1.000,00 em negrito e três parcelas
 * de R$ 333,33 logo abaixo está errado na única conta que o cliente
 * confere.
 */

describe('parseTerms', () => {
  it('lê o atalho do Bling', () => {
    expect(parseTerms('30/60/90')).toEqual([30, 60, 90]);
  });

  it.each([
    ['30,60,90', [30, 60, 90]],
    ['30 60 90', [30, 60, 90]],
    ['30;60;90', [30, 60, 90]],
    ['30 / 60 / 90 dias', [30, 60, 90]],
  ])('aceita %s como se fosse barra', (entrada, esperado) => {
    expect(parseTerms(entrada)).toEqual(esperado);
  });

  it('à vista é zero dia, e zero é um número', () => {
    expect(parseTerms('0')).toEqual([0]);
  });

  it('condição sem número nenhum não descreve parcela', () => {
    // "a combinar" é uma condição de pagamento válida de se escrever.
    expect(parseTerms('a combinar')).toEqual([]);
    expect(parseTerms('')).toEqual([]);
  });
});

describe('dividir', () => {
  it('a sobra vai na última — e o conjunto fecha', () => {
    expect(dividir(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(installmentsTotal(dividir(100, 3).map((amount) => ({ amount })))).toBe(
      100
    );
  });

  it('divisão exata não inventa centavo', () => {
    expect(dividir(1200, 4)).toEqual([300, 300, 300, 300]);
  });

  it.each([[7], [3], [11], [13]])(
    'fecha o total em %i parcelas de um valor quebrado',
    (partes) => {
      const valores = dividir(4287.31, partes);
      expect(valores).toHaveLength(partes);
      expect(installmentsTotal(valores.map((amount) => ({ amount })))).toBe(
        4287.31
      );
    }
  );

  it('nenhuma parcela é nenhuma linha', () => {
    expect(dividir(100, 0)).toEqual([]);
  });
});

describe('generateInstallments', () => {
  it('30/60/90 a partir de 8 de setembro', () => {
    const parcelas = generateInstallments({
      terms: '30/60/90',
      total: 900,
      issuedOn: '2026-09-08',
      method: 'AGRO sicredi',
    });

    expect(parcelas.map((p) => p.dueOn)).toEqual([
      '2026-10-08',
      '2026-11-07',
      '2026-12-07',
    ]);
    expect(parcelas.map((p) => p.amount)).toEqual([300, 300, 300]);
    expect(parcelas.every((p) => p.method === 'AGRO sicredi')).toBe(true);
  });

  it('à vista vence no dia da emissão', () => {
    const [parcela] = generateInstallments({
      terms: '0',
      total: 250,
      issuedOn: '2026-09-08',
    });
    expect(parcela.dueOn).toBe('2026-09-08');
    expect(parcela.days).toBe(0);
  });

  it('atravessa a virada do ano sem ajuda', () => {
    const parcelas = generateInstallments({
      terms: '30/60',
      total: 100,
      issuedOn: '2026-12-20',
    });
    expect(parcelas.map((p) => p.dueOn)).toEqual(['2027-01-19', '2027-02-18']);
  });

  it('a soma das parcelas é o total, inclusive quando não divide', () => {
    const parcelas = generateInstallments({
      terms: '30/60/90',
      total: 1000,
      issuedOn: '2026-09-08',
    });
    expect(parcelas.map((p) => p.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(installmentsTotal(parcelas)).toBe(1000);
  });

  it('condição sem número não gera nada', () => {
    expect(
      generateInstallments({
        terms: 'a combinar',
        total: 1000,
        issuedOn: '2026-09-08',
      })
    ).toEqual([]);
  });
});
