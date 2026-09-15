-- ============================================================
-- 078 — A base do pedido: total completo, frete por conta em código e
--       gravação atômica da oportunidade.
--
-- Fase 0 do plano `docs/spec-orcamentos-bling.md` (itens F0.2, F0.4 e
-- F0.5). Nada aqui fala com o Bling: é o que precisa estar certo ANTES de
-- um pedido sair daqui para um ERP.
--
-- Idempotente — pode rodar de novo. Depende da 054 (itens), da 070 (frete),
-- da 071/076 (arquivo do orçamento) e da 075 (parcelas e frete por conta).
--
-- O app tolera esta migração ainda não aplicada: sem as colunas novas os
-- campos de outras despesas e desconto geral simplesmente não aparecem, e
-- sem a função a gaveta grava pelo caminho antigo, em três chamadas.
-- ============================================================


-- ============================================================
-- 1. OUTRAS DESPESAS E DESCONTO GERAL (F0.2)
--
-- O total do pedido de venda do Bling é
--
--     total = Σ itens + outras despesas + frete − desconto geral
--
-- e a oportunidade só sabia somar os dois primeiros termos que tinha
-- (itens e frete). O desconto de ITEM continua na linha (054) e nunca é
-- subtraído de novo: ele já está no total de cada linha.
--
-- NULL é "não informado", como o frete da 070: o documento omite o que não
-- foi dito, e "sem outras despesas" digitado como 0 continua sendo 0.
--
-- O desconto geral tem unidade, como no Bling: REAL (valor em reais) ou
-- PERCENTUAL. Em PERCENTUAL a base é a soma dos itens — é a leitura mais
-- comum de ERP, e está marcada para confirmar na homologação do Bling
-- (plano, D12 e §12 da especificação) antes de qualquer pedido sair com ela.
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS other_expenses NUMERIC(12,2)
    CHECK (other_expenses IS NULL OR other_expenses >= 0),
  ADD COLUMN IF NOT EXISTS general_discount NUMERIC(12,2)
    CHECK (general_discount IS NULL OR general_discount >= 0),
  ADD COLUMN IF NOT EXISTS general_discount_unit TEXT NOT NULL DEFAULT 'REAL'
    CHECK (general_discount_unit IN ('REAL', 'PERCENTUAL'));

-- Porcentagem acima de 100 não é desconto, é erro de digitação. Separado
-- das colunas porque cita duas delas.
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_general_discount_percent;
ALTER TABLE deals
  ADD CONSTRAINT deals_general_discount_percent
  CHECK (
    general_discount_unit <> 'PERCENTUAL'
    OR general_discount IS NULL
    OR general_discount <= 100
  );

COMMENT ON COLUMN deals.other_expenses IS
  'Outras despesas do pedido (Bling: outrasDespesas). NULL = não informado.';
COMMENT ON COLUMN deals.general_discount IS
  'Desconto geral do pedido, na unidade de general_discount_unit (Bling: desconto.valor). '
  'O desconto de item fica em deal_items.discount_percent e não é subtraído de novo.';
COMMENT ON COLUMN deals.general_discount_unit IS
  'REAL ou PERCENTUAL (Bling: desconto.unidade). Em PERCENTUAL a base é a soma dos itens.';

-- O arquivo do orçamento congela o que imprimiu, como a 076 fez com
-- pagamento e transporte. `discount_amount` é o valor em reais que saiu no
-- papel — em PERCENTUAL ele depende da soma dos itens daquele dia, e
-- recalcular depois poderia dar outro número.
ALTER TABLE deal_quotes
  ADD COLUMN IF NOT EXISTS other_expenses NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS general_discount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS general_discount_unit TEXT
    CHECK (general_discount_unit IS NULL OR general_discount_unit IN ('REAL', 'PERCENTUAL')),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2);


-- ============================================================
-- 2. FRETE POR CONTA COMO O CÓDIGO DO BLING (F0.4)
--
-- A 075 criou `freight_mode` dizendo que ele guardaria o código de 0 a 9
-- do Bling. O que a gaveta gravou foi a CHAVE do catálogo de tradução
-- (`freightCif`, `freightFob`…) — nem o código, nem o rótulo. Uma chave de
-- i18n é um detalhe da interface: renomear uma mensagem mudaria o
-- significado de linhas gravadas, e nenhum sistema de fora sabe o que é
-- `freightOwnSender`.
--
-- O código é o `fretePorConta` do Bling, fixo em todo pedido do país:
--
--     0  contratação por conta do remetente (CIF)
--     1  contratação por conta do destinatário (FOB)
--     2  contratação por conta de terceiros
--     3  transporte próprio por conta do remetente
--     4  transporte próprio por conta do destinatário
--     9  sem ocorrência de transporte
--
-- SEM CHECK DE VALORES, de propósito. A versão do app anterior a esta
-- migração grava a chave; um CHECK aplicado antes do deploy do app novo
-- faria toda gravação de oportunidade com frete por conta falhar. O app
-- novo lê as duas formas e grava só o código (`lib/deals/freight.ts`), e
-- esta atualização converte o que já está gravado.
-- ============================================================
UPDATE deals
   SET freight_mode = CASE freight_mode
     WHEN 'freightCif' THEN '0'
     WHEN 'freightFob' THEN '1'
     WHEN 'freightThird' THEN '2'
     WHEN 'freightOwnSender' THEN '3'
     WHEN 'freightOwnReceiver' THEN '4'
     WHEN 'freightNone' THEN '9'
   END
 WHERE freight_mode IN (
   'freightCif', 'freightFob', 'freightThird',
   'freightOwnSender', 'freightOwnReceiver', 'freightNone'
 );

COMMENT ON COLUMN deals.freight_mode IS
  'Frete por conta: o código fretePorConta do Bling (0, 1, 2, 3, 4 ou 9). '
  'Linhas anteriores à 078 guardavam a chave de tradução; esta migração as converteu.';


-- ============================================================
-- 3. GRAVAR A OPORTUNIDADE NUMA TRANSAÇÃO SÓ (F0.5)
--
-- A gaveta gravava em três chamadas ao PostgREST, sem transação:
--
--     1. UPDATE deals
--     2. DELETE deal_items + INSERT deal_items
--     3. DELETE deal_installments + INSERT deal_installments
--
-- Uma falha no meio deixava a oportunidade pela metade: o cabeçalho novo
-- com os itens velhos, ou pior, com itens nenhum (o DELETE passou, o
-- INSERT não). O comentário de `replaceDealItems` já admitia isso — "a
-- transaction the client cannot open... which PostgREST cannot do". Uma
-- função pode: uma chamada RPC roda numa transação só, e qualquer erro
-- desfaz tudo.
--
-- Isso deixa de ser detalhe quando o pedido vai para um ERP: um PUT no
-- Bling montado a partir de uma gravação pela metade mandaria itens
-- errados com o cabeçalho certo.
--
-- SECURITY INVOKER (o padrão), como a 025: a função roda como quem chama,
-- então a RLS de `deals`, `deal_items` e `deal_installments` continua
-- valendo inteira. Ela não dá a ninguém poder que a pessoa não tinha — só
-- junta numa transação o que a pessoa já podia fazer em três.
--
-- Os parâmetros:
--   p_deal_id       NULL cria; um id atualiza (e falha se a RLS não deixar
--                   ver a linha — sem isto o UPDATE casaria zero linhas em
--                   silêncio, o defeito que a F0.3 acabou de fechar em
--                   outra tabela)
--   p_deal          a linha, com os nomes das colunas; na atualização, só
--                   as chaves PRESENTES são escritas
--   p_items         o conjunto final das linhas; NULL = não mexer nelas
--   p_installments  o conjunto final das parcelas; NULL = não mexer nelas
--
-- Devolve o id da oportunidade.
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_deal_order(
  p_deal_id UUID,
  p_deal JSONB,
  p_items JSONB,
  p_installments JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID := p_deal_id;
  v_account UUID;
BEGIN
  IF p_deal IS NULL OR jsonb_typeof(p_deal) <> 'object' THEN
    RAISE EXCEPTION 'save_deal_order: p_deal precisa ser um objeto'
      USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO deals (
      account_id, user_id, status,
      title, sales_order_number, value, shipping_cost, carrier, currency,
      contact_id, pipeline_id, stage_id, assigned_to, notes,
      expected_close_date,
      freight_mode, freight_volumes, gross_weight, payment_terms,
      other_expenses, general_discount, general_discount_unit
    )
    VALUES (
      (p_deal->>'account_id')::uuid,
      auth.uid(),
      'open',
      p_deal->>'title',
      NULLIF(p_deal->>'sales_order_number', ''),
      COALESCE((p_deal->>'value')::numeric, 0),
      (p_deal->>'shipping_cost')::numeric,
      NULLIF(p_deal->>'carrier', ''),
      COALESCE(NULLIF(p_deal->>'currency', ''), 'BRL'),
      (p_deal->>'contact_id')::uuid,
      (p_deal->>'pipeline_id')::uuid,
      (p_deal->>'stage_id')::uuid,
      NULLIF(p_deal->>'assigned_to', '')::uuid,
      NULLIF(p_deal->>'notes', ''),
      NULLIF(p_deal->>'expected_close_date', '')::date,
      NULLIF(p_deal->>'freight_mode', ''),
      (p_deal->>'freight_volumes')::numeric,
      (p_deal->>'gross_weight')::numeric,
      NULLIF(p_deal->>'payment_terms', ''),
      (p_deal->>'other_expenses')::numeric,
      (p_deal->>'general_discount')::numeric,
      COALESCE(NULLIF(p_deal->>'general_discount_unit', ''), 'REAL')
    )
    RETURNING id, account_id INTO v_id, v_account;
  ELSE
    UPDATE deals SET
      title = CASE WHEN p_deal ? 'title' THEN p_deal->>'title' ELSE title END,
      sales_order_number = CASE WHEN p_deal ? 'sales_order_number'
        THEN NULLIF(p_deal->>'sales_order_number', '') ELSE sales_order_number END,
      value = CASE WHEN p_deal ? 'value'
        THEN COALESCE((p_deal->>'value')::numeric, 0) ELSE value END,
      shipping_cost = CASE WHEN p_deal ? 'shipping_cost'
        THEN (p_deal->>'shipping_cost')::numeric ELSE shipping_cost END,
      carrier = CASE WHEN p_deal ? 'carrier'
        THEN NULLIF(p_deal->>'carrier', '') ELSE carrier END,
      currency = CASE WHEN p_deal ? 'currency'
        THEN COALESCE(NULLIF(p_deal->>'currency', ''), currency) ELSE currency END,
      contact_id = CASE WHEN p_deal ? 'contact_id'
        THEN (p_deal->>'contact_id')::uuid ELSE contact_id END,
      pipeline_id = CASE WHEN p_deal ? 'pipeline_id'
        THEN (p_deal->>'pipeline_id')::uuid ELSE pipeline_id END,
      stage_id = CASE WHEN p_deal ? 'stage_id'
        THEN (p_deal->>'stage_id')::uuid ELSE stage_id END,
      assigned_to = CASE WHEN p_deal ? 'assigned_to'
        THEN NULLIF(p_deal->>'assigned_to', '')::uuid ELSE assigned_to END,
      notes = CASE WHEN p_deal ? 'notes'
        THEN NULLIF(p_deal->>'notes', '') ELSE notes END,
      expected_close_date = CASE WHEN p_deal ? 'expected_close_date'
        THEN NULLIF(p_deal->>'expected_close_date', '')::date ELSE expected_close_date END,
      freight_mode = CASE WHEN p_deal ? 'freight_mode'
        THEN NULLIF(p_deal->>'freight_mode', '') ELSE freight_mode END,
      freight_volumes = CASE WHEN p_deal ? 'freight_volumes'
        THEN (p_deal->>'freight_volumes')::numeric ELSE freight_volumes END,
      gross_weight = CASE WHEN p_deal ? 'gross_weight'
        THEN (p_deal->>'gross_weight')::numeric ELSE gross_weight END,
      payment_terms = CASE WHEN p_deal ? 'payment_terms'
        THEN NULLIF(p_deal->>'payment_terms', '') ELSE payment_terms END,
      other_expenses = CASE WHEN p_deal ? 'other_expenses'
        THEN (p_deal->>'other_expenses')::numeric ELSE other_expenses END,
      general_discount = CASE WHEN p_deal ? 'general_discount'
        THEN (p_deal->>'general_discount')::numeric ELSE general_discount END,
      general_discount_unit = CASE WHEN p_deal ? 'general_discount_unit'
        THEN COALESCE(NULLIF(p_deal->>'general_discount_unit', ''), 'REAL')
        ELSE general_discount_unit END,
      updated_at = NOW()
    WHERE id = v_id
    RETURNING account_id INTO v_account;

    -- Zero linhas é "não existe" ou "a RLS não deixa": nos dois casos a
    -- gravação não aconteceu, e dizer isso é o contrário do silêncio.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'save_deal_order: oportunidade % não encontrada ou sem permissão', v_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_items IS NOT NULL THEN
    DELETE FROM deal_items WHERE deal_id = v_id;

    INSERT INTO deal_items (
      account_id, deal_id, product_id, name, sku, unit,
      quantity, unit_price, discount_percent, position
    )
    SELECT
      v_account,
      v_id,
      NULLIF(item->>'product_id', '')::uuid,
      item->>'name',
      NULLIF(item->>'sku', ''),
      NULLIF(item->>'unit', ''),
      (item->>'quantity')::numeric,
      COALESCE((item->>'unit_price')::numeric, 0),
      COALESCE((item->>'discount_percent')::numeric, 0),
      (ordem - 1)::integer
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS linhas(item, ordem);
  END IF;

  IF p_installments IS NOT NULL THEN
    DELETE FROM deal_installments WHERE deal_id = v_id;

    INSERT INTO deal_installments (
      account_id, deal_id, position, days, due_on, amount, method, note
    )
    SELECT
      v_account,
      v_id,
      (ordem - 1)::integer,
      COALESCE((parcela->>'days')::integer, 0),
      NULLIF(parcela->>'due_on', '')::date,
      COALESCE((parcela->>'amount')::numeric, 0),
      NULLIF(parcela->>'method', ''),
      NULLIF(parcela->>'note', '')
    FROM jsonb_array_elements(p_installments) WITH ORDINALITY AS parcelas(parcela, ordem);
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_deal_order(UUID, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_deal_order(UUID, JSONB, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.save_deal_order(UUID, JSONB, JSONB, JSONB) IS
  'Grava a oportunidade, as linhas e as parcelas numa transação só (Fase 0, F0.5). '
  'SECURITY INVOKER: a RLS das três tabelas vale inteira.';
