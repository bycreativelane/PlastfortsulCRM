-- ============================================================
-- 075_bling_order_shape
--
-- A oportunidade ganha a forma de um Pedido de Venda do Bling.
--
-- Pedido do Gabriel em 8 de setembro de 2026, com prints do Bling ao
-- lado da gaveta atual. Em uma frase: o que a operação preenche hoje no
-- Bling passa a caber aqui, na mesma ordem, para um dia ir para lá sem
-- ninguém redigitar.
--
-- A integração continua FORA (item 59 do pacote). Isto é a estrutura.
--
-- ------------------------------------------------------------
-- 1. PAGAMENTO — e por que é uma tabela
-- ------------------------------------------------------------
--
-- O Bling tem duas coisas com o mesmo nome: a "condição de pagamento",
-- que é um atalho ("30/60/90"), e as PARCELAS que ele gera a partir dela
-- — cada uma com dias, data, valor, forma e observação, e cada uma
-- editável depois. O botão "Gerar parcelas" é a ponte entre as duas.
--
-- Guardar o atalho e recalcular na hora de exibir seria perder as
-- edições: a operação muda uma data, arredonda um valor, troca a forma
-- de uma parcela só. As parcelas são linhas.
--
-- `payment_terms` fica junto mesmo assim, porque é o que a pessoa
-- digitou e é o que o Bling vai querer receber de volta.
--
-- ------------------------------------------------------------
-- 2. `method` É TEXTO, e é a mesma decisão do transportador
-- ------------------------------------------------------------
--
-- No print do Gabriel a forma de pagamento é "AGRO sicredi" — um valor
-- cadastrado na conta dele no Bling, não um código de um padrão. Não
-- existe lista universal para copiar, e inventar uma aqui seria criar um
-- cadastro que diverge do de lá no primeiro uso.
--
-- Então guarda-se o nome, como a 070 fez com `carrier` pelo mesmo
-- motivo. Quando a integração vier, esta coluna é a melhor semente
-- possível: ela diz quais formas a empresa REALMENTE usa.
--
-- ------------------------------------------------------------
-- 3. TRANSPORTE: o que o Bling pede além do nome
-- ------------------------------------------------------------
--
-- `freight_mode` é o "frete por conta" — no Bling um código de 0 a 9
-- (0 = CIF, contratação por conta do remetente; 1 = FOB, por conta do
-- destinatário; e assim por diante). Guardado como TEXTO e não como
-- inteiro: é um código de domínio de outro sistema, e um `INTEGER` daria
-- a impressão de que dá para somar ou comparar por ordem.
--
-- `gross_weight` e `freight_volumes` completam o que a transportadora
-- pergunta. Ambos opcionais — um orçamento sai antes de alguém pesar
-- nada.
--
-- ------------------------------------------------------------
-- 4. `deal_items` congela SKU e unidade
-- ------------------------------------------------------------
--
-- Pelo mesmo motivo que a 054 congelou o `name`, escrito lá: as linhas
-- interessantes daqui a um ano são as de produtos que foram renomeados
-- ou aposentados. O documento imprime o código e a unidade; se ele os
-- lesse por junção, um orçamento de junho passaria a mostrar o SKU que o
-- produto tem hoje.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS payment_terms TEXT
    CHECK (payment_terms IS NULL OR length(trim(payment_terms)) <= 120),
  ADD COLUMN IF NOT EXISTS freight_mode TEXT
    CHECK (freight_mode IS NULL OR length(trim(freight_mode)) <= 40),
  ADD COLUMN IF NOT EXISTS gross_weight NUMERIC(12,3)
    CHECK (gross_weight IS NULL OR gross_weight >= 0),
  ADD COLUMN IF NOT EXISTS freight_volumes NUMERIC(12,3)
    CHECK (freight_volumes IS NULL OR freight_volumes >= 0);

COMMENT ON COLUMN deals.payment_terms IS
  'A "condicao de pagamento" do Bling: o atalho que a pessoa digita '
  '("30/60/90") e a partir do qual as parcelas sao geradas. As parcelas '
  'em si vivem em `deal_installments`, porque sao editaveis depois.';

COMMENT ON COLUMN deals.freight_mode IS
  '"Frete por conta" do Bling — 0 CIF (remetente), 1 FOB (destinatario), '
  '2 terceiros, 3 proprio remetente, 4 proprio destinatario, 9 sem '
  'frete. TEXT porque e codigo de dominio de outro sistema.';

ALTER TABLE deal_items
  ADD COLUMN IF NOT EXISTS sku TEXT
    CHECK (sku IS NULL OR length(trim(sku)) <= 60),
  ADD COLUMN IF NOT EXISTS unit TEXT
    CHECK (unit IS NULL OR length(trim(unit)) <= 16);

COMMENT ON COLUMN deal_items.sku IS
  'Codigo do produto, congelado no momento da linha — como o `name` '
  'desde a 054, e pelo mesmo motivo: um orcamento de junho mostra o SKU '
  'de junho, e nao o que o produto tem hoje.';

-- ------------------------------------------------------------
-- As parcelas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deal_installments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- A ordem em que aparecem, como `deal_items.position`. O Bling numera
  -- as parcelas na tela (1, 2, 3) e a numeração é a ordem, não um id.
  position INTEGER NOT NULL DEFAULT 0,

  -- "Dias" e "Data" são os dois lados da mesma parcela no Bling: ele
  -- calcula a segunda a partir da primeira e da data do pedido, e deixa
  -- as duas editáveis. Guardar só uma obrigaria a recalcular a outra, e
  -- a conta erraria assim que alguém ajustasse a data à mão.
  days INTEGER NOT NULL DEFAULT 0 CHECK (days >= 0),
  due_on DATE,

  amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  -- O nome da forma, e não um código. Ver a nota 2 no topo.
  method TEXT CHECK (method IS NULL OR length(trim(method)) <= 80),
  note TEXT CHECK (note IS NULL OR length(note) <= 240),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE deal_installments IS
  'As parcelas de uma oportunidade, no formato do Pedido de Venda do '
  'Bling: dias, data, valor, forma e observacao. Sao linhas e nao um '
  'calculo porque a operacao edita cada uma — muda uma data, arredonda '
  'um valor, troca a forma de uma so.';

CREATE INDEX IF NOT EXISTS idx_deal_installments_deal
  ON deal_installments(deal_id, position);

ALTER TABLE deal_installments ENABLE ROW LEVEL SECURITY;

-- Pelo `account_id` da própria linha, como `deal_items` da 054 e pelo
-- mesmo motivo: `deals` ainda carrega a política `auth.uid() = user_id`
-- da 001, e uma parcela que só quem criou consegue ler é inútil.
DROP POLICY IF EXISTS deal_installments_select ON deal_installments;
CREATE POLICY deal_installments_select ON deal_installments FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS deal_installments_insert ON deal_installments;
CREATE POLICY deal_installments_insert ON deal_installments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_installments_update ON deal_installments;
CREATE POLICY deal_installments_update ON deal_installments FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_installments_delete ON deal_installments;
CREATE POLICY deal_installments_delete ON deal_installments FOR DELETE
  USING (is_account_member(account_id, 'agent'));
