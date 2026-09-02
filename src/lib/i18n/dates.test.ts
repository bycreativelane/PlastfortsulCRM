import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatListTime, formatMonthDay } from './dates';

// A suíte roda com NEXT_PUBLIC_APP_LOCALE=pt-BR (ver vitest.config.ts),
// que é o idioma em que a instalação realmente roda — testar em inglês
// exercitaria um caminho que ninguém usa.

describe('formatMonthDay', () => {
  it('writes the month in the order the language does', () => {
    // "26 de ago.", e não "ago. 26" — o motivo de existir a função.
    expect(formatMonthDay(new Date(2026, 7, 26))).toMatch(/26/);
    expect(formatMonthDay(new Date(2026, 7, 26))).toMatch(/ago/i);
  });
});

describe('formatListTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Uma quarta-feira, 14h05.
    vi.setSystemTime(new Date(2026, 7, 26, 14, 5, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the clock for something from today', () => {
    expect(formatListTime(new Date(2026, 7, 26, 9, 15))).toBe('09:15');
  });

  it('still shows the clock at the very start of today', () => {
    // Meia-noite é hoje. Uma comparação por "menos de 24h" chamaria isto
    // de ontem às 14h05, que é o erro clássico desta escada.
    expect(formatListTime(new Date(2026, 7, 26, 0, 0))).toBe('00:00');
  });

  it('shows a date — not a clock — for yesterday', () => {
    // O caso que motivou a função: `09:15` sozinho num card sem
    // separador de dia é lido como hoje de manhã, sempre.
    const out = formatListTime(new Date(2026, 7, 25, 9, 15));
    expect(out).not.toBe('09:15');
    expect(out).toMatch(/25/);
    expect(out).toMatch(/ago/i);
  });

  it('omits the year inside the current one', () => {
    // Num card de 150px, quatro dígitos que dizem o óbvio custam metade
    // do nome de quem escreveu.
    expect(formatListTime(new Date(2026, 0, 3, 9, 15))).not.toMatch(/2026/);
  });

  it('spells the year out once it changes', () => {
    const out = formatListTime(new Date(2025, 7, 26, 9, 15));
    expect(out).toMatch(/2025/);
  });

  it('accepts the ISO string the database hands back', () => {
    // As linhas chegam do Supabase como string; obrigar quem chama a
    // construir o Date seria uma conversão repetida em cada call site.
    const iso = new Date(2026, 7, 26, 9, 15).toISOString();
    expect(formatListTime(iso)).toBe('09:15');
  });

  it('renders nothing at all for an unusable value', () => {
    // O retorno vai cru para a tela. "Invalid Date" num card é um
    // defeito que o cliente vê; um carimbo em branco é uma ausência.
    expect(formatListTime('não é uma data')).toBe('');
    expect(formatListTime(new Date(NaN))).toBe('');
  });
});
