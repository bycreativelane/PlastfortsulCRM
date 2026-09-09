import { describe, expect, it } from 'vitest';

import {
  LOSS_REASONS,
  entryStage,
  isLostStage,
  isOpenStage,
  isWonStage,
} from './outcome';

describe('the stage names the gates recognise', () => {
  it('treats Em Andamento as the sale, and still Atendido', () => {
    expect(isWonStage('Em Andamento')).toBe(true);
    expect(isWonStage('em andamento')).toBe(true);
    expect(isWonStage('Atendido')).toBe(true);
    expect(isWonStage('Em Aberto')).toBe(false);
  });

  it('recognises the official flow name for a loss, not just Perdido', () => {
    expect(isLostStage('Venda Perdida')).toBe(true);
    expect(isLostStage('Perdido')).toBe(true);
    expect(isLostStage('Geladeira 60D')).toBe(false);
  });
});

describe('the loss reasons', () => {
  it('are the eight of the official flow, with "stopped replying" gone', () => {
    expect(LOSS_REASONS).toEqual([
      'price',
      'freight',
      'leadTime',
      'competitor',
      'noNeedNow',
      'gaveUp',
      'productMismatch',
      'other',
    ]);
    expect(LOSS_REASONS).not.toContain('noReply');
  });
});

describe('onde a oportunidade nasce', () => {
  it('reconhece Em Aberto, e não confunde com as etapas de desfecho', () => {
    expect(isOpenStage('Em Aberto')).toBe(true);
    expect(isOpenStage('em aberto')).toBe(true);
    expect(isOpenStage('Aberto')).toBe(true);
    expect(isOpenStage('Em Andamento')).toBe(false);
    expect(isOpenStage('Venda Perdida')).toBe(false);
  });

  it('acha Em Aberto mesmo quando não é a primeira coluna', () => {
    const stages = [
      { id: 'a', name: 'Novo Lead' },
      { id: 'b', name: 'Em Aberto' },
      { id: 'c', name: 'Follow-up' },
    ];
    expect(entryStage(stages)?.id).toBe('b');
  });

  it('cai para a primeira etapa num funil montado à mão', () => {
    const stages = [
      { id: 'x', name: 'Orçando' },
      { id: 'y', name: 'Fechando' },
    ];
    expect(entryStage(stages)?.id).toBe('x');
  });

  it('sem etapa nenhuma não inventa destino', () => {
    expect(entryStage([])).toBeNull();
  });
});
