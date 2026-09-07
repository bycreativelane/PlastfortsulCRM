import { describe, expect, it } from 'vitest';

import type { Task } from '@/types';

import {
  bucketOf,
  closedTasks,
  filterTasks,
  groupTasks,
  summarize,
} from './board';

const HOJE = '2026-09-07';

function task(over: Partial<Task> = {}): Task {
  return {
    id: Math.random().toString(36).slice(2),
    account_id: 'acc',
    title: 'Ligar',
    kind: 'call',
    status: 'open',
    due_on: HOJE,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Task;
}

describe('bucketOf', () => {
  it('o que venceu é "atrasada", por mais antigo que seja', () => {
    expect(bucketOf(task({ due_on: '2026-09-06' }), HOJE)).toBe('overdue');
    expect(bucketOf(task({ due_on: '2025-01-01' }), HOJE)).toBe('overdue');
  });

  it('hoje, amanhã e a semana', () => {
    expect(bucketOf(task({ due_on: HOJE }), HOJE)).toBe('today');
    expect(bucketOf(task({ due_on: '2026-09-08' }), HOJE)).toBe('tomorrow');
    expect(bucketOf(task({ due_on: '2026-09-11' }), HOJE)).toBe('week');
  });

  it('a semana são os SETE dias seguintes, não "até domingo"', () => {
    // 2026-09-07 é segunda; 14 é a segunda seguinte.
    expect(bucketOf(task({ due_on: '2026-09-14' }), HOJE)).toBe('week');
    expect(bucketOf(task({ due_on: '2026-09-15' }), HOJE)).toBe('later');
  });

  it('sem prazo é "algum dia", e não atrasada', () => {
    // O erro fácil seria tratar null como "vencido há muito tempo".
    expect(bucketOf(task({ due_on: null }), HOJE)).toBe('someday');
  });
});

describe('groupTasks', () => {
  it('atrasadas vêm primeiro, mesmo com data mais antiga', () => {
    const grupos = groupTasks(
      [
        task({ due_on: '2026-09-20', title: 'Depois' }),
        task({ due_on: '2026-08-30', title: 'Vencida' }),
        task({ due_on: HOJE, title: 'Hoje' }),
      ],
      HOJE
    );
    expect(grupos.map((g) => g.bucket)).toEqual(['overdue', 'today', 'later']);
  });

  it('não desenha faixa vazia', () => {
    const grupos = groupTasks([task({ due_on: HOJE })], HOJE);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].bucket).toBe('today');
  });

  it('deixa de fora o que não está aberto', () => {
    const grupos = groupTasks(
      [task({ status: 'done' }), task({ status: 'cancelled' })],
      HOJE
    );
    expect(grupos).toHaveLength(0);
  });

  it('dentro da faixa: prazo, hora, e o título como desempate', () => {
    const grupos = groupTasks(
      [
        task({ due_on: HOJE, due_time: '14:00', title: 'Zebra' }),
        task({ due_on: HOJE, due_time: null, title: 'Sem hora' }),
        task({ due_on: HOJE, due_time: '09:00', title: 'Cedo' }),
        task({ due_on: HOJE, due_time: '14:00', title: 'Alfa' }),
      ],
      HOJE
    );
    // Sem o título como terceiro critério, a ordem das duas de 14:00
    // dependeria de como o banco as devolveu.
    expect(grupos[0].tasks.map((t) => t.title)).toEqual([
      'Cedo',
      'Alfa',
      'Zebra',
      'Sem hora',
    ]);
  });
});

describe('filterTasks', () => {
  const base = {
    owner: 'all' as const,
    me: 'u1',
    hiddenKinds: new Set<string>(),
    search: '',
  };

  it('"Minhas" guarda o que é meu', () => {
    const out = filterTasks(
      [task({ assigned_to: 'u1' }), task({ assigned_to: 'u2' })],
      { ...base, owner: 'mine' }
    );
    expect(out).toHaveLength(1);
  });

  it('mostra tudo enquanto não se sabe quem está olhando', () => {
    const out = filterTasks(
      [task({ assigned_to: 'u1' }), task({ assigned_to: 'u2' })],
      { ...base, owner: 'mine', me: null }
    );
    expect(out).toHaveLength(2);
  });

  it('esconde os tipos desmarcados', () => {
    const out = filterTasks([task({ kind: 'call' }), task({ kind: 'visit' })], {
      ...base,
      hiddenKinds: new Set(['visit']),
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('call');
  });

  it('a busca olha título e detalhes, sem caixa', () => {
    const tarefas = [
      task({ title: 'Ligar para o Marcos' }),
      task({ title: 'Enviar orçamento', description: 'Falar com o MARCOS' }),
      task({ title: 'Outra coisa' }),
    ];
    expect(filterTasks(tarefas, { ...base, search: 'marcos' })).toHaveLength(2);
    expect(filterTasks(tarefas, { ...base, search: '  ' })).toHaveLength(3);
  });
});

describe('closedTasks', () => {
  it('mais recente primeiro', () => {
    const out = closedTasks([
      task({ status: 'done', completed_at: '2026-09-01T10:00:00Z' }),
      task({ status: 'done', completed_at: '2026-09-05T10:00:00Z' }),
      task({ status: 'open' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].completed_at).toBe('2026-09-05T10:00:00Z');
  });
});

describe('summarize', () => {
  it('conta abertas, atrasadas e de hoje', () => {
    const s = summarize(
      [
        task({ due_on: '2026-09-01' }),
        task({ due_on: '2026-09-02' }),
        task({ due_on: HOJE }),
        task({ due_on: '2026-10-01' }),
        task({ status: 'done', due_on: '2026-09-01' }),
      ],
      HOJE
    );
    // A concluída atrasada não conta: já saiu da fila.
    expect(s).toEqual({ open: 4, overdue: 2, today: 1 });
  });
});
