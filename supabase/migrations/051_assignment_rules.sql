-- ============================================================
-- 051_assignment_rules.sql — the rotation gets a shape
--
-- 045 shipped auto-assignment as one boolean dressed as a mode: `off` or
-- `round_robin`, and nothing else. The card in Settings says so in as
-- many words — "the rotation itself has no options worth exposing" — and
-- that was an honest reading of a feature nobody had used yet.
--
-- It has been used since, and three things about it turn out to be
-- decisions rather than facts:
--
--   1. WHO IS IN THE ROTATION. Today it is everybody with a profile row.
--      That includes `viewer`, who is read-only across the whole product
--      and cannot answer the thread they were just handed — a defect
--      already confirmed in the 0.8.2 audit and still open. It also
--      includes the owner, who in most of these accounts is not on the
--      support desk at all.
--   2. WHAT HAPPENS WITH NOBODY ONLINE. The engine rotates over everyone
--      instead of giving up, which is right for a shop that answers in
--      the morning and wrong for one where an unowned thread is the
--      queue everybody watches.
--   3. HOW MUCH IS TOO MUCH. A rotation is fair by turn, not by load: on
--      a busy afternoon it will hand a fifteenth open conversation to
--      somebody who has fourteen, because it is their turn.
--
-- Each of those is a column here, and each defaults to exactly what the
-- engine does today — so applying this migration changes no behaviour
-- until somebody opens the new screen.
--
-- Idempotent. Depends on 045 (the two columns it widens) and 017
-- (`account_role_enum`).
-- ============================================================


-- ============================================================
-- 1. A second strategy.
--
-- `least_busy` hands the thread to whoever has the fewest OPEN
-- conversations right now, breaking ties by the rotation cursor so it
-- never degenerates into "always the same person". It is the answer for
-- a team where conversations have very different lengths — a rotation
-- is fair about turns and says nothing about work.
--
-- `round_robin` stays the default because it is what is running.
-- ============================================================
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_auto_assign_mode_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_auto_assign_mode_check
  CHECK (auto_assign_mode IN ('off', 'round_robin', 'least_busy'));

COMMENT ON COLUMN accounts.auto_assign_mode IS
  '''off'' (default), ''round_robin'', or ''least_busy''. When not off, an '
  'unassigned conversation receiving an inbound message is handed to a '
  'member picked by that strategy. Never reassigns a conversation that '
  'already has an owner.';


-- ============================================================
-- 2. Who may receive one.
--
-- DEFAULT 'agent', which is a BEHAVIOUR CHANGE and the only one in this
-- file. It has to be: the current behaviour is the bug. A `viewer` is
-- read-only everywhere in this product — the composer is disabled for
-- them — so handing them a conversation files a waiting customer under
-- somebody who is unable to answer, and takes the thread out of the
-- unassigned queue where a colleague would have found it.
--
-- An account that genuinely wants viewers in the rotation can set this
-- to 'viewer' on the new screen. Nobody will, but the column says the
-- product knows the difference between a policy and an accident.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auto_assign_min_role account_role_enum
    NOT NULL DEFAULT 'agent';

COMMENT ON COLUMN accounts.auto_assign_min_role IS
  'Lowest role that may receive an automatic assignment. Defaults to '
  'agent: a viewer cannot reply, so assigning to one hides a waiting '
  'customer behind an owner who is unable to act.';


-- ============================================================
-- 3. Nobody is online.
--
--   'rotate_all'       what the engine does today — pick from everybody
--   'leave_unassigned' leave it in the queue for the morning
--
-- Defaults to today's behaviour. Both are defensible and which one is
-- right depends on whether this team treats "unassigned" as a queue
-- somebody watches or as a hole things fall into.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auto_assign_offline_fallback TEXT
    NOT NULL DEFAULT 'rotate_all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'accounts_auto_assign_offline_fallback_check'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_auto_assign_offline_fallback_check
      CHECK (auto_assign_offline_fallback IN ('rotate_all', 'leave_unassigned'));
  END IF;
END $$;

COMMENT ON COLUMN accounts.auto_assign_offline_fallback IS
  'What to do when no eligible member is online: ''rotate_all'' (assign '
  'anyway, the pre-051 behaviour) or ''leave_unassigned''.';


-- ============================================================
-- 4. A ceiling per person.
--
-- 0 means no ceiling, which is what runs today. Above zero, a member
-- holding that many open conversations is skipped until one closes.
--
-- The ceiling is a SKIP and not a refusal: if everybody is at the
-- ceiling the rotation ignores it and assigns anyway, because the
-- alternative is a queue that silently stops being distributed on
-- exactly the afternoon it matters most. A cap that can jam is worse
-- than no cap.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auto_assign_max_open INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_auto_assign_max_open_check'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_auto_assign_max_open_check
      CHECK (auto_assign_max_open BETWEEN 0 AND 500);
  END IF;
END $$;

COMMENT ON COLUMN accounts.auto_assign_max_open IS
  'Skip a member already holding this many open conversations. 0 = no '
  'ceiling. Ignored when it would leave nobody eligible — a cap that can '
  'jam the queue is worse than no cap.';


-- ============================================================
-- 5. "Not me."
--
-- Per person, and on `profiles` rather than in a join table because it
-- is one boolean about one member and the roster is already loaded
-- everywhere it matters.
--
-- WRITABLE BY THE MEMBER THEMSELVES, deliberately, unlike
-- `permission_overrides` next to it. Being in the support rotation is a
-- fact about your own day — the owner who does sales and not support,
-- the developer who has an account to read the inbox — and needing an
-- admin to take yourself out of it is how people instead just leave the
-- threads sitting there. `profiles_update` (017) already allows exactly
-- this, and 034's trigger only guards the privilege columns.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS auto_assign_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.auto_assign_opt_out IS
  'This member takes no automatic assignments. Self-service on purpose: '
  'it is a fact about your own day, and an opt-out that needs an admin is '
  'an opt-out people work around by ignoring the thread instead.';

-- The rotation reads "who is eligible" on every inbound message that
-- lands on an unassigned conversation, which is the hottest path this
-- column has. Partial, because the interesting rows are the few who
-- opted out.
CREATE INDEX IF NOT EXISTS idx_profiles_auto_assign_opt_out
  ON profiles(account_id)
  WHERE auto_assign_opt_out;


-- ============================================================
-- 6. Writing the opt-out.
--
-- `profiles_update` (017) is `auth.uid() = user_id` on both halves: a
-- member may write their own row and nobody else's. That is exactly
-- right for somebody taking themselves out of the rotation, and exactly
-- wrong for the other half of the request — an admin building the
-- routing rules needs to be able to say "the owner is not on the support
-- desk" without asking the owner to log in and click.
--
-- A plain PATCH from an admin against a colleague's row would match ZERO
-- ROWS and return no error, so the screen would say "salvo" and change
-- nothing. Same trap 050 hit with `permission_overrides`, same shape of
-- answer: SECURITY DEFINER, both callers allowed, one place to read the
-- rule.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_auto_assign(
  p_user_id UUID,
  p_opt_out BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  -- Yourself, always. Somebody else, only as an admin.
  IF p_user_id <> auth.uid() AND NOT is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can change who is in the rotation'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
     SET auto_assign_opt_out = COALESCE(p_opt_out, FALSE)
   WHERE user_id = p_user_id
     AND account_id = v_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That member is not in your account' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_auto_assign(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_auto_assign(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_auto_assign(UUID, BOOLEAN) TO service_role;
