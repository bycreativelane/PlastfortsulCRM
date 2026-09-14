import { describe, expect, it } from 'vitest';

import { estaNoFim, PIN_SLACK } from './use-pin-to-bottom';

/**
 * A pergunta que decide se a conversa pode ser puxada para o fim.
 *
 * O gancho inteiro depende dela: responder "sim" cedo demais sequestra
 * quem está relendo mensagem de ontem; responder "não" por um pixel deixa
 * a sala abrindo no meio, que foi o defeito relatado.
 */

const em = (scrollTop: number, scrollHeight = 1000, clientHeight = 600) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe('estaNoFim', () => {
  it('no fim exato', () => {
    expect(estaNoFim(em(400))).toBe(true);
  });

  it('a lista que cabe inteira já está no fim', () => {
    expect(estaNoFim(em(0, 500, 600))).toBe(true);
  });

  it('meia linha acima do fim ainda conta', () => {
    expect(estaNoFim(em(400 - PIN_SLACK))).toBe(true);
  });

  it('um pixel além da folga não conta', () => {
    expect(estaNoFim(em(400 - PIN_SLACK - 1))).toBe(false);
  });

  it('lendo o começo da conversa, não', () => {
    expect(estaNoFim(em(0))).toBe(false);
  });

  /**
   * O pixel fracionário do zoom.
   *
   * Com zoom de 110% o `scrollTop` do fim para em 399.5 e não em 400 — uma
   * conta exata (`>= scrollHeight - clientHeight`) diria que a pessoa saiu
   * do fim sem ela ter tocado em nada, e a mídia que chegasse depois não
   * reprenderia. É o caso que a folga existe para cobrir.
   */
  it('o fim fracionário do zoom continua sendo o fim', () => {
    expect(estaNoFim(em(399.5))).toBe(true);
    expect(estaNoFim(em(399.5), 0)).toBe(false);
  });
});
