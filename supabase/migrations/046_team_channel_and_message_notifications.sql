-- ============================================================
-- 046_team_channel_and_message_notifications
--
-- Two things reported together, both about the team noticing something.
--
--   1. A place for the team to talk to each other, which the product has
--      never had — every conversation in it is with a customer.
--   2. Notifications when a customer writes, which the product also has
--      never had. It has had exactly one notification type since 027, and
--      it fires on assignment.
--
-- Idempotent — safe to re-run. Depends on 045 having been applied first
-- (both use `conversations.hidden_at`; nothing here reads it, but the
-- numbering is the order).
-- ============================================================


-- ============================================================
-- 1. `team_messages` — the room with no customer in it.
--
-- "Uma conversa apenas para equipe PlastfortSul." Every thread in this CRM
-- is a WhatsApp conversation with somebody outside the company, so an agent
-- who wants to say "o Cleiton ligou, vai buscar amanhã" to a colleague has
-- to leave the app to say it — and the answer comes back somewhere the CRM
-- will never see. What is lost is not the chat, it is the context: the
-- sentence that explains the order lives in a different application from the
-- order.
--
-- ONE ROOM PER ACCOUNT, NOT A THREAD TABLE. There is no `channel_id` and no
-- membership table, because the request was for one room and every extra
-- level of structure here is a decision somebody has to make before they can
-- type. A second room, if it is ever wanted, is a column with a default —
-- adding one later is cheap, and guessing at it now is not.
--
-- NOT A `conversations` ROW EITHER, which was the tempting shape. Every
-- column on that table is about a customer (`contact_id NOT NULL`,
-- `unread_count` fed by the inbound webhook, the 24-hour session window,
-- `assigned_agent_id`), and every code path that reads it assumes there is a
-- phone number at the other end. An internal note in that table would be one
-- `IF` away from being sent to a customer, forever.
-- ============================================================
CREATE TABLE IF NOT EXISTS team_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Who said it. RESTRICT rather than CASCADE: removing somebody from the
  -- team must not silently delete what they told everybody, and a message
  -- with no author is worse than a message from a former colleague.
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  body TEXT NOT NULL CHECK (length(trim(body)) > 0),

  -- Optional pointer at the conversation being discussed. This is the whole
  -- reason the room is inside the CRM rather than in WhatsApp: "sobre este
  -- atendimento" is a link, not a description a colleague has to go find.
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

COMMENT ON TABLE team_messages IS
  'Internal team chat, one room per account. Never sent to WhatsApp and '
  'never visible to a contact — see the note in 046 for why this is not a '
  'row in `conversations`.';

CREATE INDEX IF NOT EXISTS idx_team_messages_account_created
  ON team_messages(account_id, created_at DESC);

ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;

-- Any member reads and writes; you can only edit or delete your own.
-- `viewer` included in the read: a read-only member is somebody who watches
-- the operation, and the room is where the operation explains itself.
DROP POLICY IF EXISTS team_messages_select ON team_messages;
CREATE POLICY team_messages_select ON team_messages FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS team_messages_insert ON team_messages;
CREATE POLICY team_messages_insert ON team_messages FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND auth.uid() = author_id);

DROP POLICY IF EXISTS team_messages_update ON team_messages;
CREATE POLICY team_messages_update ON team_messages FOR UPDATE
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS team_messages_delete ON team_messages;
CREATE POLICY team_messages_delete ON team_messages FOR DELETE
  USING (auth.uid() = author_id OR is_account_member(account_id, 'admin'));

-- Realtime, so the room behaves like a room. Same guarded add the other
-- tables use — `supabase_realtime` may already carry it on a re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'team_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
  END IF;
END $$;


-- ============================================================
-- 2. Notifications are allowed to say "a customer wrote".
--
-- THE BUG, stated plainly: this never existed. 027 created the
-- `notifications` table with a CHECK constraint allowing exactly one value,
-- `conversation_assigned`, and one trigger that fires when somebody hands
-- you a thread. Nothing anywhere notifies on an incoming message.
--
-- Which is why the report is "ALGUMAS conversas não vêm notificação" rather
-- than "none do": assignment notifications work, so the bell is demonstrably
-- alive, and the conversations that never notify look like the broken ones.
--
-- WHAT THIS MIGRATION DOES NOT DO: create the notification.
--
-- The first draft of this file did it in an `AFTER INSERT` trigger on
-- `messages`, and that was the wrong place for a reason worth writing down.
-- A trigger there fires on EVERY row inserted into that table — including a
-- broadcast writing thousands of outbound rows, and every flow, template and
-- AI reply — where the only thing it can do is check `sender_type` and
-- return. That is a plpgsql call per row on the bulk path, for nothing.
--
-- And on the path where it did have work, it did that work INSIDE the
-- inbound message's own transaction: an `INSERT ... SELECT` fanning out one
-- row per team member, holding locks, while the statement that has to
-- succeed for the message to exist at all waits on it.
--
-- So the writing moved to `@/lib/notifications/new-message`, called from the
-- webhook inside the `after()` block it already uses for deferred work. Same
-- result, no cost on any other path, and it cannot slow down or fail the
-- insert it is reacting to. The service role writes the rows, which is why
-- there is still no client INSERT policy.
--
-- What is left here is the schema half: the constraint that lets the row
-- exist, and the index the burst guard reads.
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'new_message'));

-- "Have we already announced this conversation?" runs once per inbound
-- message, so it gets its own index rather than scanning a table that grows
-- by one row per member per event.
CREATE INDEX IF NOT EXISTS idx_notifications_conversation_recent
  ON notifications(conversation_id, created_at DESC)
  WHERE type = 'new_message';

-- Remove the trigger version if an earlier copy of this file was applied.
-- Written as DROP rather than omitted, because a re-run has to leave the
-- database in the state this file describes — not in whichever state it
-- happened to be in first.
DROP TRIGGER IF EXISTS on_new_inbound_message ON messages;
DROP FUNCTION IF EXISTS notify_new_inbound_message();
