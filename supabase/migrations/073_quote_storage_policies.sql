-- ============================================================
-- 073_quote_storage_policies
--
-- Três correções na 072, todas achadas na revisão que o Gabriel fez do
-- banco depois de aplicá-la. Duas delas são defeitos meus.
--
-- ------------------------------------------------------------
-- 1. `quotes` NÃO TINHA POLÍTICA DE ESCRITA — e precisa
-- ------------------------------------------------------------
--
-- O comentário da 072 diz, com todas as letras, que "o PDF é gravado
-- pelo servidor com a service key, que passa por cima da RLS de qualquer
-- forma". Isso está ERRADO. A rota usa `createClient()` de
-- `lib/supabase/server`, que é o cliente SSR: chave anônima mais o cookie
-- do usuário, sujeito à RLS como qualquer outro.
--
-- Com a RLS ligada e nenhuma política de INSERT, o upload do PDF seria
-- recusado. E o código engole o erro do upload — a linha ficaria
-- arquivada com `pdf_url` nulo e a tela diria apenas "não foi possível
-- gerar", sem dizer por quê. Um defeito que só aparece na primeira vez
-- que alguém usa a função.
--
-- A correção NÃO é trocar para a service key. É dar ao bucket a mesma
-- política que `chat-media` tem desde a 023: quem escreve é o usuário,
-- a RLS continua valendo, e o que autoriza é a conta na primeira pasta
-- do caminho. Menos privilégio, e uma convenção só no produto inteiro.
--
-- ------------------------------------------------------------
-- 2. As políticas de escrita do `brand` estavam largas demais
-- ------------------------------------------------------------
--
-- A 072 escreveu `bucket_id = 'brand'` e nada mais, para qualquer
-- autenticado. Quer dizer: qualquer usuário de QUALQUER conta podia
-- subir, sobrescrever e apagar a logo de qualquer outra.
--
-- Não é o padrão da casa e não era intenção. A 008 prende o avatar ao
-- `auth.uid()` na primeira pasta; a 023 prende a mídia do chat ao
-- `account-<id>`. A logo é da CONTA, então ela segue a 023.
--
-- ------------------------------------------------------------
-- 3. O bucket `branding`, órfão
-- ------------------------------------------------------------
--
-- Criado à mão em 27 de agosto, fora de qualquer migração, vazio, e
-- referenciado por ZERO linhas de código — `grep branding src/` só acha
-- duas frases em prosa dentro de comentários. Com o `brand` da 072 ao
-- lado, passaram a existir dois destinos plausíveis para o mesmo
-- arquivo, e a primeira logo tinha metade de chance de ir para o errado.
--
-- Sai o que não está em migração nenhuma. É a mesma regra que o resto do
-- projeto segue: a pasta de migrações é a verdade sobre o schema, e o
-- que nasce fora dela é justamente a divergência que ela existe para
-- impedir.
--
-- ------------------------------------------------------------
-- O QUE CONTINUA COMO ESTÁ: a leitura pública
-- ------------------------------------------------------------
--
-- `brand` e `quotes` seguem legíveis por qualquer um com o link, sem
-- filtro de conta — e vale dizer sem rodeio o que isso significa: a
-- proteção de um orçamento é o UUID do caminho ser impossível de
-- adivinhar, NÃO a RLS.
--
-- É deliberado e é obrigatório: a Meta busca o arquivo pelo link para
-- entregá-lo ao cliente, e um bucket privado tornaria o envio impossível
-- sem URL assinada. `avatars`, `flow-media` e `chat-media` fazem
-- exatamente isso desde 2026. (`team-media` é privado — a 072 dizia "como
-- os quatro que já existem", e são cinco, sendo um privado.)
-- ============================================================

-- ------------------------------------------------------------
-- `quotes`
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "quotes write" ON storage.objects;
CREATE POLICY "quotes write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'quotes'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- `upsert: true` no upload faz o cliente tentar UPDATE quando o objeto já
-- existe — gerar o mesmo orçamento duas vezes é um caminho normal.
DROP POLICY IF EXISTS "quotes update" ON storage.objects;
CREATE POLICY "quotes update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'quotes'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ------------------------------------------------------------
-- `brand`, agora preso à conta
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "brand write" ON storage.objects;
CREATE POLICY "brand write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "brand update" ON storage.objects;
CREATE POLICY "brand update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- Trocar a logo é subir outra por cima; apagar é uma operação de limpeza
-- que a tela de configurações faz ao substituir o arquivo antigo.
DROP POLICY IF EXISTS "brand delete" ON storage.objects;
CREATE POLICY "brand delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ------------------------------------------------------------
-- O órfão
-- ------------------------------------------------------------
--
-- Só se estiver vazio. Um `DELETE` num bucket com objetos falha por chave
-- estrangeira, e é assim que se quer: se alguém tiver subido alguma coisa
-- entre a revisão e esta migração, ela para aqui em vez de sumir.
DELETE FROM storage.buckets
WHERE id = 'branding'
  AND NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'branding'
  );
