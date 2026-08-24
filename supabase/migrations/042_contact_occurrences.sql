-- ============================================================
-- 042_contact_occurrences
--
-- What went wrong for this customer, and whether it was fixed.
--
-- The spec asks for this twice and in two registers. Section 12 wants the
-- warning where an agent cannot miss it — "no topo ou painel lateral da
-- conversa" — and section 15 wants it clickable, opening the history. But
-- section 16 is the one that decides the SHAPE: "não usar uma etiqueta para
-- cada problema". A tag per problem turns the taxonomy into a bug tracker
-- and still cannot say when, who handled it, or how it ended.
--
-- Section 17 is why this is a table and not a flag: "a ocorrência deve
-- permanecer no histórico". A resolved problem is not a problem that never
-- happened — it is exactly what you want to know before promising the same
-- customer the same thing again. A boolean forgets; a row does not.
--
-- WHAT THE APP ALREADY DOES WITHOUT THIS. The `Possui Ocorrência` tag drives
-- the red triangle on the conversation row and the warning block on the
-- contact panel today. That is one bit, and one bit is genuinely most of the
-- value: it makes an agent read before answering. What it cannot do is
-- count, say what went wrong, or survive somebody removing the tag. When
-- this table lands, those two surfaces read from it instead and gain the
-- second line ("2 ocorrências · 1 em aberto · já teve problema com Solda").
--
-- `account_id` is denormalised out of `contacts` so RLS scopes a row without
-- a join on every read — the same trade 017 made across the schema, and 041
-- after it.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_occurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- Section 14: "oportunidade ou pedido relacionado, se houver". Nullable
  -- because a complaint often arrives with no deal attached, and SET NULL
  -- rather than CASCADE because deleting the deal must not delete the record
  -- of the problem it caused.
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,

  -- One of the fourteen in section 13. Deliberately TEXT and not an enum:
  -- the list is the client's and will grow, and a CHECK constraint would
  -- make adding "Rotulagem" a migration instead of a decision. The app
  -- offers the fourteen; the column accepts what the account writes.
  kind TEXT NOT NULL,

  occurred_on DATE NOT NULL,
  description TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  -- Section 14's "solução aplicada" and "observação final". Both empty while
  -- the occurrence is open, which is why neither is NOT NULL.
  resolution TEXT,
  final_note TEXT,
  resolved_at TIMESTAMPTZ,

  -- A resolved occurrence knows WHEN. Without this the two columns can
  -- disagree, and "resolvida" with no date is the version of this row that
  -- makes the history worthless — the whole reason section 17 keeps rows
  -- after resolution is to be able to say when the problem stopped.
  CONSTRAINT contact_occurrences_resolved_has_date
    CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),

  -- Section 14's "responsável pelo atendimento".
  --
  -- `auth.users(id)` and not `profiles(id)`, for the reason 041 spells out:
  -- `profiles.id` is not the auth id, and the auth id is what every "who did
  -- this" column in this schema holds. SET NULL for the same reason as 041's
  -- `done_by`: somebody leaving the company must not erase the history they
  -- handled.
  handled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- `updated_at` is maintained the same way every other table maintains it
-- (001:344), rather than by whichever writer remembers to set it. The
-- occurrence dialog does remember; a psql fix, a future API route or the
-- resolution form will not.
DROP TRIGGER IF EXISTS set_updated_at ON contact_occurrences;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON contact_occurrences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The only query the indicator makes: "does this contact have any, and how
-- many are open". Leading with contact_id because that is what is always
-- known; `status` second so the open count is an index-only scan.
CREATE INDEX IF NOT EXISTS idx_contact_occurrences_contact
  ON contact_occurrences(contact_id, status);

CREATE INDEX IF NOT EXISTS idx_contact_occurrences_account
  ON contact_occurrences(account_id, occurred_on DESC);

COMMENT ON TABLE contact_occurrences IS
  'Structured history of problems a customer has had. Not a pipeline and not '
  'a tag per problem (spec section 16); rows survive resolution (section 17).';

-- ============================================================
-- RLS
--
-- Any member READS: the whole point is that whoever picks up the thread sees
-- the warning, and an agent who cannot see it is the failure this prevents.
--
-- Any agent WRITES and RESOLVES: registering a problem is the work of
-- whoever is talking to the customer, and making it admin-class would mean
-- the person who heard about it cannot record it.
--
-- DELETE is admin-class, and that is the point of section 17 in policy form:
-- an occurrence is meant to stay. An agent closes it by setting `status`,
-- never by removing the row.
-- ============================================================
ALTER TABLE contact_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_occurrences_select ON contact_occurrences;
DROP POLICY IF EXISTS contact_occurrences_insert ON contact_occurrences;
DROP POLICY IF EXISTS contact_occurrences_update ON contact_occurrences;
DROP POLICY IF EXISTS contact_occurrences_delete ON contact_occurrences;

CREATE POLICY contact_occurrences_select ON contact_occurrences FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY contact_occurrences_insert ON contact_occurrences FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_occurrences_update ON contact_occurrences FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY contact_occurrences_delete ON contact_occurrences FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- `contacts.occurrence_count`, maintained by trigger.
--
-- Denormalised on purpose. The conversation list renders the red triangle
-- per row, and the contacts table would want it too: without a counter that
-- is one aggregate per row on every render of a list that already carries a
-- tag join. The trigger is what keeps it from drifting — a counter nobody
-- maintains is worse than no counter, because it is believed.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN contacts.occurrence_count IS
  'Rows in contact_occurrences for this contact, maintained by trigger. '
  'Denormalised so a list can show the warning without an aggregate.';

CREATE OR REPLACE FUNCTION sync_contact_occurrence_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Both branches on UPDATE, because an occurrence can be moved between
  -- contacts and the old one has to give its count back.
  --
  -- Each is guarded on the count actually changing. `contacts` carries its
  -- own `set_updated_at` (001:362), so an unguarded write would bump
  -- `contacts.updated_at` every time an occurrence was merely resolved — and
  -- `updated_at` is a public field of the v1 API, so an integrator syncing on
  -- it would see the contact "change" when nothing about the contact did.
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
    UPDATE contacts c
       SET occurrence_count = (
             SELECT COUNT(*) FROM contact_occurrences
              WHERE contact_id = OLD.contact_id
           )
     WHERE c.id = OLD.contact_id
       AND c.occurrence_count IS DISTINCT FROM (
             SELECT COUNT(*) FROM contact_occurrences
              WHERE contact_id = OLD.contact_id
           );
  END IF;

  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    UPDATE contacts c
       SET occurrence_count = (
             SELECT COUNT(*) FROM contact_occurrences
              WHERE contact_id = NEW.contact_id
           )
     WHERE c.id = NEW.contact_id
       AND c.occurrence_count IS DISTINCT FROM (
             SELECT COUNT(*) FROM contact_occurrences
              WHERE contact_id = NEW.contact_id
           );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_contact_occurrence_count ON contact_occurrences;
CREATE TRIGGER trg_sync_contact_occurrence_count
  AFTER INSERT OR UPDATE OR DELETE ON contact_occurrences
  FOR EACH ROW EXECUTE FUNCTION sync_contact_occurrence_count();

-- Backfill, so re-running against a table that already has rows is correct
-- rather than merely safe.
--
-- Correlated rather than joined to a GROUP BY: a join can only ever raise a
-- counter, because a contact whose occurrences were all deleted has no row in
-- the aggregate to join against and keeps its stale number forever. This
-- form reads every contact and settles on the truth in both directions.
UPDATE contacts c
   SET occurrence_count = (
         SELECT COUNT(*) FROM contact_occurrences o WHERE o.contact_id = c.id
       )
 WHERE c.occurrence_count IS DISTINCT FROM (
         SELECT COUNT(*) FROM contact_occurrences o WHERE o.contact_id = c.id
       );
