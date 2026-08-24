-- ============================================================
-- 043_deal_loss_reason
--
-- Why the deal was lost, as something you can group by.
--
-- The interface already asks — a deal cannot reach Perdido without picking
-- one of seven reasons, on the board, in the sheet and from the thread. Until
-- this migration runs, that answer is appended to `deals.notes`, which means
-- it is written down and unreportable: "quantas perdas por frete neste
-- trimestre" is a question about a column, not about free text.
--
-- The prototype states the requirement in the field hint itself —
-- "Obrigatório — alimenta o relatório de perdas" — and a report is the only
-- reason to make somebody answer a question at the moment they are trying to
-- close something.
--
-- TEXT and not an enum. The seven are the app's list today
-- (`src/lib/deals/outcome.ts`) and the eighth will be somebody's Tuesday, not
-- a migration. What keeps it groupable is that the app writes its KEYS —
-- `price`, `freight`, `competitor` — never the translated label, so the
-- report survives an operator switching the interface language.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS lost_reason TEXT,
  ADD COLUMN IF NOT EXISTS lost_note TEXT;

COMMENT ON COLUMN deals.lost_reason IS
  'Why this deal was lost. One of the seven keys in src/lib/deals/outcome.ts '
  '(price, freight, leadTime, competitor, noReply, productMismatch, other) '
  '— the KEY, never the translated label, so the loss report groups across '
  'locales.';

COMMENT ON COLUMN deals.lost_note IS
  'Free text the seller added alongside the reason. Optional by design: the '
  'reason is what the report needs, the note is what the next conversation '
  'needs.';

-- The report's whole query: losses by reason, per account, over a period.
-- Partial, because the overwhelming majority of deals are not lost and an
-- index over them would be mostly nulls.
CREATE INDEX IF NOT EXISTS idx_deals_lost_reason
  ON deals(account_id, lost_reason)
  WHERE lost_reason IS NOT NULL;

-- ============================================================
-- "Vai comprar depois" is not on the list, deliberately.
--
-- It was, and it was removed: a customer who said yes-but-not-yet is alive,
-- and filing them under Perdido takes them out of the funnel AND poisons the
-- loss report with the one row that is not a failure. That answer belongs on
-- the contact record's Compra futura date
-- (`contacts.next_purchase_expected_at`, migration 040), which is where the
-- repurchase automation looks for it. Every key above is a reason the deal
-- is OVER.
--
-- No CHECK constrains the column even so. The list is the app's and will
-- grow; a constraint would make adding the eighth reason a migration instead
-- of a decision, and a database that argues with an operator mid-sale is
-- worse than a report with a footnote.
-- ============================================================
