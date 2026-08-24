-- ============================================================
-- 041_playbooks
--
-- What to do with this deal, right now.
--
-- The board answers "where is this deal"; nothing in the product answers
-- "and therefore what". That gap is where deals go quiet: a lead sits in
-- Qualified for eleven days not because anyone decided to wait, but because
-- the next move lived in one person's head and they were busy on Thursday.
--
-- A playbook is the stage's own checklist. Steps belong to a pipeline STAGE,
-- not to a deal: the work is a property of where the deal has got to, so a
-- deal picks up its list by arriving and drops it by moving on. Nothing has
-- to be copied onto each deal when it is created, and editing the playbook
-- changes what every deal in that stage is asked to do — which is the point.
-- The only thing stored per deal is which steps are ticked.
--
-- WHY THIS IS NOT AN AUTOMATION. Automations are the machine acting on its
-- own; this is a person being told what to do. The whole colour doctrine in
-- this app rests on that distinction (amber = a human must act, grey = a
-- machine did this), and collapsing the two would mean a checklist item you
-- cannot tell apart from something already handled. Playbooks are amber.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. The steps
--
-- `account_id` is denormalised out of `pipeline_stages -> pipelines` so RLS
-- can scope a row without a two-table join on every read. It is the same
-- trade 017 made across the schema.
--
-- ON DELETE CASCADE from the stage: a stage that no longer exists cannot have
-- work attached to it, and leaving orphans would show a deal a checklist for
-- a column it is not in.
-- ============================================================
CREATE TABLE IF NOT EXISTS playbook_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  -- The one-line "how", shown under the title. Optional: most steps are
  -- self-explanatory and a forced description would fill with restatements.
  hint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE playbook_steps IS
  'The checklist a deal inherits from the stage it is currently in. Ordered by `position`; edited by admins in the pipeline settings.';

COMMENT ON COLUMN playbook_steps.hint IS
  'Optional one-liner under the title — the "how", not a restatement of the "what". Left NULL for steps that need no explaining.';

-- Every read is "the steps for this stage, in order", so the index carries
-- the sort as well as the filter.
CREATE INDEX IF NOT EXISTS idx_playbook_steps_stage
  ON playbook_steps (stage_id, position);

DROP TRIGGER IF EXISTS set_updated_at ON playbook_steps;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON playbook_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. What is ticked
--
-- A row exists iff the step is done — there is no `done BOOLEAN`, because a
-- three-state column (missing / false / true) would have two spellings for
-- "not done" and every query would have to remember both.
--
-- The composite primary key is also the uniqueness guarantee: two agents
-- ticking the same box at the same moment produce one row, not two. The
-- second write is the loser of that race, so the client sends it as an
-- upsert with `ignoreDuplicates` (playbook-checklist.tsx) — a duplicate tick
-- is somebody agreeing with what is already on screen, not an error to show
-- them.
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_playbook_progress (
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES playbook_steps(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  done_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- `auth.users(id)`, not `profiles(id)`. They are different UUIDs —
  -- `profiles.id` defaults to `uuid_generate_v4()` and only `profiles.user_id`
  -- holds the auth id (001:13-23) — and the auth id is what the app means by
  -- "who": `conversations.assigned_agent_id` holds it, 027 compares it to
  -- `auth.uid()`, and playbook-checklist.tsx writes `session.user.id`. Aimed
  -- at profiles.id, every tick would have failed the FK.
  --
  -- ON DELETE SET NULL, not CASCADE: an agent leaving the company must not
  -- silently un-tick the work they did. History outlives employment.
  done_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (deal_id, step_id)
);

COMMENT ON TABLE deal_playbook_progress IS
  'One row per completed playbook step. Absence means not done; there is no false.';

-- "Everything ticked on this deal" is the only read shape, and the primary
-- key already leads with deal_id, so no second index is needed.

-- ============================================================
-- 3. RLS
--
-- Mirrors `pipeline_stages` exactly: reading the playbook is for anyone in
-- the account, EDITING it is admin-class, because a playbook is a rule about
-- how the team works rather than a record of what happened.
--
-- Progress is the opposite and is agent-class: ticking a box IS the work.
-- ============================================================
ALTER TABLE playbook_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_playbook_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS playbook_steps_select ON playbook_steps;
DROP POLICY IF EXISTS playbook_steps_insert ON playbook_steps;
DROP POLICY IF EXISTS playbook_steps_update ON playbook_steps;
DROP POLICY IF EXISTS playbook_steps_delete ON playbook_steps;

CREATE POLICY playbook_steps_select ON playbook_steps FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY playbook_steps_insert ON playbook_steps FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY playbook_steps_update ON playbook_steps FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY playbook_steps_delete ON playbook_steps FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS deal_playbook_progress_select ON deal_playbook_progress;
DROP POLICY IF EXISTS deal_playbook_progress_insert ON deal_playbook_progress;
DROP POLICY IF EXISTS deal_playbook_progress_delete ON deal_playbook_progress;

CREATE POLICY deal_playbook_progress_select ON deal_playbook_progress FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY deal_playbook_progress_insert ON deal_playbook_progress FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY deal_playbook_progress_delete ON deal_playbook_progress FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- No UPDATE policy on purpose: a tick is created or removed, never edited.
-- Re-ticking a step is a fresh row with a fresh `done_at` and a fresh
-- `done_by`, which is the honest record of what happened.

-- ============================================================
-- 4. Realtime
--
-- The board and the deal sheet both show progress, and two agents working
-- the same pipeline should see each other's ticks without a refresh — the
-- entire point of a shared checklist is knowing what someone else already
-- did. Same pattern the rest of the app uses.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'deal_playbook_progress'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deal_playbook_progress;
  END IF;
END $$;
