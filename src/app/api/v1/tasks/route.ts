// ============================================================
// GET  /api/v1/tasks  — list tasks   (scope: tasks:read)
// POST /api/v1/tasks  — create a task (scope: tasks:write)
//
// Keyset-paginated like every other list here. Filters: `contact_id`,
// `deal_id`, `status`, `assigned_to`, and the pair `due_from` /
// `due_to` — the one an integration actually wants, because "what is
// due this week" is the question a task list answers.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import {
  assertContactOwned,
  serializeTask,
  TASK_SELECT,
  TaskApiError,
  validateTaskInput,
} from '@/lib/api/v1/tasks';
import type { Task } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read');
    const url = new URL(request.url);
    const { limit, cursor } = parseListParams(request);

    let query = ctx.supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    for (const [param, column] of [
      ['contact_id', 'contact_id'],
      ['deal_id', 'deal_id'],
      ['status', 'status'],
      ['assigned_to', 'assigned_to'],
      ['kind', 'kind'],
    ] as const) {
      const value = url.searchParams.get(param);
      if (value) query = query.eq(column, value);
    }

    // A janela de prazo, que é a pergunta de verdade de quem consome uma
    // lista de tarefas. Comparação de `DATE` com string ISO: nenhum fuso
    // entra na conta, que é o ponto da coluna ser DATE.
    const dueFrom = url.searchParams.get('due_from');
    if (dueFrom) query = query.gte('due_on', dueFrom);
    const dueTo = url.searchParams.get('due_to');
    if (dueTo) query = query.lte('due_on', dueTo);

    const filter = keysetFilter(cursor);
    if (filter) query = query.or(filter);

    const { data, error } = await query;
    if (error) return toApiErrorResponse(error);

    const page = buildPage((data ?? []) as unknown as Task[], limit);
    return okList(page.items.map(serializeTask), page.nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tasks:write');
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const patch = validateTaskInput(body, { partial: false });

    // TENANCY NA REFERÊNCIA.
    //
    // A chave é de uma conta, mas `contact_id` vem do corpo. Sem esta
    // conferência, uma chave válida anexaria a tarefa ao contato de outra
    // empresa — e a RLS não pega isso num INSERT cujo próprio `account_id`
    // está certo.
    if (typeof patch.contact_id === 'string') {
      await assertContactOwned(ctx.supabase, ctx.accountId, patch.contact_id);
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .insert({
        account_id: ctx.accountId,
        kind: 'todo',
        ...patch,
      })
      .select(TASK_SELECT)
      .maybeSingle();

    if (error) return toApiErrorResponse(error);
    if (!data) return fail('internal_error', 'insert returned no row', 500);

    return ok(serializeTask(data as unknown as Task), 201);
  } catch (err) {
    if (err instanceof TaskApiError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
