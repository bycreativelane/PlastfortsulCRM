-- ============================================================
-- 080_funcoes_antigas_sem_anon
--
-- A correção da 079, agora para as funções antigas que repetem o padrão:
-- `REVOKE ALL ... FROM PUBLIC` e nada sobre `anon`. No Supabase os
-- privilégios padrão do esquema public dão EXECUTE direto a anon,
-- authenticated e service_role — não por PUBLIC —, então tirar de PUBLIC
-- não tira de ninguém que chama pela API.
--
-- Medido em 14/09/2026, antes desta migração, só com a anon key e por GET.
-- O PostgREST roda GET em transação somente leitura (25006 conferido), então
-- a sonda não tinha como gravar nada:
--
--   executavam e paravam na própria checagem de auth.uid() ('Unauthorized'):
--     record_sign_in, redeem_invitation, remove_account_member,
--     set_member_auto_assign, set_member_permissions, set_member_role,
--     transfer_account_ownership
--
--   executavam sob a RLS e devolviam []:
--     filter_contacts_by_tags, match_ai_knowledge_fts,
--     match_ai_knowledge_semantic
--
--   executavam e devolviam 0:
--     merge_duplicate_contacts, merge_duplicate_conversations — os índices
--     únicos da 022 e da 036 não deixam existir o duplicado que procuram
--
-- Nenhuma fazia estrago. É endurecimento: o que só quem está logado chama
-- não precisa estar ao alcance de quem não está.
--
-- QUEM CONTINUA CHAMANDO
--
-- Conferido no código: todo chamador usa a sessão do usuário (authenticated)
-- ou o service role. O service role não é tocado aqui — a resposta
-- automática da IA consulta a base de conhecimento com ele.
--
-- As duas de mesclagem saem também de authenticated: nada no app as chama,
-- só as próprias migrações, como postgres.
--
-- `peek_invitation` fica como está: a 019 a abre para anon de propósito,
-- porque a página /join/<token> mostra o convite antes do login.
--
-- Idempotente: REVOKE de um privilégio que não existe não é erro.
-- ============================================================

-- 018
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM anon;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM anon;

-- 019
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM anon;

-- 022
REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM anon, authenticated;

-- 025
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) FROM anon;

-- 030 / 032
REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM anon;

-- 036
REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM anon, authenticated;

-- 050
REVOKE ALL ON FUNCTION public.record_sign_in() FROM anon;
REVOKE ALL ON FUNCTION public.set_member_permissions(UUID, JSONB) FROM anon;

-- 051
REVOKE ALL ON FUNCTION public.set_member_auto_assign(UUID, BOOLEAN) FROM anon;
