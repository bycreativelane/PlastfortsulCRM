-- ============================================================
-- 054_products.sql — the catalogue the spec always assumed
--
-- "Produtos" appears three times in the original specification and never
-- as a table:
--
--   §10  every opportunity must have `produtos`
--   §11  the customer record has `produtos de interesse`
--   §44  "Campanha por produto" — pick the customers, send the campaign
--
-- All three were built as free text or as tags, because a tag is what
-- you reach for when there is no catalogue. That works until somebody
-- asks the three questions a catalogue exists to answer: what did this
-- deal actually contain, what is this thing worth, and who buys it.
--
-- A tag cannot answer any of them. `saco_lixo` on a contact says they
-- are interested; it does not say in which size, at what price, or how
-- many. And a deal's `value` is a number somebody typed — which is why
-- the pipeline totals in Relatórios are only ever as true as the last
-- person to remember.
--
-- ------------------------------------------------------------------
-- WHAT THIS DELIBERATELY IS NOT
-- ------------------------------------------------------------------
--
-- It is not stock control. There is no quantity on hand, no reservation,
-- no movement ledger, and adding one later would be a different feature
-- with a different table. A CRM that half-tracks stock is worse than one
-- that does not: the number is wrong, somebody quotes from it, and the
-- customer is told a lie with a straight face.
--
-- It is not a price book either — one price per product, per account, in
-- the account's own currency. Tiered pricing, customer-specific prices
-- and volume breaks are a real thing that real distributors need, and
-- every one of them is a decision this migration has no way to guess.
-- The line item carries its OWN unit price (see below), which is what
-- makes a discount expressible today without pretending the catalogue
-- models it.
--
-- Idempotent. Depends on 001 (`deals`) and 017 (`is_account_member`).
-- ============================================================


-- ============================================================
-- 1. `products`
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),

  -- The code the business already uses. NOT a generated key: a
  -- distributor's SKU is printed on the box and said out loud on the
  -- phone, and inventing a second one guarantees two numbers for one
  -- product. Nullable, because plenty of small catalogues have none.
  sku TEXT CHECK (sku IS NULL OR length(trim(sku)) BETWEEN 1 AND 60),

  description TEXT CHECK (description IS NULL OR length(description) <= 2000),

  -- "un", "cx", "kg", "fardo". Free text on purpose — a fixed list of
  -- units is a list that does not contain the one this account uses.
  unit TEXT CHECK (unit IS NULL OR length(trim(unit)) <= 16),

  -- The list price. Nullable, because "sob consulta" is an answer.
  price NUMERIC(12,2) CHECK (price IS NULL OR price >= 0),
  currency TEXT NOT NULL DEFAULT 'BRL',

  -- Grouping, for the campaign-by-product case in §44. One string rather
  -- than a category table: two levels of taxonomy is a decision nobody
  -- asked for, and a text column can become an FK later without the data
  -- having to move.
  category TEXT CHECK (category IS NULL OR length(trim(category)) <= 60),

  -- Retired rather than deleted. A product that stops being sold still
  -- appears in every deal that ever contained it, and deleting it would
  -- either take that history with it or leave the line items pointing at
  -- nothing.
  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE products IS
  'Account catalogue. Not stock control and not a price book — see the '
  'note at the top of 054 for what was left out on purpose.';

-- The list, and the picker on a deal. Both read "this account, active,
-- by name".
CREATE INDEX IF NOT EXISTS idx_products_account_name
  ON products(account_id, name);

CREATE INDEX IF NOT EXISTS idx_products_account_active
  ON products(account_id)
  WHERE active;

-- One code per account, when there is a code at all. A partial unique
-- index rather than a constraint: two products with no SKU are not
-- duplicates, and a plain UNIQUE would let exactly one of them exist.
--
-- This is the trap the RD Station complaint describes — "a plataforma
-- permite duplicar registros sem restrições na importação". A catalogue
-- with the same code twice is a catalogue where the price shown depends
-- on which row the query happened to hit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_account_sku
  ON products(account_id, lower(trim(sku)))
  WHERE sku IS NOT NULL;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Everybody reads; agents and up write. A catalogue is operational data
-- — the person quoting a price is the person who notices it is wrong —
-- so this is deliberately NOT admin-only, unlike pipelines or templates.
DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS products_insert ON products;
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS products_update ON products;
CREATE POLICY products_update ON products FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Deleting is an admin act, and the interface does not offer it at all —
-- `active = false` is the retire path. The policy exists so a mistake
-- made in the first minute can be cleaned up by somebody senior.
DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_delete ON products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE OR REPLACE FUNCTION public.touch_products_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION public.touch_products_updated_at();


-- ============================================================
-- 2. `deal_items` — what the opportunity actually contains
--
-- §10 says an opportunity must have `produtos`. This is that, and it is
-- also the answer to the more interesting question: `deals.value` has
-- always been a number a person typed, so every total in Relatórios is
-- as true as the last person to remember to update it.
--
-- ------------------------------------------------------------------
-- THE PRICE IS COPIED ONTO THE LINE, NOT READ THROUGH THE FK
-- ------------------------------------------------------------------
--
-- `unit_price` is the price AGREED, stored here. It is seeded from the
-- product's list price and then belongs to the line. Three reasons, and
-- the third is the one that matters:
--
--   · a discount has to be expressible;
--   · a catalogue price change must not silently rewrite last quarter's
--     closed deals;
--   · and a deal has to survive its product being retired.
--
-- `product_id` is therefore SET NULL on delete, with the name copied
-- too: a line item remembers what was sold even when the catalogue row
-- is gone.
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  product_id UUID REFERENCES products(id) ON DELETE SET NULL,

  -- Frozen at the moment the line was added, for the same reason
  -- `account_audit_log.actor_label` is: the interesting rows a year from
  -- now are the ones whose product has since been retired or renamed.
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),

  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  -- Percentage off this line. Kept apart from `unit_price` so "we gave
  -- them 10%" survives as a fact rather than as a smaller number.
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (discount_percent >= 0 AND discount_percent <= 100),

  -- GENERATED, so no application can compute it differently. The whole
  -- point of line items is that the total stops being somebody's
  -- arithmetic.
  total NUMERIC(14,2) GENERATED ALWAYS AS (
    ROUND(quantity * unit_price * (1 - discount_percent / 100), 2)
  ) STORED,

  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE deal_items IS
  'Line items on an opportunity (spec §10). `unit_price` is the price '
  'agreed, copied from the catalogue rather than read through it — see '
  'the note in 054.';

CREATE INDEX IF NOT EXISTS idx_deal_items_deal
  ON deal_items(deal_id, position);

CREATE INDEX IF NOT EXISTS idx_deal_items_product
  ON deal_items(product_id)
  WHERE product_id IS NOT NULL;

ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY;

-- Scoped by the account on the row rather than through the deal. `deals`
-- still carries 001's `auth.uid() = user_id` policy, which would make a
-- colleague's opportunity unreadable — and a line item nobody but the
-- creator can see is worse than no line item.
DROP POLICY IF EXISTS deal_items_select ON deal_items;
CREATE POLICY deal_items_select ON deal_items FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS deal_items_insert ON deal_items;
CREATE POLICY deal_items_insert ON deal_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_items_update ON deal_items;
CREATE POLICY deal_items_update ON deal_items FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_items_delete ON deal_items;
CREATE POLICY deal_items_delete ON deal_items FOR DELETE
  USING (is_account_member(account_id, 'agent'));


-- ============================================================
-- 3. The deal's value follows its lines.
--
-- Only when there ARE lines. A deal somebody typed a number into and
-- never itemised keeps that number — this is additive, and a migration
-- that zeroed every existing opportunity in the account would be an
-- unrecoverable one.
--
-- In a trigger rather than in the app because there are three writers
-- (the board, the deal form, and eventually the import) and one of them
-- will forget.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_deal_value_from_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id UUID;
  v_total NUMERIC(14,2);
  v_count INTEGER;
BEGIN
  v_deal_id := COALESCE(NEW.deal_id, OLD.deal_id);

  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_total, v_count
  FROM deal_items
  WHERE deal_id = v_deal_id;

  -- Removing the LAST line does not reset the deal to zero. Somebody who
  -- deletes a line they added by mistake meant to remove a line, not to
  -- wipe the value the opportunity had before anybody itemised it.
  IF v_count > 0 THEN
    UPDATE deals
       SET value = v_total, updated_at = NOW()
     WHERE id = v_deal_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS deal_items_sync_value ON deal_items;
CREATE TRIGGER deal_items_sync_value
  AFTER INSERT OR UPDATE OR DELETE ON deal_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_value_from_items();


-- ============================================================
-- 4. "Produtos de interesse" (§11), as a real reference.
--
-- The contact record has carried this as tags. Tags stay — they are how
-- a campaign audience is picked today and nothing here breaks that —
-- but a reference to the catalogue is what makes §44 ("campanha por
-- produto") a query instead of a naming convention everybody has to
-- remember.
--
-- An array of ids rather than a join table: it is read whole, written
-- whole, never joined FROM, and bounded by how many products one
-- customer plausibly buys. A join table would be three more policies for
-- a list of six uuids.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS product_interest UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN contacts.product_interest IS
  'Catalogue products this customer buys or asked about (spec §11). '
  'Powers "campanha por produto" (§44) as a query rather than as a tag '
  'naming convention. Tags still work and are unchanged.';

-- GIN, because every read of this column is a containment test: "which
-- contacts are interested in THIS product".
CREATE INDEX IF NOT EXISTS idx_contacts_product_interest
  ON contacts USING GIN (product_interest);
