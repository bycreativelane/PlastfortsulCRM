import type { SupabaseClient } from '@supabase/supabase-js';

import { addDays, fromISO, toISO } from '@/lib/calendar';

/**
 * The agenda — every dated thing the CRM knows about, on one grid.
 *
 * The dashboard already answers "what needs a person NOW" and "what did the
 * machine do TODAY". Neither answers "and what is coming": a follow-up the
 * engine will send on Thursday, an opportunity somebody promised to close on
 * the 30th, a customer who asked to be called back in September. All of that
 * existed in the database and nowhere on screen — each date visible only from
 * inside the record that carries it, which is to say, only to whoever already
 * remembered to look.
 *
 * WHAT IS IN HERE AND WHAT IS NOT. A source earns a place on this calendar by
 * being a real dated commitment that something will act on. That rules out
 * two tempting ones:
 *
 *   automation_logs — what ran, by the hundred, every day. That is a log, and
 *                     a calendar full of log lines is a log with worse
 *                     navigation. The "O CRM fez hoje" panel and the
 *                     per-automation log pages already own it.
 *   scheduled sends — `broadcasts.scheduled_at` exists in the schema and
 *                     NOTHING in the app writes it or drains it; the wizard
 *                     offers "send now" and "save draft", full stop. Drawing
 *                     a "scheduled campaign" lane that can never fill, and a
 *                     reschedule control writing a column no sender reads,
 *                     would be the calendar telling a story the product does
 *                     not perform. Campaigns appear on the day they actually
 *                     went out; if scheduling ever lands, `scheduled_at`
 *                     already takes precedence below and the lane fills
 *                     itself.
 *
 * WHAT CAN BE MOVED FROM HERE. Only the two dates a person owns: a deal's
 * expected close and a customer's next-purchase date. Everything else is the
 * machine's own queue or a fact (a birthday, an occurrence that happened),
 * and a control that pretends otherwise is worse than no control. This is the
 * same line the rest of the product draws — the machine acts, the person
 * decides — applied to a calendar.
 *
 * Aggregation is client-side, matching `./queries.ts` and `./today.ts`: RLS
 * scopes every query to the account and the window is six weeks wide.
 */

type DB = SupabaseClient;

export type AgendaKind =
  /** A step the automation engine will run: follow-up D+3, pós-venda D+10. */
  | 'automation'
  /** A campaign, on the day it went out. */
  | 'broadcast'
  /** `deals.expected_close_date`. */
  | 'deal'
  /** `contacts.next_purchase_expected_at` — "volte a falar em setembro". */
  | 'repurchase'
  /** `contacts.birthday`, recurring. */
  | 'birthday'
  /** An open occurrence, on the day the problem happened. */
  | 'occurrence';

/** Which half of the product the row belongs to. Drives its colour. */
export type AgendaTone = 'human' | 'auto' | 'danger' | 'neutral';

/** Draw order, and the order of the filter chips. Human work first. */
export const AGENDA_KINDS: readonly AgendaKind[] = [
  'deal',
  'repurchase',
  'occurrence',
  'automation',
  'broadcast',
  'birthday',
] as const;

/**
 * Amber is "a person must act"; grey is "a machine has this"; red is "it
 * broke". A birthday is neither — it is a fact about a day, so it stays
 * neutral rather than borrowing the one colour that means come here.
 */
export const AGENDA_TONE: Record<AgendaKind, AgendaTone> = {
  deal: 'human',
  repurchase: 'human',
  occurrence: 'danger',
  automation: 'auto',
  broadcast: 'auto',
  birthday: 'neutral',
};

/** The table a reschedule writes to. `null` on everything else. */
export type RescheduleTarget = 'deal' | 'repurchase';

export interface AgendaItem {
  /** Unique across sources — `${kind}:${rowId}`, plus the year for birthdays. */
  id: string;
  kind: AgendaKind;
  /** Local day key `YYYY-MM-DD`. What the grid buckets on. */
  day: string;
  /** `HH:MM` when the source carries a clock time; null for date-only rows. */
  time: string | null;
  /** The thing's own name: deal title, campaign name, automation name. */
  title: string;
  /** Who it is about, when that is not already the title. */
  contact: string | null;
  /** Deal money — the one kind that has any. */
  value: number | null;
  currency: string | null;
  /** Source status, where it changes the reading (a campaign that failed). */
  status: string | null;
  href: string | null;
  /** Null when the date is not a person's to move. See the note above. */
  reschedule: RescheduleTarget | null;
  /** Row id in its own table — what a reschedule updates. */
  rowId: string;
}

// ------------------------------------------------------------
// Loading
// ------------------------------------------------------------

/**
 * Every dated thing between `from` and `to`, inclusive.
 *
 * One source failing must not blank the panel: `042` may not be applied yet,
 * the service-role key may be absent on a self-hosted instance, a network may
 * drop. Each source is therefore resolved on its own and an unusable one
 * contributes nothing rather than throwing — the calendar shows what it can
 * see, which is the same contract every other panel on this page has.
 */
export async function loadAgenda(
  db: DB,
  from: Date,
  to: Date
): Promise<AgendaItem[]> {
  const groups = await Promise.all([
    safe(() => loadDeals(db, from, to)),
    safe(() => loadRepurchases(db, from, to)),
    safe(() => loadBirthdays(db, from, to)),
    safe(() => loadBroadcasts(db, from, to)),
    safe(() => loadOccurrences(db, from, to)),
    safe(() => loadScheduledAutomations(from, to)),
  ]);

  return groups.flat().sort(compareItems);
}

async function safe(load: () => Promise<AgendaItem[]>): Promise<AgendaItem[]> {
  try {
    return await load();
  } catch {
    return [];
  }
}

/** Chronological, and within a day the timed rows before the date-only ones. */
function compareItems(a: AgendaItem, b: AgendaItem): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.time !== b.time) {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return AGENDA_KINDS.indexOf(a.kind) - AGENDA_KINDS.indexOf(b.kind);
}

async function loadDeals(db: DB, from: Date, to: Date): Promise<AgendaItem[]> {
  const { data } = await db
    .from('deals')
    .select(
      'id, title, value, currency, expected_close_date, pipeline_id, contact:contacts(name, phone)'
    )
    .eq('status', 'open')
    .gte('expected_close_date', toISO(from))
    .lte('expected_close_date', toISO(to))
    .limit(200);

  return ((data ?? []) as unknown as RawDeal[]).flatMap((row) => {
    const day = dayOf(row.expected_close_date);
    if (!day) return [];
    return [
      {
        id: `deal:${row.id}`,
        kind: 'deal' as const,
        day,
        time: null,
        title: row.title,
        contact: contactName(row.contact),
        value: row.value ?? null,
        currency: row.currency ?? null,
        status: null,
        href: row.pipeline_id
          ? `/pipelines?p=${row.pipeline_id}`
          : '/pipelines',
        reschedule: 'deal' as const,
        rowId: row.id,
      },
    ];
  });
}

async function loadRepurchases(
  db: DB,
  from: Date,
  to: Date
): Promise<AgendaItem[]> {
  const { data } = await db
    .from('contacts')
    .select('id, name, phone, next_purchase_expected_at')
    .not('next_purchase_expected_at', 'is', null)
    .gte('next_purchase_expected_at', toISO(from))
    .lte('next_purchase_expected_at', toISO(to))
    .limit(200);

  return ((data ?? []) as RawContact[]).flatMap((row) => {
    const day = dayOf(row.next_purchase_expected_at);
    if (!day) return [];
    return [
      {
        id: `repurchase:${row.id}`,
        kind: 'repurchase' as const,
        day,
        time: null,
        title: row.name || row.phone,
        contact: null,
        value: null,
        currency: null,
        status: null,
        href: `/contacts?id=${row.id}`,
        reschedule: 'repurchase' as const,
        rowId: row.id,
      },
    ];
  });
}

/**
 * Birthdays, which are the only recurring row here.
 *
 * `contacts.birthday` is a DATE with a year nobody entered on purpose — the
 * column comment says as much ("day and month are what matter"). So the year
 * is thrown away and the day and month are re-hung on whichever year the
 * window is looking at, which is also why this cannot be a range filter in
 * SQL: no index can answer "the 3rd of any September". The whole list comes
 * back and is matched here, capped, like every other client-side aggregate on
 * this page.
 */
async function loadBirthdays(
  db: DB,
  from: Date,
  to: Date
): Promise<AgendaItem[]> {
  const { data } = await db
    .from('contacts')
    .select('id, name, phone, birthday')
    .not('birthday', 'is', null)
    .limit(500);

  return birthdaysInRange((data ?? []) as RawContact[], from, to);
}

/** The pure half of `loadBirthdays`, so the recurrence is testable. */
export function birthdaysInRange(
  rows: RawContact[],
  from: Date,
  to: Date
): AgendaItem[] {
  const items: AgendaItem[] = [];
  const first = startOfDay(from);
  const last = startOfDay(to);

  for (const row of rows) {
    const born = row.birthday ? fromISO(row.birthday) : null;
    if (!born) continue;

    // A six-week window crosses at most one new year, but the loop is written
    // for any range rather than assuming that.
    for (let year = from.getFullYear(); year <= to.getFullYear(); year++) {
      const date = anniversary(born, year);
      if (date < first || date > last) continue;
      items.push({
        id: `birthday:${row.id}:${year}`,
        kind: 'birthday',
        day: toISO(date),
        time: null,
        title: row.name || row.phone,
        contact: null,
        value: null,
        currency: null,
        status: null,
        href: `/contacts?id=${row.id}`,
        reschedule: null,
        rowId: row.id,
      });
    }
  }

  return items;
}

/**
 * The 29th of February in a year that has no 29th of February.
 *
 * `new Date(2027, 1, 29)` is the 1st of March, so a leap-day customer would
 * be congratulated a day late in three years out of four. The 28th is the
 * convention here, and the one that keeps the greeting inside the right
 * month.
 */
function anniversary(born: Date, year: number): Date {
  const month = born.getMonth();
  const date = new Date(year, month, born.getDate());
  // Rolled into the next month — take the last day of the intended one.
  if (date.getMonth() !== month) return new Date(year, month + 1, 0);
  return date;
}

async function loadBroadcasts(
  db: DB,
  from: Date,
  to: Date
): Promise<AgendaItem[]> {
  const start = startOfDay(from).toISOString();
  const end = endOfDay(to).toISOString();

  const { data } = await db
    .from('broadcasts')
    .select('id, name, status, scheduled_at, created_at, total_recipients')
    // Either clock: a campaign that was scheduled is dated by the schedule, a
    // campaign that went out immediately by when it was created. PostgREST
    // cannot filter on a COALESCE, so both are asked for and the row is dated
    // below by whichever it actually has.
    .or(
      [
        `and(scheduled_at.gte.${start},scheduled_at.lte.${end})`,
        `and(scheduled_at.is.null,created_at.gte.${start},created_at.lte.${end})`,
      ].join(',')
    )
    .limit(100);

  return ((data ?? []) as RawBroadcast[]).flatMap((row) => {
    const at = row.scheduled_at ?? row.created_at;
    const day = dayOf(at);
    if (!day) return [];
    return [
      {
        id: `broadcast:${row.id}`,
        kind: 'broadcast' as const,
        day,
        time: timeOf(at),
        title: row.name,
        contact: null,
        value: null,
        currency: null,
        status: row.status ?? null,
        href: `/broadcasts/${row.id}`,
        reschedule: null,
        rowId: row.id,
      },
    ];
  });
}

/**
 * Open occurrences, on the day the problem happened.
 *
 * Backwards-looking and still the calendar's business: an unresolved
 * complaint from the 12th is a thing somebody owes an answer on, and the day
 * it landed is how anyone remembers it. Resolved ones are history and stay in
 * the contact's file.
 *
 * `042` is not applied on every instance yet, so a missing table has to be
 * ordinary rather than fatal — an error here contributes no rows, and the
 * lane is simply absent until the migration runs.
 */
async function loadOccurrences(
  db: DB,
  from: Date,
  to: Date
): Promise<AgendaItem[]> {
  const { data, error } = await db
    .from('contact_occurrences')
    .select('id, kind, occurred_on, contact_id, contact:contacts(name, phone)')
    .eq('status', 'open')
    .gte('occurred_on', toISO(from))
    .lte('occurred_on', toISO(to))
    .limit(200);

  if (error) return [];

  return ((data ?? []) as unknown as RawOccurrence[]).flatMap((row) => {
    const day = dayOf(row.occurred_on);
    if (!day) return [];
    return [
      {
        id: `occurrence:${row.id}`,
        kind: 'occurrence' as const,
        day,
        time: null,
        title: row.kind,
        contact: contactName(row.contact),
        value: null,
        currency: null,
        status: 'open',
        href: row.contact_id ? `/contacts?id=${row.contact_id}` : '/contacts',
        reschedule: null,
        rowId: row.id,
      },
    ];
  });
}

/**
 * The engine's own queue, through a route rather than a query.
 *
 * `automation_pending_executions` has RLS on and NO policy for authenticated
 * users — deliberately, per `006`: the engine writes it with the service-role
 * key and the browser has never had a reason to see it. A calendar of
 * scheduled actions is that reason, so the route reads it server-side, scoped
 * to the caller's account, and returns only the four fields drawn here. The
 * `context` jsonb — which holds the message bodies the step is going to send
 * — never crosses.
 */
async function loadScheduledAutomations(
  from: Date,
  to: Date
): Promise<AgendaItem[]> {
  const params = new URLSearchParams({
    from: startOfDay(from).toISOString(),
    to: endOfDay(to).toISOString(),
  });
  const response = await fetch(`/api/agenda/scheduled?${params}`);
  if (!response.ok) return [];

  const body = (await response.json()) as { items?: RawPending[] };

  return (body.items ?? []).flatMap((row) => {
    const day = dayOf(row.run_at);
    if (!day) return [];
    return [
      {
        id: `automation:${row.id}`,
        kind: 'automation' as const,
        day,
        time: timeOf(row.run_at),
        title: row.automation_name ?? '',
        contact: row.contact_name ?? null,
        value: null,
        currency: null,
        status: 'pending',
        href: row.automation_id ? `/automations/${row.automation_id}` : null,
        reschedule: null,
        rowId: row.id,
      },
    ];
  });
}

// ------------------------------------------------------------
// Writing
// ------------------------------------------------------------

/**
 * Move one item to another day, or (with `null`) take the date off it.
 *
 * Both writes already exist elsewhere in the app — the deal form owns the
 * close date, the Compra futura dialog owns the next-purchase date — so this
 * is the same update from a second surface, not a new capability. Clearing is
 * offered because "actually, no date" has to be expressible; the only way to
 * undo a wrong date otherwise is to invent another one.
 */
export async function rescheduleItem(
  db: DB,
  item: AgendaItem,
  iso: string | null
): Promise<boolean> {
  const now = new Date().toISOString();

  if (item.reschedule === 'deal') {
    const { error } = await db
      .from('deals')
      .update({ expected_close_date: iso, updated_at: now })
      .eq('id', item.rowId);
    return !error;
  }

  if (item.reschedule === 'repurchase') {
    const { error } = await db
      .from('contacts')
      .update({ next_purchase_expected_at: iso, updated_at: now })
      .eq('id', item.rowId);
    return !error;
  }

  return false;
}

// ------------------------------------------------------------
// Shaping
// ------------------------------------------------------------

/** Items by local day key, each day's list already in order. */
export function groupByDay(items: AgendaItem[]): Map<string, AgendaItem[]> {
  const days = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const list = days.get(item.day);
    if (list) list.push(item);
    else days.set(item.day, [item]);
  }
  return days;
}

/** How many of each kind are in the window — the count on a filter chip. */
export function countByKind(items: AgendaItem[]): Record<AgendaKind, number> {
  const counts: Record<AgendaKind, number> = {
    deal: 0,
    repurchase: 0,
    occurrence: 0,
    automation: 0,
    broadcast: 0,
    birthday: 0,
  };
  for (const item of items) counts[item.kind]++;
  return counts;
}

/** The distinct tones on a day, in draw order. What the cell dots show. */
export function tonesOf(items: AgendaItem[]): AgendaTone[] {
  const seen = new Set<AgendaTone>();
  for (const kind of AGENDA_KINDS) {
    if (items.some((item) => item.kind === kind)) seen.add(AGENDA_TONE[kind]);
  }
  return Array.from(seen);
}

// ------------------------------------------------------------
// Dates and rows
// ------------------------------------------------------------

function startOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(23, 59, 59, 999);
  return out;
}

/** Local day key for either a `date` column or a timestamp. */
function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  // A bare `YYYY-MM-DD` is already the answer, and must NOT go through `new
  // Date()` — that parses it as UTC midnight and hands back the previous day
  // west of Greenwich.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : toISO(date);
}

/** `HH:MM` in the reader's own timezone, for rows that carry a clock. */
function timeOf(value: string | null | undefined): string | null {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** The day `n` days from today, as an ISO key — the reschedule presets. */
export function isoInDays(days: number): string {
  return toISO(addDays(new Date(), days));
}

function contactName(
  contact: RawContactRef | RawContactRef[] | null | undefined
): string | null {
  const one = Array.isArray(contact) ? (contact[0] ?? null) : (contact ?? null);
  if (!one) return null;
  return one.name || one.phone || null;
}

export interface RawContact {
  id: string;
  name: string | null;
  phone: string;
  birthday?: string | null;
  next_purchase_expected_at?: string | null;
}

interface RawContactRef {
  name: string | null;
  phone: string;
}

interface RawDeal {
  id: string;
  title: string;
  value: number | null;
  currency: string | null;
  expected_close_date: string | null;
  pipeline_id: string | null;
  contact: RawContactRef | RawContactRef[] | null;
}

interface RawBroadcast {
  id: string;
  name: string;
  status: string | null;
  scheduled_at: string | null;
  created_at: string | null;
  total_recipients: number | null;
}

interface RawOccurrence {
  id: string;
  kind: string;
  occurred_on: string | null;
  contact_id: string | null;
  contact: RawContactRef | RawContactRef[] | null;
}

interface RawPending {
  id: string;
  run_at: string;
  automation_id: string | null;
  automation_name: string | null;
  contact_name: string | null;
}
