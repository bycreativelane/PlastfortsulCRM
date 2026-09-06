import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BUSINESS_HOURS,
  addBusinessDays,
  dayBounds,
  firstOpenTime,
  fromMinutes,
  intervalsFor,
  isBusinessDay,
  isOpenAt,
  minutesOf,
  nextOpenSlot,
  toBusinessHours,
  toHHMM,
  type BusinessHours,
} from './hours';

/**
 * Semana comercial padrão, com um feriado e um dia de horário curto.
 *
 * As datas são de setembro de 2026: 07/09 é uma segunda-feira (e feriado
 * de verdade), 11/09 é uma sexta e 12/09 um sábado — o que deixa os testes
 * de "sexta à noite" e "sábado" lerem como o calendário real.
 */
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
    {
      date: '2026-09-11',
      closed: false,
      opens: '08:00',
      closes: '12:00',
      label: 'Meio período',
    },
  ],
};

describe('toHHMM', () => {
  it('normaliza o TIME do Postgres', () => {
    // Uma coluna TIME volta com segundos; comparar por string com '08:00'
    // daria desigual, que é o bug que esta função existe para não ter.
    expect(toHHMM('08:00:00')).toBe('08:00');
    expect(toHHMM('13:30')).toBe('13:30');
  });

  it('recusa o que não é hora', () => {
    expect(toHHMM(null)).toBeNull();
    expect(toHHMM('')).toBeNull();
    expect(toHHMM('25:00')).toBeNull();
    expect(toHHMM('meio-dia')).toBeNull();
  });
});

describe('minutesOf / fromMinutes', () => {
  it('vai e volta', () => {
    expect(minutesOf('13:30')).toBe(810);
    expect(fromMinutes(810)).toBe('13:30');
    expect(fromMinutes(0)).toBe('00:00');
  });

  it('devolve -1 para hora inválida em vez de NaN', () => {
    // NaN se propaga silenciosamente por comparação; -1 perde a comparação
    // com qualquer minuto real, que é o comportamento seguro.
    expect(minutesOf('nada')).toBe(-1);
  });
});

describe('intervalsFor', () => {
  it('devolve a manhã e a tarde de um dia útil, em ordem', () => {
    // 2026-09-09 é uma quarta.
    expect(intervalsFor(hours, '2026-09-09')).toEqual([
      { opens: '08:00', closes: '12:00' },
      { opens: '13:30', closes: '18:00' },
    ]);
  });

  it('devolve vazio no fim de semana', () => {
    expect(intervalsFor(hours, '2026-09-12')).toEqual([]);
    expect(isBusinessDay(hours, '2026-09-12')).toBe(false);
  });

  it('a exceção fechada apaga o dia', () => {
    expect(intervalsFor(hours, '2026-09-07')).toEqual([]);
    expect(isBusinessDay(hours, '2026-09-07')).toBe(false);
  });

  it('a exceção aberta SUBSTITUI a semana, não se soma a ela', () => {
    // Sexta de meio período: uma tarde herdada da semana seria a exceção
    // não significando nada.
    expect(intervalsFor(hours, '2026-09-11')).toEqual([
      { opens: '08:00', closes: '12:00' },
    ]);
  });

  it('não usa `new Date()` na chave do dia', () => {
    // Se a implementação parseasse '2026-09-09' como UTC, um runtime a
    // oeste de Greenwich leria terça e devolveria os mesmos intervalos por
    // coincidência. Um domingo é o caso em que a coincidência quebra.
    expect(intervalsFor(hours, '2026-09-13')).toEqual([]);
    expect(intervalsFor(hours, '2026-09-14')).toHaveLength(2);
  });
});

describe('isOpenAt', () => {
  it('abre no minuto de abertura e fecha no de fechamento', () => {
    expect(isOpenAt(hours, '2026-09-09', '08:00')).toBe(true);
    expect(isOpenAt(hours, '2026-09-09', '11:59')).toBe(true);
    expect(isOpenAt(hours, '2026-09-09', '12:00')).toBe(false);
  });

  it('o almoço é fechado', () => {
    expect(isOpenAt(hours, '2026-09-09', '12:30')).toBe(false);
    expect(isOpenAt(hours, '2026-09-09', '13:30')).toBe(true);
  });

  it('feriado e hora inválida são fechados', () => {
    expect(isOpenAt(hours, '2026-09-07', '10:00')).toBe(false);
    expect(isOpenAt(hours, '2026-09-09', 'x')).toBe(false);
  });
});

describe('nextOpenSlot', () => {
  it('o atalho "amanhã" numa sexta à noite cai na segunda de manhã', () => {
    // 2026-09-11 é sexta (meio período); o dia seguinte é sábado.
    expect(nextOpenSlot(hours, '2026-09-12', '00:00')).toEqual({
      day: '2026-09-14',
      time: '08:00',
    });
  });

  it('quem já está dentro do expediente fica onde está', () => {
    expect(nextOpenSlot(hours, '2026-09-09', '09:15')).toEqual({
      day: '2026-09-09',
      time: '09:15',
    });
  });

  it('no almoço, empurra para a tarde do mesmo dia', () => {
    expect(nextOpenSlot(hours, '2026-09-09', '12:30')).toEqual({
      day: '2026-09-09',
      time: '13:30',
    });
  });

  it('depois do expediente, vai para o dia seguinte', () => {
    expect(nextOpenSlot(hours, '2026-09-09', '19:00')).toEqual({
      day: '2026-09-10',
      time: '08:00',
    });
  });

  it('pula o feriado', () => {
    // Domingo 06/09; segunda 07/09 é feriado.
    expect(nextOpenSlot(hours, '2026-09-06')).toEqual({
      day: '2026-09-08',
      time: '08:00',
    });
  });

  it('sem hora, devolve a primeira do dia', () => {
    expect(nextOpenSlot(hours, '2026-09-09')).toEqual({
      day: '2026-09-09',
      time: '08:00',
    });
  });

  it('desiste quando a semana inteira está fechada', () => {
    const closed: BusinessHours = { ...hours, weekly: [], exceptions: [] };
    expect(nextOpenSlot(closed, '2026-09-09', '08:00')).toBeNull();
  });
});

describe('firstOpenTime', () => {
  it('é a abertura da manhã, e null num dia fechado', () => {
    expect(firstOpenTime(hours, '2026-09-09')).toBe('08:00');
    expect(firstOpenTime(hours, '2026-09-07')).toBeNull();
  });
});

describe('addBusinessDays', () => {
  it('um dia útil a partir de sexta é segunda', () => {
    expect(addBusinessDays(hours, '2026-09-11', 1)).toBe('2026-09-14');
  });

  it('conta a partir de um dia fechado sem contá-lo', () => {
    // Sábado + 1 dia útil é a segunda seguinte, não a terça.
    expect(addBusinessDays(hours, '2026-09-12', 1)).toBe('2026-09-14');
  });

  it('pula o feriado', () => {
    // Sexta 04/09 + 1: segunda 07/09 é feriado, então terça 08/09.
    expect(addBusinessDays(hours, '2026-09-04', 1)).toBe('2026-09-08');
  });

  it('anda para trás', () => {
    expect(addBusinessDays(hours, '2026-09-14', -1)).toBe('2026-09-11');
  });

  it('zero é o próprio dia, mesmo fechado', () => {
    expect(addBusinessDays(hours, '2026-09-12', 0)).toBe('2026-09-12');
  });

  it('cai em dias corridos quando não há dia útil nenhum', () => {
    const closed: BusinessHours = { ...hours, weekly: [], exceptions: [] };
    expect(addBusinessDays(closed, '2026-09-09', 3)).toBe('2026-09-12');
  });
});

describe('dayBounds', () => {
  it('dá uma hora de folga de cada lado', () => {
    expect(dayBounds(hours)).toEqual({ startHour: 7, endHour: 19 });
  });

  it('só olha os dias em tela quando eles são passados', () => {
    // Uma semana de sábado a domingo não tem expediente; a régua cai no
    // padrão em vez de esticar para a semana toda.
    expect(dayBounds(hours, ['2026-09-12', '2026-09-13'])).toEqual({
      startHour: 8,
      endHour: 18,
    });
  });

  it('a sexta de meio período encurta a régua daquele dia', () => {
    expect(dayBounds(hours, ['2026-09-11'])).toEqual({
      startHour: 7,
      endHour: 13,
    });
  });
});

describe('toBusinessHours', () => {
  it('normaliza as três consultas', () => {
    const result = toBusinessHours(
      { timezone: 'America/Manaus', week_starts_on: 1, slot_minutes: 15 },
      [{ weekday: 2, opens_at: '09:00:00', closes_at: '17:00:00' }],
      [
        {
          on_date: '2026-12-25',
          closed: true,
          opens_at: null,
          closes_at: null,
          label: 'Natal',
        },
      ]
    );

    expect(result.timezone).toBe('America/Manaus');
    expect(result.weekStartsOn).toBe(1);
    expect(result.slotMinutes).toBe(15);
    expect(result.weekly).toEqual([
      { weekday: 2, opens: '09:00', closes: '17:00' },
    ]);
    expect(result.exceptions[0]?.label).toBe('Natal');
  });

  it('recusa um fuso que o runtime não conhece', () => {
    const result = toBusinessHours(
      { timezone: 'Mars/Olympus_Mons' },
      [{ weekday: 1, opens_at: '08:00:00', closes_at: '12:00:00' }],
      []
    );
    expect(result.timezone).toBe('America/Sao_Paulo');
  });

  it('sem linha nenhuma cai no padrão, não em "fechado sempre"', () => {
    // A 066 pode não ter rodado. Uma agenda sem régua é pior que uma com a
    // régua errada — ver a nota de DEFAULT_BUSINESS_HOURS.
    const result = toBusinessHours(null, [], []);
    expect(result.weekly).toEqual(DEFAULT_BUSINESS_HOURS.weekly);
    expect(isBusinessDay(result, '2026-09-09')).toBe(true);
  });

  it('descarta uma linha com hora ilegível em vez de propagar NaN', () => {
    const result = toBusinessHours(
      null,
      [
        { weekday: 1, opens_at: 'x', closes_at: '12:00:00' },
        { weekday: 1, opens_at: '08:00:00', closes_at: '12:00:00' },
      ],
      []
    );
    expect(result.weekly).toEqual([
      { weekday: 1, opens: '08:00', closes: '12:00' },
    ]);
  });
});
