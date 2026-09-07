import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/calendar-sync/admin-client';
import { loadConnection } from '@/lib/calendar-sync/google/run';
import { loadPushTargets, reconcileTask } from '@/lib/calendar-sync/google/push';
import type { Task } from '@/types';

/**
 * Reconciliar uma tarefa com a agenda da Google.
 *
 * ------------------------------------------------------------------
 * POR QUE ISTO É UMA ROTA, SE TAREFA NÃO TEM ROTA
 * ------------------------------------------------------------------
 *
 * A fase 2 decidiu que o CRM escreve `tasks` direto do navegador sob RLS, e
 * essa decisão continua valendo — não há `/api/tasks`. Mas publicar na
 * Google precisa do refresh token, que mora numa tabela com RLS ligada e
 * NENHUMA política (069), e um token que abre a agenda da empresa não vai
 * para o navegador por conveniência de arquitetura.
 *
 * Então a tarefa é salva como sempre foi, e SÓ o empurrão passa por aqui.
 * A rota não escreve `tasks`: ela lê o estado atual e faz a Google
 * combinar com ele.
 *
 * ------------------------------------------------------------------
 * QUALQUER MEMBRO, MAS SÓ AS TAREFAS DA PRÓPRIA CONTA
 * ------------------------------------------------------------------
 *
 * Quem pode criar uma tarefa pode publicá-la — exigir admin aqui faria o
 * agente criar tarefas que só um admin conseguiria mandar para a agenda,
 * que é uma metade de funcionalidade.
 *
 * A tarefa é buscada com `account_id` do chamador na consulta, e não
 * confiada do corpo: esta rota usa o service role, que passa por cima da
 * RLS. Aqui a checagem de conta É a segurança.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json()) as { taskId?: unknown };

    if (typeof body.taskId !== 'string' || body.taskId.length === 0) {
      return NextResponse.json({ error: 'taskId é obrigatório' }, { status: 400 });
    }

    const admin = supabaseAdmin();

    const { data: task } = await admin
      .from('tasks')
      .select('*')
      .eq('id', body.taskId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!task) {
      return NextResponse.json({ error: 'tarefa não encontrada' }, { status: 404 });
    }

    const connection = await loadConnection(admin, ctx.accountId);
    if (!connection) {
      // Não é erro: a maioria das contas não conecta agenda nenhuma, e o
      // diálogo de tarefa chama esta rota sempre. Um 4xx aqui encheria o
      // console de vermelho por uma configuração que é opcional.
      return NextResponse.json({ pushed: 0, deleted: 0, failed: 0, skipped: true });
    }

    const targets = await loadPushTargets(admin, connection.id);
    const outcome = await reconcileTask(
      admin,
      connection,
      task as unknown as Task,
      targets
    );

    return NextResponse.json(outcome);
  } catch (err) {
    return toErrorResponse(err);
  }
}
