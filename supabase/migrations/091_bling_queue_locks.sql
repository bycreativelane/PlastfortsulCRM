-- ============================================================
-- 091_bling_queue_locks
--
-- A revisão das correções da 090 achou três coisas que só o banco resolve.
-- Nenhuma migração anterior é editada: esta substitui as funções.
--
-- ------------------------------------------------------------
-- 1. A mesma ordem de travas em todo lugar
-- ------------------------------------------------------------
--
-- `bling_enqueue_operation` trava a oportunidade e depois a operação.
-- `bling_finish_operation` (090) atualizava a operação e depois a
-- oportunidade — a ordem oposta. Dois pedidos da mesma operação ao mesmo
-- tempo (um reenfileiramento enquanto ela termina) podiam se travar um no
-- outro, e o Postgres abortava um dos dois (40P01): o término perdia o
-- histórico, ou a rota respondia "não foi possível pôr na fila".
--
-- Terminar, e a limpeza das abandonadas no claim, passam a travar a
-- oportunidade primeiro.
--
-- ------------------------------------------------------------
-- 2. Webhook com erro passageiro espera antes de voltar
-- ------------------------------------------------------------
--
-- Desde a 090 o processamento pega um evento por vez. Um evento que falha de
-- passagem voltava a pendente e era pego de novo na volta seguinte: as dez
-- tentativas iam em segundos, e vinte segundos de Bling fora do ar
-- abandonavam o evento. O processamento agora devolve o evento com
-- `locked_until` no futuro (a espera), e o claim só pega pendente vencido.
--
-- ------------------------------------------------------------
-- 3. Apagar uma oportunidade cuja sincronização falhou antes de enviar
-- ------------------------------------------------------------
--
-- A 090 recusava apagar também por `sync_status`, e toda sincronização marca
-- 'syncing' ao enfileirar e 'error' ao falhar — mesmo que nada tenha chegado
-- ao Bling (cliente sem documento, pedido que não fecha). Fica o que diz que
-- o pedido existe ou pode existir: o vínculo, a situação e a chave (gravada
-- agora só logo antes do POST, e tirada quando o Bling recusa de vez).
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1a. Terminar: oportunidade, depois operação
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bling_finish_operation(
  p_operation_id  UUID,
  p_lock_token    UUID,
  p_status        TEXT,
  p_error         TEXT,
  p_result        JSONB,
  p_retry_seconds INTEGER,
  p_deal_patch    JSONB,
  p_events        JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c_colunas CONSTANT TEXT[] := ARRAY[
    'order_status', 'bling_order_id', 'bling_external_key', 'bling_order_number',
    'bling_source_hash', 'sync_status', 'sync_error', 'sync_version',
    'last_synced_at', 'accounts_launched_at', 'stock_launched_at',
    'stage_id', 'status', 'lost_reason'
  ];
  v_patch JSONB := COALESCE(p_deal_patch, '{}'::jsonb);
  v_chave TEXT;
  v_account UUID;
  v_deal UUID;
  v_autor UUID;
  v_trava UUID;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('succeeded', 'failed', 'queued', 'uncertain') THEN
    RAISE EXCEPTION 'bling_finish_operation: status % inválido', p_status
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_patch) <> 'object' THEN
    RAISE EXCEPTION 'bling_finish_operation: p_deal_patch precisa ser um objeto'
      USING ERRCODE = '22023';
  END IF;
  FOR v_chave IN SELECT jsonb_object_keys(v_patch) LOOP
    IF NOT (v_chave = ANY (c_colunas)) THEN
      RAISE EXCEPTION 'bling_finish_operation: a fila não escreve a coluna %', v_chave
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- A oportunidade primeiro: a mesma ordem de `bling_enqueue_operation`.
  SELECT o.deal_id INTO v_trava FROM bling_operations o WHERE o.id = p_operation_id;
  IF v_trava IS NOT NULL THEN
    PERFORM 1 FROM deals d WHERE d.id = v_trava FOR UPDATE;
  END IF;

  UPDATE bling_operations o
     SET status = p_status,
         error = CASE WHEN p_status = 'succeeded' THEN NULL ELSE left(p_error, 600) END,
         result = CASE
                    WHEN p_status = 'succeeded' THEN p_result
                    WHEN p_status = 'failed' THEN NULL
                    ELSE o.result
                  END,
         next_attempt_at = CASE
                             WHEN p_status IN ('queued', 'uncertain')
                               THEN NOW() + make_interval(secs => GREATEST(0, LEAST(COALESCE(p_retry_seconds, 30), 86400)))
                             ELSE o.next_attempt_at
                           END,
         finished_at = CASE WHEN p_status IN ('succeeded', 'failed') THEN NOW() ELSE NULL END,
         lock_token = NULL,
         locked_until = NULL,
         updated_at = NOW()
   WHERE o.id = p_operation_id
     AND o.lock_token = p_lock_token
     AND o.status = 'running'
  RETURNING o.account_id, o.deal_id, o.requested_by INTO v_account, v_deal, v_autor;

  -- Perdeu o lease: outro processo é o dono, e nada daqui vale.
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_deal IS NOT NULL AND v_patch <> '{}'::jsonb THEN
    UPDATE deals d SET
      order_status = CASE WHEN v_patch ? 'order_status' THEN v_patch->>'order_status' ELSE d.order_status END,
      bling_order_id = CASE WHEN v_patch ? 'bling_order_id' THEN v_patch->>'bling_order_id' ELSE d.bling_order_id END,
      bling_external_key = CASE WHEN v_patch ? 'bling_external_key' THEN v_patch->>'bling_external_key' ELSE d.bling_external_key END,
      bling_order_number = CASE WHEN v_patch ? 'bling_order_number' THEN v_patch->>'bling_order_number' ELSE d.bling_order_number END,
      bling_source_hash = CASE WHEN v_patch ? 'bling_source_hash' THEN v_patch->>'bling_source_hash' ELSE d.bling_source_hash END,
      sync_status = CASE WHEN v_patch ? 'sync_status' THEN v_patch->>'sync_status' ELSE d.sync_status END,
      sync_error = CASE WHEN v_patch ? 'sync_error' THEN v_patch->>'sync_error' ELSE d.sync_error END,
      sync_version = CASE WHEN v_patch ? 'sync_version' THEN d.sync_version + 1 ELSE d.sync_version END,
      last_synced_at = CASE WHEN v_patch ? 'last_synced_at' THEN (v_patch->>'last_synced_at')::timestamptz ELSE d.last_synced_at END,
      accounts_launched_at = CASE WHEN v_patch ? 'accounts_launched_at' THEN (v_patch->>'accounts_launched_at')::timestamptz ELSE d.accounts_launched_at END,
      stock_launched_at = CASE WHEN v_patch ? 'stock_launched_at' THEN (v_patch->>'stock_launched_at')::timestamptz ELSE d.stock_launched_at END,
      stage_id = CASE WHEN v_patch ? 'stage_id' THEN (v_patch->>'stage_id')::uuid ELSE d.stage_id END,
      status = CASE WHEN v_patch ? 'status' THEN v_patch->>'status' ELSE d.status END,
      lost_reason = CASE WHEN v_patch ? 'lost_reason' THEN v_patch->>'lost_reason' ELSE d.lost_reason END
    WHERE d.id = v_deal
      AND d.account_id = v_account;
  END IF;

  IF v_deal IS NOT NULL AND jsonb_typeof(p_events) = 'array' AND jsonb_array_length(p_events) > 0 THEN
    INSERT INTO deal_order_events (account_id, deal_id, kind, from_status, to_status, source, operation_id, actor_id, detail)
    SELECT v_account,
           v_deal,
           e->>'kind',
           e->>'from_status',
           e->>'to_status',
           'crm',
           p_operation_id,
           v_autor,
           CASE WHEN jsonb_typeof(e->'detail') = 'object' THEN e->'detail' ELSE '{}'::jsonb END
      FROM jsonb_array_elements(p_events) AS e;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_finish_operation(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_finish_operation(UUID, UUID, TEXT, TEXT, JSONB, INTEGER, JSONB, JSONB) TO service_role;

-- ------------------------------------------------------------
-- 1b. Pegar: as abandonadas travam a oportunidade primeiro
-- ------------------------------------------------------------

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
#variable_conflict use_column
BEGIN
  -- As oportunidades das abandonadas, travadas antes das operações (a ordem
  -- de enfileirar e de terminar).
  PERFORM 1
     FROM deals d
    WHERE d.id IN (
      SELECT o.deal_id FROM bling_operations o
       WHERE o.status = 'running'
         AND o.locked_until < NOW()
         AND o.attempts >= o.max_attempts
         AND o.deal_id IS NOT NULL
         AND (p_account_id IS NULL OR o.account_id = p_account_id)
    )
    ORDER BY d.id
    FOR UPDATE;

  -- Abandonadas: o processo morreu na última tentativa. A oportunidade só
  -- deixa de "sincronizar" quando não há outra operação dela na fila.
  WITH abandonadas AS (
    UPDATE bling_operations o
       SET status = 'failed', error = 'abandoned', finished_at = NOW(),
           lock_token = NULL, locked_until = NULL, updated_at = NOW()
     WHERE o.status = 'running'
       AND o.locked_until < NOW()
       AND o.attempts >= o.max_attempts
       AND (p_account_id IS NULL OR o.account_id = p_account_id)
    RETURNING o.id AS op_id, o.deal_id AS op_deal, o.account_id AS op_account
  )
  UPDATE deals d
     SET sync_status = 'error', sync_error = 'abandoned'
    FROM abandonadas ab
   WHERE d.id = ab.op_deal
     AND d.account_id = ab.op_account
     AND d.sync_status = 'syncing'
     AND NOT EXISTS (
       SELECT 1 FROM bling_operations x
        WHERE x.deal_id = d.id
          AND x.id NOT IN (SELECT ab2.op_id FROM abandonadas ab2)
          AND x.status IN ('queued', 'running', 'uncertain')
     );

  RETURN QUERY
  WITH candidatas AS (
    SELECT o.id AS cand_id
      FROM bling_operations o
     WHERE (p_account_id IS NULL OR o.account_id = p_account_id)
       AND (p_operation_id IS NULL OR o.id = p_operation_id)
       AND (
         (o.status IN ('queued', 'uncertain') AND o.next_attempt_at <= NOW())
         OR (o.status = 'running' AND o.locked_until < NOW() AND o.attempts < o.max_attempts)
       )
       AND NOT EXISTS (
         SELECT 1 FROM bling_operations a
          WHERE a.deal_id = o.deal_id
            AND a.id <> o.id
            AND (
              ((a.created_at, a.seq) < (o.created_at, o.seq) AND a.status IN ('queued', 'running', 'uncertain'))
              OR (a.status = 'running' AND a.locked_until >= NOW())
            )
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
   WHERE b.id = c.cand_id
  RETURNING b.id, b.lock_token, b.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_claim_operations(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_claim_operations(UUID, UUID, INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 2. Webhooks: pendente só depois da espera
-- ------------------------------------------------------------
--
-- Mesma assinatura e mesmo retorno da 090: CREATE OR REPLACE mantém o ACL,
-- e o REVOKE/GRANT abaixo o repete por clareza.

CREATE OR REPLACE FUNCTION public.bling_claim_webhook_events(
  p_event_id      UUID,
  p_limit         INTEGER,
  p_lease_seconds INTEGER
)
RETURNS TABLE (id UUID, lock_token UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- Dez tentativas e ainda pendente (ou preso processando): desiste, e a
  -- retenção limpa depois.
  UPDATE bling_webhook_events e
     SET status = 'failed', error = 'abandoned', locked_until = NULL, lock_token = NULL, processed_at = NOW()
   WHERE e.attempts >= 10
     AND (e.status = 'pending' OR (e.status = 'processing' AND e.locked_until < NOW()));

  RETURN QUERY
  WITH candidatos AS (
    SELECT e.id AS cand_id
      FROM bling_webhook_events e
     WHERE (p_event_id IS NULL OR e.id = p_event_id)
       AND (
         -- Pendente com espera (um erro passageiro) só depois dela.
         (e.status = 'pending' AND (e.locked_until IS NULL OR e.locked_until <= NOW()))
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
         lock_token = gen_random_uuid(),
         locked_until = NOW() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 900)))
    FROM candidatos c
   WHERE w.id = c.cand_id
  RETURNING w.id, w.lock_token;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_claim_webhook_events(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_claim_webhook_events(UUID, INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 3. Apagar: o vínculo, a situação ou a chave — não o estado de sincronização
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_deal_order_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c_servidor CONSTANT TEXT[] := ARRAY[
    'order_status', 'bling_order_id', 'bling_external_key', 'bling_order_number',
    'bling_source_hash', 'sync_status', 'sync_version', 'sync_error', 'last_synced_at',
    'accounts_launched_at', 'stock_launched_at'
  ];
  -- O que é só do CRM: nunca vai ao Bling, e muda em qualquer situação.
  c_do_crm CONSTANT TEXT[] := ARRAY[
    'title', 'notes', 'internal_notes', 'assigned_to', 'pipeline_id', 'stage_id',
    'stage_entered_at', 'expected_close_date', 'status', 'lost_reason',
    'lost_note', 'updated_at'
  ];
  -- Dados da produção, livres também em Em andamento.
  c_da_producao CONSTANT TEXT[] := ARRAY[
    'departure_date', 'expected_date', 'delivery_days', 'freight_volumes',
    'gross_weight', 'freight_volumes_confirmed'
  ];
  v_trava TEXT;
  v_livres TEXT[];
BEGIN
  IF current_user <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- O pedido existe no Bling, ou pode existir: o vínculo, a situação, ou a
  -- chave (gravada logo antes do POST, e tirada quando o Bling recusa de vez).
  IF TG_OP = 'DELETE' THEN
    IF OLD.bling_order_id IS NOT NULL
       OR OLD.order_status IS NOT NULL
       OR OLD.bling_external_key IS NOT NULL THEN
      RAISE EXCEPTION 'guard_deal_order_columns: esta oportunidade já é pedido no Bling e não pode ser apagada'
        USING ERRCODE = '42501',
              HINT = 'order_locked';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.order_status IS NOT NULL OR NEW.bling_order_id IS NOT NULL
       OR NEW.bling_external_key IS NOT NULL OR NEW.bling_order_number IS NOT NULL
       OR NEW.bling_source_hash IS NOT NULL
       OR NEW.sync_status IS NOT NULL OR NEW.sync_version <> 0 OR NEW.sync_error IS NOT NULL
       OR NEW.last_synced_at IS NOT NULL OR NEW.accounts_launched_at IS NOT NULL
       OR NEW.stock_launched_at IS NOT NULL THEN
      RAISE EXCEPTION 'guard_deal_order_columns: o estado do pedido no Bling só muda pelo servidor'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - ARRAY(SELECT jsonb_object_keys(to_jsonb(NEW)) EXCEPT SELECT unnest(c_servidor)))
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY(SELECT jsonb_object_keys(to_jsonb(OLD)) EXCEPT SELECT unnest(c_servidor))) THEN
    RAISE EXCEPTION 'guard_deal_order_columns: o estado do pedido no Bling só muda pelo servidor'
      USING ERRCODE = '42501';
  END IF;

  v_trava := deal_order_locked(OLD.order_status, OLD.accounts_launched_at);
  IF v_trava = 'open' THEN
    RETURN NEW;
  END IF;

  v_livres := c_do_crm || c_servidor || CASE WHEN v_trava = 'in_progress' THEN c_da_producao ELSE ARRAY[]::TEXT[] END;
  IF (to_jsonb(NEW) - v_livres) IS DISTINCT FROM (to_jsonb(OLD) - v_livres) THEN
    RAISE EXCEPTION 'guard_deal_order_columns: pedido %: estes campos estão travados nesta situação',
      COALESCE(OLD.order_status, 'com contas lançadas')
      USING ERRCODE = '42501',
            HINT = 'order_locked';
  END IF;
  RETURN NEW;
END;
$$;
