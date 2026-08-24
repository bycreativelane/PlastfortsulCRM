-- ============================================================
-- 040_contact_commercial_fields
--
-- The commercial half of a contact. Everything `contacts` holds today is
-- identity — phone, name, email, company. What it does not hold is the
-- relationship: when they last bought, how often they buy, when they said to
-- come back, whether they asked us to stop writing.
--
-- That gap is not cosmetic. Three of the six automations this product is
-- built around read exclusively from these columns and cannot be configured
-- without them:
--
--   Aniversário   → birthday
--   Recompra      → last_purchase_at + repurchase_cycle_days
--   Compra Futura → next_purchase_expected_at
--
-- They are also what the Clientes segmentation needs ("já comprou", "sem
-- comprar há mais de 60 dias", "cidade/estado") and what the contact panel's
-- "Histórico comercial" section reads.
--
-- NAMING. Columns are English, like every other column in this schema, while
-- the interface is Portuguese through the i18n catalogue. The design docs use
-- Portuguese names (`proxima_compra_prevista_em`, `ciclo_recompra_dias`);
-- adopting those would leave the schema half-translated, and every query
-- would read in two languages at once. Language belongs in the UI layer,
-- which already has one.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. The relationship
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS birthday DATE,
  ADD COLUMN IF NOT EXISTS last_purchase_at DATE,
  ADD COLUMN IF NOT EXISTS next_purchase_expected_at DATE,
  ADD COLUMN IF NOT EXISTS repurchase_cycle_days INTEGER,
  ADD COLUMN IF NOT EXISTS average_ticket NUMERIC(12,2);

COMMENT ON COLUMN contacts.birthday IS
  'Day and month matter; the year is usually unknown and never used. Stored as a full DATE because Postgres has no month-day type — the birthday automation compares month and day only.';

COMMENT ON COLUMN contacts.next_purchase_expected_at IS
  'When the customer said to come back. Set by an agent from the conversation, or by the "Compra Futura" quick reply. The automation picks the contact up on this date and clears it.';

COMMENT ON COLUMN contacts.repurchase_cycle_days IS
  'Typical gap between purchases. With last_purchase_at this is what the recompra automation counts from. NULL means "we do not know yet" — the automation skips those rather than guessing a default, which would message people on a cadence nobody chose.';

-- A CHECK rather than trusting the form: a zero or negative cycle would make
-- the recompra automation fire on every sweep, which is a customer getting
-- the same message every five minutes.
ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_repurchase_cycle_positive;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_repurchase_cycle_positive
  CHECK (repurchase_cycle_days IS NULL OR repurchase_cycle_days > 0);

-- ============================================================
-- 2. Who and where
--
-- `state` is the two-letter Brazilian UF. `tax_id` holds a CNPJ (or a CPF for
-- an individual) — named generically because the column should not have to be
-- renamed the first time a contact is a person rather than a company.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_state_is_uf;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_state_is_uf
  CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');

COMMENT ON COLUMN contacts.source IS
  'How this contact reached us — indicação, site, feira. Free text on purpose: a fixed list would be wrong within a month, and this feeds a filter, not a report that has to reconcile.';

-- ============================================================
-- 3. Opt-out
--
-- A COLUMN, not a tag — the design prototype models this as an automatic tag,
-- and that is the wrong shape for the one job it has. Excluding opted-out
-- contacts from a broadcast has to be a cheap, exact filter that cannot be
-- got wrong: a tag means a join, a tag id that must be looked up first, and a
-- row that somebody can delete from the tag manager without realising they
-- just re-enrolled forty people who asked to be left alone.
--
-- NOT NULL DEFAULT FALSE so the filter never has to reason about NULL.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.opted_out IS
  'The customer asked us to stop. Broadcasts and automations must exclude these — it is a legal position, not a preference.';

-- ============================================================
-- 4. Indexes
--
-- The date automations are cron sweeps: every run asks "whose birthday is
-- today", "whose repurchase window opened", "who did we promise to call back
-- on this date". Unindexed, each of those is a full scan of `contacts` on
-- every tick, forever.
--
-- Partial on NOT NULL because most contacts will never carry these — the
-- index only has to cover the rows a sweep can actually match.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_contacts_birthday
  ON contacts (account_id, birthday)
  WHERE birthday IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_next_purchase
  ON contacts (account_id, next_purchase_expected_at)
  WHERE next_purchase_expected_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_last_purchase
  ON contacts (account_id, last_purchase_at)
  WHERE last_purchase_at IS NOT NULL;

-- Segmentation filters on these two together far more often than apart
-- ("clientes de Porto Alegre que não compram há 60 dias").
CREATE INDEX IF NOT EXISTS idx_contacts_city_state
  ON contacts (account_id, state, city)
  WHERE city IS NOT NULL;

-- ============================================================
-- RLS
--
-- Nothing to do. `contacts` already has account-scoped policies from
-- migration 017 covering the whole row; a new column inherits them. Stated
-- explicitly so the next person does not go looking for the policy change
-- that should have been here.
-- ============================================================
