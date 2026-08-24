-- ============================================================
-- 045_inbox_state_and_contact_identity
--
-- Four small columns and one tightened policy, all from the same review.
-- Grouped into one file because they ship together, not because they are
-- one idea.
--
-- Idempotent — safe to re-run.
-- ============================================================


-- ============================================================
-- 1. `contacts.name_source` — who last named this contact.
--
-- THE BUG THIS FIXES. An agent renames "Contato 385" to "Cleiton — Silagem",
-- saves, sees the toast, and some minutes later the old name is back. The
-- minutes are however long it takes the customer to write again: every
-- inbound message compares WhatsApp's profile name against the stored one
-- and overwrites on any difference (webhook route.ts, findOrCreateContact).
--
-- The overwrite is not wrong in itself — it is what turns a bare phone
-- number into a name, and what keeps a name current for the contacts nobody
-- has ever edited. What is wrong is that it cannot tell the difference
-- between a name it wrote itself and a name a person typed.
--
-- So the column records provenance, and the webhook only writes over its
-- own work. Two values, and deliberately not a boolean: `name_locked` would
-- say WHAT to do without saying why, and the first person to read it in six
-- months would have to find this file to learn that "locked" means "a human
-- typed it".
--
-- Everyone starts at 'whatsapp', including rows that already carry an edited
-- name. Backfilling 'manual' for every contact whose name differs from its
-- phone was the obvious move and is wrong: it would also freeze every name
-- that came from WhatsApp itself, which is most of them, and freezing is the
-- behaviour we are trying NOT to make the default. A contact becomes
-- 'manual' the first time somebody edits it — one message from being right,
-- instead of permanently half-wrong.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS name_source TEXT NOT NULL DEFAULT 'whatsapp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_name_source_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_name_source_check
      CHECK (name_source IN ('whatsapp', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN contacts.name_source IS
  'Who last set contacts.name. ''whatsapp'' = the inbound webhook, which may '
  'keep overwriting it. ''manual'' = a person typed it in the app, CSV import '
  'included, and the webhook must never touch it again.';


-- ============================================================
-- 2. `conversations.waiting_since` — when it was parked.
--
-- The status column already has 'pending', and the thread header already
-- offers it. What it cannot answer is "for how long" — and a queue of
-- things marked Esperando is only useful if the oldest one surfaces.
--
-- Set when a conversation enters 'pending', cleared when it leaves. The app
-- owns both edges rather than a trigger: the inbound path already writes
-- status in one guarded UPDATE (see lib/conversations/reopen.ts, which
-- re-checks the status in SQL so two concurrent deliveries cannot fight),
-- and splitting that decision across a trigger would put half the rule
-- somewhere nobody reading the other half would look.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ;

COMMENT ON COLUMN conversations.waiting_since IS
  'When this conversation entered status=''pending''. Null in every other '
  'status. Sorts the Esperando tab oldest-first so a parked thread cannot be '
  'quietly forgotten.';


-- ============================================================
-- 3. `conversations.hidden_at` / `hidden_by` — out of the way, not gone.
--
-- "Excluir chat" was the request; hiding is the other half of the answer,
-- and it is the half that gets used daily. Most of the time the operator
-- does not want the history destroyed — they want the row out of a list of
-- ten, today. Deleting for that is a permanent answer to a temporary
-- question, and `messages` is ON DELETE CASCADE, so the answer takes the
-- conversation with it.
--
-- A hidden conversation is invisible in all three tabs and comes back on its
-- own when the customer writes again — the same inbound path that reopens a
-- closed thread clears this. That is the property that makes hiding safe to
-- reach for: nothing is lost, and nobody has to remember to look.
--
-- `hidden_by` is not an audit trail, it is a courtesy: in a shared mailbox,
-- a row that vanished is a question ("who hid this?"), and the answer should
-- not require a database.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN conversations.hidden_at IS
  'When somebody hid this conversation from the inbox lists. Cleared '
  'automatically when the customer writes again. Not a delete: no row and no '
  'message is removed.';

COMMENT ON COLUMN conversations.hidden_by IS
  'Who hid it. Null once un-hidden. SET NULL on user delete — losing the '
  'name must not un-hide the conversation.';

-- The list's own query, which is now "everything not hidden, newest first".
-- Partial so it indexes the rows the inbox actually reads rather than the
-- handful that are hidden.
CREATE INDEX IF NOT EXISTS idx_conversations_visible
  ON conversations(account_id, last_message_at DESC)
  WHERE hidden_at IS NULL;


-- ============================================================
-- 4. Automatic assignment, on the account.
--
-- `assign_conversation` already exists as an automation step and already
-- offers a `round_robin` mode. The mode is a lie: it reads
-- `profiles ... limit(1)` and hands every conversation to whoever comes back
-- first, forever. The comment in engine.ts admits as much.
--
-- Two columns is the whole fix. The cursor is what makes a rotation a
-- rotation — without somewhere to remember who got the last one, every
-- dispatch starts counting from the beginning, which is exactly the bug.
--
-- 'off' is the default because turning this on is a decision about how a
-- team works, and a CRM that starts silently routing conversations to people
-- is a CRM nobody trusts on day one.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auto_assign_mode TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS auto_assign_cursor UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_auto_assign_mode_check'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_auto_assign_mode_check
      CHECK (auto_assign_mode IN ('off', 'round_robin'));
  END IF;
END $$;

COMMENT ON COLUMN accounts.auto_assign_mode IS
  '''off'' (default) or ''round_robin''. When round_robin, an unassigned '
  'conversation receiving an inbound message is handed to the next online '
  'member. Never reassigns a conversation that already has an owner.';

COMMENT ON COLUMN accounts.auto_assign_cursor IS
  'auth user id of whoever received the last automatic assignment. The '
  'rotation resumes after them; a null (or a member who has since left) '
  'starts from the top of the list.';


-- ============================================================
-- 5. Deleting a conversation becomes an admin act.
--
-- 017 granted DELETE to `agent`, which is the same level that can send a
-- message. Those are not comparable acts: one is the job, the other destroys
-- the thread and — through ON DELETE CASCADE on `messages` — every message
-- in it, for everybody, with no undo anywhere in the product.
--
-- Hiding (above) is what agents get instead, and it covers the real need.
-- Deleting stays for the cases hiding cannot answer — a test thread, a wrong
-- number, an LGPD erasure request — and those are admin decisions.
--
-- This has to live in the policy and not only in the interface. A hidden
-- button is a suggestion; PostgREST is reachable with any signed-in
-- session's token.
-- ============================================================
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations
  FOR DELETE USING (is_account_member(account_id, 'admin'));
