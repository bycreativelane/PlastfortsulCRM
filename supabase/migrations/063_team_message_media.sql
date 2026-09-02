-- ============================================================
-- 063_team_message_media.sql — print, áudio e vídeo na sala da equipe
--
-- ------------------------------------------------------------
-- O PROBLEMA
-- ------------------------------------------------------------
--
-- A sala da equipe só aceita texto. `team_messages.body` é
-- `TEXT NOT NULL CHECK (length(trim(body)) > 0)` e não existe coluna
-- nenhuma para um anexo — então "manda o print do pedido" continua
-- acontecendo no WhatsApp pessoal, que é exatamente o que a migração
-- 046 escreveu que queria acabar:
--
--   "o que se perde não é o chat. É que a frase que explica o pedido
--    mora num aplicativo diferente do pedido."
--
-- Um print do comprovante é a frase que explica o pedido, com mais
-- frequência do que uma frase é.
--
-- ------------------------------------------------------------
-- POR QUE UM BUCKET NOVO, E NÃO O `chat-media`
-- ------------------------------------------------------------
--
-- O `chat-media` (migração 023) resolveria isto sem nenhum SQL: já
-- aceita imagem, vídeo, áudio e documento, já tem política de escrita
-- por membro da conta, e o caminho `account-<uuid>/` já é o que o
-- `upload-media.ts` monta.
--
-- Ele é PÚBLICO. Tem que ser: a Meta busca a URL na hora de enviar, e
-- um objeto lá é lido por qualquer um que tenha o link.
--
-- Isso está certo para um anexo que o cliente vai receber de qualquer
-- jeito. Está errado para a sala interna, e desfaz o argumento que
-- criou a sala. A 046 se recusou a guardar mensagem interna em
-- `conversations` porque estaria "a um `IF` de distância de ser
-- entregue a um cliente"; guardar o print interno num balde público
-- seria a mesma frouxidão por outro caminho — não é preciso um `IF`,
-- basta o link vazar.
--
-- Então: `team-media`, privado, leitura só para membro da conta. O
-- cliente guarda o CAMINHO e assina a URL na hora de renderizar.
--
-- ------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO NÃO FAZ
-- ------------------------------------------------------------
--
-- Não apaga objeto nenhum. Uma mensagem apagada deixa o arquivo no
-- balde, de propósito: apagar no `DELETE` exige um gatilho que fale com
-- o storage, e um gatilho que apaga bytes é a última coisa que se quer
-- depurar. A faxina de órfãos é trabalho de rotina, não de escrita.
-- ============================================================

-- ============================================================
-- 1. As colunas de mídia em team_messages
-- ============================================================

ALTER TABLE team_messages
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text',
  -- O CAMINHO no balde, não a URL. O balde é privado, então a URL é
  -- assinada e expira; guardar uma URL assinada numa coluna é guardar
  -- um valor que fica errado sozinho depois de uma hora.
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  -- O nome que o arquivo tinha na máquina de quem mandou. É o que o
  -- balão do documento mostra, e o que o download devolve.
  ADD COLUMN IF NOT EXISTS media_name TEXT,
  ADD COLUMN IF NOT EXISTS media_size INTEGER;

-- Os mesmos quatro tipos que o `message-media.tsx` já sabe desenhar,
-- mais `text`. Nada de `location` nem `template`: os dois só fazem
-- sentido numa conversa com quem está do lado de fora.
ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_content_type_check;
ALTER TABLE team_messages
  ADD CONSTRAINT team_messages_content_type_check
  CHECK (content_type IN ('text', 'image', 'audio', 'video', 'document'));

COMMENT ON COLUMN team_messages.media_path IS
  'Caminho no bucket privado team-media (account-<uuid>/...). NUNCA uma '
  'URL: o bucket é privado e a URL assinada expira.';

-- ============================================================
-- 2. O CHECK do corpo, relaxado — e só até onde precisa
--
-- Era `length(trim(body)) > 0`, o que proíbe uma mensagem que é só um
-- print. Vira: texto continua exigindo texto, mídia exige o caminho, e
-- uma mídia PODE vir com legenda.
--
-- A alternativa preguiçosa — largar o CHECK — deixaria entrar uma linha
-- sem corpo e sem anexo, que não é nada e ainda assim ocupa uma linha na
-- sala.
-- ============================================================

ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_body_check;
ALTER TABLE team_messages ALTER COLUMN body DROP NOT NULL;

ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_has_content;
ALTER TABLE team_messages
  ADD CONSTRAINT team_messages_has_content
  CHECK (
    CASE content_type
      WHEN 'text' THEN body IS NOT NULL AND length(trim(body)) > 0
      ELSE media_path IS NOT NULL AND length(trim(media_path)) > 0
    END
  );

-- ============================================================
-- 3. O bucket privado
--
-- 16 MB como os outros, e a lista de tipos é MAIOR que a do
-- `chat-media` de propósito: aquela é a lista que a Meta aceita, e aqui
-- não tem Meta nenhuma no caminho. Um print do Windows é PNG, um vídeo
-- de tela gravado no navegador é WebM, e um áudio gravado no navegador é
-- WebM/Opus — os três seriam recusados pela lista de saída e os três são
-- exatamente o que alguém manda para um colega.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-media',
  'team-media',
  FALSE,
  16777216,
  ARRAY[
    -- Imagens (print de tela incluído)
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    -- Vídeo, com o WebM que o navegador grava
    'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp',
    -- Áudio, idem
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav',
    -- Documentos
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
    'application/zip'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 4. RLS do storage — membro da conta lê e escreve, mais ninguém
--
-- Mesma forma de predicado das migrações 020 e 023: o primeiro segmento
-- do caminho é `account-<account_id>` e tem que bater com a conta de
-- quem chama. A diferença que importa está no SELECT — no `chat-media`
-- ele é `USING (bucket_id = 'chat-media')`, aberto. Aqui ele confere a
-- conta, que é a razão de o balde existir.
-- ============================================================

DROP POLICY IF EXISTS "Members read team media" ON storage.objects;
CREATE POLICY "Members read team media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'team-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members upload team media" ON storage.objects;
CREATE POLICY "Members upload team media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'team-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- Sem UPDATE e sem DELETE, e isso é a decisão e não um esquecimento.
-- Um anexo da sala é imutável: a mensagem pode ser editada ou apagada,
-- o arquivo que ela citou não. Trocar os bytes debaixo de uma frase que
-- um colega já leu é a única coisa que um chat interno não pode deixar
-- acontecer.

-- ============================================================
-- 5. Índice
--
-- A sala lê por conta e por data (o índice da 046 já cobre), mas a
-- faxina de órfãos vai querer procurar por caminho. Parcial, porque a
-- esmagadora maioria das linhas é texto e não tem caminho nenhum.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_team_messages_media_path
  ON team_messages(media_path)
  WHERE media_path IS NOT NULL;
