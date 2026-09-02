-- ============================================================
-- 065_deal_stage_events_and_automation_scope
--
-- O que o fluxo comercial oficial (docs/spec-automacoes-fluxo.md) precisa
-- do banco e o motor de automações não tinha:
--
--   1. QUANDO uma oportunidade entrou na etapa em que está, e um histórico
--      de cada movimentação. "24 h em Em Aberto sem resposta" é uma pergunta
--      sobre uma coluna que não existia; o quadro, a thread, a sheet e o
--      formulário gravam `stage_id` direto do navegador e nenhum deles
--      avisa ninguém.
--   2. A fila de esperas e o log sabendo de qual OPORTUNIDADE são, e sabendo
--      ser cancelados. Hoje os status são pending/running/done/failed e o
--      webhook de entrada não toca na fila: um cliente que responde durante
--      um follow-up recebe o D3 mesmo assim.
--   3. A automação declarando seu funil, suas regras de cancelamento e sua
--      política de reentrada — em vez de cada regra virar um passo.
--   4. A mensagem enviada lembrando de qual resposta rápida veio, para que
--      `/aberto` possa ser um gatilho.
--
-- O evento de etapa nasce AQUI, por gatilho, e não numa rota: há quatro
-- escritas client-side de `stage_id` e refatorar as quatro deixa aberta a
-- quinta que alguém escrever amanhã. O gatilho pega todas, inclusive as do
-- próprio motor. O cron drena `deal_stage_events` (padrão outbox) e dispara
-- o gatilho `deal_stage_entered` — ver src/lib/automations/stage-events.ts.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ============================================================
-- 1. Onde a oportunidade está, e desde quando
-- ============================================================
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ;

-- Backfill com a melhor aproximação que existe: `updated_at` move em
-- qualquer edição, então é "quando alguém mexeu por último", que é um
-- limite superior honesto para "quando entrou na etapa".
UPDATE deals
   SET stage_entered_at = COALESCE(updated_at, created_at, NOW())
 WHERE stage_entered_at IS NULL;

ALTER TABLE deals ALTER COLUMN stage_entered_at SET DEFAULT NOW();

COMMENT ON COLUMN deals.stage_entered_at IS
  'Quando a oportunidade entrou na etapa atual. Mantido por gatilho a cada '
  'mudança de stage_id; é o relógio de "tempo na etapa" das automações.';

-- ============================================================
-- 2. O histórico de movimentação, que também é a caixa de saída do motor
--
-- `dispatched_at` NULL significa "o cron ainda não viu". O drenador marca
-- a linha antes de disparar (claim), do mesmo jeito que o cron de esperas
-- marca `running` — dois tiques concorrentes não despacham o mesmo evento.
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_stage_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id   UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  -- NULL quando a escrita veio do motor ou do service role: o autor de uma
  -- movimentação automática está no log da própria automação.
  changed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_events_undispatched
  ON deal_stage_events(changed_at) WHERE dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal
  ON deal_stage_events(deal_id, changed_at DESC);

COMMENT ON TABLE deal_stage_events IS
  'Cada mudança de etapa de uma oportunidade, e a criação. Histórico para '
  'a ficha e caixa de saída para o gatilho deal_stage_entered (065).';

ALTER TABLE deal_stage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_stage_events_select ON deal_stage_events;
CREATE POLICY deal_stage_events_select ON deal_stage_events FOR SELECT
  USING (is_account_member(account_id));
-- Sem INSERT/UPDATE/DELETE para authenticated: só o gatilho abaixo escreve
-- (SECURITY DEFINER) e só o service role marca dispatched_at.

-- BEFORE, porque muda a própria linha.
CREATE OR REPLACE FUNCTION deals_touch_stage_entered_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_stage_entered_at ON deals;
CREATE TRIGGER trg_deals_stage_entered_at
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_touch_stage_entered_at();

-- AFTER, porque um BEFORE INSERT ainda não tem `deals.id` para a chave
-- estrangeira. A criação conta como "entrou na etapa": uma oportunidade
-- aberta direto em Em Aberto tem que iniciar o mesmo relógio que uma
-- movida para lá.
CREATE OR REPLACE FUNCTION deals_record_stage_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NULL;
  END IF;
  -- Linhas anteriores à 017 sem account_id não existem mais (a 017 fez
  -- backfill e NOT NULL), mas o gatilho não pode ser a coisa que derruba
  -- um INSERT se um dia existirem.
  IF NEW.account_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO deal_stage_events (account_id, deal_id, from_stage_id, to_stage_id, changed_by)
  VALUES (
    NEW.account_id,
    NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END,
    NEW.stage_id,
    auth.uid()
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_record_stage_event ON deals;
CREATE TRIGGER trg_deals_record_stage_event
  AFTER INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_record_stage_event();

-- ============================================================
-- 3. A fila de esperas conhece a oportunidade e sabe ser cancelada
--
-- CASCADE em deal_id: apagar a oportunidade leva suas esperas junto — uma
-- espera sem oportunidade acordaria para mover o que não existe.
-- ============================================================
ALTER TABLE automation_pending_executions
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

ALTER TABLE automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_status_check;
ALTER TABLE automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_automation_pending_contact
  ON automation_pending_executions(account_id, contact_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automation_pending_deal
  ON automation_pending_executions(deal_id) WHERE status = 'pending';

COMMENT ON COLUMN automation_pending_executions.cancelled_reason IS
  'customer_replied | stage_entered:<stage_id> | cancelled_by:<automation_id> '
  '| date_cleared. Preenchido quando status = cancelled; a linha nunca é apagada.';

-- ============================================================
-- 4. O log responde "qual oportunidade", "por que acabou" e "já disparei?"
--
-- SET NULL em deal_id: o histórico sobrevive à oportunidade, como sobrevive
-- ao contato desde a 004.
--
-- `trigger_key` é a idempotência das varreduras por data: o gatilho de
-- aniversário grava `contact:<id>:<AAAA-MM-DD>` e o índice único recusa a
-- segunda execução do mesmo dia — dois tiques do cron, uma mensagem.
-- ============================================================
ALTER TABLE automation_logs
  ADD COLUMN IF NOT EXISTS deal_id     UUID REFERENCES deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS end_reason  TEXT,
  ADD COLUMN IF NOT EXISTS trigger_key TEXT;

ALTER TABLE automation_logs DROP CONSTRAINT IF EXISTS automation_logs_status_check;
ALTER TABLE automation_logs ADD CONSTRAINT automation_logs_status_check
  CHECK (status IN ('success', 'partial', 'failed', 'cancelled', 'skipped'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_logs_trigger_key
  ON automation_logs(automation_id, trigger_key) WHERE trigger_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_logs_deal
  ON automation_logs(deal_id) WHERE deal_id IS NOT NULL;

COMMENT ON COLUMN automation_logs.end_reason IS
  'Por que a execução terminou quando não foi pelo fim da lista: '
  'customer_replied, stage_entered:<stage_id>, cancelled_by:<automation_id>, '
  'reentry_blocked, already_running, date_cleared, end_step, ou o motivo '
  'livre de um passo Encerrar.';

-- ============================================================
-- 5. A automação declara seu funil, suas regras de cancelamento e a
--    política de reentrada
--
-- Padrões que não mudam nada do que já roda: `cancel_on_reply` falso,
-- lista de etapas vazia, `reentry_policy = 'always'`. As automações do
-- fluxo oficial ligam o que precisam ao serem instaladas.
-- ============================================================
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS pipeline_id          UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_on_reply      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancel_when_stage_in UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reentry_policy       TEXT NOT NULL DEFAULT 'always',
  ADD COLUMN IF NOT EXISTS reentry_days         INTEGER;

ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_reentry_policy_check;
ALTER TABLE automations ADD CONSTRAINT automations_reentry_policy_check
  CHECK (reentry_policy IN ('always', 'never', 'after_complete', 'after_days'));

ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_reentry_days_check;
ALTER TABLE automations ADD CONSTRAINT automations_reentry_days_check
  CHECK (reentry_policy <> 'after_days' OR (reentry_days IS NOT NULL AND reentry_days > 0));

COMMENT ON COLUMN automations.pipeline_id IS
  'O funil cujas oportunidades esta automação trabalha. Um gatilho de contato '
  '(mensagem recebida, etiqueta) resolve a oportunidade aberta mais recente '
  'do contato NESTE funil; NULL resolve em qualquer funil.';
COMMENT ON COLUMN automations.cancel_on_reply IS
  'O webhook de entrada cancela as esperas pendentes desta automação para o '
  'contato que respondeu, antes de disparar qualquer gatilho.';
COMMENT ON COLUMN automations.cancel_when_stage_in IS
  'Etapas cuja entrada cancela as esperas pendentes desta automação para '
  'aquela oportunidade. É a lista do §22 do fluxo oficial, por automação.';

-- ============================================================
-- 6. A mensagem lembra de qual resposta rápida veio
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS quick_reply_id UUID REFERENCES quick_replies(id) ON DELETE SET NULL;

COMMENT ON COLUMN messages.quick_reply_id IS
  'A resposta rápida que gerou esta mensagem, quando o atendente usou uma. '
  'É o que faz /aberto ser um gatilho (team_message_sent).';

-- ============================================================
-- 7. A varredura de aniversário
--
-- PostgREST não filtra por mês e dia de uma DATE. Uma função, chamada com
-- o service role pelo cron, responde "quem faz aniversário hoje nesta
-- conta" usando o índice parcial da 040. Exclui quem pediu para parar:
-- o envio recusaria de qualquer forma, mas não vale nem abrir a execução.
-- ============================================================
CREATE OR REPLACE FUNCTION contacts_with_birthday_on(
  p_account_id UUID,
  p_month INTEGER,
  p_day INTEGER
)
RETURNS TABLE (id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
    FROM contacts c
   WHERE c.account_id = p_account_id
     AND c.birthday IS NOT NULL
     AND c.opted_out = FALSE
     AND EXTRACT(MONTH FROM c.birthday) = p_month
     AND EXTRACT(DAY   FROM c.birthday) = p_day;
$$;

REVOKE ALL ON FUNCTION contacts_with_birthday_on(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION contacts_with_birthday_on(UUID, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION contacts_with_birthday_on(UUID, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION contacts_with_birthday_on(UUID, INTEGER, INTEGER) TO service_role;
