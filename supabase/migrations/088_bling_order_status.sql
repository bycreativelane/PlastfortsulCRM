-- ============================================================
-- 088_bling_order_status
--
-- Fase 5 de `docs/spec-orcamentos-bling.md`: mudar a situação do pedido,
-- lançar e estornar contas e estoque — e o histórico de cada passo.
--
-- ------------------------------------------------------------
-- deal_order_events
-- ------------------------------------------------------------
--
-- Uma linha por coisa que aconteceu com o pedido: criado, atualizado,
-- situação pedida, situação mudada, contas lançadas ou estornadas, estoque
-- lançado ou estornado, divergência, recusa do Bling. Com a ORIGEM — o CRM,
-- o webhook do Bling ou a reconciliação — porque "quem mudou isto?" é a
-- primeira pergunta quando o financeiro acha um lançamento que não esperava.
--
-- Leitura para membros (a gaveta mostra o histórico); escrita só do
-- servidor.
--
-- ------------------------------------------------------------
-- A fila, desempatada
-- ------------------------------------------------------------
--
-- A 086 punha em fila por oportunidade comparando `created_at`. Duas
-- operações criadas na MESMA transação têm o mesmo `created_at` (NOW() é o
-- início da transação), e as duas eram pegas juntas — medido no banco de
-- teste ao conferir a 086. Uma sequência desempata.
--
-- ------------------------------------------------------------
-- O aviso
-- ------------------------------------------------------------
--
-- `notifications.type` ganha `bling_order`, com `deal_id`: a mudança feita
-- à mão no Bling, a divergência e a recusa avisam o responsável.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O histórico do pedido
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deal_order_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'order_created',
                  'order_updated',
                  'status_requested',
                  'status_changed',
                  'accounts_launched',
                  'accounts_reversed',
                  'stock_launched',
                  'stock_reversed',
                  'divergence',
                  'refused'
                )),
  from_status   TEXT,
  to_status     TEXT,
  source        TEXT NOT NULL CHECK (source IN ('crm', 'bling', 'reconcile')),
  operation_id  UUID REFERENCES bling_operations(id) ON DELETE SET NULL,
  actor_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Nomes de campo e ids do Bling; nunca documento, endereço ou telefone.
  detail        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_order_events_deal
  ON deal_order_events (deal_id, created_at DESC);

ALTER TABLE deal_order_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_order_events_select ON deal_order_events;
CREATE POLICY deal_order_events_select ON deal_order_events FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- 2. A fila, desempatada
-- ------------------------------------------------------------

ALTER TABLE bling_operations
  ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY;

CREATE OR REPLACE FUNCTION public.bling_claim_operations(
  p_account_id    UUID,
  p_operation_id  UUID,
  p_limit         INTEGER,
  p_lease_seconds INTEGER
)
RETURNS TABLE (id UUID, lock_token UUID, attempts INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidatas AS (
    SELECT o.id
      FROM bling_operations o
     WHERE (p_account_id IS NULL OR o.account_id = p_account_id)
       AND (p_operation_id IS NULL OR o.id = p_operation_id)
       AND (
         (o.status IN ('queued', 'uncertain') AND o.next_attempt_at <= NOW())
         OR (o.status = 'running' AND o.locked_until < NOW())
       )
       AND NOT EXISTS (
         SELECT 1 FROM bling_operations a
          WHERE a.deal_id = o.deal_id
            AND a.id <> o.id
            AND (a.created_at, a.seq) < (o.created_at, o.seq)
            AND a.status IN ('queued', 'running', 'uncertain')
       )
     ORDER BY o.next_attempt_at, o.created_at, o.seq
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 20))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE bling_operations b
     SET status = 'running',
         lock_token = gen_random_uuid(),
         locked_until = NOW() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 900))),
         attempts = b.attempts + 1,
         updated_at = NOW()
    FROM candidatas c
   WHERE b.id = c.id
  RETURNING b.id, b.lock_token, b.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_claim_operations(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_claim_operations(UUID, UUID, INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 3. O aviso ao responsável
-- ------------------------------------------------------------

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'new_message', 'task_due', 'team_mention', 'bling_order'));

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE;

COMMENT ON COLUMN notifications.deal_id IS
  'A oportunidade do pedido que gerou o aviso, para type = bling_order (088).';
