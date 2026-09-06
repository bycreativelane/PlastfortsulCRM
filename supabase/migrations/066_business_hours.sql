-- ============================================================
-- 066_business_hours
--
-- O relógio da empresa: em que fuso ela vive, e em que dias e horas
-- ela atende.
--
-- POR QUE ISTO VEM ANTES DE TAREFAS. O produto inteiro só conhece o DIA.
-- Das seis fontes da agenda (lib/dashboard/agenda.ts), duas carregam hora,
-- e o fuso está escrito à mão em `lib/automations/local-time.ts` — que diz
-- em comentário: "There is no per-account zone in the schema". Enquanto
-- isso for verdade, "às 14h" não tem dono: uma tarefa marcada por quem
-- está em Manaus cai uma hora fora, uma vista de dia não sabe entre que
-- linhas se desenhar, e o atalho "amanhã" cai às 00:00.
--
-- TRÊS COISAS, E POR QUE SÃO TRÊS:
--
--   1. Colunas em `accounts` — o que é uma resposta só por conta (o fuso,
--      o primeiro dia da semana, o tamanho do slot).
--   2. `business_hours` — a semana, um INTERVALO POR LINHA. Manhã e tarde
--      são duas linhas, que é como se representa o almoço sem inventar
--      uma coluna "pausa" que só serve para um formato de expediente.
--   3. `business_hours_exceptions` — o que foge da semana: feriado,
--      emenda, sábado de balanço. Preenchido à mão, de propósito: são
--      doze linhas por ano e a empresa tem os dias dela. Um calendário
--      nacional embutido que erra é pior que uma lista vazia.
--
-- `user_id` NULO EM DUAS TABELAS. NULL é "o horário da conta"; preenchido
-- seria "o horário próprio de uma pessoa". A tela desta entrega só edita o
-- da conta e nada lê o outro caso — a coluna existe agora porque é uma
-- coluna hoje ou uma migração depois, e o dia em que um vendedor tiver
-- expediente próprio não é um dia para mexer em índice único.
--
-- `account_id` está nas duas tabelas mesmo com `user_id`, denormalizado,
-- para a RLS resolver sem join — a mesma troca da 017, 041, 042 e 065.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ============================================================
-- 1. O relógio da conta
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS timezone       TEXT     NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS week_starts_on SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slot_minutes   SMALLINT NOT NULL DEFAULT 30;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_week_starts_on_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_week_starts_on_check
  CHECK (week_starts_on BETWEEN 0 AND 6);

-- 15, 30 e 60 são as únicas divisões que uma grade de dia desenha sem
-- virar régua. A lista é curta e fechada de propósito.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_slot_minutes_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_slot_minutes_check
  CHECK (slot_minutes IN (15, 30, 60));

COMMENT ON COLUMN accounts.timezone IS
  'Fuso IANA em que esta conta trabalha. Passa a ser a verdade que '
  'lib/automations/local-time.ts tratava como constante; DEFAULT_TIMEZONE '
  'vira o fallback de quem não conseguir ler daqui (066).';
COMMENT ON COLUMN accounts.week_starts_on IS
  'Primeiro dia da semana, 0 = domingo. O calendário pergunta ao locale '
  '(lib/calendar.ts firstDayOfWeek); esta coluna deixa a conta discordar.';
COMMENT ON COLUMN accounts.slot_minutes IS
  'Altura de uma linha na grade de dia/semana, em minutos: 15, 30 ou 60.';

-- ============================================================
-- 2. A semana
-- ============================================================
CREATE TABLE IF NOT EXISTS business_hours (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NULL = o horário da conta. Ver a nota do cabeçalho.
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 0 = domingo, como `Date.getDay()`, e NÃO como o ISO-8601 (1 = segunda).
  -- O JavaScript que vai ler isto usa `getDay()` em todo lugar, e converter
  -- na fronteira é onde nasce o bug de um dia.
  weekday    SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at   TIME NOT NULL,
  closes_at  TIME NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Um intervalo que fecha antes de abrir não é um expediente noturno —
  -- é um erro de digitação. Expediente que cruza a meia-noite seria duas
  -- linhas em dois dias, e nenhum consumidor desta tabela precisa disso.
  CONSTRAINT business_hours_order CHECK (closes_at > opens_at)
);

-- Duas parciais em vez de uma sobre COALESCE: o índice único tem de valer
-- separadamente para a linha da conta e para a de cada pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_hours_account_slot
  ON business_hours(account_id, weekday, opens_at) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_hours_user_slot
  ON business_hours(user_id, weekday, opens_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_business_hours_account
  ON business_hours(account_id);

COMMENT ON TABLE business_hours IS
  'Expediente semanal, um intervalo por linha. Manhã e tarde são duas '
  'linhas. user_id NULL = o horário da conta (066).';

DROP TRIGGER IF EXISTS set_updated_at ON business_hours;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON business_hours
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer membro: a agenda de todo mundo precisa saber
-- entre que linhas se desenhar, inclusive a de um viewer.
DROP POLICY IF EXISTS business_hours_select ON business_hours;
CREATE POLICY business_hours_select ON business_hours FOR SELECT
  USING (is_account_member(account_id));

-- Escrita com piso de admin, o mesmo de `accounts_update` (017) — a tela
-- fica atrás de `settings.manage`, e a política é quem realmente decide.
DROP POLICY IF EXISTS business_hours_insert ON business_hours;
CREATE POLICY business_hours_insert ON business_hours FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS business_hours_update ON business_hours;
CREATE POLICY business_hours_update ON business_hours FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS business_hours_delete ON business_hours;
CREATE POLICY business_hours_delete ON business_hours FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 3. O que foge da semana
-- ============================================================
CREATE TABLE IF NOT EXISTS business_hours_exceptions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  on_date    DATE NOT NULL,
  -- O caso comum é fechar. Um dia com horário diferente (o 24 de dezembro
  -- que fecha ao meio-dia) é `closed = FALSE` com as duas horas.
  closed     BOOLEAN NOT NULL DEFAULT TRUE,
  opens_at   TIME,
  closes_at  TIME,
  label      TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT business_hours_exceptions_open_has_range
    CHECK (closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL
                      AND closes_at > opens_at))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_hours_exc_account_date
  ON business_hours_exceptions(account_id, on_date) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_hours_exc_user_date
  ON business_hours_exceptions(user_id, on_date) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_business_hours_exc_account_range
  ON business_hours_exceptions(account_id, on_date);

COMMENT ON TABLE business_hours_exceptions IS
  'Feriados e dias de horário diferente, por data. Preenchido à mão: uma '
  'lista nacional embutida que erre é pior que uma vazia (066).';

DROP TRIGGER IF EXISTS set_updated_at ON business_hours_exceptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON business_hours_exceptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE business_hours_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_hours_exc_select ON business_hours_exceptions;
CREATE POLICY business_hours_exc_select ON business_hours_exceptions FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS business_hours_exc_insert ON business_hours_exceptions;
CREATE POLICY business_hours_exc_insert ON business_hours_exceptions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS business_hours_exc_update ON business_hours_exceptions;
CREATE POLICY business_hours_exc_update ON business_hours_exceptions FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS business_hours_exc_delete ON business_hours_exceptions;
CREATE POLICY business_hours_exc_delete ON business_hours_exceptions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 4. Semente: seg–sex, 08:00–12:00 e 13:30–18:00
--
-- Uma conta sem horário nenhum é uma conta cuja agenda não sabe se
-- desenhar, e "vazio" aqui não é um estado que alguém escolheu — é a
-- migração tendo acabado de rodar. Só semeia conta que ainda não tem
-- NENHUMA linha própria, para que re-executar não ressuscite um dia que
-- alguém apagou de propósito.
-- ============================================================
INSERT INTO business_hours (account_id, weekday, opens_at, closes_at)
SELECT a.id, d.weekday, h.opens_at, h.closes_at
  FROM accounts a
 CROSS JOIN (VALUES (1), (2), (3), (4), (5)) AS d(weekday)
 CROSS JOIN (VALUES (TIME '08:00', TIME '12:00'),
                    (TIME '13:30', TIME '18:00')) AS h(opens_at, closes_at)
 WHERE NOT EXISTS (
   SELECT 1 FROM business_hours b
    WHERE b.account_id = a.id AND b.user_id IS NULL
 )
ON CONFLICT DO NOTHING;
