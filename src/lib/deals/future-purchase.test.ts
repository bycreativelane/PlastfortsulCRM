import { describe, expect, it } from 'vitest';

import {
  FUTURE_PURCHASE_STAGE_NAMES,
  findStage,
  normalizeStageName,
  type StageRow,
} from './future-purchase';

/**
 * O casamento de nome de etapa.
 *
 * É a parte que decide se a compra futura move a oportunidade ou não faz
 * nada — e ela erra em silêncio: uma etapa que não casa devolve `null`, o
 * chamador pula, e o vendedor vê a data salvar sem a oportunidade andar.
 * Exatamente o comportamento que o item 5 veio corrigir.
 */

const stages: StageRow[] = [
  { id: 's1', name: 'Novo Lead', pipeline_id: 'p1' },
  { id: 's2', name: 'Compra Futura', pipeline_id: 'p1' },
  { id: 's3', name: 'Compra Futura', pipeline_id: 'p2' },
];

describe('normalizeStageName', () => {
  it('ignora acento, hífen e caixa', () => {
    // O pacote escreve "Compra-futura", o produto grava "Compra Futura".
    const alvo = normalizeStageName('Compra Futura');
    for (const variante of [
      'Compra-futura',
      'compra futura',
      'COMPRA-FUTURA',
      '  Compra   Futura  ',
      'Compra_Futura',
    ]) {
      expect(normalizeStageName(variante), variante).toBe(alvo);
    }
  });

  it('não confunde etapas diferentes', () => {
    expect(normalizeStageName('Em Aberto')).not.toBe(
      normalizeStageName('Em Andamento')
    );
  });
});

describe('findStage', () => {
  it('acha a etapa no funil certo', () => {
    expect(findStage(stages, 'p1', FUTURE_PURCHASE_STAGE_NAMES)?.id).toBe('s2');
  });

  it('NÃO atravessa para outro funil', () => {
    // Duas contas, ou dois funis da mesma conta, podem ter uma etapa com o
    // mesmo nome. Mover a oportunidade para a do funil errado a tiraria do
    // lugar onde ela é vista.
    expect(findStage(stages, 'p2', FUTURE_PURCHASE_STAGE_NAMES)?.id).toBe('s3');
  });

  it('devolve null quando a etapa não existe', () => {
    const semEtapa: StageRow[] = [
      { id: 'x', name: 'Novo Lead', pipeline_id: 'p1' },
    ];
    // Null é "não mover", e não "criar uma etapa": uma conta que ainda não
    // montou o funil oficial deve ver a data salvar mesmo assim.
    expect(findStage(semEtapa, 'p1', FUTURE_PURCHASE_STAGE_NAMES)).toBeNull();
  });

  it('casa qualquer um dos nomes aceitos', () => {
    const comHifen: StageRow[] = [
      { id: 'h', name: 'Compra-futura', pipeline_id: 'p1' },
    ];
    expect(findStage(comHifen, 'p1', FUTURE_PURCHASE_STAGE_NAMES)?.id).toBe('h');
  });
});
