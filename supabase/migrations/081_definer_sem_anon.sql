-- ============================================================
-- 081_definer_sem_anon
--
-- A 079 e a 080 fecharam funções que tinham `REVOKE ... FROM PUBLIC` e
-- esqueciam `anon`. Estas seis são o caso que sobrou: SECURITY DEFINER que
-- NUNCA receberam REVOKE nenhum. No Supabase isso quer dizer EXECUTE para
-- anon e authenticated duas vezes — pelo privilégio padrão do esquema e por
-- PUBLIC —, e uma SECURITY DEFINER não passa pela RLS.
--
-- Medido em 14/09/2026, antes desta migração, só com a anon key e por GET
-- (transação somente leitura: 25006 conferido, a sonda não grava nada):
--
--   claim_ai_reply_slot         executava e chegava ao UPDATE (25006)
--   record_webhook_failure      executava e chegava ao UPDATE (25006)
--   _bcast_bump                 executava e chegava ao UPDATE (25006)
--   recompute_broadcast_counts  executava e chegava ao UPDATE (25006)
--   touch_presence              executava e parava em auth.uid() ('Unauthorized')
--   is_account_member           executava e devolvia false
--
-- As quatro primeiras não têm checagem nenhuma por dentro. Por POST, quem
-- tivesse a anon key — que vai no navegador — e um id conseguia:
--   - desativar o webhook de saída de qualquer conta
--     (record_webhook_failure com max_failures = 1);
--   - esgotar o limite de respostas da IA de uma conversa
--     (claim_ai_reply_slot);
--   - somar qualquer número em qualquer contador de uma campanha
--     (_bcast_bump, que recebe a coluna como texto).
-- Ids são UUID, então precisava conhecê-los; ainda assim, a porta existia,
-- e para qualquer conta.
--
-- QUEM CONTINUA CHAMANDO (conferido no código)
--
--   claim_ai_reply_slot     resposta automática da IA, com o service role
--   record_webhook_failure  entrega de webhooks, com o service role
--   _bcast_bump             só o gatilho broadcast_recipient_aggregate_trigger,
--                           que é SECURITY DEFINER: a chamada de dentro roda
--                           como o dono, não como quem gravou o destinatário
--   recompute_broadcast_counts  ninguém no app; é a rede de segurança que a
--                           005 deixou para rodar à mão, como postgres
--   touch_presence          o navegador logado (authenticated)
--
-- `is_account_member` fica aberta de propósito, agora por escrito: as
-- políticas de RLS a chamam também quando quem consulta é anon, e sem
-- EXECUTE a consulta daria erro em vez de voltar vazia. Para anon ela só
-- sabe responder false (auth.uid() é nulo).
--
-- REVOGAR SÓ DE anon NÃO FECHA
--
-- Todo papel é membro implícito de PUBLIC. Enquanto PUBLIC tiver EXECUTE,
-- tirar o anon por nome não muda nada — por isso cada função abaixo sai de
-- PUBLIC e de anon juntas.
--
-- Idempotente: REVOKE de um privilégio que não existe não é erro.
-- ============================================================

-- 029 / 031
REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;

-- 028
REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer) TO service_role;

-- 005
REVOKE ALL ON FUNCTION public._bcast_bump(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(uuid) FROM PUBLIC, anon, authenticated;

-- 024
REVOKE ALL ON FUNCTION public.touch_presence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_presence(text) TO authenticated;

-- 017
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, account_role_enum) TO anon;
