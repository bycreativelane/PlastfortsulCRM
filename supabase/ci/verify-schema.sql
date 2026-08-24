-- Post-migration assertions for the CI job in
-- `.github/workflows/migrations.yml`.
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- ------------------------------------------------------------
  -- The commercial pass, migrations 040-044.
  --
  -- One assertion each, on the object that would be missing if the
  -- file had done nothing. Not every column: this stays a smoke test,
  -- and restating the migrations here would only give them somewhere
  -- to drift apart from.
  --
  -- These were absent for a while, and the gap is worth naming. All
  -- five applied, CI replayed all five, and CI asserted none of them —
  -- a green run that proved only that Postgres had not objected. That
  -- is the exact failure this file exists to catch, so it had it too.
  -- ------------------------------------------------------------

  -- 040: the opt-out flag. The WhatsApp webhook writes it when a
  -- customer replies PARE, and logs-and-continues if the write fails —
  -- so without this column an opt-out is silently dropped and the
  -- contact keeps receiving broadcasts.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'contacts'
       AND column_name = 'opted_out'
  ) THEN
    RAISE EXCEPTION 'contacts.opted_out is missing — migration 040 did not apply';
  END IF;

  -- 041: playbooks.
  IF to_regclass('public.playbook_steps') IS NULL THEN
    RAISE EXCEPTION 'public.playbook_steps is missing — migration 041 did not apply';
  END IF;
  IF to_regclass('public.deal_playbook_progress') IS NULL THEN
    RAISE EXCEPTION 'public.deal_playbook_progress is missing — migration 041 did not apply';
  END IF;

  -- 042: occurrences, and the trigger function behind the denormalised
  -- counter. A missing FUNCTION is the quietest failure of the set —
  -- the table exists, rows insert, and `contacts.occurrence_count`
  -- simply stays 0 forever while the interface believes it.
  IF to_regclass('public.contact_occurrences') IS NULL THEN
    RAISE EXCEPTION 'public.contact_occurrences is missing — migration 042 did not apply';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'sync_contact_occurrence_count'
  ) THEN
    RAISE EXCEPTION 'sync_contact_occurrence_count() is missing — the occurrence counter will never update (migration 042)';
  END IF;

  -- 043: why a deal was lost.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'deals'
       AND column_name = 'lost_reason'
  ) THEN
    RAISE EXCEPTION 'deals.lost_reason is missing — migration 043 did not apply';
  END IF;

  -- 044: quick-reply shortcut and attachment.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'quick_replies'
       AND column_name = 'shortcut'
  ) THEN
    RAISE EXCEPTION 'quick_replies.shortcut is missing — migration 044 did not apply';
  END IF;

  -- 045: inbox state (waiting clock, hiding) and contact name provenance.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'contacts'
       AND column_name = 'name_source'
  ) THEN
    RAISE EXCEPTION 'contacts.name_source is missing — migration 045 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'conversations'
       AND column_name = 'hidden_at'
  ) THEN
    RAISE EXCEPTION 'conversations.hidden_at is missing — migration 045 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'accounts'
       AND column_name = 'auto_assign_mode'
  ) THEN
    RAISE EXCEPTION 'accounts.auto_assign_mode is missing — migration 045 did not apply';
  END IF;

  -- Deleting a conversation cascades to every message in it, so 045
  -- narrows the policy from 'agent' to 'admin'. Asserted because the
  -- interface hiding the menu item is a courtesy and this is the guard.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'conversations'
       AND policyname = 'conversations_delete'
       AND qual LIKE '%admin%'
  ) THEN
    RAISE EXCEPTION 'conversations_delete is not admin-scoped — migration 045 did not apply';
  END IF;

  -- 046: the team's own room, and notifications for an inbound message.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'team_messages'
  ) THEN
    RAISE EXCEPTION 'team_messages is missing — migration 046 did not apply';
  END IF;

  -- The CHECK is the assertion worth making: 027 allowed exactly one type,
  -- so a trigger writing 'new_message' against the old constraint fails
  -- silently into the trigger's own EXCEPTION handler and nobody is told.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notifications_type_check'
       AND pg_get_constraintdef(oid) LIKE '%new_message%'
  ) THEN
    RAISE EXCEPTION 'notifications does not accept new_message — migration 046 did not apply';
  END IF;

  -- The trigger version of this must be GONE: it fired on every row of every
  -- broadcast, and it fanned out inside the inbound insert's transaction.
  -- The app writes these rows now. See the note in 046.
  IF EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_new_inbound_message'
  ) THEN
    RAISE EXCEPTION 'on_new_inbound_message still exists — re-apply migration 046';
  END IF;

  -- 047: the conversation row knows what the last message WAS.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'conversations'
       AND column_name = 'last_message_kind'
  ) THEN
    RAISE EXCEPTION 'conversations.last_message_kind is missing — migration 047 did not apply';
  END IF;

  -- The RPC has to carry the four-argument signature, not the old two. A
  -- leftover 2-arg version makes the webhook's call ambiguous rather than
  -- merely stale, so this asserts the shape and not just the columns.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'bump_conversation_on_inbound'
       AND p.pronargs = 4
  ) THEN
    RAISE EXCEPTION 'bump_conversation_on_inbound is not the 4-argument version — migration 047 did not apply';
  END IF;

  -- The GRANT is the half of 047 that was missing when it was written, and
  -- it is invisible from the outside: the columns land, the function has the
  -- right shape, and every inbound message silently loses its unread bump
  -- because the webhook cannot execute it. `DROP FUNCTION` takes the ACL
  -- with it and `REVOKE ... FROM PUBLIC` removes the default, so this has to
  -- be asserted rather than assumed.
  IF NOT has_function_privilege(
       'service_role',
       'public.bump_conversation_on_inbound(uuid, text, text, text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'service_role cannot execute bump_conversation_on_inbound — migration 047 is missing its GRANT';
  END IF;

  -- 048: the room's write policies are scoped by ACCOUNT, not just by
  -- author. 046 checked authorship alone, and `account_id` is a writable
  -- column — so an author could PATCH their own message into another
  -- account's room, where realtime delivered it live.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'team_messages'
       AND policyname = 'team_messages_update'
       AND qual LIKE '%is_account_member%'
       AND with_check LIKE '%is_account_member%'
  ) THEN
    RAISE EXCEPTION 'team_messages_update is not account-scoped — migration 048 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'team_messages'
       AND policyname = 'team_messages_delete'
       AND qual LIKE '%is_account_member%'
  ) THEN
    RAISE EXCEPTION 'team_messages_delete is not account-scoped — migration 048 did not apply';
  END IF;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.
