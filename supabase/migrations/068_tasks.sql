-- ============================================================
-- 068_tasks
--
-- O compromisso que uma pessoa marca.
--
-- POR QUE ISTO EXISTE AGORA. O `spec-automacoes-fluxo.md` decidiu o
-- contrário — decisão 2, "Ligação é uma etapa, sem entidade tarefa" — e a
-- decisão foi revogada em 2 de setembro de 2026. O plano está em
-- `docs/spec-tarefas-e-agendas.md`; esta é a Fase 2 dele.
--
-- O que a decisão antiga não conseguia expressar: "ligar para o Marcos na
-- quinta às 14h". Mover a oportunidade para a etapa Ligação diz QUE alguém
-- deve ligar, e não diz quem, nem quando, nem se já ligou. As três coisas
-- que faltavam são exatamente três colunas.
--
-- ------------------------------------------------------------
-- DIA E HORA SEPARADOS, e não um TIMESTAMPTZ
-- ------------------------------------------------------------
--
-- `due_on DATE` + `due_time TIME`, lidos no fuso de `accounts.timezone`
-- (066). Três razões, na ordem em que pesam:
--
--   1. É o modelo da própria Google Agenda — `start.date` para o dia
--      inteiro, `start.dateTime` para o marcado. A Fase 4 publica tarefas
--      lá; guardar como TIMESTAMPTZ obrigaria a adivinhar, na hora de
--      exportar, se aquilo era um dia ou um instante.
--   2. A ausência de hora É a informação. "Ligar hoje" não é "ligar às
--      00:00", e um TIMESTAMPTZ não sabe dizer a diferença sem uma segunda
--      coluna booleana — que é a mesma coluna, com um nome pior.
--   3. `lib/calendar.ts` explica no topo por que este produto nunca passa
--      uma data por `new Date()`: meia-noite UTC é o dia anterior a oeste
--      de Greenwich. Uma DATE nunca corre esse risco.
--
-- ------------------------------------------------------------
-- O QUE ACONTECE COM UMA TAREFA CONCLUÍDA: nada
-- ------------------------------------------------------------
--
-- Ela fica. É a mesma regra que a 042 fixou para as ocorrências e a 065
-- para a fila de automações — status e motivo, nunca DELETE. "Já ligamos
-- para este cliente na semana passada" é precisamente o que se quer saber
-- antes de ligar de novo, e um booleano que some não responde.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  title       TEXT NOT NULL,
  description TEXT,

  -- TEXT e não enum, pela doutrina da 042: a lista é da conta e vai
  -- crescer. O app oferece seis (ligação, reunião, visita, follow-up,
  -- orçamento, outro); a coluna aceita o que a conta escrever, e
  -- acrescentar "Cobrança" vira uma decisão em vez de uma migração.
  kind        TEXT NOT NULL DEFAULT 'todo',

  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'done', 'cancelled')),

  -- Ver a nota do cabeçalho. Ambas anuláveis: uma tarefa sem prazo é uma
  -- lista de coisas a fazer, que é um uso legítimo e não aparece na agenda.
  due_on      DATE,
  due_time    TIME,
  duration_minutes SMALLINT,

  -- Lembrete em MINUTOS ANTES, não num instante absoluto. Mover a tarefa
  -- move o lembrete junto, sem recalcular coluna nenhuma — e sem a classe
  -- de bug em que os dois discordam.
  remind_minutes_before SMALLINT,
  -- Carimbo do envio: é o que impede dois tiques de cron concorrentes de
  -- notificarem duas vezes. Mesmo raciocínio do claim da 065.
  reminded_at TIMESTAMPTZ,

  -- `auth.users(id)` e não `profiles(id)`, pela razão que a 041 e a 042
  -- explicam: `profiles.id` não é o id de auth, e o id de auth é o que
  -- toda coluna de "quem fez isto" carrega neste schema. SET NULL porque
  -- quem sai da empresa não pode levar junto o que ficou combinado.
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- A quem a tarefa se refere.
  --
  -- CASCADE no contato e SET NULL na oportunidade — o mesmo par da 042, e
  -- pela mesma razão: uma tarefa sem cliente é ruído que ninguém vai
  -- limpar, mas apagar o negócio não pode apagar o registro do que se
  -- combinou com a pessoa.
  contact_id      UUID REFERENCES contacts(id)      ON DELETE CASCADE,
  deal_id         UUID REFERENCES deals(id)         ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  completed_at    TIMESTAMPTZ,
  completion_note TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Concluída sabe QUANDO. Sem isto as duas colunas podem discordar, e
  -- "feita" sem data é a versão desta linha que não serve para nada — o
  -- mesmo constraint que a 042 usa em `resolved_at`.
  CONSTRAINT tasks_done_has_date
    CHECK (status <> 'done' OR completed_at IS NOT NULL),

  -- Hora sem dia não existe. `due_time` sozinha seria uma tarefa marcada
  -- para as 14h de nunca.
  CONSTRAINT tasks_time_needs_day
    CHECK (due_time IS NULL OR due_on IS NOT NULL),

  -- Lembrete sem prazo também não: não há de onde contar os minutos.
  CONSTRAINT tasks_reminder_needs_day
    CHECK (remind_minutes_before IS NULL OR due_on IS NOT NULL)
);

-- A agenda pergunta "o que está aberto nesta janela", sempre por conta.
CREATE INDEX IF NOT EXISTS idx_tasks_account_due
  ON tasks(account_id, due_on) WHERE status = 'open';
-- O filtro "Minhas", que é o padrão da tela.
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_due
  ON tasks(assigned_to, due_on) WHERE status = 'open';
-- As fichas: o painel do contato e o cartão da oportunidade.
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal    ON tasks(deal_id);
-- A varredura de lembretes, que roda a cada minuto e não pode varrer tudo.
CREATE INDEX IF NOT EXISTS idx_tasks_reminder_due
  ON tasks(due_on)
  WHERE status = 'open'
    AND remind_minutes_before IS NOT NULL
    AND reminded_at IS NULL;

COMMENT ON TABLE tasks IS
  'Compromissos que uma pessoa marca: ligar, visitar, orçar. Reverte a '
  'decisão 2 de docs/spec-automacoes-fluxo.md; ver '
  'docs/spec-tarefas-e-agendas.md (068).';
COMMENT ON COLUMN tasks.due_on IS
  'O dia, no fuso de accounts.timezone. DATE e não TIMESTAMPTZ — ver o '
  'cabeçalho da 068.';
COMMENT ON COLUMN tasks.due_time IS
  'A hora de parede, ou NULL para "neste dia, sem hora marcada". A '
  'ausência é informação, não um valor faltando.';
COMMENT ON COLUMN tasks.remind_minutes_before IS
  'Minutos antes do prazo. Relativo de propósito: mover a tarefa move o '
  'lembrete, sem duas colunas que possam discordar.';

DROP TRIGGER IF EXISTS set_updated_at ON tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS
--
-- Ler e escrever é de qualquer membro; apagar, não.
--
-- A assimetria é deliberada. Uma equipe pequena precisa que qualquer um
-- possa marcar e concluir o que for — "quem ficou de ligar" é justamente
-- o que se quer ver, e uma tarefa que só o dono pode fechar é uma tarefa
-- que fica aberta quando o dono está de férias. Já apagar destrói o
-- histórico, e para isso existe `cancelled`.
-- ============================================================
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Só quem criou, ou um admin. Uma tarefa criada por engano é do autor;
-- qualquer outra é história da conta.
DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_delete ON tasks FOR DELETE
  USING (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND created_by = auth.uid())
  );

-- ============================================================
-- O lembrete é uma notificação
--
-- `notifications` já existe (027) e já é entregue ao vivo (046 pôs a
-- tabela na publicação de realtime, e `use-unread-notifications` a lê).
-- Um segundo canal para lembrete de tarefa seria um sino diferente para o
-- mesmo tipo de interrupção. Só o CHECK precisa crescer.
--
-- A tabela não tem política de INSERT para o navegador, de propósito
-- (027): quem escreve é o gatilho SECURITY DEFINER ou o service role — e
-- a varredura de lembretes é service role.
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'new_message', 'task_due'));

-- A notificação aponta para a tarefa que a gerou, para que clicar no sino
-- abra a coisa em vez de abrir a lista.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;

COMMENT ON COLUMN notifications.task_id IS
  'A tarefa que gerou o lembrete, para type = task_due (068).';
