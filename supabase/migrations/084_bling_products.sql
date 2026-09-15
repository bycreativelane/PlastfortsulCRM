-- ============================================================
-- 084_bling_products
--
-- Produtos vindos do Bling — Fase 2 de `docs/spec-orcamentos-bling.md`,
-- segunda parte. Decisões D6 e D7, respondidas pelo Gabriel em 15/09/2026.
--
-- ------------------------------------------------------------
-- D6: O BLING É A FONTE, E O VÍNCULO É PELO SKU
-- ------------------------------------------------------------
--
-- A importação vincula aos produtos que já existem (054/055) pelo código,
-- sem duplicar, e cria o que só existe no Bling. Nome, código, unidade,
-- preço e situação passam a vir do Bling: o preço do Bling é o preço de
-- lista, o que a linha do pedido sugere — o vendedor continua podendo
-- praticar outro na linha.
--
-- O que é do CRM continua do CRM: medidas e material (055), descrição, e
-- as duas colunas de categoria abaixo, que nenhuma sincronização toca.
--
-- `products.sku` já é único por conta sem caixa (054), então o CRM nunca tem
-- dois produtos com o mesmo código. A ambiguidade vem do outro lado:
--   - produto do Bling SEM código — não há por onde vincular;
--   - código que já está vinculado a OUTRO produto do Bling;
--   - código ou nome maior do que o CRM aceita.
-- Esses vão para `bling_product_matches`, e um admin decide: vincular a um
-- produto existente, criar, ou ignorar.
--
-- ------------------------------------------------------------
-- D7: FAMÍLIA → CATEGORIA DE RECEITA, UMA VEZ
-- ------------------------------------------------------------
--
-- "Família" é a categoria CADASTRAL do produto no Bling
-- (`bling_references.kind = 'product_category'`). A categoria que vai no
-- pedido é de RECEITA, outra coisa. `bling_family_categories` liga uma à
-- outra, confirmada por um admin com sugestão pelo nome.
--
-- A resolução de um item, na ordem:
--   1. a exceção do produto (`products.revenue_category_bling_id`);
--   2. a família dele, subindo pelos pais até achar uma mapeada;
--   3. a categoria padrão ("Demais produtos → Outros produtos", da
--      especificação), em `bling_settings.default_revenue_category_id`.
-- `defines_order_category = false` marca o item auxiliar (a abraçadeira): ele
-- não conta na hora de decidir a categoria do pedido (Fase 3).
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. As colunas do Bling em `products`
-- ------------------------------------------------------------

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS bling_product_id TEXT,
  ADD COLUMN IF NOT EXISTS bling_product_type TEXT
    CHECK (bling_product_type IS NULL OR bling_product_type IN ('P', 'S', 'N')),
  ADD COLUMN IF NOT EXISTS gross_weight_kg NUMERIC(12,3)
    CHECK (gross_weight_kg IS NULL OR gross_weight_kg >= 0),
  ADD COLUMN IF NOT EXISTS net_weight_kg NUMERIC(12,3)
    CHECK (net_weight_kg IS NULL OR net_weight_kg >= 0),
  ADD COLUMN IF NOT EXISTS bling_family_id TEXT,
  -- Exceção por produto (D7). Do CRM: a sincronização nunca escreve aqui.
  ADD COLUMN IF NOT EXISTS revenue_category_bling_id TEXT,
  ADD COLUMN IF NOT EXISTS defines_order_category BOOLEAN NOT NULL DEFAULT TRUE,
  -- Controle da sincronização: quando o detalhe foi lido, e o resumo da
  -- listagem naquela hora (para não pedir o detalhe do que não mudou).
  ADD COLUMN IF NOT EXISTS bling_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bling_list_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_account_bling
  ON products (account_id, bling_product_id)
  WHERE bling_product_id IS NOT NULL;

COMMENT ON COLUMN products.bling_product_id IS
  'Id do produto no Bling (084). Com ele, nome, código, unidade, preço e situação vêm do Bling.';
COMMENT ON COLUMN products.revenue_category_bling_id IS
  'Exceção de categoria de receita deste produto (D7). Nunca escrita pela sincronização.';
COMMENT ON COLUMN products.defines_order_category IS
  'Falso para item auxiliar (ex.: abraçadeira): não decide a categoria do pedido (D7).';

-- ------------------------------------------------------------
-- 2. Família → categoria de receita
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_family_categories (
  account_id                 UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_bling_id            TEXT NOT NULL,
  revenue_category_bling_id  TEXT NOT NULL,
  company_id                 TEXT NOT NULL,
  confirmed_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (account_id, family_bling_id)
);

ALTER TABLE bling_family_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bling_family_categories_select ON bling_family_categories;
CREATE POLICY bling_family_categories_select ON bling_family_categories FOR SELECT
  USING (is_account_member(account_id));
-- Escrita pela rota de admin, com auditoria.

ALTER TABLE bling_settings
  ADD COLUMN IF NOT EXISTS default_revenue_category_id TEXT;

-- ------------------------------------------------------------
-- 3. Os produtos que precisam de um admin
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_product_matches (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id         UUID NOT NULL REFERENCES bling_connections(id) ON DELETE CASCADE,
  bling_product_id      TEXT NOT NULL,
  bling_code            TEXT,
  bling_name            TEXT NOT NULL,
  reason                TEXT NOT NULL CHECK (reason IN (
                          'no_sku',
                          'sku_linked_elsewhere',
                          'sku_too_long'
                        )),
  -- O produto do CRM que parece ser o mesmo, quando há um. Só sugestão.
  candidate_product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'linked', 'created', 'ignored')),
  -- O produto como o Bling o descreveu na última leitura, para criar sem
  -- pedir o detalhe de novo.
  payload               JSONB NOT NULL DEFAULT '{}',
  resolved_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, bling_product_id)
);

CREATE INDEX IF NOT EXISTS idx_bling_product_matches_pending
  ON bling_product_matches (account_id)
  WHERE status = 'pending';

ALTER TABLE bling_product_matches ENABLE ROW LEVEL SECURITY;
-- Nenhuma política: a fila sai pela rota de admin.
