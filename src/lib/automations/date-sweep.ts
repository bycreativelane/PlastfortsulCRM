import type { SupabaseClient } from '@supabase/supabase-js';

import type { Automation, DateFieldReachedTriggerConfig } from '@/types';
import { supabaseAdmin } from './admin-client';
import { runAutomationsForTrigger } from './engine';
import {
  DEFAULT_TIMEZONE,
  localParts,
  parseHHmm,
  safeTimeZone,
} from './local-time';

/**
 * The one sweep the official flow actually needs: "whose date is today".
 *
 * Everything that is "D+N after entering a stage" is a stage trigger plus a
 * wait, and Compra Futura is a wait-until-date — none of those scan. What
 * is left is the birthday, which recurs and has no entry event, and the
 * two other contact dates for whoever wants an automation on them.
 *
 * Runs on every cron tick. It is cheap to run often because it is
 * idempotent: each dispatch carries `trigger_key = contact:<id>:<date>`,
 * and migration 065's unique index on (automation_id, trigger_key) makes
 * the second insert of the day fail before a single step runs. Two ticks,
 * one message.
 *
 * "Today" is read in the automation's zone, never the host's — see
 * ./local-time.ts.
 */
export interface SweepResult {
  automations: number;
  dispatched: number;
}

interface Group {
  accountId: string;
  field: DateFieldReachedTriggerConfig['field'];
  timeZone: string;
  atMinutes: number;
}

export async function runDateFieldSweeps(
  now: Date = new Date(),
  db: SupabaseClient = supabaseAdmin()
): Promise<SweepResult> {
  const result: SweepResult = { automations: 0, dispatched: 0 };

  const { data, error } = await db
    .from('automations')
    .select('*')
    .eq('trigger_type', 'date_field_reached')
    .eq('is_active', true);
  if (error) {
    console.error('[date-sweep] fetch automations failed:', error.message);
    return result;
  }
  const automations = (data ?? []) as Automation[];
  if (automations.length === 0) return result;
  result.automations = automations.length;

  // One query per (account, field, zone, time) rather than per automation:
  // two birthday automations on one account read the contacts once, and
  // the engine matches each of them by field on dispatch.
  const groups = new Map<string, Group>();
  for (const a of automations) {
    const cfg = (a.trigger_config ??
      {}) as Partial<DateFieldReachedTriggerConfig>;
    if (!cfg.field) continue;
    const timeZone = safeTimeZone(cfg.timezone ?? DEFAULT_TIMEZONE);
    const atMinutes = parseHHmm(cfg.at) ?? 9 * 60;
    const key = `${a.account_id}|${cfg.field}|${timeZone}|${atMinutes}`;
    if (!groups.has(key)) {
      groups.set(key, {
        accountId: a.account_id,
        field: cfg.field,
        timeZone,
        atMinutes,
      });
    }
  }

  for (const group of groups.values()) {
    const local = localParts(now, group.timeZone);
    // Not before the configured hour. The next tick after it fires; the
    // key keeps every later tick of the day quiet.
    if (local.hour * 60 + local.minute < group.atMinutes) continue;

    let contactIds: string[] = [];
    try {
      contactIds = await findContactsForDate(db, group, local);
    } catch (err) {
      console.error('[date-sweep] contact lookup failed:', err);
      continue;
    }

    for (const contactId of contactIds) {
      await runAutomationsForTrigger({
        accountId: group.accountId,
        triggerType: 'date_field_reached',
        contactId,
        context: {
          date_field: group.field,
          trigger_key: `contact:${contactId}:${local.dateKey}`,
        },
      });
      result.dispatched++;
    }
  }

  return result;
}

async function findContactsForDate(
  db: SupabaseClient,
  group: Group,
  local: { month: number; day: number; dateKey: string }
): Promise<string[]> {
  if (group.field === 'birthday') {
    // Month and day only — the year is usually unknown (040). PostgREST
    // cannot filter on EXTRACT, so the migration ships a function for it.
    const { data, error } = await db.rpc('contacts_with_birthday_on', {
      p_account_id: group.accountId,
      p_month: local.month,
      p_day: local.day,
    });
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  }

  const { data, error } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', group.accountId)
    .eq(group.field, local.dateKey)
    .eq('opted_out', false)
    .limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}
