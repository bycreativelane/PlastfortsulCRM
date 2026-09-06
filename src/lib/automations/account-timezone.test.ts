import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { accountTimeZone, resolveTimeZone } from './account-timezone';
import { DEFAULT_TIMEZONE } from './local-time';

/**
 * A precedência é o comportamento inteiro desta função, e é a única coisa
 * aqui capaz de mudar a hora de um follow-up que já estava configurado.
 */
function fakeDb(
  response: { data: unknown; error: unknown },
  seen: string[] = []
): SupabaseClient {
  return {
    from(table: string) {
      seen.push(table);
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => response,
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('accountTimeZone', () => {
  it('lê a coluna da conta', async () => {
    const db = fakeDb({ data: { timezone: 'America/Manaus' }, error: null });
    expect(await accountTimeZone(db, 'acct')).toBe('America/Manaus');
  });

  it('cai no padrão quando a 066 ainda não rodou', async () => {
    // 42703: a coluna não existe. As migrações deste projeto são aplicadas
    // à mão, então esta janela é real — e durante ela o motor tem de se
    // comportar exatamente como antes da migração.
    const db = fakeDb({ data: null, error: { code: '42703' } });
    expect(await accountTimeZone(db, 'acct')).toBe(DEFAULT_TIMEZONE);
  });

  it('cai no padrão para conta inexistente, nula, ou fuso ilegível', async () => {
    expect(
      await accountTimeZone(fakeDb({ data: null, error: null }), 'acct')
    ).toBe(DEFAULT_TIMEZONE);
    expect(
      await accountTimeZone(
        fakeDb({ data: { timezone: 'Mars/Olympus_Mons' }, error: null }),
        'acct'
      )
    ).toBe(DEFAULT_TIMEZONE);
  });

  it('não consulta nada sem conta', async () => {
    const seen: string[] = [];
    const db = fakeDb({ data: null, error: null }, seen);
    expect(await accountTimeZone(db, null)).toBe(DEFAULT_TIMEZONE);
    expect(seen).toEqual([]);
  });
});

describe('resolveTimeZone', () => {
  it('o que a automação declarou ganha da conta', async () => {
    // Uma automação salva com fuso próprio não pode mudar de hora porque a
    // conta declarou o dela — é a garantia de compatibilidade da 066.
    const seen: string[] = [];
    const db = fakeDb(
      { data: { timezone: 'America/Manaus' }, error: null },
      seen
    );
    expect(await resolveTimeZone(db, 'acct', 'Europe/Lisbon')).toBe(
      'Europe/Lisbon'
    );
    expect(seen).toEqual([]);
  });

  it('sem declaração, segue a conta', async () => {
    const db = fakeDb({ data: { timezone: 'America/Manaus' }, error: null });
    expect(await resolveTimeZone(db, 'acct', undefined)).toBe('America/Manaus');
    expect(await resolveTimeZone(db, 'acct', null)).toBe('America/Manaus');
  });

  it('uma declaração ilegível vira o padrão, não a da conta', async () => {
    // Quem escreveu um fuso quis um fuso; devolver o da conta esconderia o
    // erro de digitação atrás de um comportamento plausível.
    const db = fakeDb({ data: { timezone: 'America/Manaus' }, error: null });
    expect(await resolveTimeZone(db, 'acct', 'Mars/Olympus_Mons')).toBe(
      DEFAULT_TIMEZONE
    );
  });
});
