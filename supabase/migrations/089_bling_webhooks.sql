-- ============================================================
-- 089_bling_webhooks
--
-- Fase 6 de `docs/spec-orcamentos-bling.md`: o Bling avisando o CRM.
--
-- ------------------------------------------------------------
-- bling_webhook_events
-- ------------------------------------------------------------
--
-- A rota grava o evento ANTES de responder 2xx (o Bling desabilita o
-- webhook depois de três dias de falha, e considera falha o que passa de
-- cinco segundos), e processa depois. `event_id` é único: o mesmo evento
-- entregue duas vezes é uma linha só, e as duas entregas recebem 2xx.
--
-- LGPD: não guarda o corpo inteiro. Um pedido traz nome e documento do
-- cliente; aqui ficam só os ids e números que o processamento usa
-- (`summary`). O pedido é sempre RELIDO por id — a entrega é fora de ordem.
--
-- Pega com lease, como a fila de operações: o `after()` da rota e o cron não
-- processam o mesmo evento.
--
-- ------------------------------------------------------------
-- Saúde e reconciliação
-- ------------------------------------------------------------
--
-- `bling_connections` ganha o último webhook recebido e o cursor da
-- reconciliação (~15 min, `dataAlteracaoInicial` menos uma sobreposição).
-- A reconciliação que acha mudança que o webhook não trouxe carimba
-- `reconcile_found_at`: com webhook calado há horas, é o alerta de webhook
-- desabilitado.
--
-- ------------------------------------------------------------
-- Retenção
-- ------------------------------------------------------------
--
-- `bling_purge` apaga eventos processados e operações terminadas antigos.
-- `bling_maintenance` guarda quando cada rotina rodou — o cron chama a
-- retenção de fato, uma vez por dia (o "com o agendamento chamado de fato"
-- da especificação).
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Os eventos
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_webhook_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  account_id     UUID REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id  UUID REFERENCES bling_connections(id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL,
  event          TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 80),
  resource_id    TEXT,
  occurred_at    TIMESTAMPTZ,
  -- Só ids e números: nunca nome, documento, endereço ou telefone.
  summary        JSONB NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                   'pending', 'processing', 'processed', 'ignored', 'failed'
                 )),
  attempts       INTEGER NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  error          TEXT CHECK (error IS NULL OR length(error) <= 600),
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bling_webhook_events_event
  ON bling_webhook_events (event_id);
CREATE INDEX IF NOT EXISTS idx_bling_webhook_events_pending
  ON bling_webhook_events (received_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE bling_webhook_events ENABLE ROW LEVEL SECURITY;
-- Nenhuma política: só o servidor.

CREATE OR REPLACE FUNCTION public.bling_claim_webhook_events(
  p_event_id      UUID,
  p_limit         INTEGER,
  p_lease_seconds INTEGER
)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidatos AS (
    SELECT e.id
      FROM bling_webhook_events e
     WHERE (p_event_id IS NULL OR e.id = p_event_id)
       AND (
         e.status = 'pending'
         OR (e.status = 'processing' AND e.locked_until < NOW())
       )
       AND e.attempts < 10
     ORDER BY e.received_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE bling_webhook_events w
     SET status = 'processing',
         attempts = w.attempts + 1,
         locked_until = NOW() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 900)))
    FROM candidatos c
   WHERE w.id = c.id
  RETURNING w.id;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_claim_webhook_events(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_claim_webhook_events(UUID, INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 2. Saúde e cursor da reconciliação
-- ------------------------------------------------------------

ALTER TABLE bling_connections
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS orders_cursor TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reconcile_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconcile_found_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 3. Retenção
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_maintenance (
  task         TEXT PRIMARY KEY CHECK (task IN ('retention')),
  last_run_at  TIMESTAMPTZ,
  last_result  JSONB NOT NULL DEFAULT '{}'
);

ALTER TABLE bling_maintenance ENABLE ROW LEVEL SECURITY;
-- Nenhuma política: só o servidor.

CREATE OR REPLACE FUNCTION public.bling_purge(
  p_event_days     INTEGER,
  p_operation_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_eventos INTEGER;
  v_operacoes INTEGER;
BEGIN
  DELETE FROM bling_webhook_events
   WHERE status IN ('processed', 'ignored', 'failed')
     AND received_at < NOW() - make_interval(days => GREATEST(1, COALESCE(p_event_days, 30)));
  GET DIAGNOSTICS v_eventos = ROW_COUNT;

  -- Operações que terminaram. As que ainda podem andar (queued, running,
  -- uncertain) nunca saem, por mais velhas que sejam.
  DELETE FROM bling_operations
   WHERE status IN ('succeeded', 'failed')
     AND COALESCE(finished_at, updated_at) < NOW() - make_interval(days => GREATEST(7, COALESCE(p_operation_days, 180)));
  GET DIAGNOSTICS v_operacoes = ROW_COUNT;

  INSERT INTO bling_maintenance (task, last_run_at, last_result)
  VALUES ('retention', NOW(), jsonb_build_object('events', v_eventos, 'operations', v_operacoes))
  ON CONFLICT (task) DO UPDATE
    SET last_run_at = EXCLUDED.last_run_at, last_result = EXCLUDED.last_result;

  RETURN jsonb_build_object('events', v_eventos, 'operations', v_operacoes);
END;
$$;

REVOKE ALL ON FUNCTION public.bling_purge(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_purge(INTEGER, INTEGER) TO service_role;
