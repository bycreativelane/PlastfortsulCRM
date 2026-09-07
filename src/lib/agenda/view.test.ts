import { describe, expect, it } from 'vitest';

import type { AgendaItem, AgendaKind } from '@/lib/dashboard/agenda';
import {
  allDayItems,
  filterAgenda,
  hourSlots,
  isAgendaView,
  positionOf,
  rangeFor,
  startOfWeek,
  timedItems,
} from './view';

function item(over: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: 'task:1',
    kind: 'task',
    day: '2026-09-07',
    time: null,
    title: 'x',
    contact: null,
    value: null,
    currency: null,
    status: null,
    href: null,
    owner: null,
    reschedule: null,
    rowId: '1',
    ...over,
  };
}

describe('startOfWeek', () => {
  // 2026-09-07 é uma segunda-feira.
  it('volta para o domingo quando a semana começa em 0', () => {
    expect(startOfWeek(new Date(2026, 8, 7), 0).getDate()).toBe(6);
  });

  it('fica na própria segunda quando a semana começa em 1', () => {
    expect(startOfWeek(new Date(2026, 8, 7), 1).getDate()).toBe(7);
  });

  it('atravessa o mês para trás sem estourar', () => {
    // 2026-09-01 é uma terça; a semana começando no domingo cai em agosto.
    const start = startOfWeek(new Date(2026, 8, 1), 0);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(30);
  });
});

describe('rangeFor', () => {
  it('o dia carrega um dia só', () => {
    const r = rangeFor('day', new Date(2026, 8, 7), 1);
    expect(r.days).toEqual(['2026-09-07']);
    expect(r.from).toEqual(r.to);
  });

  it('a semana carrega sete dias na ordem', () => {
    const r = rangeFor('week', new Date(2026, 8, 9), 1);
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toBe('2026-09-07');
    expect(r.days[6]).toBe('2026-09-13');
  });

  it('o mês carrega a grade inteira, e não só os dias do mês', () => {
    const r = rangeFor('month', new Date(2026, 8, 15), 0);
    expect(r.days).toHaveLength(42);
    // As pontas pertencem aos meses vizinhos — é o que a MonthGrid desenha.
    expect(r.days[0] < '2026-09-01').toBe(true);
    expect(r.days[41] > '2026-09-30').toBe(true);
  });
});

describe('filterAgenda', () => {
  const none = new Set<AgendaKind>();

  it('esconde os tipos desmarcados', () => {
    const items = [item({ kind: 'task' }), item({ kind: 'birthday' })];
    const out = filterAgenda(items, {
      hidden: new Set<AgendaKind>(['birthday']),
      owner: 'all',
      me: 'u1',
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('task');
  });

  it('"Minhas" guarda o que é meu', () => {
    const items = [item({ owner: 'u1' }), item({ owner: 'u2' })];
    const out = filterAgenda(items, { hidden: none, owner: 'mine', me: 'u1' });
    expect(out).toHaveLength(1);
    expect(out[0].owner).toBe('u1');
  });

  it('NUNCA esconde o que não é de ninguém', () => {
    const items = [item({ kind: 'birthday', owner: null }), item({ owner: 'u2' })];
    const out = filterAgenda(items, { hidden: none, owner: 'mine', me: 'u1' });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('birthday');
  });

  it('mostra tudo enquanto não se sabe quem está olhando', () => {
    const items = [item({ owner: 'u1' }), item({ owner: 'u2' })];
    const out = filterAgenda(items, { hidden: none, owner: 'mine', me: null });
    expect(out).toHaveLength(2);
  });

  it('filtra por um colega escolhido', () => {
    const items = [item({ owner: 'u1' }), item({ owner: 'u2' })];
    const out = filterAgenda(items, { hidden: none, owner: 'u2', me: 'u1' });
    expect(out).toHaveLength(1);
    expect(out[0].owner).toBe('u2');
  });
});

describe('hourSlots', () => {
  it('respeita a divisão da conta', () => {
    expect(hourSlots(8, 10, 60)).toEqual(['08:00', '09:00']);
    expect(hourSlots(8, 9, 30)).toEqual(['08:00', '08:30']);
    expect(hourSlots(8, 9, 15)).toEqual(['08:00', '08:15', '08:30', '08:45']);
  });

  it('não entra em laço infinito com divisão zerada', () => {
    expect(hourSlots(8, 10, 0)).toEqual(['08:00', '09:00']);
  });
});

describe('positionOf', () => {
  it('não posiciona o que não tem hora', () => {
    expect(positionOf({ time: null }, 8, 18)).toBeNull();
  });

  it('põe o começo do expediente no topo', () => {
    expect(positionOf({ time: '08:00' }, 8, 18)?.top).toBe(0);
  });

  it('põe o meio no meio', () => {
    expect(positionOf({ time: '13:00' }, 8, 18)?.top).toBe(50);
  });

  it('prende na borda em vez de sumir com o que cai fora', () => {
    const late = positionOf({ time: '22:00' }, 8, 18);
    expect(late).not.toBeNull();
    expect(late!.top).toBe(100);
    const early = positionOf({ time: '05:00' }, 8, 18);
    expect(early!.top).toBe(0);
  });

  it('devolve null quando o eixo não tem altura', () => {
    expect(positionOf({ time: '09:00' }, 10, 10)).toBeNull();
  });
});

describe('separação por hora', () => {
  it('divide o dia entre a faixa de cima e o eixo', () => {
    const items = [item({ time: null }), item({ time: '09:00' })];
    expect(allDayItems(items)).toHaveLength(1);
    expect(timedItems(items)).toHaveLength(1);
  });
});

describe('isAgendaView', () => {
  it('aceita os três e recusa o resto', () => {
    expect(isAgendaView('week')).toBe(true);
    expect(isAgendaView('ano')).toBe(false);
    expect(isAgendaView(null)).toBe(false);
  });
});
