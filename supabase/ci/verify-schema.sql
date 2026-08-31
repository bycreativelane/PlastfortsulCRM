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

  -- 049: the three columns the inbound webhook writes words into, and
  -- the switch that decides whether it spends money doing so. All three
  -- are invisible from the outside — an unmigrated database takes a voice
  -- note, pays a provider to transcribe it, and drops the result with one
  -- console line.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'messages'
       AND column_name = 'media_transcript'
  ) THEN
    RAISE EXCEPTION 'messages.media_transcript is missing — migration 049 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ai_configs'
       AND column_name = 'media_understanding_enabled'
  ) THEN
    RAISE EXCEPTION 'ai_configs.media_understanding_enabled is missing — migration 049 did not apply';
  END IF;

  -- The widened CHECK. `logAiUsage` swallows its own errors by design, so
  -- a constraint still limited to ('auto_reply','draft') would not fail
  -- anything visible — it would just under-report the spend of the one AI
  -- surface that runs without anybody pressing a button.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ai_usage_log_mode_check'
       AND pg_get_constraintdef(oid) LIKE '%transcription%'
  ) THEN
    RAISE EXCEPTION 'ai_usage_log_mode_check does not allow transcription — migration 049 did not apply';
  END IF;

  -- 050: the log, the clock, and the guard.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'account_audit_log'
  ) THEN
    RAISE EXCEPTION 'account_audit_log is missing — migration 050 did not apply';
  END IF;

  -- APPEND-ONLY is a property of what is ABSENT, which is the kind of
  -- thing a later migration adds back by accident. An UPDATE or DELETE
  -- policy on this table would make the log editable by the people it
  -- is a record of.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'account_audit_log'
       AND cmd IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'account_audit_log has an UPDATE or DELETE policy — the log must stay append-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND column_name = 'permission_overrides'
  ) THEN
    RAISE EXCEPTION 'profiles.permission_overrides is missing — migration 050 did not apply';
  END IF;

  -- Without the trigger, `profiles_update_own` (034) is the policy that
  -- governs this column — and that policy lets a viewer edit their own
  -- row. The overrides would be self-service.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'profiles_guard_permission_overrides'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'profiles_guard_permission_overrides is missing — anyone could grant themselves capabilities';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'record_sign_in'
  ) THEN
    RAISE EXCEPTION 'record_sign_in() is missing — migration 050 did not apply';
  END IF;

  -- The only writer for somebody ELSE's overrides. `profiles_update`
  -- (017) is own-row-only, so without this function an admin's save
  -- matches zero rows and reports success — the permissions screen would
  -- lie in the one direction nobody checks.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'set_member_permissions'
  ) THEN
    RAISE EXCEPTION 'set_member_permissions() is missing — migration 050 did not apply';
  END IF;

  -- 051: the rotation's rules. The mode CHECK is the one that fails
  -- loudly if it is missing — an account set to `least_busy` on an
  -- un-migrated database would be rejected at the write and read back as
  -- "off", so auto-assignment would silently stop.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'accounts_auto_assign_mode_check'
       AND pg_get_constraintdef(oid) LIKE '%least_busy%'
  ) THEN
    RAISE EXCEPTION 'accounts_auto_assign_mode_check does not allow least_busy — migration 051 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'accounts'
       AND column_name = 'auto_assign_min_role'
  ) THEN
    RAISE EXCEPTION 'accounts.auto_assign_min_role is missing — migration 051 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND column_name = 'auto_assign_opt_out'
  ) THEN
    RAISE EXCEPTION 'profiles.auto_assign_opt_out is missing — migration 051 did not apply';
  END IF;

  -- Without the RPC an admin taking somebody out of the rotation writes
  -- zero rows and is told it worked — `profiles_update` (017) is
  -- own-row-only. Same silent-success shape 050's permissions RPC has.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'set_member_auto_assign'
  ) THEN
    RAISE EXCEPTION 'set_member_auto_assign() is missing — migration 051 did not apply';
  END IF;

  -- 052: rooms.
  IF to_regclass('public.team_rooms') IS NULL THEN
    RAISE EXCEPTION 'team_rooms is missing — migration 052 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'team_messages'
       AND column_name = 'room_id'
  ) THEN
    RAISE EXCEPTION 'team_messages.room_id is missing — migration 052 did not apply';
  END IF;

  -- The backfill. Every account has exactly one default room, and the
  -- app reads that as a singleton in three places — the rail card, the
  -- channel, and the settings screen. A missing one is an account whose
  -- team room opens empty.
  IF EXISTS (
    SELECT 1 FROM accounts a
     WHERE NOT EXISTS (
       SELECT 1 FROM team_rooms r
        WHERE r.account_id = a.id AND r.is_default
     )
  ) THEN
    RAISE EXCEPTION 'an account has no default team room — migration 052 backfill did not run';
  END IF;

  -- The guard that makes "the default room" a thing you can rely on.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'team_rooms_guard_default'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'team_rooms_guard_default is missing — the default room could be deleted with its history';
  END IF;

  -- 053: the assistant stops being one text box.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ai_configs'
       AND column_name = 'enabled_tools'
  ) THEN
    RAISE EXCEPTION 'ai_configs.enabled_tools is missing — migration 053 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ai_configs'
       AND column_name = 'guardrails'
  ) THEN
    RAISE EXCEPTION 'ai_configs.guardrails is missing — migration 053 did not apply';
  END IF;

  -- Pinned documents fail SILENTLY when the column is absent: the
  -- retriever catches the error and carries on, so the two documents
  -- somebody marked as always-relevant simply never reach the model and
  -- nothing anywhere says so.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ai_knowledge_documents'
       AND column_name = 'pinned'
  ) THEN
    RAISE EXCEPTION 'ai_knowledge_documents.pinned is missing — migration 053 did not apply';
  END IF;

  -- 054: the catalogue.
  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION 'products is missing — migration 054 did not apply';
  END IF;

  IF to_regclass('public.deal_items') IS NULL THEN
    RAISE EXCEPTION 'deal_items is missing — migration 054 did not apply';
  END IF;

  -- THE WORST ONE TO LOSE. Without the trigger the line items save
  -- perfectly and `deals.value` never moves — so every total in
  -- Relatórios goes back to being whatever somebody typed, with no error
  -- anywhere and no way to notice except by adding up a quote by hand.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'deal_items_sync_value'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'deal_items_sync_value is missing — a deal value would never follow its lines';
  END IF;

  -- The partial unique index that stops one product code landing on two
  -- rows. It is partial on purpose: two products with NO code are not
  -- duplicates, and a plain UNIQUE would allow exactly one of them.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_products_account_sku'
  ) THEN
    RAISE EXCEPTION 'idx_products_account_sku is missing — a product code could be duplicated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'contacts'
       AND column_name = 'product_interest'
  ) THEN
    RAISE EXCEPTION 'contacts.product_interest is missing — migration 054 did not apply';
  END IF;

  -- 055: measurements that can be searched, and the split between
  -- correcting a product and curating the catalogue.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = 'size_label'
  ) THEN
    RAISE EXCEPTION 'products.size_label is missing — migration 055 did not apply';
  END IF;

  -- The generated label is what the list, the quote line and the
  -- assistant all read, and what a search for "40x60" matches. A plain
  -- column here would mean three screens formatting it three ways.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = 'size_label'
       AND is_generated = 'ALWAYS'
  ) THEN
    RAISE EXCEPTION 'products.size_label is not GENERATED — three screens could format it three ways';
  END IF;

  -- Without the trigger, "retire" is a plain UPDATE and any agent can
  -- take a product out of everybody's catalogue. RLS cannot express it:
  -- it constrains rows, and this is a column.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'products_guard_active'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'products_guard_active is missing — any agent could retire a product';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'products'
       AND policyname = 'products_insert'
       AND with_check LIKE '%admin%'
  ) THEN
    RAISE EXCEPTION 'products_insert is not admin-scoped — migration 055 did not apply';
  END IF;

  -- ============================================================
  -- 056 — quem mandou, e se chegou
  -- ============================================================

  -- The three columns the WhatsApp-model row reads.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'conversations'
       AND column_name = 'last_message_sender_type'
  ) THEN
    RAISE EXCEPTION 'conversations.last_message_sender_type is missing — migration 056 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'conversations'
       AND column_name = 'last_message_status'
  ) THEN
    RAISE EXCEPTION 'conversations.last_message_status is missing — migration 056 did not apply';
  END IF;

  -- THE ONE THAT MATTERS. Both triggers apply clean and the columns look
  -- right whether or not they exist, because every writer of
  -- `last_message_*` predates them: the row simply keeps the value the
  -- backfill left, forever. The list would show yesterday's tick beside
  -- today's message and nothing in the app would report an error.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'messages_sync_last_sender'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'messages_sync_last_sender is missing — the conversation row would freeze on whatever the 056 backfill wrote';
  END IF;

  -- And the second one, which is the whole reason the tick is ever more
  -- than a single grey check: delivered and read arrive minutes later as
  -- an UPDATE, not as a new message.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'messages_sync_last_status'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'messages_sync_last_status is missing — delivery ticks would never advance in the list';
  END IF;

  -- ============================================================
  -- 057 — a IA de apoio sai de dentro do agente
  -- ============================================================

  -- THE ONE THAT MATTERS. Without this column `loadAiConfig` falls back
  -- to `is_active`, and the manual tools go back to riding on the
  -- agent's master switch — the exact behaviour 057 exists to end. It
  -- degrades silently: nothing errors, the panel just stops being able
  -- to say yes when the agent says no.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'ai_configs'
       AND column_name = 'assist_is_active'
  ) THEN
    RAISE EXCEPTION 'ai_configs.assist_is_active is missing — the manual AI tools are still gated on the agent switch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'ai_configs'
       AND column_name = 'transcribe_audio_enabled'
  ) THEN
    RAISE EXCEPTION 'ai_configs.transcribe_audio_enabled is missing — migration 057 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'ai_configs'
       AND column_name = 'read_document_enabled'
  ) THEN
    RAISE EXCEPTION 'ai_configs.read_document_enabled is missing — migration 057 did not apply';
  END IF;

  -- ============================================================
  -- 058 — a porta de entrada (Typebot, n8n)
  -- ============================================================

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'webhook_hooks'
  ) THEN
    RAISE EXCEPTION 'webhook_hooks is missing — migration 058 did not apply';
  END IF;

  -- THE ONE THAT MATTERS. Without the CHECK, an INSERT could give a hook
  -- any scope string at all — and the engine's gate reads
  -- `scopes.includes('messages')`, so a row with `messages ` (trailing
  -- space) or `MESSAGES` would fail the gate and look correct in the UI,
  -- or a typo'd scope would silently widen nothing. The constraint is
  -- what keeps the vocabulary closed.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints c
     JOIN information_schema.constraint_column_usage u
       ON u.constraint_name = c.constraint_name
    WHERE u.table_name = 'webhook_hooks'
      AND u.column_name = 'scopes'
  ) THEN
    RAISE EXCEPTION 'webhook_hooks.scopes has no CHECK — the scope vocabulary is not closed';
  END IF;

  -- The default must NOT include `messages`. If it ever does, every hook
  -- created from then on can make the account send WhatsApp messages,
  -- and nothing on the screen would say so.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'webhook_hooks'
       AND column_name = 'scopes'
       AND column_default LIKE '%messages%'
  ) THEN
    RAISE EXCEPTION 'webhook_hooks.scopes defaults to something containing `messages` — new hooks would be able to send WhatsApp by default';
  END IF;

  -- Idempotency. Without this index two simultaneous retries both pass
  -- and the deal is created twice — the failure the dedupe key exists
  -- for, and one nothing in the app would report.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'webhook_deliveries'
       AND indexname = 'idx_webhook_deliveries_dedupe'
  ) THEN
    RAISE EXCEPTION 'idx_webhook_deliveries_dedupe is missing — a retried webhook would run twice';
  END IF;

  -- Deliveries hold the payload, which holds a phone and a name. No
  -- write policy for anybody authenticated: they are written by the
  -- route with service role, and an admin able to forge one would make
  -- the debugging record useless.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'webhook_deliveries'
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'webhook_deliveries gained a write policy — delivery history must be service-role only';
  END IF;

  -- ============================================================
  -- 059 — da entrega até o que ela causou
  -- ============================================================

  -- Sem esta coluna a tela de entregas volta a dizer só "aceita", e
  -- ligar uma execução de automação a um payload passa a depender de
  -- casar horário — que quebra assim que duas entregas caem no mesmo
  -- segundo. Aplica limpo e a tela fica meio muda.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'automation_logs'
       AND column_name = 'delivery_id'
  ) THEN
    RAISE EXCEPTION 'automation_logs.delivery_id is missing — the deliveries screen cannot say what a payload caused';
  END IF;

  -- SET NULL e nunca CASCADE. A retenção de 7 dias apaga a entrega; se
  -- a FK fosse CASCADE, apagaria junto o registro operacional da
  -- automação, que vive muito mais.
  IF EXISTS (
    SELECT 1
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage k
        ON k.constraint_name = rc.constraint_name
     WHERE k.table_name = 'automation_logs'
       AND k.column_name = 'delivery_id'
       AND rc.delete_rule <> 'SET NULL'
  ) THEN
    RAISE EXCEPTION 'automation_logs.delivery_id must be ON DELETE SET NULL — pruning a delivery would otherwise delete the automation run with it';
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
