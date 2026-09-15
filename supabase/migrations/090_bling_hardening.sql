-- ============================================================
-- 090_bling_hardening
--
-- O que as três auditorias da 0.11.0 acharam nas migrações 085–089 e que
-- só o banco resolve. Nenhuma migração anterior é editada: esta substitui
-- as funções e acrescenta os gatilhos.
--
-- ------------------------------------------------------------
-- A FILA, sem duas mãos na mesma operação
-- ------------------------------------------------------------
--
-- 1. O lease vencia no meio do trabalho. O cron pegava até dez operações
--    com um lease de 180 s e processava uma depois da outra; com o Bling
--    lento, a sétima começava depois do lease, o tique seguinte a pegava
--    de novo e dois processos criavam o mesmo pedido. Agora o processo pega
--    uma por vez e renova o lease ANTES de cada escrita no Bling
--    (`bling_touch_operation`, compare-and-set pelo `lock_token`): quem
--    perdeu a vez não escreve.
--
-- 2. O término era três escritas soltas — a operação, o histórico e a
--    oportunidade —, e a operação ficava "concluída" antes de a oportunidade
--    receber o vínculo ou o carimbo. Um reinício no meio perdia o carimbo, e
--    o pedido repetido caía na operação concluída sem fazer nada.
--    `bling_finish_operation` faz as três numa transação, com o mesmo
--    compare-and-set.
--
-- 3. Uma operação que falhou e voltou para a fila mantinha `created_at` e
--    `seq` de quando nasceu, e passava na frente das mais novas da mesma
--    oportunidade. Volta para o fim. E nenhuma operação é pega enquanto
--    outra da mesma oportunidade roda com lease vivo.
--
-- 4. Operação `running` com o lease vencido e as tentativas esgotadas é de
--    um processo que morreu na última tentativa: vira `failed`
--    ('abandoned'), em vez de ficar "sincronizando" para sempre.
--
-- 5. Os webhooks ganham o mesmo dono de lease (`lock_token`).
--
-- ------------------------------------------------------------
-- O PEDIDO QUE FOI AO BLING
-- ------------------------------------------------------------
--
-- `deals.bling_source_hash` é o resumo do pedido gravado que o Bling
-- recebeu na última criação ou atualização bem-sucedida. Mudar para Em
-- andamento lança contas a partir do que está NO BLING; sem este resumo, uma
-- parcela trocada no CRM e nunca enviada virava conta a receber errada.
--
-- ------------------------------------------------------------
-- AS GUARDAS
-- ------------------------------------------------------------
--
-- 6. Mesma conta: o navegador escolhe `contact_id`, `carrier_id`,
--    `pipeline_id`, `stage_id` e `assigned_to` da oportunidade, e `deal_id`
--    e `product_id` das linhas. A RLS confere a linha, não o que ela aponta.
-- 7. Produto: as colunas que vêm do Bling (vínculo, tipo, família,
--    categoria, "define a categoria", cache da listagem) só pelo servidor, e
--    o peso de produto vinculado também — o Bling é a fonte (D6).
-- 8. Exceção de peso: só admin autoriza, e o autor é quem está logado.
-- 9. Linhas e parcelas: a trava confere a oportunidade de ANTES e a de
--    DEPOIS — mover uma linha de um pedido travado para um aberto mudava o
--    travado.
-- 10. Apagar funil ou contato: a cascata roda como dono da tabela e passava
--     por cima da guarda das oportunidades. A guarda vai para o pai.
-- 11. Apagar oportunidade com a chave do pedido gravada (criação incerta)
--     ou com estado de sincronização também é recusado.
-- 12. Uma empresa do Bling, uma conexão viva: o webhook acha a conta pelo
--     `companyId`.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Renovar o lease antes de escrever
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bling_touch_operation(
  p_operation_id  UUID,
  p_lock_token    UUID,
  p_lease_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE bling_operations o
     SET locked_until = NOW() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 900))),
         updated_at = NOW()
   WHERE o.id = p_operation_id
     AND o.lock_token = p_lock_token
     AND o.status = 'running';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_touch_operation(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_touch_operation(UUID, UUID, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 2. O resumo do pedido que o Bling recebeu
-- ------------------------------------------------------------

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS bling_source_hash TEXT;

COMMENT ON COLUMN deals.bling_source_hash IS
  'Resumo do pedido gravado na última criação/atualização aceita pelo Bling (090). Só o servidor escreve.';

-- ------------------------------------------------------------
-- 3. Terminar numa transação só
-- ------------------------------------------------------------
--
-- `p_status`: 'succeeded' e 'failed' terminam; 'queued' e 'uncertain'
-- repetem depois de `p_retry_seconds`. `p_deal_patch` só aceita as colunas
-- de servidor abaixo — uma chave desconhecida é erro, e não uma coluna
-- esquecida em silêncio. `sync_version` presente pede o INCREMENTO (o valor
-- é ignorado): a leitura de quem montou o patch pode estar velha.

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
-- 4. Enfileirar: o que falhou e volta, volta para o fim
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
#variable_conflict use_column
DECLARE
  v_id UUID;
  v_status TEXT;
BEGIN
  -- A linha da oportunidade serializa quem enfileira para ela (086).
  IF p_deal_id IS NOT NULL THEN
    PERFORM 1 FROM deals d WHERE d.id = p_deal_id AND d.account_id = p_account_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bling_enqueue_operation: oportunidade % não é desta conta', p_deal_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO bling_operations (account_id, deal_id, kind, idempotency_key, payload_hash, params, requested_by)
  VALUES (p_account_id, p_deal_id, p_kind, p_key, p_payload_hash, COALESCE(p_params, '{}'::jsonb), p_requested_by)
  ON CONFLICT (account_id, idempotency_key) DO NOTHING
  RETURNING bling_operations.id, bling_operations.status INTO v_id, v_status;

  IF v_id IS NULL THEN
    SELECT o.id, o.status INTO v_id, v_status
      FROM bling_operations o
     WHERE o.account_id = p_account_id AND o.idempotency_key = p_key
     FOR UPDATE;

    -- Falhou de vez e alguém pediu de novo: volta para a fila, com a mesma
    -- chave, e para o FIM dela — `created_at` e `seq` novos. Com os antigos,
    -- a mudança de situação refeita passava na frente da atualização que
    -- corrigia as parcelas.
    IF v_status = 'failed' THEN
      UPDATE bling_operations o
         SET status = 'queued', attempts = 0, next_attempt_at = NOW(), error = NULL,
             lock_token = NULL, locked_until = NULL, finished_at = NULL,
             created_at = NOW(), seq = DEFAULT,
             payload_hash = COALESCE(p_payload_hash, o.payload_hash),
             params = COALESCE(p_params, o.params),
             requested_by = COALESCE(p_requested_by, o.requested_by), updated_at = NOW()
       WHERE o.id = v_id;
      v_status := 'queued';
      IF p_deal_id IS NOT NULL THEN
        UPDATE deals d SET sync_status = 'syncing', sync_error = NULL WHERE d.id = p_deal_id;
      END IF;
    END IF;

    RETURN QUERY SELECT v_id, v_status, FALSE;
    RETURN;
  END IF;

  IF p_deal_id IS NOT NULL THEN
    UPDATE deals d SET sync_status = 'syncing', sync_error = NULL WHERE d.id = p_deal_id;
  END IF;

  RETURN QUERY SELECT v_id, v_status, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_enqueue_operation(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_enqueue_operation(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID) TO service_role;

-- ------------------------------------------------------------
-- 5. Pegar: uma oportunidade não tem duas operações rodando
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
-- 6. Webhooks com dono de lease
-- ------------------------------------------------------------

ALTER TABLE bling_webhook_events
  ADD COLUMN IF NOT EXISTS lock_token UUID;

-- O retorno muda (agora leva o token): DROP e CREATE. O ACL vai junto com o
-- DROP, e volta logo abaixo.
DROP FUNCTION IF EXISTS public.bling_claim_webhook_events(UUID, INTEGER, INTEGER);

CREATE FUNCTION public.bling_claim_webhook_events(
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
-- 7. A guarda das colunas do pedido, com o resumo e o DELETE completo
-- ------------------------------------------------------------
--
-- A mesma da 085, com duas mudanças: `bling_source_hash` é coluna de
-- servidor, e o DELETE também é recusado quando a chave do pedido já foi
-- gravada (a criação incerta — o pedido pode existir no Bling) ou quando há
-- estado de sincronização.

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

  IF TG_OP = 'DELETE' THEN
    IF OLD.bling_order_id IS NOT NULL
       OR OLD.order_status IS NOT NULL
       OR OLD.bling_external_key IS NOT NULL
       OR COALESCE(OLD.sync_status, 'not_sent') <> 'not_sent' THEN
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

-- ------------------------------------------------------------
-- 8. Linhas e parcelas: a trava de antes e a de depois
-- ------------------------------------------------------------
--
-- A leitura da oportunidade é do próprio usuário, sob RLS: todo membro lê
-- todas as oportunidades da conta, e a guarda de mesma conta (seção 9)
-- garante que a linha só aponta para oportunidade da conta dela.

CREATE OR REPLACE FUNCTION public.guard_deal_children_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_lancado TIMESTAMPTZ;
BEGIN
  IF current_user <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- A de antes: sair de um pedido travado muda o pedido travado.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT d.order_status, d.accounts_launched_at INTO v_status, v_lancado
      FROM deals d WHERE d.id = OLD.deal_id;
    IF deal_order_locked(v_status, v_lancado) <> 'open' THEN
      RAISE EXCEPTION 'guard_deal_children_locked: pedido %: itens e parcelas travados nesta situação',
        COALESCE(v_status, 'com contas lançadas')
        USING ERRCODE = '42501',
              HINT = 'order_locked';
    END IF;
  END IF;

  -- A de depois: entrar num pedido travado também.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT d.order_status, d.accounts_launched_at INTO v_status, v_lancado
      FROM deals d WHERE d.id = NEW.deal_id;
    IF deal_order_locked(v_status, v_lancado) <> 'open' THEN
      RAISE EXCEPTION 'guard_deal_children_locked: pedido %: itens e parcelas travados nesta situação',
        COALESCE(v_status, 'com contas lançadas')
        USING ERRCODE = '42501',
              HINT = 'order_locked';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 9. Mesma conta
-- ------------------------------------------------------------
--
-- SECURITY DEFINER: a pergunta "este contato é da conta desta oportunidade?"
-- não pode depender do que a RLS mostra a quem escreve. Vale para todos os
-- papéis — o servidor também não tem por que ligar contas diferentes — e
-- só confere o que mudou, então linhas antigas não são relidas.

-- Pela forma JSON de NEW e OLD: num INSERT não há OLD para comparar, e a
-- comparação fica igual nas duas operações.
CREATE OR REPLACE FUNCTION public.guard_deal_refs_same_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_novo JSONB := to_jsonb(NEW);
  v_velho JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_conta UUID := NEW.account_id;
  v_conta_mudou BOOLEAN := TG_OP = 'INSERT' OR (v_novo->>'account_id') IS DISTINCT FROM (v_velho->>'account_id');
BEGIN
  IF NEW.contact_id IS NOT NULL
     AND (v_conta_mudou OR (v_novo->>'contact_id') IS DISTINCT FROM (v_velho->>'contact_id'))
     AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.account_id = v_conta) THEN
    RAISE EXCEPTION 'guard_deal_refs_same_account: o contato não é desta conta'
      USING ERRCODE = '42501', HINT = 'foreign_reference';
  END IF;

  IF NEW.carrier_id IS NOT NULL
     AND (v_conta_mudou OR (v_novo->>'carrier_id') IS DISTINCT FROM (v_velho->>'carrier_id'))
     AND NOT EXISTS (SELECT 1 FROM carriers c WHERE c.id = NEW.carrier_id AND c.account_id = v_conta) THEN
    RAISE EXCEPTION 'guard_deal_refs_same_account: a transportadora não é desta conta'
      USING ERRCODE = '42501', HINT = 'foreign_reference';
  END IF;

  IF NEW.pipeline_id IS NOT NULL
     AND (v_conta_mudou OR (v_novo->>'pipeline_id') IS DISTINCT FROM (v_velho->>'pipeline_id'))
     AND NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.id = NEW.pipeline_id AND p.account_id = v_conta) THEN
    RAISE EXCEPTION 'guard_deal_refs_same_account: o funil não é desta conta'
      USING ERRCODE = '42501', HINT = 'foreign_reference';
  END IF;

  IF NEW.stage_id IS NOT NULL
     AND (v_conta_mudou OR (v_novo->>'stage_id') IS DISTINCT FROM (v_velho->>'stage_id'))
     AND NOT EXISTS (
       SELECT 1 FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
        WHERE s.id = NEW.stage_id AND p.account_id = v_conta
     ) THEN
    RAISE EXCEPTION 'guard_deal_refs_same_account: a etapa não é desta conta'
      USING ERRCODE = '42501', HINT = 'foreign_reference';
  END IF;

  IF NEW.assigned_to IS NOT NULL
     AND (v_conta_mudou OR (v_novo->>'assigned_to') IS DISTINCT FROM (v_velho->>'assigned_to'))
     AND NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = NEW.assigned_to AND pr.account_id = v_conta) THEN
    RAISE EXCEPTION 'guard_deal_refs_same_account: o responsável não é desta conta'
      USING ERRCODE = '42501', HINT = 'foreign_reference';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_guard_same_account ON deals;
CREATE TRIGGER deals_guard_same_account
  BEFORE INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_refs_same_account();

-- Linhas e parcelas. `product_id` pela forma JSON: a parcela não tem a
-- coluna, e o PL/pgSQL resolveria `NEW.product_id` ao preparar a expressão.
CREATE OR REPLACE FUNCTION public.guard_deal_child_same_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_novo JSONB := to_jsonb(NEW);
  v_velho JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_conta_mudou BOOLEAN := TG_OP = 'INSERT' OR (v_novo->>'account_id') IS DISTINCT FROM (v_velho->>'account_id');
  v_produto UUID := NULLIF(v_novo->>'product_id', '')::uuid;
BEGIN
  IF (v_conta_mudou OR (v_novo->>'deal_id') IS DISTINCT FROM (v_velho->>'deal_id'))
     AND NOT EXISTS (
       SELECT 1 FROM deals d
        WHERE d.id = (v_novo->>'deal_id')::uuid AND d.account_id = (v_novo->>'account_id')::uuid
     ) THEN
    RAISE EXCEPTION 'guard_deal_child_same_account: a oportunidade não é desta conta'
      USING ERRCODE = '42501', HINT = 'foreign_reference';
  END IF;

  IF v_produto IS NOT NULL
     AND (v_conta_mudou OR (v_novo->>'product_id') IS DISTINCT FROM (v_velho->>'product_id'))
     AND NOT EXISTS (
       SELECT 1 FROM products p WHERE p.id = v_produto AND p.account_id = (v_novo->>'account_id')::uuid
     ) THEN
    RAISE EXCEPTION 'guard_deal_child_same_account: o produto não é desta conta'
      USING ERRCODE = '42501', HINT = 'foreign_reference';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deal_items_same_account ON deal_items;
CREATE TRIGGER deal_items_same_account
  BEFORE INSERT OR UPDATE ON deal_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_child_same_account();

DROP TRIGGER IF EXISTS deal_installments_same_account ON deal_installments;
CREATE TRIGGER deal_installments_same_account
  BEFORE INSERT OR UPDATE ON deal_installments
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_child_same_account();

-- ------------------------------------------------------------
-- 10. Exceção de peso: só admin, e o autor é quem está logado
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_deal_weight_exception()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.weight_exception_note IS NOT DISTINCT FROM OLD.weight_exception_note THEN
      -- O autor não muda sozinho.
      NEW.weight_exception_by := OLD.weight_exception_by;
      RETURN NEW;
    END IF;
  END IF;

  -- Tirar a exceção deixa o pedido menos pronto, e qualquer um pode.
  IF NULLIF(btrim(COALESCE(NEW.weight_exception_note, '')), '') IS NULL THEN
    NEW.weight_exception_note := NULL;
    NEW.weight_exception_by := NULL;
    RETURN NEW;
  END IF;

  IF NOT is_account_member(NEW.account_id, 'admin') THEN
    RAISE EXCEPTION 'guard_deal_weight_exception: só um admin autoriza a exceção de peso'
      USING ERRCODE = '42501', HINT = 'weight_exception_admin';
  END IF;
  NEW.weight_exception_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_guard_weight_exception ON deals;
CREATE TRIGGER deals_guard_weight_exception
  BEFORE INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_weight_exception();

-- ------------------------------------------------------------
-- 11. Produto: o que vem do Bling só pelo servidor
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_product_bling_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.bling_product_id IS NOT NULL OR NEW.bling_product_type IS NOT NULL
       OR NEW.bling_family_id IS NOT NULL OR NEW.revenue_category_bling_id IS NOT NULL
       OR NEW.defines_order_category IS DISTINCT FROM TRUE
       OR NEW.bling_synced_at IS NOT NULL OR NEW.bling_list_hash IS NOT NULL THEN
      RAISE EXCEPTION 'guard_product_bling_columns: o vínculo com o Bling só muda pelo servidor'
        USING ERRCODE = '42501', HINT = 'bling_managed';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.bling_product_id IS DISTINCT FROM OLD.bling_product_id
     OR NEW.bling_product_type IS DISTINCT FROM OLD.bling_product_type
     OR NEW.bling_family_id IS DISTINCT FROM OLD.bling_family_id
     OR NEW.revenue_category_bling_id IS DISTINCT FROM OLD.revenue_category_bling_id
     OR NEW.defines_order_category IS DISTINCT FROM OLD.defines_order_category
     OR NEW.bling_synced_at IS DISTINCT FROM OLD.bling_synced_at
     OR NEW.bling_list_hash IS DISTINCT FROM OLD.bling_list_hash THEN
    RAISE EXCEPTION 'guard_product_bling_columns: o vínculo com o Bling só muda pelo servidor'
      USING ERRCODE = '42501', HINT = 'bling_managed';
  END IF;

  -- Produto vinculado: o peso é o do Bling (D6).
  IF OLD.bling_product_id IS NOT NULL
     AND (NEW.gross_weight_kg IS DISTINCT FROM OLD.gross_weight_kg
          OR NEW.net_weight_kg IS DISTINCT FROM OLD.net_weight_kg) THEN
    RAISE EXCEPTION 'guard_product_bling_columns: o peso de produto vinculado vem do Bling'
      USING ERRCODE = '42501', HINT = 'bling_managed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_guard_bling ON products;
CREATE TRIGGER products_guard_bling
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_bling_columns();

-- ------------------------------------------------------------
-- 12. Apagar funil ou contato que tem pedido
-- ------------------------------------------------------------
--
-- `deals.pipeline_id` é ON DELETE CASCADE e `deals.contact_id` é SET NULL.
-- A cascata roda como dono da tabela, e a guarda das oportunidades (que só
-- vale para `authenticated`) não a vê: apagar o funil apagava os pedidos, e
-- apagar o contato tirava o cliente de um pedido travado.

CREATE OR REPLACE FUNCTION public.guard_order_parents()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'pipelines' THEN
    IF EXISTS (
      SELECT 1 FROM deals d
       WHERE d.pipeline_id = OLD.id
         AND (d.bling_order_id IS NOT NULL OR d.order_status IS NOT NULL OR d.bling_external_key IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'guard_order_parents: este funil tem oportunidades que são pedido no Bling'
        USING ERRCODE = '42501', HINT = 'order_locked';
    END IF;
  ELSIF TG_TABLE_NAME = 'contacts' THEN
    IF EXISTS (
      SELECT 1 FROM deals d
       WHERE d.contact_id = OLD.id
         AND (d.bling_order_id IS NOT NULL OR d.order_status IS NOT NULL OR d.bling_external_key IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'guard_order_parents: este contato é o cliente de um pedido no Bling'
        USING ERRCODE = '42501', HINT = 'order_locked';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS pipelines_guard_orders ON pipelines;
CREATE TRIGGER pipelines_guard_orders
  BEFORE DELETE ON pipelines
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_parents();

DROP TRIGGER IF EXISTS contacts_guard_orders ON contacts;
CREATE TRIGGER contacts_guard_orders
  BEFORE DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_parents();

-- ------------------------------------------------------------
-- 13. Uma empresa do Bling, uma conexão viva
-- ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_bling_connections_company_live
  ON bling_connections (company_id)
  WHERE status <> 'revoked';
