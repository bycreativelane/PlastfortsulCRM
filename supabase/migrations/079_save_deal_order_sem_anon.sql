-- ============================================================
-- 079_save_deal_order_sem_anon
--
-- A 078 terminou com
--
--   REVOKE ALL ON FUNCTION public.save_deal_order(...) FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.save_deal_order(...) TO authenticated;
--
-- com a intenção de "só quem está logado". Não chega: no Supabase os
-- privilégios padrão do esquema public dão EXECUTE DIRETO a anon,
-- authenticated e service_role em toda função criada — não por PUBLIC.
-- Tirar de PUBLIC não tira de anon.
--
-- Medido em 14/09/2026, depois de aplicada a 078, só com a anon key:
--   save_deal_order(p_deal := null)        → 22023 da própria função
--                                            (executou)
--   increment_automation_execution_count   → 42501 permission denied
--     (a 007 revoga de anon por nome)
--
-- O estrago possível era pequeno — a função é SECURITY INVOKER, a RLS de
-- deals/deal_items/deal_installments vale inteira e anon não passa em
-- nenhuma —, mas a porta não deve existir. Mesmo padrão da 007/012/037.
--
-- Idempotente: REVOKE de um privilégio que não existe não é erro.
-- ============================================================

REVOKE ALL ON FUNCTION public.save_deal_order(UUID, JSONB, JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_deal_order(UUID, JSONB, JSONB, JSONB) TO authenticated;
