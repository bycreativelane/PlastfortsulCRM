-- ============================================================
-- 087_bling_claim_uuid
--
-- `bling_claim_operations` (086) chamava `uuid_generate_v4()` com
-- `SET search_path = public`. No Supabase a extensão uuid-ossp mora no
-- schema `extensions`, então a função não achava a outra e toda tentativa
-- de pegar operação morria com 42883 — medido no banco de teste logo
-- depois de aplicar a 086, antes de qualquer operação real existir.
--
-- Os DEFAULTs das tabelas não têm o problema: a expressão é guardada já
-- resolvida na criação da tabela. Só código que roda com o search_path
-- travado precisa de `gen_random_uuid()`, que está no pg_catalog.
--
-- Mesma assinatura e mesmo ACL; só o corpo muda.
-- Idempotente — seguro de re-executar.
-- ============================================================

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
