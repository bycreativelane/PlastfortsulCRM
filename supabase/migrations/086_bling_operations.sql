-- ============================================================
-- 086_bling_operations
--
-- Fase 4 de `docs/spec-orcamentos-bling.md`: criar e atualizar o pedido no
-- Bling, sem worker e sem duplicar.
--
-- ------------------------------------------------------------
-- A FILA
-- ------------------------------------------------------------
--
-- Toda escrita no Bling é uma linha de `bling_operations` antes de ser uma
-- chamada. A rota enfileira (e marca a oportunidade como "sincronizando" na
-- MESMA transação, `bling_enqueue_operation`), dispara o processamento com
-- `after()` para ser imediato, e o cron de minuto drena o que sobrar e
-- retenta com lease (`bling_claim_operations`). Nada depende de processo em
-- memória (D10).
--
-- `idempotency_key` é única por conta. Criar pedido tem uma chave por
-- oportunidade, para sempre: clique duplo, repetição depois de timeout e o
-- cron chegando junto caem na mesma linha. Atualizar leva o resumo do
-- payload na chave — o mesmo pedido mandado duas vezes é uma operação só.
--
-- `uncertain` é o estado de quem não sabe se o Bling gravou (timeout, 5xx,
-- conexão caída depois do POST). A próxima tentativa CONSULTA antes de
-- escrever — `GET /pedidos/vendas?numerosLojas[]=` — e só então decide.
--
-- Por oportunidade, as operações andam em fila: uma não é pega enquanto
-- houver outra mais velha da mesma oportunidade por terminar. Um PUT não
-- pode passar na frente do POST que cria o pedido que ele atualiza.
--
-- ------------------------------------------------------------
-- A CHAVE GERAL
-- ------------------------------------------------------------
--
-- `bling_settings.orders_enabled` (Fase 7, item 1), desligada por padrão.
-- Sem ela nenhuma rota escreve no Bling: referências e produtos continuam
-- sincronizando, e o envio de orçamento segue como antes.
--
-- ------------------------------------------------------------
-- E O QUE A 085 DEIXOU
-- ------------------------------------------------------------
--
-- `deal_quotes` passa a guardar validade e prazo de entrega, que o documento
-- imprime desde a 085.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A chave geral
-- ------------------------------------------------------------

ALTER TABLE bling_settings
  ADD COLUMN IF NOT EXISTS orders_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- 2. A fila
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_operations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- SET NULL: o histórico da operação sobrevive à oportunidade (que, sendo
  -- pedido, o navegador nem consegue apagar — 085).
  deal_id          UUID REFERENCES deals(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN (
                     'upsert_contact',
                     'create_order',
                     'update_order',
                     'change_status',
                     'launch_accounts',
                     'reverse_accounts',
                     'launch_stock',
                     'reverse_stock'
                   )),
  idempotency_key  TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  payload_hash     TEXT,
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                     'queued', 'running', 'succeeded', 'failed', 'uncertain'
                   )),
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until     TIMESTAMPTZ,
  lock_token       UUID,
  -- O que a operação precisa além da oportunidade: a situação de destino
  -- de uma mudança, por exemplo. Nunca dado pessoal.
  params           JSONB NOT NULL DEFAULT '{}',
  -- Já sanitizado (`sanitizeBlingText`): vai para a tela.
  error            TEXT CHECK (error IS NULL OR length(error) <= 600),
  result           JSONB,
  correlation_id   UUID NOT NULL DEFAULT uuid_generate_v4(),
  requested_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bling_operations_key
  ON bling_operations (account_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_bling_operations_due
  ON bling_operations (next_attempt_at)
  WHERE status IN ('queued', 'uncertain', 'running');
CREATE INDEX IF NOT EXISTS idx_bling_operations_deal
  ON bling_operations (deal_id, created_at);

ALTER TABLE bling_operations ENABLE ROW LEVEL SECURITY;
-- Nenhuma política: a fila é do servidor. A tela lê o estado em
-- `deals.sync_status` e pelas rotas.

-- ------------------------------------------------------------
-- 3. Enfileirar, na mesma transação que marca a oportunidade
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bling_enqueue_operation(
  p_account_id   UUID,
  p_deal_id      UUID,
  p_kind         TEXT,
  p_key          TEXT,
  p_payload_hash TEXT,
  p_params       JSONB,
  p_requested_by UUID
)
RETURNS TABLE (operation_id UUID, operation_status TEXT, created BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_status TEXT;
BEGIN
  -- A linha da oportunidade serializa quem enfileira para ela: dois cliques
  -- simultâneos esperam um pelo outro aqui, e o segundo acha a chave.
  IF p_deal_id IS NOT NULL THEN
    PERFORM 1 FROM deals WHERE id = p_deal_id AND account_id = p_account_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bling_enqueue_operation: oportunidade % não é desta conta', p_deal_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO bling_operations (account_id, deal_id, kind, idempotency_key, payload_hash, params, requested_by)
  VALUES (p_account_id, p_deal_id, p_kind, p_key, p_payload_hash, COALESCE(p_params, '{}'::jsonb), p_requested_by)
  ON CONFLICT (account_id, idempotency_key) DO NOTHING
  RETURNING id, status INTO v_id, v_status;

  IF v_id IS NULL THEN
    SELECT o.id, o.status INTO v_id, v_status
      FROM bling_operations o
     WHERE o.account_id = p_account_id AND o.idempotency_key = p_key
     FOR UPDATE;

    -- Uma operação que falhou de vez (dado recusado pelo Bling) volta para a
    -- fila quando alguém pede de novo — depois de corrigir o que faltava. A
    -- chave continua a mesma: criar pedido nunca ganha uma segunda linha, e
    -- a tentativa nova consulta por `numeroLoja` antes de escrever.
    IF v_status = 'failed' THEN
      UPDATE bling_operations
         SET status = 'queued', attempts = 0, next_attempt_at = NOW(), error = NULL,
             lock_token = NULL, locked_until = NULL, finished_at = NULL,
             payload_hash = COALESCE(p_payload_hash, payload_hash),
             requested_by = COALESCE(p_requested_by, requested_by), updated_at = NOW()
       WHERE id = v_id;
      v_status := 'queued';
      IF p_deal_id IS NOT NULL THEN
        UPDATE deals SET sync_status = 'syncing', sync_error = NULL WHERE id = p_deal_id;
      END IF;
    END IF;

    RETURN QUERY SELECT v_id, v_status, FALSE;
    RETURN;
  END IF;

  IF p_deal_id IS NOT NULL THEN
    UPDATE deals SET sync_status = 'syncing', sync_error = NULL WHERE id = p_deal_id;
  END IF;

  RETURN QUERY SELECT v_id, v_status, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_enqueue_operation(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_enqueue_operation(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID) TO service_role;

-- ------------------------------------------------------------
-- 4. Pegar operações para processar, com lease
-- ------------------------------------------------------------
--
-- `p_operation_id` pega uma específica (o `after()` da rota); sem ele, as
-- vencidas da conta — ou de todas, com `p_account_id` nulo (o cron).
-- Um `running` cujo lease venceu é de um processo que morreu no meio: volta
-- a ser pego, e a tentativa nova começa consultando.

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
            AND a.created_at < o.created_at
            AND a.status IN ('queued', 'running', 'uncertain')
       )
     ORDER BY o.next_attempt_at, o.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 20))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE bling_operations b
     SET status = 'running',
         lock_token = uuid_generate_v4(),
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
-- 5. O orçamento arquivado guarda validade e prazo (085)
-- ------------------------------------------------------------

ALTER TABLE deal_quotes
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS delivery_days INTEGER CHECK (delivery_days IS NULL OR delivery_days BETWEEN 0 AND 3650);
