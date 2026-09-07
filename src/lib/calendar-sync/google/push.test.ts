import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '@/types';

const upsertEvent = vi.fn();
const deleteEvent = vi.fn();

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    upsertEvent: (...args: unknown[]) => upsertEvent(...args),
    deleteEvent: (...args: unknown[]) => deleteEvent(...args),
  };
});

// O token vem decifrado do banco; aqui a conexão já traz um válido para
// que `ensureAccessToken` não tente renovar (o que exigiria rede).
vi.mock('./events', async () => {
  const actual = await vi.importActual<typeof import('./events')>('./events');
  return { ...actual, ensureAccessToken: async () => 'token-vivo' };
});

const { applyRemoteMove, reconcileTask } = await import('./push');
const { GoogleApiError } = await import('./client');
type LinkRow = import('./push').LinkRow;

/**
 * As cinco regras do §D5, cada uma com teste — é o que a fase 5 pede
 * nominalmente, e a razão é que nenhuma delas falha de forma barulhenta.
 * Uma tarefa apagada por engano, um evento duplicado, um ricochete que move
 * o compromisso sozinho: os três acontecem em silêncio e só aparecem quando
 * alguém repara que a agenda está errada.
 */

function task(over: Partial<Task> = {}): Task {
  return {
    id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    account_id: 'acc',
    title: 'Ligar para o Marcos',
    kind: 'call',
    status: 'open',
    due_on: '2026-09-07',
    due_time: '14:00',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Task;
}

interface Write {
  table: string;
  op: 'upsert' | 'update';
  payload: Record<string, unknown>;
}

function fakeDb() {
  const writes: Write[] = [];
  const db = {
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>) {
          writes.push({ table, op: 'upsert', payload });
          return Promise.resolve({ data: null, error: null });
        },
        update(payload: Record<string, unknown>) {
          writes.push({ table, op: 'update', payload });
          const q: Record<string, unknown> = {};
          q.eq = () => q;
          q.in = () => q;
          q.then = (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null });
          return q;
        },
      };
    },
  };
  return { db: db as never, writes };
}

const CONNECTION = {
  id: 'conn',
  account_id: 'acc',
  refresh_token: 'r',
  access_token: null,
  access_expires_at: null,
};
const TARGETS = [{ sourceId: 'src-1', externalId: 'primaria@group.calendar' }];

beforeEach(() => {
  upsertEvent.mockReset().mockResolvedValue({ id: 'ev1', etag: '"v2"' });
  deleteEvent.mockReset().mockResolvedValue(undefined);
});

describe('regra 4 — concluir não apaga o evento, cancelar apaga', () => {
  it('a concluída CONTINUA na agenda, com o visto no título', async () => {
    const { db } = fakeDb();
    const outcome = await reconcileTask(
      db,
      CONNECTION,
      task({ status: 'done' }),
      TARGETS
    );

    expect(outcome.pushed).toBe(1);
    expect(deleteEvent).not.toHaveBeenCalled();
    const body = upsertEvent.mock.calls[0][3] as { summary: string };
    // Uma agenda que se esvazia conforme o trabalho é feito perde o
    // registro que a torna útil.
    expect(body.summary).toBe('✓ Ligar para o Marcos');
  });

  it('a cancelada é REMOVIDA — o único caso em que o evento some', async () => {
    const { db, writes } = fakeDb();
    const outcome = await reconcileTask(
      db,
      CONNECTION,
      task({ status: 'cancelled' }),
      TARGETS
    );

    expect(outcome.deleted).toBe(1);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
    expect(upsertEvent).not.toHaveBeenCalled();
    expect(writes[0].payload.sync_state).toBe('deleted');
  });

  it('a que perdeu o prazo sai também — o caso silencioso', async () => {
    const { db } = fakeDb();
    const outcome = await reconcileTask(
      db,
      CONNECTION,
      task({ due_on: null }),
      TARGETS
    );

    // Sem isto, alguém limpa a data e o evento fica lá marcando um dia que
    // a tarefa já não reivindica.
    expect(outcome.deleted).toBe(1);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });
});

describe('o vínculo guarda o etag que ESTE lado escreveu', () => {
  it('grava o etag da resposta, que é o que impede o ricochete', async () => {
    const { db, writes } = fakeDb();
    await reconcileTask(db, CONNECTION, task(), TARGETS);

    const link = writes.find((w) => w.table === 'task_calendar_links');
    expect(link?.payload.etag).toBe('"v2"');
    expect(link?.payload.sync_state).toBe('synced');
    expect(link?.payload.external_id).toBe('ev1');
  });

  it('publica em cada agenda de destino', async () => {
    const { db } = fakeDb();
    const outcome = await reconcileTask(db, CONNECTION, task(), [
      ...TARGETS,
      { sourceId: 'src-2', externalId: 'comercial@group.calendar' },
    ]);
    expect(outcome.pushed).toBe(2);
    expect(upsertEvent).toHaveBeenCalledTimes(2);
  });

  it('sem destino não chama a Google', async () => {
    const { db, writes } = fakeDb();
    const outcome = await reconcileTask(db, CONNECTION, task(), []);
    expect(outcome).toEqual({ pushed: 0, deleted: 0, failed: 0 });
    expect(upsertEvent).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('a caixa de saída — o que falha volta', () => {
  it('erro transitório fica pendente, para o cron drenar', async () => {
    upsertEvent.mockRejectedValue(new GoogleApiError(503, 'indisponível'));
    const { db, writes } = fakeDb();

    const outcome = await reconcileTask(db, CONNECTION, task(), TARGETS);

    expect(outcome.failed).toBe(1);
    const link = writes.find((w) => w.table === 'task_calendar_links');
    expect(link?.payload.sync_state).toBe('pending');
    expect(link?.payload.last_error).toContain('503');
  });

  it('erro permanente vira `error`, que a tela pode destacar', async () => {
    upsertEvent.mockRejectedValue(new GoogleApiError(403, 'escopo faltando'));
    const { db, writes } = fakeDb();

    await reconcileTask(db, CONNECTION, task(), TARGETS);

    const link = writes.find((w) => w.table === 'task_calendar_links');
    // "Aguardando" para sempre é pior do que dizer que precisa de gente.
    expect(link?.payload.sync_state).toBe('error');
  });

  it('uma agenda que falha não impede a outra', async () => {
    upsertEvent
      .mockRejectedValueOnce(new GoogleApiError(503, 'oops'))
      .mockResolvedValueOnce({ id: 'ev2', etag: '"v9"' });
    const { db } = fakeDb();

    const outcome = await reconcileTask(db, CONNECTION, task(), [
      ...TARGETS,
      { sourceId: 'src-2', externalId: 'comercial@group.calendar' },
    ]);

    expect(outcome.failed).toBe(1);
    expect(outcome.pushed).toBe(1);
  });
});

describe('regra 2 — mover na Google move a tarefa', () => {
  const link: LinkRow = {
    id: 'link-1',
    task_id: 't1',
    source_id: 'src-1',
    external_id: 'ev1',
    etag: '"v1"',
    sync_state: 'synced',
  };

  it('NÃO age quando o etag é o mesmo — é a nossa própria escrita', async () => {
    const { db, writes } = fakeDb();
    const moved = await applyRemoteMove(db, link, {
      etag: '"v1"',
      all_day: true,
      start_date: '2026-09-20',
    });

    expect(moved).toBe(false);
    // O ricochete que isto impede: sem a comparação, cada tique "moveria"
    // a tarefa para onde ela já estava, para sempre.
    expect(writes).toHaveLength(0);
  });

  it('move quando o etag mudou, e grava o etag ANTES da tarefa', async () => {
    const { db, writes } = fakeDb();
    const moved = await applyRemoteMove(db, link, {
      etag: '"v2"',
      all_day: true,
      start_date: '2026-09-20',
    });

    expect(moved).toBe(true);
    const linkIdx = writes.findIndex((w) => w.table === 'task_calendar_links');
    const taskIdx = writes.findIndex((w) => w.table === 'tasks');
    // Se a segunda escrita falhar, o pior caso é uma mudança perdida — e
    // não um laço que remove a mesma coisa a cada cinco minutos.
    expect(linkIdx).toBeLessThan(taskIdx);
    expect(writes[taskIdx].payload.due_on).toBe('2026-09-20');
  });

  it('um evento com hora leva a hora junto', async () => {
    const { db, writes } = fakeDb();
    await applyRemoteMove(db, link, {
      etag: '"v3"',
      all_day: false,
      starts_at: '2026-09-21T09:30:00-03:00',
      time: '09:30',
    });

    const taskWrite = writes.find((w) => w.table === 'tasks');
    expect(taskWrite?.payload.due_on).toBe('2026-09-21');
    expect(taskWrite?.payload.due_time).toBe('09:30');
  });

  it('o dia inteiro zera a hora em vez de inventar meia-noite', async () => {
    const { db, writes } = fakeDb();
    await applyRemoteMove(db, link, {
      etag: '"v4"',
      all_day: true,
      start_date: '2026-09-22',
    });

    const taskWrite = writes.find((w) => w.table === 'tasks');
    expect(taskWrite?.payload.due_time).toBeNull();
  });

  it('sem etag não faz nada — não dá para saber se mudou', async () => {
    const { db, writes } = fakeDb();
    const moved = await applyRemoteMove(db, link, {
      etag: null,
      all_day: true,
      start_date: '2026-09-30',
    });

    expect(moved).toBe(false);
    expect(writes).toHaveLength(0);
  });
});

describe('regra 5 e as instruções que cada código carrega', () => {
  it('429 e 5xx são transitórios', () => {
    expect(new GoogleApiError(429, 'quota').isTransient).toBe(true);
    expect(new GoogleApiError(503, 'oops').isTransient).toBe(true);
  });

  it('403 NÃO é transitório, mesmo sendo às vezes cota', () => {
    // Distinguir "cota estourada" de "escopo faltando" exige ler a
    // mensagem, e repetir um escopo faltando para sempre nunca fecha.
    expect(new GoogleApiError(403, 'insufficient scope').isTransient).toBe(
      false
    );
  });

  it('cada código carrega a sua instrução', () => {
    expect(new GoogleApiError(410, 'sync token').needsFullResync).toBe(true);
    expect(new GoogleApiError(409, 'duplicate').alreadyExists).toBe(true);
    expect(new GoogleApiError(404, 'not found').isGone).toBe(true);
    expect(new GoogleApiError(401, 'expired').isExpiredToken).toBe(true);
  });
});
