import { describe, expect, it } from 'vitest';

import type { Task } from '@/types';
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from '@/lib/hours';
import {
  countTasks,
  isDueToday,
  isOverdue,
  openTasks,
  sortTasks,
} from './queries';
import { presetDue } from './mutations';
import { reminderInstant } from './reminders';

function task(over: Partial<Task> & { id: string }): Task {
  return {
    account_id: 'acct',
    title: 'Ligar para o Marcos',
    kind: 'call',
    status: 'open',
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

/** Semana padrão + o feriado de 07/09/2026, que é uma segunda-feira. */
const hours: BusinessHours = {
  ...DEFAULT_BUSINESS_HOURS,
  exceptions: [
    {
      date: '2026-09-07',
      closed: true,
      opens: null,
      closes: null,
      label: 'Independência',
    },
  ],
};

describe('isOverdue / isDueToday', () => {
  const today = '2026-09-09';

  it('atrasada é prazo anterior a hoje, e só se estiver aberta', () => {
    expect(isOverdue(task({ id: '1', due_on: '2026-09-08' }), today)).toBe(
      true
    );
    expect(isOverdue(task({ id: '2', due_on: today }), today)).toBe(false);
    expect(isOverdue(task({ id: '3', due_on: '2026-09-10' }), today)).toBe(
      false
    );
  });

  it('concluída nunca está atrasada', () => {
    // Senão a ficha de um cliente antigo fica vermelha para sempre.
    const done = task({
      id: '4',
      due_on: '2026-08-01',
      status: 'done',
      completed_at: '2026-08-02T12:00:00.000Z',
    });
    expect(isOverdue(done, today)).toBe(false);
  });

  it('sem prazo não atrasa', () => {
    expect(isOverdue(task({ id: '5' }), today)).toBe(false);
  });

  it('hoje é hoje', () => {
    expect(isDueToday(task({ id: '6', due_on: today }), today)).toBe(true);
    expect(isDueToday(task({ id: '7', due_on: '2026-09-10' }), today)).toBe(
      false
    );
  });
});

describe('sortTasks', () => {
  it('abertas antes das fechadas, por prazo, e as marcadas antes das soltas', () => {
    const sorted = sortTasks([
      task({ id: 'sem-prazo' }),
      task({
        id: 'feita',
        due_on: '2026-09-01',
        status: 'done',
        completed_at: 'x',
      }),
      task({ id: 'dia-10-sem-hora', due_on: '2026-09-10' }),
      task({ id: 'dia-10-as-9', due_on: '2026-09-10', due_time: '09:00' }),
      task({ id: 'dia-9', due_on: '2026-09-09' }),
    ]);

    expect(sorted.map((t) => t.id)).toEqual([
      'dia-9',
      'dia-10-as-9',
      'dia-10-sem-hora',
      'sem-prazo',
      'feita',
    ]);
  });

  it('compara hora por minutos, não por string', () => {
    // '9:00' < '10:00' é falso por string. A coluna é TIME e volta com
    // zero à esquerda, mas nada impede alguém de passar '9:00'.
    const sorted = sortTasks([
      task({ id: 'dez', due_on: '2026-09-09', due_time: '10:00' }),
      task({ id: 'nove', due_on: '2026-09-09', due_time: '9:00' }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['nove', 'dez']);
  });

  it('não muda o array recebido', () => {
    const input = [
      task({ id: 'b', due_on: '2026-09-10' }),
      task({ id: 'a', due_on: '2026-09-09' }),
    ];
    sortTasks(input);
    expect(input.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('openTasks / countTasks', () => {
  const list = [
    task({ id: '1', due_on: '2026-09-01' }),
    task({ id: '2', due_on: '2026-09-09' }),
    task({ id: '3', due_on: '2026-09-20' }),
    task({ id: '4', status: 'done', completed_at: 'x' }),
    task({ id: '5', status: 'cancelled' }),
  ];

  it('abertas, em ordem', () => {
    expect(openTasks(list).map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('conta aberta, atrasada e feita — cancelada não é nenhuma das três', () => {
    expect(countTasks(list, '2026-09-09')).toEqual({
      open: 3,
      overdue: 1,
      done: 1,
      total: 5,
    });
  });
});

describe('presetDue', () => {
  it('"amanhã" numa sexta cai na segunda de manhã', () => {
    // 2026-09-11 é sexta. Sábado e domingo estão fechados.
    expect(presetDue('tomorrow', hours, '2026-09-11')).toEqual({
      due_on: '2026-09-14',
      due_time: '08:00',
    });
  });

  it('"amanhã" pula o feriado', () => {
    // Sexta 04/09 + 1 dia útil: segunda 07/09 é feriado, então terça.
    expect(presetDue('tomorrow', hours, '2026-09-04')).toEqual({
      due_on: '2026-09-08',
      due_time: '08:00',
    });
  });

  it('"hoje" no meio do expediente mantém a hora', () => {
    expect(presetDue('today', hours, '2026-09-09', '09:15')).toEqual({
      due_on: '2026-09-09',
      due_time: '09:15',
    });
  });

  it('"hoje" no almoço empurra para a tarde', () => {
    expect(presetDue('today', hours, '2026-09-09', '12:30')).toEqual({
      due_on: '2026-09-09',
      due_time: '13:30',
    });
  });

  it('"hoje" depois do expediente vira o dia inteiro, não uma hora que já foi', () => {
    expect(presetDue('today', hours, '2026-09-09', '19:00')).toEqual({
      due_on: '2026-09-09',
      due_time: null,
    });
  });

  it('"em 3 dias" e "próxima semana" contam dias ÚTEIS', () => {
    expect(presetDue('in3days', hours, '2026-09-09').due_on).toBe('2026-09-14');
    expect(presetDue('nextWeek', hours, '2026-09-09').due_on).toBe(
      '2026-09-18'
    );
  });
});

describe('reminderInstant', () => {
  /** 2026-09-09 é uma quarta; São Paulo está em UTC-3 nessa data. */
  it('conta a partir da hora marcada, no fuso da conta', () => {
    const at = reminderInstant(
      { due_on: '2026-09-09', due_time: '14:00', remind_minutes_before: 30 },
      hours
    );
    expect(at?.toISOString()).toBe('2026-09-09T16:30:00.000Z');
  });

  it('sem hora, conta a partir da abertura do expediente daquele dia', () => {
    // A tarefa "para quinta" com 30 min de lembrete tem de avisar às 07:30
    // de quinta, e não às 23:30 de quarta.
    const at = reminderInstant(
      { due_on: '2026-09-10', due_time: null, remind_minutes_before: 30 },
      hours
    );
    expect(at?.toISOString()).toBe('2026-09-10T10:30:00.000Z'); // 07:30 -03
  });

  it('num dia fechado, cai nas 09:00 em vez de não ter base', () => {
    const at = reminderInstant(
      { due_on: '2026-09-07', due_time: null, remind_minutes_before: 0 },
      hours
    );
    expect(at?.toISOString()).toBe('2026-09-07T12:00:00.000Z'); // 09:00 -03
  });

  it('"24 h antes" recua para o dia anterior', () => {
    const at = reminderInstant(
      {
        due_on: '2026-09-10',
        due_time: '09:00',
        remind_minutes_before: 24 * 60,
      },
      hours
    );
    expect(at?.toISOString()).toBe('2026-09-09T12:00:00.000Z');
  });

  it('sem prazo ou sem lembrete não há instante', () => {
    expect(
      reminderInstant(
        { due_on: null, due_time: '09:00', remind_minutes_before: 30 },
        hours
      )
    ).toBeNull();
    expect(
      reminderInstant(
        {
          due_on: '2026-09-10',
          due_time: '09:00',
          remind_minutes_before: null,
        },
        hours
      )
    ).toBeNull();
  });

  it('respeita um fuso diferente do padrão', () => {
    const manaus: BusinessHours = { ...hours, timezone: 'America/Manaus' };
    const at = reminderInstant(
      { due_on: '2026-09-09', due_time: '14:00', remind_minutes_before: 0 },
      manaus
    );
    expect(at?.toISOString()).toBe('2026-09-09T18:00:00.000Z'); // -04
  });
});
