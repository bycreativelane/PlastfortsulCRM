-- ============================================================
-- 072_company_identity_and_quote_files
--
-- Quem é a empresa, e onde o orçamento fica gravado como arquivo.
--
-- Pedido do Gabriel em 8 de setembro de 2026: "PDF personalizado, com
-- logo da empresa, doc de orçamento bem estruturado visualmente e interno
-- na plataforma" — e, na mensagem seguinte, "envia no whatsapp ou envia
-- como imagem e fica o PDF salvo na plataforma".
--
-- ------------------------------------------------------------
-- 1. A EMPRESA, que este CRM nunca soube dizer
-- ------------------------------------------------------------
--
-- O item 54 do pacote pede, no cabeçalho do orçamento, "logo […] dados
-- essenciais da empresa", e no rodapé "contato da PlastfortSul; site".
-- Nada disso existia: `accounts` tinha nome, dono, fuso, moeda e horário
-- comercial, e `whatsapp_config` guarda o `phone_number_id` da Meta — um
-- identificador, não um telefone que se imprima.
--
-- Por isso o documento saía com o nome da conta e mais nada. Não era uma
-- escolha de desenho; era o limite do que o banco sabia.
--
-- TUDO OPCIONAL. Uma conta recém-criada não tem CNPJ nem logo, e o
-- documento tem de sair mesmo assim — omitindo o que falta, como já faz
-- com frete, transportador e observações. Um NOT NULL aqui transformaria
-- "ainda não preenchi" em "não consigo gerar orçamento".
--
-- `legal_name` SEPARADO de `accounts.name`: um é como a empresa se chama
-- no dia a dia ("PlastfortSul"), o outro é o que vai num documento
-- comercial ("Plastfort Sul Embalagens Ltda."). Forçar os dois a serem o
-- mesmo campo faria a barra lateral dizer razão social.
--
-- ------------------------------------------------------------
-- 2. O ARQUIVO, ao lado do registro que já existe
-- ------------------------------------------------------------
--
-- A 071 guarda os DADOS do orçamento porque o PDF nascia no navegador de
-- quem imprimia e o servidor nunca o via. Isso muda agora: o PDF passa a
-- ser gerado pelo servidor, então há bytes para guardar.
--
-- Os dados CONTINUAM guardados, e não viram redundância. Eles são o que
-- deixa procurar por cliente, pedido ou produto, e o que permite
-- redesenhar um documento cujo arquivo tenha sido apagado do bucket. O
-- arquivo é a cópia entregável; a linha é o registro.
--
-- Duas colunas e não uma: o PDF é o que fica guardado, e a IMAGEM é o que
-- vai pelo WhatsApp — um PNG aparece aberto na conversa, e um PDF vira um
-- cartão de arquivo que alguém precisa tocar para ver. As duas saem da
-- MESMA renderização, então elas nunca discordam.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS legal_name TEXT
    CHECK (legal_name IS NULL OR length(trim(legal_name)) BETWEEN 1 AND 160),
  ADD COLUMN IF NOT EXISTS tax_id TEXT
    CHECK (tax_id IS NULL OR length(trim(tax_id)) BETWEEN 1 AND 32),
  ADD COLUMN IF NOT EXISTS company_phone TEXT
    CHECK (company_phone IS NULL OR length(trim(company_phone)) BETWEEN 1 AND 32),
  ADD COLUMN IF NOT EXISTS company_email TEXT
    CHECK (company_email IS NULL OR length(trim(company_email)) BETWEEN 1 AND 160),
  ADD COLUMN IF NOT EXISTS company_site TEXT
    CHECK (company_site IS NULL OR length(trim(company_site)) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS company_address TEXT
    CHECK (company_address IS NULL OR length(trim(company_address)) <= 240),
  -- URL pública no bucket `brand`, como `contacts.avatar_url` é no
  -- `avatars`. Guardar a URL e não o caminho segue o que o resto do app
  -- já faz, e é o que o `<img>` do documento consome direto.
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN accounts.legal_name IS
  'Razao social, para documentos. Separada de `name`, que e como a '
  'empresa aparece na barra lateral. O orcamento usa esta quando existe.';

COMMENT ON COLUMN accounts.logo_url IS
  'URL publica da logo no bucket `brand`. Aparece no cabecalho do '
  'orcamento; sem ela o documento imprime so o nome, sem buraco.';

ALTER TABLE deal_quotes
  -- Caminho no bucket, e não só a URL: é o que permite APAGAR o objeto se
  -- a linha for embora. `avatars` e `chat-media` aprenderam isso antes —
  -- guardar só a URL deixa lixo no storage para sempre.
  ADD COLUMN IF NOT EXISTS pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS image_path TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN deal_quotes.pdf_url IS
  'O arquivo entregavel. A linha continua guardando os dados do '
  'documento: e o que deixa procurar, e o que redesenha um orcamento '
  'cujo arquivo tenha sumido do bucket.';

COMMENT ON COLUMN deal_quotes.image_url IS
  'A mesma renderizacao em PNG. E o que vai pelo WhatsApp — uma imagem '
  'abre na conversa, um PDF vira um cartao que alguem precisa tocar.';

-- ------------------------------------------------------------
-- 3. Os buckets
-- ------------------------------------------------------------
--
-- PÚBLICOS, como os quatro que já existem, e aqui isso não é inércia: a
-- Meta BUSCA o arquivo pelo link para entregá-lo ao cliente. Um bucket
-- privado tornaria o envio impossível sem URL assinada, e o caminho é um
-- UUID — a mesma exposição que `chat-media` já tem para toda foto que
-- este CRM manda ou recebe.

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand', 'brand', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('quotes', 'quotes', true)
ON CONFLICT (id) DO NOTHING;

-- Leitura anônima: é o que faz o link público funcionar, para a Meta e
-- para o navegador do cliente.
DROP POLICY IF EXISTS "brand public read" ON storage.objects;
CREATE POLICY "brand public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'brand');

DROP POLICY IF EXISTS "quotes public read" ON storage.objects;
CREATE POLICY "quotes public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'quotes');

-- Escrita só para quem está autenticado na conta. O PDF é gravado pelo
-- servidor com a service key, que passa por cima da RLS de qualquer
-- forma; esta política é para a logo, que sobe do navegador.
DROP POLICY IF EXISTS "brand write" ON storage.objects;
CREATE POLICY "brand write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand');

DROP POLICY IF EXISTS "brand update" ON storage.objects;
CREATE POLICY "brand update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'brand');

DROP POLICY IF EXISTS "brand delete" ON storage.objects;
CREATE POLICY "brand delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brand');
