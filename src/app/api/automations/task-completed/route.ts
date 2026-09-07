import { after } from 'next/server';
import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { runAutomationsForTrigger } from '@/lib/automations/engine';

/**
 * Avisar o motor que uma tarefa foi concluída.
 *
 * ------------------------------------------------------------------
 * POR QUE UMA ROTA, DE NOVO
 * ------------------------------------------------------------------
 *
 * Mesma razão do `/api/calendar/publish`: a tarefa é concluída no
 * navegador sob RLS (decisão da fase 2, que continua valendo), e o motor de
 * automações roda com service role porque precisa ler as automações da
 * conta, escrever `automation_logs` e mandar mensagem pelo WhatsApp. Nada
 * disso é coisa que o navegador de um agente deva conseguir fazer sozinho.
 *
 * ------------------------------------------------------------------
 * O ESTADO É CONFERIDO AQUI, NÃO CONFIADO DO CORPO
 * ------------------------------------------------------------------
 *
 * O corpo manda um id, e esta rota vai ao banco ver se a tarefa REALMENTE
 * está concluída e é da conta de quem chamou. Sem isso, qualquer sessão
 * conseguiria disparar o gatilho quantas vezes quisesse, para qualquer
 * tarefa — inclusive as que ainda estão abertas. Um gatilho que dispara
 * sem o fato que ele nomeia é pior que um gatilho que não dispara: manda
 * mensagem para cliente sobre coisa que não aconteceu.
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
      .select('id, kind, status, contact_id, deal_id')
      .eq('id', body.taskId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const row = task as {
      kind: string;
      status: string;
      contact_id: string | null;
      deal_id: string | null;
    } | null;

    // Não é erro: reabrir uma tarefa também passa por aqui, e o cliente
    // não deveria precisar saber quais transições disparam o quê.
    if (!row || row.status !== 'done') {
      return NextResponse.json({ dispatched: false });
    }

    // `after` para que a resposta não espere o motor: uma automação pode
    // mandar mensagem, chamar webhook e esperar — e a chavinha de concluir
    // não pode ficar girando por causa disso. Mesmo padrão do webhook de
    // entrada.
    after(async () => {
      await runAutomationsForTrigger({
        accountId: ctx.accountId,
        triggerType: 'task_completed',
        contactId: row.contact_id,
        context: {
          task_kind: row.kind,
          deal_id: row.deal_id ?? undefined,
        },
      });
    });

    return NextResponse.json({ dispatched: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
