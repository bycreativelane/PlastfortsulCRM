import { describe, expect, it } from 'vitest';

import {
  eventIdForTask,
  exclusiveToInclusive,
  inclusiveToExclusive,
  normalizeEmail,
  taskToEvent,
  toMirrorEvent,
} from './map';

describe('o fim exclusivo da Google', () => {
  it('um evento de UM dia não vira de dois', () => {
    // É assim que a Google manda "o dia 7, e só ele".
    const mirror = toMirrorEvent({
      id: 'e1',
      start: { date: '2026-09-07' },
      end: { date: '2026-09-08' },
    });
    expect(mirror?.all_day).toBe(true);
    expect(mirror?.start_date).toBe('2026-09-07');
    expect(mirror?.end_date).toBe('2026-09-07');
  });

  it('atravessa o mês para trás', () => {
    expect(exclusiveToInclusive('2026-10-01')).toBe('2026-09-30');
  });

  it('atravessa o ano', () => {
    expect(exclusiveToInclusive('2027-01-01')).toBe('2026-12-31');
  });

  it('sobrevive ao 29 de fevereiro', () => {
    // 2028 é bissexto.
    expect(exclusiveToInclusive('2028-03-01')).toBe('2028-02-29');
  });

  it('a volta desfaz a ida', () => {
    for (const iso of ['2026-09-07', '2026-12-31', '2028-02-29']) {
      expect(exclusiveToInclusive(inclusiveToExclusive(iso)!)).toBe(iso);
    }
  });

  it('recusa o que não é data', () => {
    expect(exclusiveToInclusive('amanhã')).toBeNull();
    expect(exclusiveToInclusive('2026-9-7')).toBeNull();
  });
});

describe('toMirrorEvent', () => {
  it('guarda o marcado como timestamp e não toca nas colunas de data', () => {
    const mirror = toMirrorEvent({
      id: 'e2',
      start: { dateTime: '2026-09-07T14:00:00-03:00' },
      end: { dateTime: '2026-09-07T15:00:00-03:00' },
    });
    expect(mirror?.all_day).toBe(false);
    expect(mirror?.starts_at).toBe('2026-09-07T14:00:00-03:00');
    expect(mirror?.start_date).toBeNull();
    expect(mirror?.end_date).toBeNull();
  });

  it('descarta o que não tem id', () => {
    expect(toMirrorEvent({ start: { date: '2026-09-07' } })).toBeNull();
  });

  it('descarta o que não tem começo', () => {
    expect(toMirrorEvent({ id: 'e3' })).toBeNull();
  });

  it('um dia inteiro sem fim dura um dia', () => {
    const mirror = toMirrorEvent({ id: 'e4', start: { date: '2026-09-07' } });
    expect(mirror?.end_date).toBe('2026-09-07');
  });

  it('normaliza os e-mails dos participantes', () => {
    const mirror = toMirrorEvent({
      id: 'e5',
      start: { date: '2026-09-07' },
      organizer: { email: ' Vendas@Empresa.COM ' },
      attendees: [{ email: 'Maria@Cliente.com' }, {}, { email: '  ' }],
    });
    expect(mirror?.organizer_email).toBe('vendas@empresa.com');
    expect(mirror?.attendee_emails).toEqual(['maria@cliente.com']);
  });
});

describe('normalizeEmail', () => {
  it('casa caixas diferentes do mesmo endereço', () => {
    expect(normalizeEmail('Maria@Empresa.com')).toBe('maria@empresa.com');
  });

  it('devolve null para vazio', () => {
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe('eventIdForTask', () => {
  it('é determinístico e cabe em base32hex', () => {
    // O alfabeto para em `v`. Um prefixo com `w`, `x`, `y` ou `z` é
    // recusado pela Google no envio — não na compilação.
    const id = eventIdForTask('3F2504E0-4F89-11D3-9A0C-0305E82C3301');
    expect(id).toBe('crm3f2504e04f8911d39a0c0305e82c3301');
    expect(id).toMatch(/^[0-9a-v]+$/);
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(id).toBe(eventIdForTask('3F2504E0-4F89-11D3-9A0C-0305E82C3301'));
  });
});

describe('taskToEvent', () => {
  const base = { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', title: 'Ligar' };

  it('sem hora publica DIA INTEIRO, e não meia-noite', () => {
    const body = taskToEvent({ ...base, due_on: '2026-09-07' });
    expect(body?.start).toEqual({ date: '2026-09-07' });
    // O fim volta a ser exclusivo do lado da Google.
    expect(body?.end).toEqual({ date: '2026-09-08' });
  });

  it('com hora publica um intervalo', () => {
    const body = taskToEvent({
      ...base,
      due_on: '2026-09-07',
      due_time: '14:30',
      duration_minutes: 45,
    });
    expect(body?.start).toEqual({ dateTime: '2026-09-07T14:30:00' });
    expect(body?.end).toEqual({ dateTime: '2026-09-07T15:15:00' });
  });

  it('usa 30 minutos quando a duração não foi dita', () => {
    const body = taskToEvent({ ...base, due_on: '2026-09-07', due_time: '09:00' });
    expect(body?.end).toEqual({ dateTime: '2026-09-07T09:30:00' });
  });

  it('não deixa um compromisso atravessar a meia-noite', () => {
    const body = taskToEvent({
      ...base,
      due_on: '2026-09-07',
      due_time: '23:50',
      duration_minutes: 60,
    });
    expect(body?.end).toEqual({ dateTime: '2026-09-07T23:59:00' });
  });

  it('marca a concluída com um visto em vez de apagar', () => {
    const body = taskToEvent({
      ...base,
      due_on: '2026-09-07',
      status: 'done',
    });
    expect(body?.summary).toBe('✓ Ligar');
  });

  it('sem prazo não há evento', () => {
    expect(taskToEvent({ ...base })).toBeNull();
  });

  it('o id do corpo é o determinístico', () => {
    const body = taskToEvent({ ...base, due_on: '2026-09-07' });
    expect(body?.id).toBe(eventIdForTask(base.id));
  });
});
