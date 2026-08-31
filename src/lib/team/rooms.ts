import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The rooms the team talks in.
 *
 * 046 built one room per account and argued for it: every extra level of
 * structure is a decision somebody has to make before they can type. That
 * held until somebody wanted to separate two kinds of conversation, which
 * is what 052 answers — see the note at the top of that migration for
 * what it deliberately does NOT add (membership; these are folders, not
 * private channels).
 *
 * THE DEFAULT ROOM HAS NO NAME IN THE DATABASE. `name IS NULL` means "the
 * room this account started with", and the app renders
 * `Inbox.team.title` for it. Seeding a literal would have hard-coded
 * "Minha equipe" into an English or Korean install — as data, where
 * nobody could find it to fix. Everything here resolves that NULL through
 * `roomName`, so no call site has to remember.
 */

export interface TeamRoom {
  id: string;
  account_id: string;
  /** NULL for the default room. Pass through `roomName` before drawing. */
  name: string | null;
  description: string | null;
  position: number;
  is_default: boolean;
  created_at: string;
  archived_at: string | null;
}

const ROOM_SELECT =
  'id, account_id, name, description, position, is_default, created_at, archived_at';

/**
 * `team_rooms` arrives with migration 052, which is applied by hand.
 * Same pair `@/lib/team/messages` watches for: PostgREST answers
 * `PGRST205` for a relation missing from its schema cache, Postgres
 * `42P01` for one that is genuinely absent.
 */
export function isMissingRoomsTable(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return (
    /team_rooms/i.test(error.message ?? '') &&
    /(does not exist|could not find)/i.test(error.message ?? '')
  );
}

/**
 * Every room in the account, ordered the way the switcher shows them.
 *
 * `'missing-table'` and `[]` are different answers and every caller has
 * to be able to tell them apart — the first means "the feature has not
 * landed, behave like 046", the second means "somebody archived
 * everything", which cannot actually happen because the default room
 * cannot be deleted.
 */
export async function loadTeamRooms(
  db: SupabaseClient,
  accountId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<TeamRoom[] | 'missing-table'> {
  let query = db
    .from('team_rooms')
    .select(ROOM_SELECT)
    .eq('account_id', accountId);

  if (!opts.includeArchived) query = query.is('archived_at', null);

  const { data, error } = await query
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingRoomsTable(error)) return 'missing-table';
    console.error('Failed to load team rooms:', error.message);
    return [];
  }

  return (data ?? []) as TeamRoom[];
}

/**
 * What to call a room on screen.
 *
 * `fallback` is the caller's `t('title')`. Keeping the translator out of
 * this module is what lets it be imported from a server route later
 * without dragging next-intl in.
 */
export function roomName(
  room: Pick<TeamRoom, 'name' | 'is_default'> | null | undefined,
  fallback: string
): string {
  const name = room?.name?.trim();
  if (name) return name;
  return fallback;
}

/** The room the app opens when nothing else is chosen. */
export function defaultRoom(rooms: TeamRoom[]): TeamRoom | null {
  return rooms.find((r) => r.is_default) ?? rooms[0] ?? null;
}

/**
 * Resolve a room id — possibly from a URL, possibly stale — to a room
 * that exists.
 *
 * A link to a room somebody archived last week should open the default
 * room rather than an empty pane, and it should do it without saying
 * anything: the message the person wanted is gone either way, and an
 * error about a room id is not information they can use.
 */
export function resolveRoom(
  rooms: TeamRoom[],
  wanted: string | null | undefined
): TeamRoom | null {
  if (wanted) {
    const hit = rooms.find((r) => r.id === wanted);
    if (hit) return hit;
  }
  return defaultRoom(rooms);
}

export interface RoomDraft {
  name: string;
  description: string;
}

export async function createTeamRoom(
  db: SupabaseClient,
  args: { accountId: string; createdBy: string | null } & RoomDraft
): Promise<{ room: TeamRoom | null; error: string | null }> {
  const name = args.name.trim();
  if (!name) return { room: null, error: 'empty' };

  const { data, error } = await db
    .from('team_rooms')
    .insert({
      account_id: args.accountId,
      name,
      description: args.description.trim() || null,
      created_by: args.createdBy,
    })
    .select(ROOM_SELECT)
    .single();

  if (error) return { room: null, error: error.message };
  return { room: data as TeamRoom, error: null };
}

/**
 * Rename, re-describe, reorder.
 *
 * The default room can be renamed like any other — that is the whole
 * point of the request that started this ("modificar o nome e descrição
 * dessa equipe"). What it cannot be is deleted, and that is enforced by a
 * trigger rather than here.
 */
export async function updateTeamRoom(
  db: SupabaseClient,
  id: string,
  patch: Partial<Pick<TeamRoom, 'name' | 'description' | 'position'>>
): Promise<{ error: string | null }> {
  const next: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name?.trim() ?? '';
    // Clearing the name of the default room puts it back to being called
    // whatever the locale calls it, which is a real thing to want. On any
    // other room an empty name would leave it unnameable in the
    // switcher, so the caller validates before getting here.
    next.name = name || null;
  }
  if (patch.description !== undefined) {
    next.description = patch.description?.trim() || null;
  }
  if (patch.position !== undefined) next.position = patch.position;

  if (Object.keys(next).length === 0) return { error: null };

  const { error } = await db.from('team_rooms').update(next).eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Take a room out of the switcher without taking its history with it.
 *
 * ARCHIVE, NOT DELETE, and the two are genuinely different here:
 * `team_messages.room_id` cascades, so deleting a room deletes six months
 * of decisions along with it. "Apagar essa sala" nearly always means
 * "stop showing it to me".
 *
 * Deleting is still possible from the database for a room created by
 * mistake; the interface does not offer it, because the interface cannot
 * tell the two cases apart and the destructive reading is unrecoverable.
 */
export async function archiveTeamRoom(
  db: SupabaseClient,
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  const { error } = await db
    .from('team_rooms')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id);
  return { error: error?.message ?? null };
}
