import type { SupabaseClient } from '@supabase/supabase-js';
import { startOfLocalDay } from './date-utils';

/**
 * "Central Hoje" — what needs a person, and what the machine already did.
 *
 * The split is the product's whole thesis, so it is the split the data model
 * here follows too. Two shapes come back and they are deliberately different:
 *
 *   HumanQueue — things somebody has to decide or answer. Actionable, linked,
 *                counted. This is the only part of the app allowed to look
 *                urgent.
 *   MachineLog — what automations produced today. Informational, greyed, and
 *                never a task. If the CRM can do it, it does it; putting its
 *                output in a to-do list would be asking a person to supervise
 *                work that needed no supervision.
 *
 * Everything aggregates client-side, matching the rest of ./queries.ts — RLS
 * scopes each query to the account, and the volumes here are counts over a
 * single day.
 */

type DB = SupabaseClient;

/** A deal untouched for this long is treated as stalled. */
export const STALE_DEAL_DAYS = 7;

export interface HumanQueue {
  /** Conversations with unread inbound. */
  unread: number;
  /** In the shared queue with nobody on them. */
  unassigned: number;
  /** Open deals nobody has moved in STALE_DEAL_DAYS. */
  stalled: number;
  /** Automation runs that failed today and nobody has seen. */
  failed: number;
}

export interface MachineLogRow {
  /** Automation name, or a fallback when the automation was deleted. */
  label: string;
  count: number;
}

export async function loadHumanQueue(db: DB): Promise<HumanQueue> {
  const staleBefore = new Date(
    startOfLocalDay().getTime() - STALE_DEAL_DAYS * 86_400_000
  ).toISOString();
  const todayStart = startOfLocalDay().toISOString();

  const [unread, unassigned, stalled, failed] = await Promise.all([
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gt('unread_count', 0),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .is('assigned_agent_id', null)
      .neq('status', 'closed'),
    // `updated_at` is the only clock a deal has — there is no stage-transition
    // history (see the Reports page). It moves on any edit, so this reads as
    // "nobody has touched it", which is a weaker claim than "it has not moved
    // stage" but an honest one.
    db
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .lt('updated_at', staleBefore),
    db
      .from('automation_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', todayStart),
  ]);

  return {
    unread: unread.count ?? 0,
    unassigned: unassigned.count ?? 0,
    stalled: stalled.count ?? 0,
    failed: failed.count ?? 0,
  };
}

/**
 * What the automations produced today, grouped by automation.
 *
 * Only successful and partial runs: a failure is not something the machine
 * "did", it is something a person now has to deal with, and it is already
 * counted in the human queue above. Listing it in both places would double-
 * count the same event and blur the one line this screen exists to draw.
 */
export async function loadMachineLog(
  db: DB,
  fallbackLabel: string
): Promise<MachineLogRow[]> {
  const { data } = await db
    .from('automation_logs')
    .select('automation_id, automations(name)')
    .in('status', ['success', 'partial'])
    .gte('created_at', startOfLocalDay().toISOString())
    .limit(500);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    automation_id: string | null;
    automations?: { name?: string | null } | null;
  }>) {
    const label = row.automations?.name?.trim() || fallbackLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export interface ActionRow {
  conversationId: string;
  name: string;
  company: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
  /** Nobody owns it — the amber case. */
  unassigned: boolean;
}

/** How many rows one page of the queue holds. */
export const ACTION_QUEUE_PAGE_SIZE = 8;

export interface ActionQueuePage {
  rows: ActionRow[];
  /**
   * Everything that matches, not just this page.
   *
   * The panel used to ask for eight rows and say nothing about the ninth, so
   * an inbox with thirty things waiting and one with eight looked identical.
   * The count is what makes the pager honest — and what tells somebody
   * whether the list they are reading is the list.
   */
  total: number;
}

/**
 * The conversations a person actually has to open, most recent first.
 *
 * Two reasons a row is here and no others: nobody has read it, or nobody has
 * claimed it. Both are states, not tasks — which is the point. The system does
 * not invent a to-do ("call this lead back") for anything it could have done
 * itself; what is left over is exactly the work that needed a human, and this
 * is the whole list of it.
 *
 * Paged rather than capped. `count: 'exact'` costs a second scan on the same
 * filter, which at this scale is the price of not lying about the size of the
 * queue.
 */
export async function loadActionQueue(
  db: DB,
  page = 0,
  pageSize = ACTION_QUEUE_PAGE_SIZE
): Promise<ActionQueuePage> {
  const start = Math.max(0, page) * pageSize;

  const { data, count } = await db
    .from('conversations')
    .select(
      'id, unread_count, assigned_agent_id, last_message_text, last_message_at, contact:contacts(name, phone, company)',
      { count: 'exact' }
    )
    .neq('status', 'closed')
    .or('unread_count.gt.0,assigned_agent_id.is.null')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    // Inclusive on both ends, unlike `limit`.
    .range(start, start + pageSize - 1);

  const rows = ((data ?? []) as unknown as RawActionRow[]).map((row) => {
    const contact = one(row.contact);
    return {
      conversationId: row.id,
      name: contact?.name || contact?.phone || '',
      company: contact?.company ?? null,
      lastMessage: row.last_message_text,
      lastMessageAt: row.last_message_at,
      unread: row.unread_count ?? 0,
      unassigned: !row.assigned_agent_id,
    };
  });

  // A page past the end answers 416 with no rows and no count. Falling back
  // to what came back keeps the pager pointing at something real rather than
  // reporting a queue of zero over a list that has rows on page one.
  return { rows, total: count ?? rows.length };
}

interface RawContact {
  name: string | null;
  phone: string;
  company: string | null;
}

interface RawActionRow {
  id: string;
  unread_count: number | null;
  assigned_agent_id: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  contact: RawContact | RawContact[] | null;
}

/**
 * Unwrap a to-one embed.
 *
 * PostgREST returns an object for a to-one relationship, but supabase-js
 * cannot know the cardinality without generated database types and infers an
 * array. Rather than cast the shape away and index `[0]` — which would be
 * `undefined` against what actually arrives — accept both and normalise here.
 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
