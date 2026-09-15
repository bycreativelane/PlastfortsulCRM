-- ============================================================
-- 085_bling_order_fields
--
-- O pedido completo no CRM, ainda sem enviar — D8 (Fase 2) e Fase 3 de
-- `docs/spec-orcamentos-bling.md`, numa migração só: as duas mexem na mesma
-- gaveta, na mesma função de gravação e nas mesmas camadas da linha.
--
-- ------------------------------------------------------------
-- D8: TRANSPORTADORA, VENDEDOR E FORMA DE PAGAMENTO POR ID
-- ------------------------------------------------------------
--
-- `carriers` é um cadastro novo (admin), semeado com os nomes que já estão em
-- `deals.carrier`, com o contato do transportador no Bling e o frete-por-conta
-- padrão. A oportunidade guarda `carrier_id`; o texto `carrier` continua, como
-- rótulo congelado e histórico.
--
-- `bling_seller_links` liga a pessoa da equipe ao vendedor do Bling. Não mexe
-- em `profiles`, cujo gatilho de proteção (034, 050) teria de ser ampliado.
--
-- A parcela guarda `payment_method_bling_id`; `method` continua como o rótulo
-- congelado da forma na hora em que foi escolhida.
--
-- ------------------------------------------------------------
-- FASE 3: O QUE O PEDIDO PRECISA
-- ------------------------------------------------------------
--
-- Datas (venda, saída, prevista, prazo em dias, validade), observações
-- internas, a categoria de receita escolhida quando o pedido mistura famílias
-- (com quem escolheu e por quê), volumes confirmados, a exceção de peso
-- autorizada. Nos itens, o que o documento e o Bling precisam congelado na
-- linha: preço de lista, peso bruto unitário, id do produto no Bling,
-- categoria e se o item decide a categoria. No contato, os dados fiscais e o
-- endereço que a especificação exige para emitir.
--
-- ------------------------------------------------------------
-- O QUE SÓ O SERVIDOR ESCREVE
-- ------------------------------------------------------------
--
-- `order_status`, o vínculo com o pedido do Bling e o estado da sincronização
-- mudam por ação explícita (D1 = B) ou pelo que o Bling devolve — nunca por um
-- PATCH do navegador. `guard_deal_order_columns` recusa a mudança quando quem
-- escreve é `authenticated`; o service role e as funções SECURITY DEFINER
-- passam. Sem isso, qualquer agente mudaria "Em andamento" para "Em aberto"
-- num PATCH e destravaria um pedido com contas lançadas.
--
-- ------------------------------------------------------------
-- AS TRAVAS POR SITUAÇÃO, NO BANCO
-- ------------------------------------------------------------
--
-- A tabela do plano (§5, Fase 3):
--
--   Em aberto / Compra futura, sem lançamento   tudo
--   Em andamento (ou com contas lançadas)       congela cliente, itens, preços,
--                                               descontos, categoria, frete e
--                                               parcelas
--   Atendido                                    só o que é do CRM
--   Cancelado                                   só o que é do CRM
--
-- "O que é do CRM" — título, observações, responsável, etapa, datas de
-- acompanhamento, ganho/perdido — nunca vai ao Bling e continua editável.
-- Em andamento também deixa confirmar volumes e peso, e as datas de saída e
-- prevista: são dados da produção, que acontecem justamente nessa fase.
--
-- A trava é um gatilho, e não só a gaveta: um PATCH direto pelo PostgREST
-- passaria pela RLS. E ela congela por EXCLUSÃO — só as colunas listadas como
-- livres podem mudar; uma coluna que uma migração futura acrescentar nasce
-- travada até alguém decidir o contrário.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Transportadoras
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS carriers (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id                  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  -- O transportador como contato no Bling, e o nome dele lá na hora da escolha.
  bling_contact_id            TEXT,
  bling_contact_name          TEXT,
  bling_logistics_id          TEXT,
  bling_logistics_service_id  TEXT,
  -- O código do frete-por-conta do Bling (lib/deals/freight.ts).
  default_freight_payer_code  TEXT CHECK (
                                default_freight_payer_code IS NULL
                                OR default_freight_payer_code IN ('0', '1', '2', '3', '4', '9')
                              ),
  requires_freight_value      BOOLEAN NOT NULL DEFAULT FALSE,
  is_customer_pickup          BOOLEAN NOT NULL DEFAULT FALSE,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_carriers_account_name
  ON carriers (account_id, lower(trim(name)));

ALTER TABLE carriers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS carriers_select ON carriers;
CREATE POLICY carriers_select ON carriers FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS carriers_insert ON carriers;
CREATE POLICY carriers_insert ON carriers FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS carriers_update ON carriers;
CREATE POLICY carriers_update ON carriers FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
-- Sem DELETE: transportadora sai de uso com `active = false`, porque pedidos
-- antigos apontam para ela.

-- A semente: cada nome distinto que já está numa oportunidade, menos "A
-- definir" (não é transportadora, é a falta de uma). "Cliente retira" entra
-- marcado como retirada.
INSERT INTO carriers (account_id, name, is_customer_pickup)
SELECT DISTINCT ON (d.account_id, lower(trim(d.carrier)))
       d.account_id,
       trim(d.carrier),
       lower(trim(d.carrier)) LIKE 'cliente retira%'
  FROM deals d
 WHERE d.carrier IS NOT NULL
   AND length(trim(d.carrier)) BETWEEN 1 AND 120
   AND lower(trim(d.carrier)) NOT IN ('a definir', 'to be defined', '미정')
 ORDER BY d.account_id, lower(trim(d.carrier)), d.created_at
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 2. Vendedor do Bling por pessoa da equipe
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_seller_links (
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bling_seller_id  TEXT NOT NULL,
  company_id       TEXT NOT NULL,
  linked_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (account_id, user_id),
  UNIQUE (account_id, bling_seller_id)
);

ALTER TABLE bling_seller_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bling_seller_links_select ON bling_seller_links;
CREATE POLICY bling_seller_links_select ON bling_seller_links FOR SELECT
  USING (is_account_member(account_id));
-- Escrita pela rota de admin.

-- ------------------------------------------------------------
-- 3. A oportunidade como pedido
-- ------------------------------------------------------------

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_date DATE,
  ADD COLUMN IF NOT EXISTS departure_date DATE,
  ADD COLUMN IF NOT EXISTS expected_date DATE,
  ADD COLUMN IF NOT EXISTS delivery_days INTEGER CHECK (delivery_days IS NULL OR delivery_days BETWEEN 0 AND 3650),
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT CHECK (internal_notes IS NULL OR length(internal_notes) <= 4000),
  ADD COLUMN IF NOT EXISTS revenue_category_bling_id TEXT,
  ADD COLUMN IF NOT EXISTS revenue_category_chosen_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_category_note TEXT CHECK (revenue_category_note IS NULL OR length(revenue_category_note) <= 240),
  ADD COLUMN IF NOT EXISTS freight_volumes_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS weight_exception_note TEXT CHECK (weight_exception_note IS NULL OR length(weight_exception_note) <= 240),
  ADD COLUMN IF NOT EXISTS weight_exception_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Só o servidor escreve (ver o cabeçalho).
  ADD COLUMN IF NOT EXISTS order_status TEXT CHECK (
    order_status IS NULL
    OR order_status IN ('em_aberto', 'em_andamento', 'atendido', 'cancelado', 'compra_futura')
  ),
  ADD COLUMN IF NOT EXISTS bling_order_id TEXT,
  ADD COLUMN IF NOT EXISTS bling_external_key TEXT,
  ADD COLUMN IF NOT EXISTS bling_order_number TEXT,
  ADD COLUMN IF NOT EXISTS sync_status TEXT CHECK (
    sync_status IS NULL
    OR sync_status IN ('not_sent', 'syncing', 'synced', 'pending', 'error', 'divergent')
  ),
  ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_error TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounts_launched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stock_launched_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_account_bling_order
  ON deals (account_id, bling_order_id)
  WHERE bling_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_account_bling_key
  ON deals (account_id, bling_external_key)
  WHERE bling_external_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_sync_pending
  ON deals (account_id, sync_status)
  WHERE sync_status IN ('syncing', 'pending', 'error', 'divergent');

-- As oportunidades que já tinham transportadora escrita passam a apontar
-- para o cadastro. Sem mexer em `updated_at`: é o mesmo dado, reorganizado.
ALTER TABLE deals DISABLE TRIGGER set_updated_at;
UPDATE deals d
   SET carrier_id = c.id
  FROM carriers c
 WHERE c.account_id = d.account_id
   AND lower(trim(c.name)) = lower(trim(d.carrier))
   AND d.carrier_id IS NULL;
ALTER TABLE deals ENABLE TRIGGER set_updated_at;

-- ------------------------------------------------------------
-- 4. Snapshots nas linhas e nas parcelas
-- ------------------------------------------------------------

ALTER TABLE deal_items
  ADD COLUMN IF NOT EXISTS list_price NUMERIC(12,2) CHECK (list_price IS NULL OR list_price >= 0),
  ADD COLUMN IF NOT EXISTS unit_gross_weight_kg NUMERIC(12,3) CHECK (unit_gross_weight_kg IS NULL OR unit_gross_weight_kg >= 0),
  ADD COLUMN IF NOT EXISTS bling_product_id TEXT,
  ADD COLUMN IF NOT EXISTS revenue_category_bling_id TEXT,
  ADD COLUMN IF NOT EXISTS defines_order_category BOOLEAN NOT NULL DEFAULT TRUE,
  -- Produto físico (P) pesa; serviço não. Congelado junto, porque o
  -- produto pode mudar de tipo depois.
  ADD COLUMN IF NOT EXISTS bling_product_type TEXT CHECK (bling_product_type IS NULL OR bling_product_type IN ('P', 'S', 'N'));

ALTER TABLE deal_installments
  ADD COLUMN IF NOT EXISTS payment_method_bling_id TEXT;

-- ------------------------------------------------------------
-- 5. O contato para emitir
-- ------------------------------------------------------------

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS person_type TEXT CHECK (person_type IS NULL OR person_type IN ('F', 'J')),
  ADD COLUMN IF NOT EXISTS trade_name TEXT CHECK (trade_name IS NULL OR length(trim(trade_name)) <= 120),
  ADD COLUMN IF NOT EXISTS state_registration TEXT CHECK (state_registration IS NULL OR length(trim(state_registration)) <= 30),
  -- 1 contribuinte de ICMS · 2 isento · 9 não contribuinte (códigos da NF-e)
  ADD COLUMN IF NOT EXISTS taxpayer_indicator TEXT CHECK (taxpayer_indicator IS NULL OR taxpayer_indicator IN ('1', '2', '9')),
  ADD COLUMN IF NOT EXISTS rg TEXT CHECK (rg IS NULL OR length(trim(rg)) <= 20),
  ADD COLUMN IF NOT EXISTS zip_code TEXT CHECK (zip_code IS NULL OR zip_code ~ '^[0-9]{8}$'),
  ADD COLUMN IF NOT EXISTS street TEXT CHECK (street IS NULL OR length(trim(street)) <= 120),
  ADD COLUMN IF NOT EXISTS street_number TEXT CHECK (street_number IS NULL OR length(trim(street_number)) <= 20),
  ADD COLUMN IF NOT EXISTS complement TEXT CHECK (complement IS NULL OR length(trim(complement)) <= 60),
  ADD COLUMN IF NOT EXISTS district TEXT CHECK (district IS NULL OR length(trim(district)) <= 60),
  ADD COLUMN IF NOT EXISTS nfe_email TEXT CHECK (nfe_email IS NULL OR length(trim(nfe_email)) <= 120),
  ADD COLUMN IF NOT EXISTS landline_phone TEXT CHECK (landline_phone IS NULL OR length(trim(landline_phone)) <= 30),
  ADD COLUMN IF NOT EXISTS bling_contact_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_bling
  ON contacts (account_id, bling_contact_id)
  WHERE bling_contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- 6. O que só o servidor muda, e as travas por situação
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.deal_order_locked(p_status TEXT, p_launched TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- 'open' (tudo), 'in_progress' (congela o pedido), 'closed' (só o CRM)
  SELECT CASE
    WHEN p_status IN ('atendido', 'cancelado') THEN 'closed'
    WHEN p_status = 'em_andamento' OR p_launched IS NOT NULL THEN 'in_progress'
    ELSE 'open'
  END;
$$;

CREATE OR REPLACE FUNCTION public.guard_deal_order_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c_servidor CONSTANT TEXT[] := ARRAY[
    'order_status', 'bling_order_id', 'bling_external_key', 'bling_order_number',
    'sync_status', 'sync_version', 'sync_error', 'last_synced_at',
    'accounts_launched_at', 'stock_launched_at'
  ];
  -- O que é só do CRM: nunca vai ao Bling, e muda em qualquer situação.
  -- `status` e `lost_reason`/`lost_note` são o ganho/perdido do funil (001,
  -- 043); `stage_entered_at` é escrito pelo gatilho da 065.
  c_do_crm CONSTANT TEXT[] := ARRAY[
    'title', 'notes', 'internal_notes', 'assigned_to', 'pipeline_id', 'stage_id',
    'stage_entered_at', 'expected_close_date', 'status', 'lost_reason',
    'lost_note', 'updated_at'
  ];
  -- Dados da produção, livres também em Em andamento.
  c_da_producao CONSTANT TEXT[] := ARRAY[
    'departure_date', 'expected_date', 'delivery_days', 'freight_volumes',
    'gross_weight', 'freight_volumes_confirmed'
  ];
  v_trava TEXT;
  v_livres TEXT[];
BEGIN
  IF current_user <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Apagar uma oportunidade que já é pedido no Bling deixaria o pedido
  -- órfão lá — com contas lançadas, se passou de Em aberto. Exclusão de
  -- pedido está fora do escopo (§9 do plano).
  IF TG_OP = 'DELETE' THEN
    IF OLD.bling_order_id IS NOT NULL OR OLD.order_status IS NOT NULL THEN
      RAISE EXCEPTION 'guard_deal_order_columns: esta oportunidade já é pedido no Bling e não pode ser apagada'
        USING ERRCODE = '42501',
              HINT = 'order_locked';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.order_status IS NOT NULL OR NEW.bling_order_id IS NOT NULL
       OR NEW.bling_external_key IS NOT NULL OR NEW.bling_order_number IS NOT NULL
       OR NEW.sync_status IS NOT NULL OR NEW.sync_version <> 0 OR NEW.sync_error IS NOT NULL
       OR NEW.last_synced_at IS NOT NULL OR NEW.accounts_launched_at IS NOT NULL
       OR NEW.stock_launched_at IS NOT NULL THEN
      RAISE EXCEPTION 'guard_deal_order_columns: o estado do pedido no Bling só muda pelo servidor'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- O estado do pedido no Bling: nunca pelo navegador.
  IF (to_jsonb(NEW) - ARRAY(SELECT jsonb_object_keys(to_jsonb(NEW)) EXCEPT SELECT unnest(c_servidor)))
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY(SELECT jsonb_object_keys(to_jsonb(OLD)) EXCEPT SELECT unnest(c_servidor))) THEN
    RAISE EXCEPTION 'guard_deal_order_columns: o estado do pedido no Bling só muda pelo servidor'
      USING ERRCODE = '42501';
  END IF;

  v_trava := deal_order_locked(OLD.order_status, OLD.accounts_launched_at);
  IF v_trava = 'open' THEN
    RETURN NEW;
  END IF;

  v_livres := c_do_crm || c_servidor || CASE WHEN v_trava = 'in_progress' THEN c_da_producao ELSE ARRAY[]::TEXT[] END;
  IF (to_jsonb(NEW) - v_livres) IS DISTINCT FROM (to_jsonb(OLD) - v_livres) THEN
    RAISE EXCEPTION 'guard_deal_order_columns: pedido %: estes campos estão travados nesta situação',
      COALESCE(OLD.order_status, 'com contas lançadas')
      USING ERRCODE = '42501',
            HINT = 'order_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_guard_order_columns ON deals;
CREATE TRIGGER deals_guard_order_columns
  BEFORE INSERT OR UPDATE OR DELETE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_order_columns();

-- Linhas e parcelas de um pedido travado não mudam — nem por INSERT, UPDATE
-- ou DELETE, que é como a gravação atômica (078) reescreve as duas.
CREATE OR REPLACE FUNCTION public.guard_deal_children_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deal UUID;
  v_status TEXT;
  v_lancado TIMESTAMPTZ;
BEGIN
  IF current_user <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Por TG_OP, e não COALESCE(NEW, OLD): num DELETE, NEW não tem campos.
  IF TG_OP = 'DELETE' THEN
    v_deal := OLD.deal_id;
  ELSE
    v_deal := NEW.deal_id;
  END IF;

  SELECT order_status, accounts_launched_at INTO v_status, v_lancado
    FROM deals WHERE id = v_deal;

  IF deal_order_locked(v_status, v_lancado) <> 'open' THEN
    RAISE EXCEPTION 'guard_deal_children_locked: pedido %: itens e parcelas travados nesta situação',
      COALESCE(v_status, 'com contas lançadas')
      USING ERRCODE = '42501',
            HINT = 'order_locked';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deal_items_guard_locked ON deal_items;
CREATE TRIGGER deal_items_guard_locked
  BEFORE INSERT OR UPDATE OR DELETE ON deal_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_children_locked();

DROP TRIGGER IF EXISTS deal_installments_guard_locked ON deal_installments;
CREATE TRIGGER deal_installments_guard_locked
  BEFORE INSERT OR UPDATE OR DELETE ON deal_installments
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_children_locked();

-- ------------------------------------------------------------
-- 7. A gravação atômica, com os campos novos
-- ------------------------------------------------------------
--
-- Mesma assinatura da 078 (o ACL fica: a 079 tirou anon por nome). A
-- oportunidade só grava as colunas PRESENTES em `p_deal`; as de servidor não
-- estão na lista e nunca passam por aqui.

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
      other_expenses, general_discount, general_discount_unit,
      carrier_id, sale_date, departure_date, expected_date, delivery_days,
      valid_until, internal_notes, revenue_category_bling_id,
      revenue_category_chosen_by, revenue_category_note,
      freight_volumes_confirmed, weight_exception_note, weight_exception_by
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
      COALESCE(NULLIF(p_deal->>'general_discount_unit', ''), 'REAL'),
      NULLIF(p_deal->>'carrier_id', '')::uuid,
      NULLIF(p_deal->>'sale_date', '')::date,
      NULLIF(p_deal->>'departure_date', '')::date,
      NULLIF(p_deal->>'expected_date', '')::date,
      (p_deal->>'delivery_days')::integer,
      NULLIF(p_deal->>'valid_until', '')::date,
      NULLIF(p_deal->>'internal_notes', ''),
      NULLIF(p_deal->>'revenue_category_bling_id', ''),
      NULLIF(p_deal->>'revenue_category_chosen_by', '')::uuid,
      NULLIF(p_deal->>'revenue_category_note', ''),
      COALESCE((p_deal->>'freight_volumes_confirmed')::boolean, false),
      NULLIF(p_deal->>'weight_exception_note', ''),
      NULLIF(p_deal->>'weight_exception_by', '')::uuid
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
      carrier_id = CASE WHEN p_deal ? 'carrier_id'
        THEN NULLIF(p_deal->>'carrier_id', '')::uuid ELSE carrier_id END,
      sale_date = CASE WHEN p_deal ? 'sale_date'
        THEN NULLIF(p_deal->>'sale_date', '')::date ELSE sale_date END,
      departure_date = CASE WHEN p_deal ? 'departure_date'
        THEN NULLIF(p_deal->>'departure_date', '')::date ELSE departure_date END,
      expected_date = CASE WHEN p_deal ? 'expected_date'
        THEN NULLIF(p_deal->>'expected_date', '')::date ELSE expected_date END,
      delivery_days = CASE WHEN p_deal ? 'delivery_days'
        THEN (p_deal->>'delivery_days')::integer ELSE delivery_days END,
      valid_until = CASE WHEN p_deal ? 'valid_until'
        THEN NULLIF(p_deal->>'valid_until', '')::date ELSE valid_until END,
      internal_notes = CASE WHEN p_deal ? 'internal_notes'
        THEN NULLIF(p_deal->>'internal_notes', '') ELSE internal_notes END,
      revenue_category_bling_id = CASE WHEN p_deal ? 'revenue_category_bling_id'
        THEN NULLIF(p_deal->>'revenue_category_bling_id', '') ELSE revenue_category_bling_id END,
      revenue_category_chosen_by = CASE WHEN p_deal ? 'revenue_category_chosen_by'
        THEN NULLIF(p_deal->>'revenue_category_chosen_by', '')::uuid ELSE revenue_category_chosen_by END,
      revenue_category_note = CASE WHEN p_deal ? 'revenue_category_note'
        THEN NULLIF(p_deal->>'revenue_category_note', '') ELSE revenue_category_note END,
      freight_volumes_confirmed = CASE WHEN p_deal ? 'freight_volumes_confirmed'
        THEN COALESCE((p_deal->>'freight_volumes_confirmed')::boolean, false) ELSE freight_volumes_confirmed END,
      weight_exception_note = CASE WHEN p_deal ? 'weight_exception_note'
        THEN NULLIF(p_deal->>'weight_exception_note', '') ELSE weight_exception_note END,
      weight_exception_by = CASE WHEN p_deal ? 'weight_exception_by'
        THEN NULLIF(p_deal->>'weight_exception_by', '')::uuid ELSE weight_exception_by END,
      updated_at = NOW()
    WHERE id = v_id
    RETURNING account_id INTO v_account;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'save_deal_order: oportunidade % não encontrada ou sem permissão', v_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_items IS NOT NULL THEN
    DELETE FROM deal_items WHERE deal_id = v_id;

    INSERT INTO deal_items (
      account_id, deal_id, product_id, name, sku, unit,
      quantity, unit_price, discount_percent, position,
      list_price, unit_gross_weight_kg, bling_product_id,
      revenue_category_bling_id, defines_order_category, bling_product_type
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
      (ordem - 1)::integer,
      (item->>'list_price')::numeric,
      (item->>'unit_gross_weight_kg')::numeric,
      NULLIF(item->>'bling_product_id', ''),
      NULLIF(item->>'revenue_category_bling_id', ''),
      COALESCE((item->>'defines_order_category')::boolean, true),
      NULLIF(item->>'bling_product_type', '')
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS linhas(item, ordem);
  END IF;

  IF p_installments IS NOT NULL THEN
    DELETE FROM deal_installments WHERE deal_id = v_id;

    INSERT INTO deal_installments (
      account_id, deal_id, position, days, due_on, amount, method, note,
      payment_method_bling_id
    )
    SELECT
      v_account,
      v_id,
      (ordem - 1)::integer,
      COALESCE((parcela->>'days')::integer, 0),
      NULLIF(parcela->>'due_on', '')::date,
      COALESCE((parcela->>'amount')::numeric, 0),
      NULLIF(parcela->>'method', ''),
      NULLIF(parcela->>'note', ''),
      NULLIF(parcela->>'payment_method_bling_id', '')
    FROM jsonb_array_elements(p_installments) WITH ORDINALITY AS parcelas(parcela, ordem);
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.save_deal_order(UUID, JSONB, JSONB, JSONB) IS
  'Grava a oportunidade, as linhas e as parcelas numa transação só (078; campos do pedido na 085). '
  'SECURITY INVOKER: a RLS e as travas por situação valem inteiras.';
