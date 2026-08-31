-- ============================================================
-- 050_account_governance.sql — the record, the clock, and the exceptions
--
-- Three things asked for together, and they belong together because they
-- are the same question asked in three tenses:
--
--   Auditoria de conta   what has been done to this account   (past)
--   Último acesso        who is still actually using it       (present)
--   Permissões           what each person may do next         (future)
--
-- Today the product can answer none of them. `account_role` is the whole
-- of the permission system — four levels, identical for everybody who
-- holds one — and nothing anywhere records that a role was changed, a
-- member removed, an API key minted, or the WhatsApp number repointed.
-- On an account with five people that is not a compliance gap, it is an
-- ordinary Tuesday problem: "quem tirou o Vitor do funil" has no answer,
-- and the only way to find out is to ask everybody.
--
-- Idempotent — safe to re-run. Depends on 017 (account roles) and 024
-- (`member_presence`, which supplies half of "último acesso").
-- ============================================================


-- ============================================================
-- 1. `account_audit_log` — what happened, and who did it.
--
-- APPEND-ONLY BY CONSTRUCTION. There is no UPDATE policy and no DELETE
-- policy on this table for anybody, including the owner. A log a member
-- can edit is not a log; it is a document, and the one question it exists
-- to answer ("did somebody change this?") is exactly the one it would
-- stop being able to answer.
--
-- Rows die only with their account, via the CASCADE.
-- ============================================================
CREATE TABLE IF NOT EXISTS account_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Who. SET NULL rather than RESTRICT, because a member being removed
  -- is one of the things this table records, and a foreign key that
  -- blocked the deletion would make the log the reason the action it is
  -- describing cannot happen.
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Who, in words, frozen at the moment of the act.
  --
  -- This is the column that makes the log readable a year later. A join
  -- to `profiles` gives the name somebody has TODAY; the log needs the
  -- name they had when they did it, because the interesting rows are
  -- precisely the ones about people who have since been renamed or
  -- removed — and `actor_user_id` is NULL for exactly those.
  actor_label TEXT,

  -- What. A dotted vocabulary, closed in the application rather than in
  -- a CHECK: see `@/lib/audit/events`. Deliberately not an enum — every
  -- new kind of event would otherwise be a migration, which is the
  -- friction that ends with things quietly not being logged.
  action TEXT NOT NULL CHECK (length(trim(action)) > 0),

  -- What it was done to. `target_id` is TEXT rather than UUID because the
  -- targets are not one table: a member (auth uid), an API key (uuid), a
  -- settings section (a string), a pipeline stage. `target_label` is the
  -- same frozen-in-time courtesy `actor_label` gets.
  target_type TEXT,
  target_id TEXT,
  target_label TEXT,

  -- The detail. Before/after for a role change, the scopes on a key, the
  -- fields touched in a settings save. Kept as JSON because it differs
  -- per action and nothing queries inside it — it is read by a human,
  -- one row at a time.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE account_audit_log IS
  'Append-only record of consequential acts on an account: membership, '
  'roles, permissions, keys, integration config. No UPDATE or DELETE '
  'policy exists for any role — see the note in 050.';

-- The only read pattern there is: one account, newest first, sometimes
-- narrowed to one actor or one action.
CREATE INDEX IF NOT EXISTS idx_audit_account_created
  ON account_audit_log(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_account_actor
  ON account_audit_log(account_id, actor_user_id, created_at DESC);

ALTER TABLE account_audit_log ENABLE ROW LEVEL SECURITY;

-- ADMIN AND UP READ IT, and that is narrower than most tables here.
-- The log says when each person last signed in and what they changed,
-- which is a different class of fact from "how many deals are open" — an
-- agent has no operational use for it, and a shared inbox where everyone
-- can see everyone's session times is a different workplace.
DROP POLICY IF EXISTS account_audit_log_select ON account_audit_log;
CREATE POLICY account_audit_log_select ON account_audit_log FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- No INSERT policy on purpose: writes come from the service role in API
-- routes, or through the one narrow RPC below. A client that could insert
-- freely could also insert convincingly.


-- ============================================================
-- 2. `record_sign_in()` — the one thing a browser may add to the log.
--
-- The webhook and the API routes write their own rows with the service
-- role. A sign-in has no server route to hang off: Supabase auth happens
-- between the browser and GoTrue, and the app finds out about it from a
-- session callback. So the browser has to be able to say "I am here",
-- and this is the smallest possible way to let it.
--
-- It takes NO ARGUMENTS. The account, the actor and the label all come
-- from the caller's own profile, so the only sentence a client can add to
-- the log is the true one it was going to add anyway. SECURITY DEFINER
-- because there is no INSERT policy for it to satisfy.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.last_sign_in_at IS
  'When this member last authenticated, as reported by their own browser '
  'through record_sign_in(). The other half of "último acesso" is '
  'member_presence.last_seen_at (024), which is activity rather than '
  'authentication — the roster shows whichever is more recent.';

CREATE OR REPLACE FUNCTION public.record_sign_in()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_name TEXT;
  v_last TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, full_name, last_sign_in_at
    INTO v_account_id, v_name, v_last
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RETURN; -- profile not linked to an account yet; nothing to attribute
  END IF;

  UPDATE profiles
     SET last_sign_in_at = NOW()
   WHERE user_id = auth.uid();

  -- ONE ROW PER HOUR AT MOST.
  --
  -- The caller is a React effect on a page that survives navigation but
  -- not a hard reload, and a browser restored from sleep re-fires the
  -- session callback. Without this guard an ordinary morning writes a
  -- dozen identical "entrou" lines, and a log that repeats itself is a
  -- log nobody scrolls. The stamp above still moves every time, so
  -- "último acesso" stays exact.
  IF v_last IS NULL OR v_last < NOW() - INTERVAL '1 hour' THEN
    INSERT INTO account_audit_log (
      account_id, actor_user_id, actor_label, action, target_type
    ) VALUES (
      v_account_id, auth.uid(), v_name, 'session.signed_in', 'session'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sign_in() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sign_in() TO authenticated;


-- ============================================================
-- 3. `profiles.permission_overrides` — the exception, over the role.
--
-- The role stays the base and stays the security boundary. This column
-- is a small map of `capability -> boolean` that answers differently for
-- ONE person: hide Relatórios from an agent who should not see per-user
-- conversion, let the office manager into Disparos without making them
-- an admin of everything else.
--
--     { "reports.view": true, "broadcasts.send": false }
--
-- Absent key = whatever the role says. That is the property worth
-- protecting: an account that never opens this screen behaves exactly as
-- it does today, and a capability added next year defaults to the role
-- rather than to a blank.
--
-- WHAT THIS IS NOT.
--
-- It is not row-level security, and reading it as such would be the
-- expensive mistake. RLS still decides what the database will hand over,
-- and RLS knows only about `account_role`. These overrides are enforced
-- by the interface and by this app's own API routes — which is the same
-- strength as the gate on /relatórios today, and is enough for "o Vitor
-- não precisa ver isso". It is NOT enough for "o Vitor não pode ver
-- isso, de jeito nenhum": somebody with the account's anon key and a
-- terminal still gets whatever their ROLE allows. Where that distinction
-- matters, the answer is the role, not this column.
--
-- `@/lib/auth/capabilities` carries the same warning next to the
-- vocabulary, and the settings panel says it in Portuguese to the person
-- setting it.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permission_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profiles.permission_overrides IS
  'Per-member exceptions over the account role: {"capability": bool}. '
  'Absent key means "ask the role". Enforced in the app and its API '
  'routes, NOT in RLS — see the note in migration 050.';

-- A map, not a list and not a string. Cheap to assert, and it is the
-- shape every reader assumes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_permission_overrides_object'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_permission_overrides_object
      CHECK (jsonb_typeof(permission_overrides) = 'object');
  END IF;
END $$;


-- ============================================================
-- 4. Who may change somebody else's permissions.
--
-- TWO THINGS ARE IN THE WAY, and they push in opposite directions.
--
-- `profiles_update` (017) is `auth.uid() = user_id` on both halves: a
-- member may update their OWN row and nobody else's. So an admin CANNOT
-- write a colleague's overrides through PostgREST at all — the UPDATE
-- matches zero rows and reports no error, which is the worst possible
-- shape for a permissions screen: it says "salvo" and changes nothing.
--
-- And the row they CAN write is their own, which is exactly the row that
-- must not be self-served: `permission_overrides` sits on `profiles`
-- next to `account_role`, and RLS constrains rows rather than columns —
-- the same hole 034 had to close with a trigger for `account_role`.
--
-- So both halves are handled, one each:
--
--   · `set_member_permissions()` — SECURITY DEFINER, admin-only, writes
--     somebody ELSE's row. The same shape as `set_member_role` (018),
--     for the same reason.
--   · `guard_permission_overrides()` — a BEFORE UPDATE trigger that
--     refuses a self-edit of this column from a browser. It is what
--     stops a viewer granting themselves the vocabulary through the one
--     row RLS does let them touch.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_permissions(
  p_user_id UUID,
  p_overrides JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(COALESCE(p_overrides, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Permissions must be an object' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  IF NOT is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can change permissions'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own permissions'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_role INTO v_target_role
  FROM profiles
  WHERE user_id = p_user_id AND account_id = v_account_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'That member is not in your account'
      USING ERRCODE = '22023';
  END IF;

  -- The owner is the account. A screen that can take Configurações away
  -- from them is a screen that can lock everybody out, and the recovery
  -- for that is a database console.
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'The owner''s permissions cannot be restricted'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
     SET permission_overrides = COALESCE(p_overrides, '{}'::jsonb)
   WHERE user_id = p_user_id
     AND account_id = v_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_permissions(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_permissions(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_permissions(UUID, JSONB) TO service_role;
CREATE OR REPLACE FUNCTION public.guard_permission_overrides()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Unchanged? Nothing to police. This is the ordinary case — every
  -- profile save that touches a name or an avatar lands here.
  IF NEW.permission_overrides IS NOT DISTINCT FROM OLD.permission_overrides THEN
    RETURN NEW;
  END IF;

  -- The service role and a migration have no auth.uid(). Those are
  -- backfills and admin tooling, not a browser.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE ONE THAT MATTERS. `profiles_update` (017) lets a member write
  -- exactly one row — their own — and this column lives on it. Without
  -- this branch a viewer could PATCH themselves the whole vocabulary and
  -- the app would believe it, which is the same hole 034 closed for
  -- `account_role`.
  --
  -- It also covers the admin, deliberately: everything on the
  -- permissions screen is one person deciding about another, which is
  -- reviewable. Editing your own row is the one move nobody else sees.
  IF NEW.user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own permissions'
      USING ERRCODE = '42501';
  END IF;

  -- Reached only through `set_member_permissions` above, which has
  -- already checked this. Stated twice on purpose: the RPC is the door,
  -- and this is the lock behind it.
  IF NOT is_account_member(NEW.account_id, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can change permissions'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_permission_overrides ON profiles;
CREATE TRIGGER profiles_guard_permission_overrides
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_permission_overrides();


-- ============================================================
-- 5. Realtime.
--
-- The audit log is not published. It is a screen somebody opens on
-- purpose and reads once, not a feed — and publishing it would push
-- every member's sign-in time down a websocket to every admin's browser
-- for as long as the tab is open.
-- ============================================================
