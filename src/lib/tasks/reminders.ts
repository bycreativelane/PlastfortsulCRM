import type { SupabaseClient } from '@supabase/supabase-js';

import type { Task } from '@/types';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  localParts,
  parseHHmm,
  zonedTimeToUtc,
} from '@/lib/automations/local-time';
import { firstOpenTime, type BusinessHours } from '@/lib/hours';
import { loadBusinessHours } from '@/lib/hours-db';

/**
 * Lembrar alguém de uma tarefa.
 *
 * Roda no tique do cron, junto das varreduras de automação, e escreve em
 * `notifications` — a tabela que já existe (027), já é entregue ao vivo
 * (046) e já tem sino. Um segundo canal para lembrete de tarefa seria um
 * alerta diferente para o mesmo tipo de interrupção.
 *
 * ------------------------------------------------------------
 * POR QUE SERVICE ROLE
 * ------------------------------------------------------------
 *
 * `notifications` não tem política de INSERT para `authenticated`, de
 * propósito desde a 027: quem escreve é o gatilho SECURITY DEFINER ou o
 * service role. Uma varredura que roda sem ninguém logado é o segundo caso.
 *
 * ------------------------------------------------------------
 * O CARIMBO É O QUE IMPEDE O ENVIO DUPLO
 * ------------------------------------------------------------
 *
 * `reminded_at` é gravado junto com a notificação, e a seleção exige que
 * ele seja NULL. Dois tiques concorrentes — ou um cron que ficou parado uma
 * hora e voltou — produzem um lembrete, não dois. É o mesmo raciocínio do
 * claim em `automation_pending_executions` e em `deal_stage_events`.
 *
 * Remarcar a tarefa limpa o carimbo (`rescheduleTask`), porque aí é outro
 * prazo e merece outro lembrete.
 */

export interface ReminderSweepResult {
  /** Tarefas cujo lembrete venceu neste tique. */
  due: number;
  /** Quantas viraram notificação. Menor que `due` quando não há a quem. */
  notified: number;
}

/**
 * Quantos dias para trás a varredura olha.
 *
 * Um cron parado por um fim de semana volta e ainda avisa da tarefa de
 * sexta, que é o comportamento útil. Mais que isso vira arqueologia: ser
 * lembrado, na terça, de uma tarefa cujo prazo era há três semanas não
 * ajuda ninguém e enche o sino.
 */
const LOOKBACK_DAYS = 3;

/** Quando a tarefa não tem hora, é a primeira do expediente. */
const FALLBACK_TIME = '09:00';

export async function runTaskReminderSweep(
  now: Date = new Date(),
  db: SupabaseClient = supabaseAdmin()
): Promise<ReminderSweepResult> {
  const result: ReminderSweepResult = { due: 0, notified: 0 };

  // A janela é em dias corridos e generosa nos dois lados: o corte fino é
  // feito abaixo, no fuso de cada conta, porque só ali se sabe que instante
  // é "14:00 menos 30 minutos". Um dia de folga à frente cobre a conta que
  // está num fuso adiantado em relação ao host.
  const from = toDayKey(now, -LOOKBACK_DAYS);
  const to = toDayKey(now, 1);

  const { data, error } = await db
    .from('tasks')
    .select(
      'id, account_id, title, due_on, due_time, remind_minutes_before, ' +
        'assigned_to, created_by, contact_id'
    )
    .eq('status', 'open')
    .not('remind_minutes_before', 'is', null)
    .is('reminded_at', null)
    .gte('due_on', from)
    .lte('due_on', to)
    .limit(200);

  if (error) {
    // A 068 pode não ter rodado. Nesse caso não há tarefa para lembrar, e
    // derrubar o tique inteiro levaria junto as varreduras de automação.
    console.error('[task-reminders] fetch failed:', error.message);
    return result;
  }

  const tasks = (data ?? []) as unknown as Task[];
  if (tasks.length === 0) return result;

  // O expediente uma vez por conta, não uma por tarefa: dez tarefas da
  // mesma conta são três consultas, não trinta.
  const hoursByAccount = new Map<string, BusinessHours>();
  for (const accountId of new Set(tasks.map((t) => t.account_id))) {
    const loaded = await loadBusinessHours(db, accountId);
    hoursByAccount.set(accountId, loaded.hours);
  }

  for (const task of tasks) {
    const hours = hoursByAccount.get(task.account_id);
    if (!hours) continue;

    const at = reminderInstant(task, hours);
    if (!at || at.getTime() > now.getTime()) continue;
    result.due++;

    // A quem: o responsável, ou quem criou.
    //
    // O segundo não é consolo — quem marcou "lembrar 30 min antes" numa
    // tarefa sem responsável estava pedindo o lembrete para si. Sem nenhum
    // dos dois (uma tarefa criada pelo motor, um dia) não há destinatário,
    // e o carimbo desce assim mesmo: guardar um lembrete de um prazo que já
    // passou, para disparar no dia em que alguém for atribuído, é pior que
    // não lembrar.
    const recipient = task.assigned_to ?? task.created_by ?? null;

    if (recipient) {
      const { error: insertError } = await db.from('notifications').insert({
        account_id: task.account_id,
        user_id: recipient,
        type: 'task_due',
        task_id: task.id,
        contact_id: task.contact_id ?? null,
        // O texto é composto na interface (`lib/notifications/text.ts`);
        // aqui vai só o título da tarefa, que é dado e não idioma.
        title: task.title,
        body: null,
      });
      if (insertError) {
        console.error('[task-reminders] notify failed:', insertError.message);
        // Sem carimbo: o próximo tique tenta de novo. Uma falha de escrita
        // não pode consumir o lembrete.
        continue;
      }
      result.notified++;
    }

    const { error: stampError } = await db
      .from('tasks')
      .update({ reminded_at: new Date().toISOString() })
      .eq('id', task.id)
      .is('reminded_at', null);

    if (stampError) {
      console.error('[task-reminders] stamp failed:', stampError.message);
    }
  }

  return result;
}

/**
 * O instante em que o lembrete desta tarefa vence.
 *
 * `due_on` + `due_time` são hora de parede no fuso da CONTA (066), então a
 * conversão passa por `zonedTimeToUtc`, que já trata a virada do horário de
 * verão — o mesmo caminho que o passo "esperar até a data do campo" usa.
 *
 * Sem hora marcada, a base é a primeira hora do expediente daquele dia. Uma
 * tarefa "para quinta", com lembrete de 30 minutos, tem de avisar às 07:30
 * de quinta e não às 23:30 de quarta.
 */
export function reminderInstant(
  task: Pick<Task, 'due_on' | 'due_time' | 'remind_minutes_before'>,
  hours: BusinessHours
): Date | null {
  if (!task.due_on || task.remind_minutes_before == null) return null;

  const base =
    parseHHmm(task.due_time ?? '') ??
    parseHHmm(firstOpenTime(hours, task.due_on) ?? FALLBACK_TIME) ??
    9 * 60;

  // Um lembrete que cairia no dia anterior é permitido de propósito: "24 h
  // antes" é um pedido legítimo, e `zonedTimeToUtc` aceita minutos
  // negativos recuando o instante, não a data de referência.
  return zonedTimeToUtc(
    task.due_on,
    base - task.remind_minutes_before,
    hours.timezone
  );
}

/** `YYYY-MM-DD`, `n` dias a partir de `now`, em UTC — só para a janela. */
function toDayKey(now: Date, n: number): string {
  const shifted = new Date(now.getTime() + n * 86_400_000);
  return localParts(shifted, 'UTC').dateKey;
}
