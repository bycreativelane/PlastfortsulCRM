-- ============================================================
-- 071_deal_quotes
--
-- Todo orçamento gerado fica guardado.
--
-- Pedido do Gabriel em 8 de setembro de 2026, testando o bloco 38–59:
-- "todo orçamento gerado em PDF precisa ficar salvo em uma seção de
-- documentos > orçamentos".
--
-- ------------------------------------------------------------
-- O QUE FICA GUARDADO NÃO É O PDF
-- ------------------------------------------------------------
--
-- É o DOCUMENTO — os dados dele. E não é uma limitação contornável: o PDF
-- é produzido pelo navegador quando alguém escolhe "Salvar como PDF" no
-- diálogo de impressão, no computador da pessoa. O app nunca vê aqueles
-- bytes; ele nem sabe se a pessoa salvou ou cancelou.
--
-- Guardar os dados é melhor do que guardar o arquivo, e não só por ser o
-- possível:
--
--   · a página redesenha o documento idêntico, pelo MESMO componente e
--     pelo MESMO cálculo — um PDF guardado seria uma segunda verdade
--     sobre o total, que é o que o item 55 do pacote proíbe;
--   · dá para procurar por cliente, por número de pedido, por valor. Um
--     blob não responde nada disso;
--   · e ocupa bytes, não megabytes.
--
-- ------------------------------------------------------------
-- UMA LINHA POR GERAÇÃO, E NÃO UMA POR OPORTUNIDADE
-- ------------------------------------------------------------
--
-- "Todo orçamento gerado" é literal. O negócio muda depois que o
-- orçamento sai — o preço cai, o frete aparece, um item entra — e o que
-- o cliente recebeu foi a versão daquele dia. Sobrescrever apagaria
-- exatamente o que faz este registro valer: o que foi prometido, e
-- quando.
--
-- É a mesma regra das ocorrências (042) e da fila de automações (065):
-- histórico se acumula, não se corrige.
--
-- ------------------------------------------------------------
-- `deal_id` PODE FICAR NULO
-- ------------------------------------------------------------
--
-- `ON DELETE SET NULL`, como a 004 fez com `deals.contact_id`. Apagar a
-- oportunidade não pode apagar o orçamento que já foi enviado a um
-- cliente: o documento é a prova do que se prometeu, e ele sobrevive ao
-- registro que o originou. Por isso tudo que ele imprime está copiado
-- aqui — nome do cliente, linhas, totais — e nada é lido por junção na
-- hora de desenhar.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  -- Quem gerou. Auditoria, e o rodapé "Atendimento: fulano" do documento
  -- é o `owner` abaixo, que é o RESPONSÁVEL pela oportunidade — as duas
  -- coisas são diferentes e podem discordar.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ---- O documento, congelado -------------------------------------
  order_number TEXT
    CHECK (order_number IS NULL
           OR length(trim(order_number)) BETWEEN 1 AND 40),
  issued_on DATE NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_company TEXT,
  customer_phone TEXT,

  -- As linhas como vieram. JSONB e não uma tabela filha: elas não são
  -- consultadas por si — ninguém pergunta "quais orçamentos citaram o
  -- produto X" a partir daqui, para isso existe `deal_items`. Aqui elas
  -- são o TEXTO do documento, e um documento é um bloco só.
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,

  currency TEXT NOT NULL DEFAULT 'BRL',
  products NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- NULL é "não definido", que o documento omite em vez de imprimir zero.
  -- A mesma distinção de `deals.shipping_cost` na 070.
  shipping NUMERIC(12,2) CHECK (shipping IS NULL OR shipping >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0,

  carrier TEXT,
  owner TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE deal_quotes IS
  'Um orçamento gerado, congelado. Guarda os DADOS do documento e não o '
  'PDF — o arquivo nasce no navegador de quem gerou e o servidor nunca o '
  've. A pagina /documentos/orcamentos redesenha pelo mesmo componente.';

COMMENT ON COLUMN deal_quotes.lines IS
  'As linhas do documento: [{name, quantity, unitPrice, discountPercent, '
  'total}]. Congeladas — `deal_items` continua sendo a verdade sobre a '
  'oportunidade de hoje, e isto é o que o cliente recebeu naquele dia.';

-- A consulta da página: os mais recentes da conta primeiro.
CREATE INDEX IF NOT EXISTS idx_deal_quotes_account
  ON deal_quotes(account_id, created_at DESC);

-- E "quais orçamentos saíram desta oportunidade", que é a pergunta da
-- gaveta. Parcial porque a coluna fica nula quando a oportunidade some.
CREATE INDEX IF NOT EXISTS idx_deal_quotes_deal
  ON deal_quotes(deal_id, created_at DESC)
  WHERE deal_id IS NOT NULL;

ALTER TABLE deal_quotes ENABLE ROW LEVEL SECURITY;

-- Pelo `account_id` da própria linha, como a 054 fez em `deal_items` e
-- pelo mesmo motivo: `deals` ainda carrega a política `auth.uid() =
-- user_id` da 001, e um orçamento que só quem gerou consegue ler é um
-- arquivo morto.
DROP POLICY IF EXISTS deal_quotes_select ON deal_quotes;
CREATE POLICY deal_quotes_select ON deal_quotes FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS deal_quotes_insert ON deal_quotes;
CREATE POLICY deal_quotes_insert ON deal_quotes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- SEM update e SEM delete, de propósito. Um documento enviado a um
-- cliente não se edita: se o preço mudou, o que sai é um orçamento novo,
-- e os dois ficam. Quem precisar apagar por engano usa o banco — e vai
-- ter que querer muito.
