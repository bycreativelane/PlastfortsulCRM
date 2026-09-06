import { describe, expect, it } from 'vitest';

import {
  birthdaysInRange,
  loadAgenda,
  countByKind,
  groupByDay,
  isoInDays,
  tonesOf,
  type AgendaItem,
  type AgendaKind,
  type RawContact,
} from './agenda';

function contact(over: Partial<RawContact> & { id: string }): RawContact {
  return { name: 'Maria Silva', phone: '5551999990000', ...over };
}

function item(
  kind: AgendaKind,
  day: string,
  id = `${kind}:${day}`
): AgendaItem {
  return {
    id,
    kind,
    day,
    time: null,
    title: 'x',
    contact: null,
    value: null,
    currency: null,
    status: null,
    href: null,
    reschedule: null,
    rowId: id,
  };
}

describe('birthdaysInRange', () => {
  const from = new Date(2026, 7, 1); // 1 Aug 2026
  const to = new Date(2026, 8, 11); // 11 Sep 2026

  it('ignores the stored year and hangs the day on the window', () => {
    const items = birthdaysInRange(
      [contact({ id: 'c1', birthday: '1974-08-23' })],
      from,
      to
    );
    expect(items).toHaveLength(1);
    expect(items[0].day).toBe('2026-08-23');
    expect(items[0].kind).toBe('birthday');
    expect(items[0].href).toBe('/contacts?id=c1');
    // A birthday is a fact about a day — nothing here may move it.
    expect(items[0].reschedule).toBeNull();
  });

  it('leaves out the ones the window does not reach', () => {
    expect(
      birthdaysInRange(
        [contact({ id: 'c1', birthday: '1990-11-04' })],
        from,
        to
      )
    ).toHaveLength(0);
  });

  it('includes both ends of the window', () => {
    const items = birthdaysInRange(
      [
        contact({ id: 'first', birthday: '1988-08-01' }),
        contact({ id: 'last', birthday: '1988-09-11' }),
      ],
      from,
      to
    );
    expect(items.map((i) => i.day).sort()).toEqual([
      '2026-08-01',
      '2026-09-11',
    ]);
  });

  it('celebrates a leap-day birthday on the 28th in a common year', () => {
    const items = birthdaysInRange(
      [contact({ id: 'c1', birthday: '2000-02-29' })],
      new Date(2027, 1, 1),
      new Date(2027, 2, 7)
    );
    expect(items).toHaveLength(1);
    // NOT 1 March, which is where `new Date(2027, 1, 29)` lands.
    expect(items[0].day).toBe('2027-02-28');
  });

  it('keeps the 29th in a leap year', () => {
    const items = birthdaysInRange(
      [contact({ id: 'c1', birthday: '2000-02-29' })],
      new Date(2028, 1, 1),
      new Date(2028, 2, 7)
    );
    expect(items[0].day).toBe('2028-02-29');
  });

  it('handles a window that crosses the new year', () => {
    const items = birthdaysInRange(
      [
        contact({ id: 'dec', birthday: '1985-12-25' }),
        contact({ id: 'jan', birthday: '1991-01-03' }),
      ],
      new Date(2026, 11, 20),
      new Date(2027, 0, 30)
    );
    expect(items.map((i) => i.day).sort()).toEqual([
      '2026-12-25',
      '2027-01-03',
    ]);
  });

  it('does not emit the same birthday twice in a one-year window', () => {
    const items = birthdaysInRange(
      [contact({ id: 'c1', birthday: '1985-06-10' })],
      new Date(2026, 11, 20),
      new Date(2027, 0, 30)
    );
    expect(items).toHaveLength(0);
  });

  it('names the row by the phone when the contact has no name', () => {
    const items = birthdaysInRange(
      [contact({ id: 'c1', name: '', birthday: '1985-08-05' })],
      from,
      to
    );
    expect(items[0].title).toBe('5551999990000');
  });

  it('skips rows with no birthday at all', () => {
    expect(
      birthdaysInRange([contact({ id: 'c1', birthday: null })], from, to)
    ).toHaveLength(0);
  });
});

describe('groupByDay', () => {
  it('buckets by local day key and keeps the given order', () => {
    const days = groupByDay([
      item('deal', '2026-08-23', 'a'),
      item('automation', '2026-08-23', 'b'),
      item('broadcast', '2026-08-24', 'c'),
    ]);
    expect(days.get('2026-08-23')?.map((i) => i.id)).toEqual(['a', 'b']);
    expect(days.get('2026-08-24')).toHaveLength(1);
    expect(days.get('2026-08-25')).toBeUndefined();
  });
});

describe('countByKind', () => {
  it('counts every kind, including the ones with nothing', () => {
    const counts = countByKind([
      item('deal', '2026-08-23', 'a'),
      item('deal', '2026-08-24', 'b'),
      item('birthday', '2026-08-24', 'c'),
    ]);
    expect(counts.deal).toBe(2);
    expect(counts.birthday).toBe(1);
    expect(counts.occurrence).toBe(0);
  });
});

describe('tonesOf', () => {
  it('returns each tone once, in draw order', () => {
    expect(
      tonesOf([
        item('birthday', '2026-08-23', 'a'),
        item('automation', '2026-08-23', 'b'),
        item('deal', '2026-08-23', 'c'),
        item('repurchase', '2026-08-23', 'd'),
      ])
    ).toEqual(['human', 'auto', 'neutral']);
  });

  it('is empty for an empty day', () => {
    expect(tonesOf([])).toEqual([]);
  });
});

describe('isoInDays', () => {
  it('offsets from today in local days', () => {
    const today = new Date();
    const expected = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 7
    );
    expect(isoInDays(7)).toBe(
      `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`
    );
  });
});

/**
 * O dia é o da EMPRESA, não o de quem está olhando.
 *
 * Antes da 066 a agenda agrupava com `Date#getHours` — o fuso do navegador.
 * Enquanto todo mundo estava no mesmo fuso, invisível; assim que a conta
 * declarou o dela, é a diferença entre uma campanha das 23:40 em São Paulo
 * aparecer no dia 10 para o comercial e no dia 11 para quem lê de Lisboa.
 * Um calendário comercial que mostra dias diferentes para pessoas diferentes
 * não é um calendário compartilhado.
 */
describe('loadAgenda — fuso da conta', () => {
  /**
   * Um `SupabaseClient` de mentira: qualquer encadeamento de filtros
   * devolve as linhas da tabela pedida. O que se testa aqui é o mapeamento,
   * não o PostgREST.
   */
  function fakeDb(tables: Record<string, unknown[]>) {
    const from = (table: string) => {
      const result = { data: tables[table] ?? [], error: null };
      const chain: Record<string | symbol, unknown> = {};
      const proxy = new Proxy(chain, {
        get(_target, prop) {
          if (prop === 'then') {
            return (
              resolve: (value: typeof result) => unknown,
              reject?: (reason: unknown) => unknown
            ) => Promise.resolve(result).then(resolve, reject);
          }
          return () => proxy;
        },
      });
      return proxy;
    };
    return { from } as unknown as Parameters<typeof loadAgenda>[0];
  }

  const broadcast = {
    id: 'b1',
    name: 'Promoção de setembro',
    status: 'sent',
    // 11/09/2026, 02:40 UTC — ainda dia 10 às 23:40 em São Paulo.
    scheduled_at: '2026-09-11T02:40:00.000Z',
    created_at: '2026-09-11T02:40:00.000Z',
    total_recipients: 10,
  };

  const window = { from: new Date(2026, 8, 1), to: new Date(2026, 8, 30) };

  it('coloca a campanha no dia da conta, não no do leitor', async () => {
    const originalFetch = globalThis.fetch;
    // A fonte de automações passa por rota; aqui não há servidor.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
      })) as typeof fetch;

    try {
      const db = fakeDb({ broadcasts: [broadcast] });

      const sp = await loadAgenda(
        db,
        window.from,
        window.to,
        'America/Sao_Paulo'
      );
      expect(sp).toHaveLength(1);
      expect(sp[0]).toMatchObject({ day: '2026-09-10', time: '23:40' });

      const lisbon = await loadAgenda(
        db,
        window.from,
        window.to,
        'Europe/Lisbon'
      );
      expect(lisbon[0]).toMatchObject({ day: '2026-09-11', time: '03:40' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uma coluna DATE não passa por `new Date()` em fuso nenhum', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
      })) as typeof fetch;

    try {
      const db = fakeDb({
        deals: [
          {
            id: 'd1',
            title: 'Bobina 50µ',
            value: 1000,
            currency: 'BRL',
            expected_close_date: '2026-09-30',
            pipeline_id: 'p1',
            contact: { name: 'Maria', phone: '55519' },
          },
        ],
      });

      for (const zone of ['America/Sao_Paulo', 'Pacific/Kiritimati']) {
        const items = await loadAgenda(db, window.from, window.to, zone);
        expect(items[0]).toMatchObject({ day: '2026-09-30', time: null });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
