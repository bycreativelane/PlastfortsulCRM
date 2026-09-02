import { describe, expect, it } from 'vitest';

import { LOSS_REASONS, isLostStage, isWonStage } from './outcome';

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
