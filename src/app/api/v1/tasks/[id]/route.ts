// ============================================================
// GET    /api/v1/tasks/{id}  — one task     (scope: tasks:read)
// PATCH  /api/v1/tasks/{id}  — update it    (scope: tasks:write)
// DELETE /api/v1/tasks/{id}  — remove it    (scope: tasks:write)
//
// Concluir é `PATCH { "status": "done" }` e não um verbo próprio: um
// `/complete` seria uma segunda porta para a mesma transição, com uma
// segunda regra para manter em sincronia com a primeira.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  assertContactOwned,
  serializeTask,
  TASK_SELECT,
  TaskApiError,
  validateTaskInput,
} from '@/lib/api/v1/tasks';
import type { Task } from '@/types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) return toApiErrorResponse(error);
    if (!data) return fail('not_found', 'task not found', 404);

    return ok(serializeTask(data as unknown as Task));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'tasks:write');
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const patch = validateTaskInput(body, { partial: true });

    if (typeof patch.contact_id === 'string') {
      await assertContactOwned(ctx.supabase, ctx.accountId, patch.contact_id);
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(TASK_SELECT)
      .maybeSingle();

    if (error) return toApiErrorResponse(error);
    if (!data) return fail('not_found', 'task not found', 404);

    return ok(serializeTask(data as unknown as Task));
  } catch (err) {
    if (err instanceof TaskApiError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}

/**
 * Apagar de verdade, e é a única operação desta API que faz isso.
 *
 * A 068 decidiu que uma tarefa concluída FICA — status e motivo, nunca
 * DELETE — e essa decisão continua valendo para o produto. Mas uma
 * integração que criou uma tarefa por engano precisa de um caminho de
 * volta, e `status: 'cancelled'` deixa na lista uma linha que nunca
 * deveria ter existido. Cancelar é para o que foi decidido; apagar é para
 * o que foi um erro de escrita.
 */
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const ctx = await requireApiKey(request, 'tasks:write');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) return toApiErrorResponse(error);
    if (!data) return fail('not_found', 'task not found', 404);

    return ok({ id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
