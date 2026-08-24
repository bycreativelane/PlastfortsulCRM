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
