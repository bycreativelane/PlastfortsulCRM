-- ============================================================
-- 058_inbound_hooks.sql — a porta de entrada para Typebot, n8n e afins
--
-- O CRM já é um n8n pequeno: o motor de automação tem gatilhos,
-- condições, onze ações e interpolação de `{{vars.qualquer_coisa}}`.
-- O que faltava era um jeito de alguém de fora ENTREGAR essas vars.
--
-- Esta migração cria essa porta.
--
-- ------------------------------------------------------------------
-- O MODELO DE AMEAÇA, PORQUE ELE DECIDE O SCHEMA INTEIRO
-- ------------------------------------------------------------------
--
-- Uma rota pública que dispara automações consegue acionar
-- `send_message`. Ou seja: quem alcançar a URL faz o número da empresa
-- mandar WhatsApp para qualquer telefone — e a consequência não é
-- constrangimento, é **a Meta banir o número**. Para uma distribuidora
-- cujo canal comercial é aquele número, é existencial.
--
-- E o risco maior não é o atacante. É o LOOP: um fluxo do n8n com um
-- `for` mal fechado dispara do IP autorizado, com o token correto, mil
-- vezes. Toda defesa baseada em "quem é você" deixa passar, porque a
-- resposta está certa.
--
-- Daí as três colunas que carregam a segurança deste arquivo:
--
--   scopes        o que este hook PODE fazer — mensagens desligadas
--   allowed_ips   de onde ele pode falar
--   token_hash    e nunca o token em si
--
-- Idempotente.
-- ============================================================


-- ============================================================
-- 1. Os hooks
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_hooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Como a pessoa reconhece este hook na tela. "typebot-orçamento".
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),

  -- SHA-256 do token, nunca o token.
  --
  -- Mesmo tratamento que `invitations.token_hash` (017) dá ao convite,
  -- e pelo mesmo motivo: um dump do banco não pode virar acesso. O
  -- texto é mostrado uma vez, na criação, e nunca mais existe do lado
  -- de cá.
  token_hash TEXT NOT NULL UNIQUE,
  -- Os primeiros caracteres, em claro, só para a tela conseguir dizer
  -- QUAL token é qual sem poder reconstruí-lo.
  token_hint TEXT,

  /**
   * O QUE ESTE HOOK PODE FAZER — a coluna mais importante do arquivo.
   *
   * Duas palavras, e a linha entre elas é onde mora o risco:
   *
   *   data      escrever no CRM — campos, etiquetas, oportunidades
   *   messages  qualquer coisa que chegue no WhatsApp de um cliente
   *
   * `messages` NÃO entra no padrão. Com ele fora, um token vazado (ou um
   * loop do n8n) vira poluição de dados: chato, reversível, revogável em
   * um clique. Com ele dentro, vira um canhão apontado para o próprio
   * número.
   *
   * Duas e não oito: granularidade fina aqui é decoração. A pergunta que
   * alguém realmente faz é "isso pode falar com meu cliente?".
   */
  scopes TEXT[] NOT NULL DEFAULT ARRAY['data']::TEXT[]
    CHECK (scopes <@ ARRAY['data', 'messages']::TEXT[]),

  /**
   * De onde ele pode falar. Vazio = de qualquer lugar.
   *
   * Vale porque o n8n e o Typebot deste time rodam em servidor próprio,
   * com IP fixo — então esta é a única defesa que **não custa nada na
   * ponta que envia**: nenhum header para configurar, nenhum token para
   * colar, nada que quebre quando alguém recria o fluxo.
   *
   * Guardado como texto e comparado como texto: são poucos endereços,
   * escritos à mão, e um tipo `INET` traria normalização (`::ffff:` em
   * IPv4-mapped) que confunde mais do que ajuda numa lista curta.
   */
  allowed_ips TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- Responde "parou de funcionar?" e "alguém usa isto que eu não
  -- conheço?" sem abrir log nenhum.
  last_used_at TIMESTAMPTZ,
  last_error TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_hooks_account
  ON webhook_hooks(account_id);

COMMENT ON COLUMN webhook_hooks.scopes IS
  'data | messages. `messages` fora do padrão de propósito: é a '
  'diferença entre um token vazado ser poluição de dados e ser um '
  'banimento do número na Meta.';


-- ============================================================
-- 2. As entregas — o que chegou, para poder depurar
--
-- Sem isto, "não funcionou" vira adivinhação, que é o que mais dói em
-- integração por webhook.
--
-- ------------------------------------------------------------------
-- RETENÇÃO CURTA, E ISSO NÃO É DETALHE
-- ------------------------------------------------------------------
--
-- O payload traz telefone e nome — dado pessoal. Guardar isso
-- indefinidamente é criar um banco paralelo de PII que ninguém sabe que
-- existe, e é exatamente o que a LGPD alcança. Sete dias, apagados pela
-- função abaixo.
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hook_id UUID NOT NULL REFERENCES webhook_hooks(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'duplicate', 'rejected')),

  payload JSONB,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  error TEXT,

  /**
   * IDEMPOTÊNCIA.
   *
   * Typebot com retry manda o mesmo POST duas vezes, e sem isto são dois
   * negócios criados e o vendedor ligando duas vezes para a mesma
   * pessoa. Vem do campo `event_id` do payload quando existe, e do hash
   * do corpo quando não.
   *
   * Índice ÚNICO PARCIAL: só as entregas aceitas competem. Uma rejeitada
   * não deve impedir a próxima tentativa de passar — é justamente o caso
   * em que o retry é o comportamento certo.
   */
  dedupe_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_dedupe
  ON webhook_deliveries(hook_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'accepted';

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook
  ON webhook_deliveries(hook_id, received_at DESC);


-- ============================================================
-- 3. RLS: só admin vê, e ninguém escreve pela API pública
--
-- Estas linhas SÃO a configuração de segurança da porta de entrada —
-- token, escopo, lista de IPs. Um agente que pudesse lê-las teria o
-- suficiente para saber onde bater; um que pudesse escrevê-las poderia
-- se dar `messages`.
-- ============================================================
ALTER TABLE webhook_hooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_hooks_select ON webhook_hooks;
CREATE POLICY webhook_hooks_select ON webhook_hooks FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_hooks_insert ON webhook_hooks;
CREATE POLICY webhook_hooks_insert ON webhook_hooks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_hooks_update ON webhook_hooks;
CREATE POLICY webhook_hooks_update ON webhook_hooks FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_hooks_delete ON webhook_hooks;
CREATE POLICY webhook_hooks_delete ON webhook_hooks FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON webhook_deliveries FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- Sem INSERT/UPDATE/DELETE para ninguém autenticado. As entregas são
-- escritas SÓ pela rota, com service role. Uma política de escrita aqui
-- deixaria um admin forjar histórico de entrega — que é o oposto do que
-- um registro de depuração serve.


-- ============================================================
-- 4. A limpeza
--
-- Chamada pelo mesmo cron que já roda as automações agendadas. Sete
-- dias: tempo de sobra para depurar "chegou na sexta e não funcionou" e
-- curto o bastante para não virar arquivo permanente de PII.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prune_webhook_deliveries()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM webhook_deliveries
   WHERE received_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$fn$;

REVOKE ALL ON FUNCTION public.prune_webhook_deliveries() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_webhook_deliveries() FROM anon;
REVOKE ALL ON FUNCTION public.prune_webhook_deliveries() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_webhook_deliveries() TO service_role;
