-- ============================================================
-- 067_realtime_contact_surface
--
-- O QUE A AUTOMAÇÃO FAZ TEM QUE APARECER SOZINHO.
--
-- Reportado assim: "ao mandar automações, adicionar ou remover etiqueta,
-- a página já atualizar automático — não precisar apertar F5".
--
-- O diagnóstico é de publicação, não de tela. A `supabase_realtime`
-- carrega hoje `messages`, `conversations`, `message_reactions`,
-- `flow_runs`, `member_presence`, `notifications`,
-- `deal_playbook_progress` e `team_messages`. Não carrega `contacts`,
-- `contact_tags` nem `deals`.
--
-- Cruzando isso com o que um passo de automação sabe fazer
-- (lib/automations/engine.ts):
--
--   send_message / send_template / send_buttons / send_list  → messages       ✓ ao vivo
--   assign_conversation / close_conversation                 → conversations  ✓ ao vivo
--   add_tag / remove_tag                                     → contact_tags   ✗ só no F5
--   update_contact_field                                     → contacts       ✗ só no F5
--   create_deal / move_deal_stage / update_deal              → deals          ✗ só no F5
--
-- Ou seja: metade do motor já chega sozinha na tela e a outra metade não.
-- A mensagem que a automação manda aparece na hora; a etiqueta que ela
-- pendura no contato, a oportunidade que ela cria e o campo que ela
-- escreve ficam invisíveis até alguém recarregar. Lido do lado de quem
-- usa, isso não é "faltou atualizar" — é "a automação não rodou".
--
-- As três tabelas juntas, e não só `contact_tags`, porque são o mesmo
-- pedido: parar num lugar deixaria "a etiqueta aparece mas a
-- oportunidade não", que é a mesma reclamação outra vez.
--
-- SOBRE VAZAMENTO ENTRE CONTAS. INSERT e UPDATE passam pela RLS de
-- SELECT de cada assinante (`contacts_select`, `deals_select` e
-- `contact_tags_select`, todas em 017), então ninguém recebe linha de
-- outra conta. DELETE, no Realtime do Supabase, não passa por RLS — mas
-- sem REPLICA IDENTITY FULL o payload de DELETE é só a chave primária,
-- um uuid solto sem contexto. É por isso que esta migração NÃO mexe na
-- replica identity: o cliente trata qualquer DELETE como "recarregue o
-- que está na tela", que é barato e não precisa saber qual linha saiu.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'contact_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_tags;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'deals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deals;
  END IF;
END $$;
