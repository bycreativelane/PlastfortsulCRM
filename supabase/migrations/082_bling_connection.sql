-- ============================================================
-- 082_bling_connection
--
-- A conexão com o Bling: Fase 1 de `docs/spec-orcamentos-bling.md`.
--
-- Nada de pedido, produto ou contato ainda. Esta migração guarda a
-- autorização, impede que o CRM estoure os limites do Bling, e impede que
-- duas renovações do token corram ao mesmo tempo. Tudo o que as fases
-- seguintes vão pendurar aqui (cadastros de referência, fila de operações,
-- webhooks) depende de estas três coisas estarem certas.
--
-- ------------------------------------------------------------
-- UMA CONEXÃO POR CONTA, E RLS LIGADA SEM POLÍTICA
-- ------------------------------------------------------------
--
-- O mesmo desenho de `calendar_connections` (069): a conexão é da EMPRESA,
-- `connected_by` é histórico, e o navegador nunca lê a linha — ela guarda
-- um refresh token que abre o ERP da empresa por 30 dias. O estado sai por
-- rota, com os campos escolhidos à mão e sem os dois cifrados.
--
-- ------------------------------------------------------------
-- O CÓDIGO DE AUTORIZAÇÃO SÓ PODE SER TROCADO UMA VEZ
-- ------------------------------------------------------------
--
-- No Bling, reusar um código ainda válido não é só um erro: ele REVOGA o
-- acesso do usuário, "por segurança" (documentação oficial, erros comuns).
-- Um callback atingido duas vezes — o navegador repetindo a navegação, um
-- clique duplo no consentimento — derrubaria a conexão que acabou de nascer.
--
-- `bling_oauth_codes` guarda o SHA-256 do código (nunca o código) numa
-- chave primária. O callback grava ANTES de trocar: o segundo acerto cai
-- no UNIQUE e não chama o Bling. O código vale um minuto; a linha pode ir
-- embora no dia seguinte.
--
-- ------------------------------------------------------------
-- O LIMITADOR MORA NO BANCO
-- ------------------------------------------------------------
--
-- O Bling aceita 3 requisições por segundo e 120.000 por dia POR CONTA —
-- somando todas as integrações daquela conta — e não manda `Retry-After`.
-- Pior: 600 requisições em 10 segundos bloqueiam o IP do servidor por 10
-- minutos, e 20 chamadas a /oauth/token em 60 segundos o bloqueiam por uma
-- hora. Um contador em memória não serve: o cron, a tela e cada instância
-- do servidor contariam separado.
--
-- `bling_take_request()` é um balde de fichas atômico, com margem: 2 por
-- segundo e 100.000 por dia, deixando folga para as outras integrações da
-- mesma conta Bling. O `FOR UPDATE` na linha da conexão serializa quem chega
-- junto. Devolve 0 (pode ir), N (espere N milissegundos) ou -1 (acabou o dia).
--
-- ------------------------------------------------------------
-- A RENOVAÇÃO TEM DONO
-- ------------------------------------------------------------
--
-- O Bling não documenta se o refresh token muda a cada renovação. Se muda,
-- duas renovações simultâneas com o mesmo refresh token têm um perdedor, e o
-- perdedor pode ser a conexão inteira. `bling_claim_refresh()` entrega a
-- vez a um só, por 30 segundos, e no máximo uma vez por minuto por conexão
-- — bem abaixo das 20 por minuto que bloqueiam o IP. Quem não pegou a vez
-- espera o dono gravar e lê o token novo.
--
-- O molde da Google (069) não tem nada disso, e o plano registra por que
-- não copiar: sem trava, e um refresh que falha não marca a conexão.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A conexão
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_connections (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id           UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,

  -- Quem autorizou. Histórico, não chave (ver 069).
  connected_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- A empresa do outro lado, como `GET /empresas/me/dados-basicos` a
  -- descreve. `company_id` é uma string hexadecimal no Bling, não um número.
  company_id           TEXT NOT NULL,
  company_name         TEXT,
  company_cnpj         TEXT,

  -- Os ids numéricos que a resposta do token traz em `scope`. O Bling não
  -- publica o nome de cada um; a tela mostra quantos.
  scopes               TEXT[] NOT NULL DEFAULT '{}',

  -- Cifrados com `ENCRYPTION_KEY` (`lib/whatsapp/encryption.ts`). O JWT do
  -- Bling tem de 1.500 a 3.000 caracteres, e cifrado dobra: TEXT, não VARCHAR.
  refresh_token        TEXT NOT NULL,
  access_token         TEXT,
  access_expires_at    TIMESTAMPTZ,

  -- Quando o refresh token ATUAL foi emitido. Muda só quando uma renovação
  -- devolve um refresh token diferente do que foi usado: é daqui que a tela
  -- tira "a autorização vence em", e é assim que a homologação vai descobrir
  -- se o Bling gira o refresh token ou não.
  refresh_issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  status               TEXT NOT NULL DEFAULT 'connected'
                       CHECK (status IN ('connected', 'revoked', 'error')),
  last_error           TEXT,
  last_error_at        TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_success_at      TIMESTAMPTZ,

  -- A vez de renovar (ver o cabeçalho).
  refresh_lock_token   UUID,
  refresh_lock_until   TIMESTAMPTZ,
  refresh_attempted_at TIMESTAMPTZ,

  -- O balde de fichas (ver o cabeçalho). Nulo = balde cheio.
  rate_tokens          NUMERIC(6,3),
  rate_updated_at      TIMESTAMPTZ,
  rate_day             DATE,
  rate_day_count       INTEGER NOT NULL DEFAULT 0 CHECK (rate_day_count >= 0),

  connected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bling_connections ENABLE ROW LEVEL SECURITY;
-- E nenhuma política. Ver o cabeçalho.

COMMENT ON TABLE bling_connections IS
  'Autorização OAuth do Bling, uma por conta (082). RLS sem política: só o '
  'service role lê; o estado sai por /api/bling/connection sem os tokens.';

-- ------------------------------------------------------------
-- 2. Códigos de autorização já trocados
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bling_oauth_codes (
  -- SHA-256 hexadecimal do código. O código em si nunca é gravado.
  code_hash   TEXT PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bling_oauth_codes ENABLE ROW LEVEL SECURITY;
-- Nenhuma política também: só o callback, pelo service role, escreve aqui.

-- ------------------------------------------------------------
-- 3. O balde de fichas
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bling_take_request(p_connection_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c_taxa     CONSTANT NUMERIC := 2;       -- fichas por segundo (o Bling aceita 3)
  c_rajada   CONSTANT NUMERIC := 2;       -- o balde cheio
  c_diario   CONSTANT INTEGER := 100000;  -- o Bling aceita 120.000
  v_agora    TIMESTAMPTZ := clock_timestamp();
  -- O dia do Bling não é documentado; o da empresa é o de São Paulo.
  v_hoje     DATE := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_fichas   NUMERIC;
  v_desde    TIMESTAMPTZ;
  v_dia      DATE;
  v_contagem INTEGER;
BEGIN
  SELECT rate_tokens, rate_updated_at, rate_day, rate_day_count
    INTO v_fichas, v_desde, v_dia, v_contagem
    FROM bling_connections
   WHERE id = p_connection_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bling_take_request: conexão % não existe', p_connection_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_dia IS DISTINCT FROM v_hoje THEN
    v_contagem := 0;
  END IF;
  IF v_contagem >= c_diario THEN
    RETURN -1;
  END IF;

  v_fichas := LEAST(
    c_rajada,
    COALESCE(v_fichas, c_rajada)
      + c_taxa * GREATEST(0, EXTRACT(EPOCH FROM (v_agora - COALESCE(v_desde, v_agora))))
  );

  -- Sem ficha inteira: não gasta nada e diz quanto falta. A próxima chamada
  -- recalcula a partir do mesmo ponto, então esperar e voltar é exato.
  IF v_fichas < 1 THEN
    RETURN CEIL((1 - v_fichas) / c_taxa * 1000)::INTEGER;
  END IF;

  UPDATE bling_connections
     SET rate_tokens     = v_fichas - 1,
         rate_updated_at = v_agora,
         rate_day        = v_hoje,
         rate_day_count  = v_contagem + 1
   WHERE id = p_connection_id;

  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.bling_take_request(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_take_request(UUID) TO service_role;

COMMENT ON FUNCTION public.bling_take_request(UUID) IS
  'Balde de fichas por conexão Bling (082): 0 = pode chamar, N = espere N ms, '
  '-1 = limite diário. 2/s e 100.000/dia, abaixo dos 3/s e 120.000 do Bling.';

-- ------------------------------------------------------------
-- 4. A vez de renovar
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bling_claim_refresh(p_connection_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE bling_connections
     SET refresh_lock_token   = gen_random_uuid(),
         refresh_lock_until   = clock_timestamp() + INTERVAL '30 seconds',
         refresh_attempted_at = clock_timestamp()
   WHERE id = p_connection_id
     AND status <> 'revoked'
     AND (refresh_lock_until IS NULL OR refresh_lock_until < clock_timestamp())
     AND (refresh_attempted_at IS NULL
          OR refresh_attempted_at < clock_timestamp() - INTERVAL '60 seconds')
  RETURNING refresh_lock_token;
$$;

REVOKE ALL ON FUNCTION public.bling_claim_refresh(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bling_claim_refresh(UUID) TO service_role;

COMMENT ON FUNCTION public.bling_claim_refresh(UUID) IS
  'Entrega a vez de renovar o token Bling a um só chamador, por 30 s e no '
  'máximo uma vez por minuto (082). Devolve o token da vez, ou nulo.';
