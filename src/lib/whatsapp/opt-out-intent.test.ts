import { describe, expect, it } from 'vitest';
import { isOptOutIntent } from './opt-out-intent';

describe('isOptOutIntent', () => {
  it('matches a standalone SAIR reply, with optional punctuation', () => {
    expect(isOptOutIntent({ text: 'SAIR' })).toBe(true);
    expect(isOptOutIntent({ text: 'sair' })).toBe(true);
    expect(isOptOutIntent({ text: '  Sair.  ' })).toBe(true);
    expect(isOptOutIntent({ text: 'SAIR!' })).toBe(true);
  });

  it('does not match SAIR inside a longer sentence', () => {
    expect(isOptOutIntent({ text: 'não vou sair' })).toBe(false);
    expect(isOptOutIntent({ text: 'responda SAIR para parar' })).toBe(false);
  });

  it('matches the marketing quick-reply, accent-insensitive', () => {
    expect(isOptOutIntent({ buttonLabel: 'Não quero receber' })).toBe(true);
    expect(isOptOutIntent({ buttonPayload: 'Nao quero receber' })).toBe(true);
  });

  it('does not treat other negative buttons as opt-out', () => {
    expect(isOptOutIntent({ buttonLabel: 'Agora não' })).toBe(false);
    expect(isOptOutIntent({ buttonLabel: 'Ainda não' })).toBe(false);
    expect(isOptOutIntent({ text: 'hello' })).toBe(false);
  });
});
