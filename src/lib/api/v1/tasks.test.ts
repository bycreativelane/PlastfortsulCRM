import { describe, expect, it } from 'vitest';

import type { Task } from '@/types';

import { serializeTask, TaskApiError, validateTaskInput } from './tasks';

function row(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    account_id: 'acc',
    title: 'Ligar',
    kind: 'call',
    status: 'open',
    due_on: '2026-09-07',
    due_time: '14:30:00',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Task;
}

describe('o contrato de saída', () => {
  it('publica HH:MM, e não o HH:MM:SS que o Postgres devolve', () => {
    expect(serializeTask(row()).due_time).toBe('14:30');
  });

  it('mantém dia e hora SEPARADOS', () => {
    const out = serializeTask(row());
    // Fundi-los obrigaria a escolher um fuso na saída e a adivinhar, na
    // entrada, se "2026-09-07T00:00:00" era o dia ou a meia-noite.
    expect(out.due_on).toBe('2026-09-07');
    expect(out).not.toHaveProperty('due_at');
  });

  it('a ausência de hora sai como null, não como 00:00', () => {
    expect(serializeTask(row({ due_time: null })).due_time).toBeNull();
  });

  it('não vaza `reminded_at`, que é estado da varredura', () => {
    const out = serializeTask(row({ reminded_at: '2026-09-07T13:00:00Z' }));
    expect(out).not.toHaveProperty('reminded_at');
  });
});

describe('validação de entrada', () => {
  it('exige título ao criar', () => {
    expect(() => validateTaskInput({}, { partial: false })).toThrow(
      TaskApiError
    );
    expect(() =>
      validateTaskInput({ title: '   ' }, { partial: false })
    ).toThrow(/title is required/);
  });

  it('não exige título ao atualizar', () => {
    const patch = validateTaskInput({ status: 'done' }, { partial: true });
    expect(patch.status).toBe('done');
    expect(patch).not.toHaveProperty('title');
  });

  it('recusa `due_time` sem `due_on`', () => {
    // "As 14h" sem dia não é um prazo, e aceitar isso gravaria uma hora
    // que nunca chega — a varredura de lembretes procura por `due_on`.
    expect(() =>
      validateTaskInput({ due_time: '14:00' }, { partial: true })
    ).toThrow(/due_time requires due_on/);
  });

  it('aceita `due_time` quando `due_on` vem junto', () => {
    const patch = validateTaskInput(
      { due_on: '2026-09-07', due_time: '14:00' },
      { partial: true }
    );
    expect(patch.due_time).toBe('14:00');
  });

  it('limpar o prazo limpa a hora junto', () => {
    const patch = validateTaskInput({ due_on: null }, { partial: true });
    expect(patch.due_on).toBeNull();
    // Senão sobraria uma hora órfã apontando para um dia que já não existe.
    expect(patch.due_time).toBeNull();
  });

  it('recusa formatos errados de data e hora', () => {
    expect(() =>
      validateTaskInput({ due_on: '07/09/2026' }, { partial: true })
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      validateTaskInput(
        { due_on: '2026-09-07', due_time: '25:00' },
        { partial: true }
      )
    ).toThrow(/HH:MM/);
    expect(() =>
      validateTaskInput(
        { due_on: '2026-09-07', due_time: '2:00' },
        { partial: true }
      )
    ).toThrow(/HH:MM/);
  });

  it('recusa status e tipo desconhecidos', () => {
    expect(() =>
      validateTaskInput({ status: 'quase' }, { partial: true })
    ).toThrow(/open, done or cancelled/);
    expect(() =>
      validateTaskInput({ kind: 'telepatia' }, { partial: true })
    ).toThrow(/kind must be one of/);
  });

  it('concluir carimba `completed_at`, e reabrir limpa', () => {
    const done = validateTaskInput({ status: 'done' }, { partial: true });
    expect(typeof done.completed_at).toBe('string');
    // Sem isto, uma tarefa fechada por integração ficaria sem data e
    // sumiria dos relatórios que contam por período.
    const open = validateTaskInput({ status: 'open' }, { partial: true });
    expect(open.completed_at).toBeNull();
  });

  it('recusa um PATCH vazio em vez de escrever nada em silêncio', () => {
    expect(() => validateTaskInput({}, { partial: true })).toThrow(
      /nothing to update/
    );
  });

  it('aceita desatribuir passando null', () => {
    const patch = validateTaskInput({ assigned_to: null }, { partial: true });
    expect(patch.assigned_to).toBeNull();
  });

  it('o erro carrega código e status para a resposta', () => {
    try {
      validateTaskInput({ due_on: 'ontem' }, { partial: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TaskApiError);
      expect((error as TaskApiError).code).toBe('invalid_due_on');
      expect((error as TaskApiError).status).toBe(400);
    }
  });
});
