import { describe, expect, it } from 'vitest';

import { nextOrderNumber } from './order-number';

describe('nextOrderNumber', () => {
  it('o caso da operação: 14349 vira 14350', () => {
    expect(nextOrderNumber('14349')).toBe('14350');
  });

  it('preserva o zero à esquerda', () => {
    expect(nextOrderNumber('0099')).toBe('0100');
    expect(nextOrderNumber('PV-0099')).toBe('PV-0100');
  });

  it('cresce em vez de estourar a largura', () => {
    // Cortar para caber daria `000` — o único jeito de esta função
    // devolver um número menor do que o último.
    expect(nextOrderNumber('999')).toBe('1000');
  });

  it('copia o prefixo sem interpretá-lo', () => {
    expect(nextOrderNumber('2026/145')).toBe('2026/146');
    expect(nextOrderNumber('PED 7')).toBe('PED 8');
  });

  it('incrementa o ÚLTIMO grupo de dígitos', () => {
    expect(nextOrderNumber('2026-0007')).toBe('2026-0008');
  });

  it('preserva o que vem depois dos dígitos', () => {
    expect(nextOrderNumber('145-A')).toBe('146-A');
  });

  it('não adivinha o que não tem número', () => {
    expect(nextOrderNumber('sem número')).toBe('');
    expect(nextOrderNumber('')).toBe('');
    expect(nextOrderNumber(null)).toBe('');
    expect(nextOrderNumber(undefined)).toBe('');
  });

  it('aguenta um número maior do que um inteiro seguro', () => {
    // `Number` perderia o último dígito aqui; `BigInt` não.
    expect(nextOrderNumber('9007199254740993')).toBe('9007199254740994');
  });
});
