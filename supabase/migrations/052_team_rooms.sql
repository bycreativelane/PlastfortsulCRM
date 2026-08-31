-- ============================================================
-- 052_team_rooms.sql — the second room
--
-- 046 created the team channel as ONE ROOM PER ACCOUNT and said why, at
-- length: "there is no `channel_id` and no membership table, because the
-- request was for one room and every extra level of structure here is a
-- decision somebody has to make before they can type." It also said what
-- would happen if that turned out to be wrong: "A second room, if it is
-- ever wanted, is a column with a default — adding one later is cheap,
-- and guessing at it now is not."
--
-- It is wanted. This is that column, and the cheapness holds: every
-- existing message keeps working, the default room needs no naming, and
-- an account that never opens the new screen has exactly the product it
-- had yesterday.
--
-- WHAT IS STILL NOT HERE, and for the same reason as in 046: membership.
-- A room belongs to the account and every member of the account can read
-- and write it. Per-room membership is a permission system, it would
-- need its own table, its own RLS, its own screen, and its own answer to
-- "what happens to the messages when somebody is removed" — and none of
-- that was asked for. Rooms here are folders for conversations, not
-- private channels, and the interface should never suggest otherwise.
--
-- Idempotent. Depends on 046 (`team_messages`) and 048 (its policies).
-- ============================================================


-- ============================================================
-- 1. `team_rooms`
--
-- `name` IS NULLABLE, and that is the trick that keeps this migration
-- from having an opinion about language.
--
-- Every account gets a default room in the backfill below, and that room
-- has to be called something. SQL has no access to the locale
-- catalogues, so seeding a literal would hard-code "Minha equipe" into
-- the database of an account running the product in English or Korean —
-- a string nobody could find to fix, because it is data rather than
-- copy. A NULL name means "the room this account started with", and the
-- app renders `Inbox.team.title` for it, in whatever language it is set
-- to. The moment somebody renames it, the name is theirs.
-- ============================================================
CREATE TABLE IF NOT EXISTS team_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- NULL only for the default room. See above.
  name TEXT CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 60),

  -- What the room is FOR. The whole reason a second room exists is that
  -- somebody wanted to separate two kinds of conversation, and a room
  -- called "Operação" with no description is a room three people will
  -- each use for something different.
  description TEXT CHECK (description IS NULL OR length(description) <= 280),

  -- Display order in the switcher. Not `created_at`: the room you use
  -- most is rarely the one you made first.
  position INTEGER NOT NULL DEFAULT 0,

  -- The room 046 effectively created. Cannot be deleted — see the
  -- trigger below.
  is_default BOOLEAN NOT NULL DEFAULT FALSE,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Archived rather than deleted is the ONLY way a room with history
  -- goes away, because deleting it deletes the messages (see the FK
  -- below) and "arquivar" is what people mean when they say "apagar essa
  -- sala" about a room with six months of decisions in it.
  archived_at TIMESTAMPTZ
);

COMMENT ON TABLE team_rooms IS
  'Internal rooms, one account per row set. Every account member reads '
  'and writes every room — these are folders, not private channels. See '
  'the note in 052 for why there is no membership table.';

CREATE INDEX IF NOT EXISTS idx_team_rooms_account
  ON team_rooms(account_id, position, created_at);

-- Exactly one default per account, enforced rather than assumed: the
-- backfill, the app's "which room do I open" and the delete guard all
-- read it as a singleton.
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_rooms_one_default
  ON team_rooms(account_id) WHERE is_default;

ALTER TABLE team_rooms ENABLE ROW LEVEL SECURITY;

-- Everybody reads. Only admins reshape.
--
-- Creating and naming rooms is org design, not day-to-day work: it is
-- the same class of act as adding a pipeline stage, and the same bar
-- applies. Writing IN a room stays open to every agent — see
-- `team_messages` policies from 046.
DROP POLICY IF EXISTS team_rooms_select ON team_rooms;
CREATE POLICY team_rooms_select ON team_rooms FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS team_rooms_insert ON team_rooms;
CREATE POLICY team_rooms_insert ON team_rooms FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS team_rooms_update ON team_rooms;
CREATE POLICY team_rooms_update ON team_rooms FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS team_rooms_delete ON team_rooms;
CREATE POLICY team_rooms_delete ON team_rooms FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- ============================================================
-- 2. The default room cannot be deleted.
--
-- RLS decides WHO, not WHICH — there is no way to write "an admin may
-- delete any room except this one" as a policy without also blocking the
-- cascade from `accounts`. A trigger can tell the two apart: a direct
-- DELETE has a live account row behind it, and a cascade does not.
--
-- Why it matters: the default room is where `room_id IS NULL` history
-- landed, it is what the rail card and the inbox open when nothing else
-- is chosen, and deleting it would take every message in it with them.
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_default_team_room()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT OLD.is_default THEN
    RETURN OLD;
  END IF;

  -- The account is going away and taking its rooms with it. Nothing to
  -- protect; the alternative is a trigger that makes accounts
  -- undeletable.
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = OLD.account_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'The default room cannot be deleted — archive it instead'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS team_rooms_guard_default ON team_rooms;
CREATE TRIGGER team_rooms_guard_default
  BEFORE DELETE ON team_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_default_team_room();


-- ============================================================
-- 3. `team_messages.room_id`
--
-- NULLABLE, and it stays nullable after the backfill. A NOT NULL here
-- would mean this migration has to succeed completely or the table
-- becomes unwritable, and it would mean any future account bootstrapped
-- without a room cannot receive a message at all. The app reads NULL as
-- "the default room", which is exactly what those rows are.
--
-- CASCADE, not SET NULL: deleting a room deletes what was said in it.
-- SET NULL would quietly move a deleted room's history into the default
-- room, where it would read as things people said in a conversation they
-- were not having.
-- ============================================================
ALTER TABLE team_messages
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES team_rooms(id) ON DELETE CASCADE;

COMMENT ON COLUMN team_messages.room_id IS
  'Which room this was said in. NULL means the account default room — '
  'every row written before 052 is one of those, and the app resolves it '
  'the same way.';

CREATE INDEX IF NOT EXISTS idx_team_messages_room_created
  ON team_messages(room_id, created_at DESC);


-- ============================================================
-- 4. A message cannot be filed in another account's room.
--
-- The account guard from 048 checks `account_id`, and `room_id` is a
-- second way to say where a message lives. Without this, an author could
-- point their own message at a room id belonging to somebody else — RLS
-- on `team_messages` would still hide it from that account, so the
-- damage is a message misfiled in its OWN room list rather than a leak.
-- Still wrong, and one `EXISTS` to close.
--
-- The subquery is itself under `team_rooms` RLS, which is what makes it
-- work: a room in another account is not visible to this caller, so the
-- EXISTS finds nothing and the check fails.
-- ============================================================
DROP POLICY IF EXISTS team_messages_insert ON team_messages;
CREATE POLICY team_messages_insert ON team_messages FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND auth.uid() = author_id
    AND (
      room_id IS NULL
      OR EXISTS (
        SELECT 1 FROM team_rooms r
         WHERE r.id = room_id AND r.account_id = team_messages.account_id
      )
    )
  );

DROP POLICY IF EXISTS team_messages_update ON team_messages;
CREATE POLICY team_messages_update ON team_messages FOR UPDATE
  USING (auth.uid() = author_id AND is_account_member(account_id))
  WITH CHECK (
    auth.uid() = author_id
    AND is_account_member(account_id)
    AND (
      room_id IS NULL
      OR EXISTS (
        SELECT 1 FROM team_rooms r
         WHERE r.id = room_id AND r.account_id = team_messages.account_id
      )
    )
  );


-- ============================================================
-- 5. Backfill — one default room per account that has members.
--
-- `ON CONFLICT DO NOTHING` against the partial unique index above, so a
-- re-run adds nothing. Existing messages are left with `room_id IS NULL`
-- rather than pointed at the new row: NULL already means "the default
-- room" everywhere that reads it, and an UPDATE across every team
-- message in every account buys nothing for it.
-- ============================================================
INSERT INTO team_rooms (account_id, name, description, is_default, position)
SELECT a.id, NULL, NULL, TRUE, 0
FROM accounts a
ON CONFLICT DO NOTHING;


-- ============================================================
-- 6. Realtime.
--
-- The rooms themselves are not published. They change when somebody
-- opens Settings and types a name — a page reload away — and publishing
-- them would put a websocket message on every member's browser for it.
-- `team_messages` is already published (046) and that is the stream that
-- has to be live.
-- ============================================================
