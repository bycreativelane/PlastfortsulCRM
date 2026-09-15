-- ============================================================
-- 083_bling_references
--
-- Os cadastros do Bling que o pedido vai referenciar por ID — Fase 2 de
-- `docs/spec-orcamentos-bling.md`, primeira parte.
--
-- A especificação é taxativa: produto, forma de pagamento, categoria,
-- situação, vendedor e transportador vão ao Bling pelo ID real, "nunca
-- apenas pelo nome". Para escolher um ID, o CRM precisa conhecer a lista —
-- e a lista mora no Bling.
--
-- ------------------------------------------------------------
-- UMA TABELA DE CACHE, E NÃO ONZE
-- ------------------------------------------------------------
--
-- `bling_references` guarda, por conexão, o que o Bling devolveu: situações,
-- ações e transições do módulo de pedidos de venda, categorias de receita e
-- de produto, formas de pagamento, vendedores, depósitos, tipos de contato e
-- logísticas. É CACHE: a sincronização reescreve, e nada do CRM é dono dessas
-- linhas. Onde o CRM tem entidade própria (produto, contato, transportadora),
-- o vínculo é coluna tipada na tabela dele, não aqui (§2 do plano).
--
-- `active` é o que o Bling diz (inativa, desabilitada). `removed_at` é o que
-- a última sincronização completa daquele tipo NÃO trouxe mais: a linha fica,
-- para a tela conseguir dizer "a categoria X não existe mais no Bling" em vez
-- de simplesmente esquecê-la.
--
-- Leitura para qualquer membro da conta: a gaveta do pedido vai listar formas
-- de pagamento para quem vende. Escrita só pelo service role (a sincronização).
--
-- ------------------------------------------------------------
-- QUAL SITUAÇÃO É "EM ANDAMENTO" É DECISÃO DE UM ADMIN
-- ------------------------------------------------------------
--
-- `bling_settings` liga cada papel que o CRM conhece (as cinco situações, o
-- módulo de pedidos, a categoria raiz "Venda direta", as formas liberadas) a
-- um ID do Bling. A tela sugere pelo nome e o admin confirma — o mesmo gesto
-- que a D7 escolheu para as famílias. Procurar pelo nome na hora de salvar um
-- pedido é o que a especificação proíbe.
--
-- `company_id` diz para qual empresa do Bling esses IDs valem. Se a conta
-- reconectar outra empresa, os papéis voltam a "confirmar", em vez de apontar
-- para IDs que lá significam outra coisa.
--
-- ------------------------------------------------------------
-- UMA SINCRONIZAÇÃO POR VEZ
-- ------------------------------------------------------------
--
-- `bling_sync_jobs` guarda o estado de cada trabalho longo por conexão
-- (`references` agora, `products` na próxima migração), e
-- `bling_claim_sync()` entrega a vez a um só: o botão "Atualizar agora" e o
-- cron chegando juntos não dobram as chamadas ao Bling. Uma vez que ficou
-- presa por 15 minutos — o processo morreu no meio — pode ser retomada.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O cache
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_references (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES bling_connections(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'order_module',
                    'order_status',
                    'order_action',
                    'order_transition',
                    'revenue_category',
                    'product_category',
                    'payment_method',
                    'seller',
                    'warehouse',
                    'contact_type',
                    'logistics'
                  )),
  -- Os IDs do Bling são inteiros na API, mas o id da empresa é hexadecimal:
  -- TEXT para todos, e ninguém faz conta com eles.
  bling_id        TEXT NOT NULL,
  parent_bling_id TEXT,
  label           TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  payload         JSONB NOT NULL DEFAULT '{}',
  seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, kind, bling_id)
);

CREATE INDEX IF NOT EXISTS idx_bling_references_account_kind
  ON bling_references (account_id, kind);

ALTER TABLE bling_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bling_references_select ON bling_references;
CREATE POLICY bling_references_select ON bling_references FOR SELECT
  USING (is_account_member(account_id));
-- Sem INSERT/UPDATE/DELETE: só a sincronização, pelo service role.

-- ------------------------------------------------------------
-- 2. Os papéis confirmados
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_settings (
  account_id                 UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  company_id                 TEXT NOT NULL,

  order_module_id            TEXT,
  status_open_id             TEXT,
  status_in_progress_id      TEXT,
  status_fulfilled_id        TEXT,
  status_canceled_id         TEXT,
  status_future_purchase_id  TEXT,
  revenue_root_category_id   TEXT,
  payment_method_ids         TEXT[] NOT NULL DEFAULT '{}',

  updated_by                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bling_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bling_settings_select ON bling_settings;
CREATE POLICY bling_settings_select ON bling_settings FOR SELECT
  USING (is_account_member(account_id));
-- Escrita pela rota de admin, com auditoria (`bling.mapping_updated`).

-- ------------------------------------------------------------
-- 3. O estado dos trabalhos longos
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_sync_jobs (
  connection_id    UUID NOT NULL REFERENCES bling_connections(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job              TEXT NOT NULL CHECK (job IN ('references', 'products')),
  status           TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'error')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  last_success_at  TIMESTAMPTZ,
  error            TEXT,
  stats            JSONB NOT NULL DEFAULT '{}',

  PRIMARY KEY (connection_id, job)
);

ALTER TABLE bling_sync_jobs ENABLE ROW LEVEL SECURITY;
-- Nenhuma política: o estado sai pela rota de admin.

CREATE OR REPLACE FUNCTION public.bling_claim_sync(p_connection_id UUID, p_job TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_vez     BOOLEAN;
BEGIN
  SELECT account_id INTO v_account
    FROM bling_connections
   WHERE id = p_connection_id
     AND status <> 'revoked';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO bling_sync_jobs (connection_id, account_id, job, status, started_at)
  VALUES (p_connection_id, v_account, p_job, 'running', clock_timestamp())
  ON CONFLICT (connection_id, job) DO UPDATE
     SET status      = 'running',
         started_at  = clock_timestamp(),
         finished_at = NULL,
         error       = NULL
   WHERE bling_sync_jobs.status <> 'running'
      OR bling_sync_jobs.started_at < clock_timestamp() - INTERVAL '15 minutes'
  RETURNING true INTO v_vez;

  RETURN COALESCE(v_vez, false);
END;
$$;

REVOKE ALL ON FUNCTION public.bling_claim_sync(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_claim_sync(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.bling_claim_sync(UUID, TEXT) IS
  'Entrega a vez de rodar um trabalho longo do Bling (references, products) a '
  'um só chamador por conexão (083). Uma vez presa há 15 minutos pode ser retomada.';
