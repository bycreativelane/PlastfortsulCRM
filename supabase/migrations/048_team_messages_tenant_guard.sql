-- ============================================================
-- 048 — team_messages: close the cross-tenant write
--
-- WHAT IS WRONG WITH 046
--
-- The room's UPDATE policy checks authorship and nothing else:
--
--   CREATE POLICY team_messages_update ON team_messages FOR UPDATE
--     USING (auth.uid() = author_id)
--     WITH CHECK (auth.uid() = author_id);
--
-- `account_id` is a plain column on the row, and PostgREST will happily
-- PATCH it. So an author can take their own message and move it into
-- somebody else's account:
--
--   PATCH /rest/v1/team_messages?id=eq.<their-own-message>
--   { "account_id": "<another-account>" }
--
-- Both halves of the policy pass — they only ever asked "is this your
-- message", and it is. The row lands in the other account's room, and
-- because `team_messages` is in the `supabase_realtime` publication it
-- shows up there LIVE, in a chat window, for people with no relationship
-- to the sender.
--
-- The DELETE policy has the same shape of gap in its author branch:
-- `auth.uid() = author_id OR is_account_member(account_id, 'admin')`. The
-- second half is scoped; the first is not. It is a smaller hole — you can
-- only delete a row you wrote — but it is the same missing check, and
-- leaving one of a pair fixed is how the other one comes back.
--
-- THE FIX is `is_account_member(account_id)` on both sides of both
-- policies. `USING` decides which rows you may target; `WITH CHECK`
-- decides what the row is allowed to look like AFTER the write — and it is
-- the second one that stops the account_id from moving. Both are needed:
-- with only `WITH CHECK` you could still target a foreign row, and with
-- only `USING` you could still push one out.
--
-- Membership is checked at the default `viewer` level rather than the
-- `agent` that 046's INSERT requires. The question here is tenancy, not
-- permission: authorship already decides who may edit, and somebody
-- demoted to viewer after writing should not have their own line become
-- another account's to inherit.
--
-- WHY A NEW MIGRATION and not an edit to 046: 046 is applied. Editing an
-- applied file changes nothing in the database and leaves the repository
-- describing a schema that no environment has.
--
-- Idempotent, like every policy change in this project — `DROP POLICY IF
-- EXISTS` then create, so a re-run is a no-op rather than an error.
-- ============================================================

DROP POLICY IF EXISTS team_messages_update ON team_messages;
CREATE POLICY team_messages_update ON team_messages FOR UPDATE
  USING (auth.uid() = author_id AND is_account_member(account_id))
  WITH CHECK (auth.uid() = author_id AND is_account_member(account_id));

DROP POLICY IF EXISTS team_messages_delete ON team_messages;
CREATE POLICY team_messages_delete ON team_messages FOR DELETE
  USING (
    is_account_member(account_id)
    AND (auth.uid() = author_id OR is_account_member(account_id, 'admin'))
  );

-- Carries 046's sentence forward rather than replacing it: `COMMENT ON`
-- overwrites, so dropping the WhatsApp note to add the tenancy one would
-- lose the fact that explains why this table is not `conversations`.
COMMENT ON TABLE team_messages IS
  'Internal team chat, one room per account. Never sent to WhatsApp and '
  'never visible to a contact — see the note in 046 for why this is not a '
  'row in `conversations`. Every write policy is scoped by '
  'is_account_member(account_id): authorship alone is not a tenant '
  'boundary, because account_id is a writable column (048).';
