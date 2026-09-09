-- ============================================================
-- 076_quote_order_fields
--
-- O ARQUIVO GUARDA O QUE O DOCUMENTO IMPRIME. A 075 deu à oportunidade a
-- forma do Pedido de Venda do Bling — condição de pagamento, parcelas,
-- frete por conta, volumes, peso bruto — e o documento passa a imprimir
-- tudo isso. Sem estas colunas, reabrir um orçamento em Documentos →
-- Orçamentos redesenharia um papel DIFERENTE do que o cliente recebeu:
-- mesmo total, sem as parcelas e sem o transporte.
--
-- É o argumento da 071 aplicado aos campos novos, e ele não mudou: a
-- linha é o que foi enviado naquele dia. Um campo que o documento mostra
-- e o arquivo não guarda transforma o histórico numa aproximação.
--
-- ------------------------------------------------------------
-- POR QUE AS PARCELAS SÃO JSONB AQUI, e linhas na 075
-- ------------------------------------------------------------
--
-- Porque as duas tabelas respondem perguntas diferentes. Em
-- `deal_installments` a parcela é VIVA: a operação muda uma data,
-- arredonda um valor, troca a forma — e por isso ela é uma linha, com
-- RLS, índice e ordem.
--
-- Aqui ela é CÓPIA MORTA, congelada junto com o resto do documento. É a
-- mesma decisão que a 071 tomou para `lines`, escrita lá: o orçamento
-- guarda o que imprimiu, e o que imprimiu não se edita depois. Uma
-- tabela filha de `deal_quotes` seria uma segunda cópia com o dobro do
-- custo e nenhuma pergunta nova que ela soubesse responder.
--
-- ------------------------------------------------------------
-- NADA É NOT NULL
-- ------------------------------------------------------------
--
-- As linhas anteriores a esta migração não têm nenhum desses campos e
-- não podem inventá-los. Um orçamento antigo continua desenhando o que
-- sempre desenhou; os blocos novos simplesmente não aparecem nele, que é
-- a verdade sobre aquele documento.
-- ============================================================

ALTER TABLE deal_quotes
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS installments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS freight_mode TEXT,
  ADD COLUMN IF NOT EXISTS freight_volumes NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS gross_weight NUMERIC(12,3);

COMMENT ON COLUMN deal_quotes.installments IS
  'As parcelas COMO O DOCUMENTO AS IMPRIMIU — copia congelada de '
  '`deal_installments` no momento da geracao. Editar a parcela na '
  'oportunidade nao mexe aqui, e e por isso que esta coluna existe.';

COMMENT ON COLUMN deal_quotes.freight_mode IS
  'O "frete por conta" do Bling no momento da geracao. Texto legivel, '
  'como saiu no papel — nao o codigo de dominio.';
