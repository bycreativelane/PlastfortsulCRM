import { describe, expect, it } from 'vitest';

import {
  birthdaysInRange,
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
