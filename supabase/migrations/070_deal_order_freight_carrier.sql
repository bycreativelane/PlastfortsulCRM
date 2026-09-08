-- ============================================================
-- 070_deal_order_freight_carrier
--
-- As três colunas que o orçamento precisa, e a moeda que estava errada.
--
-- Plano: `docs/spec-correcoes-2026-09.md`, bloco 38–59 (a origem é o
-- `docs/pacote-correcoes-v2.md`, itens 39, 41, 47 e 48). É a base da
-- oportunidade redesenhada e do orçamento gerado dentro do CRM; a
-- integração com o Bling é etapa futura e nada aqui fala com ele.
--
-- NUMERAÇÃO. A 069 é a do Google. Três planos de 4 de setembro reservam
-- 070–075 no papel e nenhum deles foi escrito; a regra da casa é numerar
-- pela ordem REAL de entrega, conferindo `ls supabase/migrations/` — o
-- próprio `spec-transporte-secundario.md` manda fazer assim.
--
-- ------------------------------------------------------------
-- 1. `sales_order_number` — E NÃO O `title` (item 39)
-- ------------------------------------------------------------
--
-- O pacote permite reaproveitar o título ("internamente pode continuar
-- usando o campo existente de título se isso evitar migration
-- desnecessária"). Não evita mais, e a razão é uma coisa que mudou depois
-- de o pacote ser escrito:
--
--   · o item 3 tornou o título OPCIONAL e fez `resolveDealTitle`
--     preenchê-lo com o nome do contato;
--   · o item 17 fez toda conversa nova abrir uma oportunidade por esse
--     caminho.
--
-- Somados, todo negócio deste produto nasce com "Euclides Fernando
-- Goncalves" no título. Chamar essa coluna de "Pedido de venda" poria um
-- nome de gente no campo que deve receber `14349`, em todas as
-- oportunidades já existentes de uma vez.
--
-- TEXT e não INTEGER porque o item 39 diz "aceitar números e texto", e
-- porque um número de pedido é um IDENTIFICADOR: ninguém soma dois nem
-- ordena por ele como grandeza. Sem UNIQUE — o mesmo pedido pode ser
-- orçado duas vezes, e uma trava aqui viraria um erro de gravação numa
-- tela de vendedor.
--
-- ------------------------------------------------------------
-- 2. `shipping_cost` — o frete separado (item 47)
-- ------------------------------------------------------------
--
-- Fora de `value` de propósito. O orçamento precisa mostrar as três
-- linhas — produtos, frete, total — e um `value` que já embutisse o frete
-- não sabe mais dizer quanto era cada parte. É a mesma razão pela qual
-- `deal_items.discount_percent` mora ao lado de `unit_price` em vez de
-- dentro dele: um número que absorve o outro apaga um fato.
--
-- NULL não é zero. "Frete não definido ainda" e "frete por nossa conta"
-- são coisas diferentes, e o orçamento imprime uma e omite a outra.
--
-- ------------------------------------------------------------
-- 3. `carrier` — o transportador (item 48)
-- ------------------------------------------------------------
--
-- TEXT, e a decisão de NÃO criar uma tabela está aqui porque o item 48
-- manda verificar antes: "o campo deve preferencialmente reutilizar
-- contatos/cadastros classificados como Transportadora, CASO essa
-- estrutura já exista". Conferido — não existe. Não há tipo, etiqueta de
-- sistema nem tabela de transportadoras neste banco.
--
-- Então o mínimo honesto é guardar o nome. Isso não cria uma segunda base
-- de nada: é um campo de texto numa oportunidade, do mesmo tamanho da
-- decisão que ele representa. "Cliente retira" e "A definir", que o item
-- pede, são dois valores como quaisquer outros — a tela os oferece, o
-- banco não precisa saber que são especiais.
--
-- Quando (e se) transportadora virar cadastro, esta coluna é o que diz
-- QUAIS nomes a empresa realmente usa, o que é a melhor semente possível
-- para essa tabela.
--
-- ------------------------------------------------------------
-- 4. A moeda: BRL (item 41)
-- ------------------------------------------------------------
--
-- O item 41 tira `Moeda` da interface e diz "usar BRL como padrão, manter
-- isso internamente". A 021 pôs `DEFAULT 'USD'` — um padrão de esqueleto
-- de app, não uma decisão sobre esta operação. Esconder o campo sem
-- corrigir o padrão trocaria um erro visível por um automático.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ: mexer em `deals.currency`. O item 59 é
-- explícito — "não apagar campos históricos do banco apenas porque saíram
-- da interface" —, e uma oportunidade fechada em dólar foi fechada em
-- dólar. O que muda é com que moeda as PRÓXIMAS nascem.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS sales_order_number TEXT
    CHECK (sales_order_number IS NULL
           OR length(trim(sales_order_number)) BETWEEN 1 AND 40),
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(12,2)
    CHECK (shipping_cost IS NULL OR shipping_cost >= 0),
  ADD COLUMN IF NOT EXISTS carrier TEXT
    CHECK (carrier IS NULL OR length(trim(carrier)) BETWEEN 1 AND 120);

COMMENT ON COLUMN deals.sales_order_number IS
  'O número do pedido/orçamento que a operação controla no Bling. Digitado '
  'à mão nesta fase (item 39). TEXT porque é identificador, e separado de '
  '`title` porque o título é preenchido por automação com o nome do '
  'contato desde a correção do item 3.';

COMMENT ON COLUMN deals.shipping_cost IS
  'Frete, separado do valor dos produtos para o orçamento poder mostrar '
  'subtotal / frete / total (item 47). NULL é "ainda não definido", que '
  'não é o mesmo que zero.';

COMMENT ON COLUMN deals.carrier IS
  'Transportadora, ou um dos estados que o item 48 pede ("Cliente retira", '
  '"A definir"). Texto e não FK: não existe cadastro de transportadora '
  'neste banco, e o item manda verificar antes de criar um segundo.';

-- Ordenar e filtrar por número de pedido é a consulta óbvia desta coluna
-- ("cadê o 14349?"). Parcial porque a esmagadora maioria das linhas —
-- todas as que nascem de uma conversa nova — não tem número nenhum.
CREATE INDEX IF NOT EXISTS idx_deals_sales_order
  ON deals(account_id, sales_order_number)
  WHERE sales_order_number IS NOT NULL;

-- ------------------------------------------------------------
-- A moeda
-- ------------------------------------------------------------

ALTER TABLE accounts
  ALTER COLUMN default_currency SET DEFAULT 'BRL';

-- As contas que ainda carregam o padrão antigo. `WHERE default_currency
-- = 'USD'` e não um UPDATE seco: uma conta que tenha escolhido dólar de
-- propósito escolheu escrevendo 'USD', e não há como distinguir as duas
-- pela coluna — mas também não há nenhuma. Este produto tem uma operação,
-- ela é brasileira, e o pacote diz isso em uma frase ("a moeda utilizada
-- operacionalmente é BRL").
UPDATE accounts SET default_currency = 'BRL' WHERE default_currency = 'USD';

COMMENT ON COLUMN accounts.default_currency IS
  'Moeda das oportunidades novas. BRL desde a 070 (item 41 do pacote), '
  'que também tirou o seletor de moeda do formulário. Oportunidades '
  'antigas mantêm a moeda com que foram criadas.';
