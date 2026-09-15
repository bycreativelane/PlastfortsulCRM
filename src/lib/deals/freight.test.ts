import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FREIGHT_LABEL_KEY,
  FREIGHT_PAYER_CODES,
  freightCode,
  freightLabelKey,
} from './freight';

describe('freightCode — o fretePorConta do Bling', () => {
  it('os seis códigos oficiais, e só eles', () => {
    expect([...FREIGHT_PAYER_CODES]).toEqual(['0', '1', '2', '3', '4', '9']);
  });

  it('código gravado volta como está', () => {
    for (const c of FREIGHT_PAYER_CODES) expect(freightCode(c)).toBe(c);
  });

  /*
   * As linhas gravadas antes da 078 guardam a chave de tradução. O app
   * tem de lê-las enquanto a migração não roda — e depois também, porque
   * nada garante que ninguém restaure um backup antigo.
   */
  it('chave antiga vira o código certo', () => {
    expect(freightCode('freightCif')).toBe('0');
    expect(freightCode('freightFob')).toBe('1');
    expect(freightCode('freightThird')).toBe('2');
    expect(freightCode('freightOwnSender')).toBe('3');
    expect(freightCode('freightOwnReceiver')).toBe('4');
    expect(freightCode('freightNone')).toBe('9');
  });

  it('vazio e lixo não viram código nenhum', () => {
    expect(freightCode(null)).toBeNull();
    expect(freightCode('')).toBeNull();
    expect(freightCode('5')).toBeNull();
    expect(freightCode('CIF — remetente')).toBeNull();
  });

  it('o rótulo sai do código e da chave antiga igual', () => {
    expect(freightLabelKey('0')).toBe('freightCif');
    expect(freightLabelKey('freightCif')).toBe('freightCif');
    expect(freightLabelKey('7')).toBeNull();
  });
});

describe('a 078 e este arquivo concordam', () => {
  /*
   * A conversão das linhas antigas mora em SQL e o mapa do app mora aqui.
   * Duas cópias de uma tabela de seis linhas é exatamente o tipo de coisa
   * que diverge sem ninguém ver — uma troca de 3 com 4 na migração
   * inverteria quem paga o frete em todo pedido antigo.
   */
  it('cada WHEN da migração bate com o mapa', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '078_order_totals_and_atomic_save.sql'
      ),
      'utf8'
    );
    const pares = [...sql.matchAll(/WHEN\s+'(freight\w+)'\s+THEN\s+'(\d)'/g)].map(
      (m) => [m[1], m[2]] as const
    );
    expect(pares.length).toBe(6);
    for (const [chave, codigo] of pares) {
      expect(FREIGHT_LABEL_KEY[codigo as keyof typeof FREIGHT_LABEL_KEY]).toBe(
        chave
      );
    }
  });
});
