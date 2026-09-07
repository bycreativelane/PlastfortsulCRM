-- ============================================================
-- 069_google_calendar
--
-- A ponte com a agenda que a empresa já usa.
--
-- É a Fase 4 do `docs/spec-tarefas-e-agendas.md`, e responde ao pedido de
-- "trazer o que já está agendado lá para dentro, e publicar lá o que é
-- criado aqui". Quatro tabelas: a conexão, quais agendas seguir, o que há
-- nelas, e o vínculo entre uma tarefa e o evento que ela virou.
--
-- ------------------------------------------------------------
-- UMA CONEXÃO, A DA EMPRESA — e não uma por vendedor
-- ------------------------------------------------------------
--
-- Decisão 4 do plano, tomada em 2 de setembro de 2026. Um admin autoriza a
-- conta Google principal e escolhe quais agendas dela entram; todos os
-- membros leem as mesmas, e uma tarefa publicada vai para uma agenda que a
-- EMPRESA controla — não para a conta pessoal de quem a criou. Quem sai da
-- empresa não leva a agenda comercial junto.
--
-- Por isso `UNIQUE (account_id, provider)` e não
-- `UNIQUE (user_id, provider, provider_email)`: o bloco SQL do §D2 do plano
-- ainda mostra a chave antiga, mas o §D0 a revoga explicitamente e é o §D0
-- que vale. `connected_by` é histórico — quem autorizou — e não chave.
--
-- O dia em que cada vendedor quiser a agenda dele é uma migração que
-- relaxa este índice único, não um redesenho.
--
-- ------------------------------------------------------------
-- RLS LIGADA E NENHUMA POLÍTICA EM `calendar_connections`
-- ------------------------------------------------------------
--
-- Deliberado, e é o mesmo padrão de `automation_pending_executions`: a
-- linha guarda um refresh token que abre a agenda da empresa, e uma
-- política de leitura é uma concessão PERMANENTE a todo o navegador de
-- todo membro. O navegador nunca lê esta tabela. O estado da conexão sai
-- por rota, com os campos escolhidos à mão e sem os dois cifrados.
--
-- As outras três têm política de leitura: não guardam segredo, e a agenda
-- precisa desenhá-las direto do cliente como já faz com `deals`.
--
-- ------------------------------------------------------------
-- O DIA INTEIRO NÃO VIRA TIMESTAMP
-- ------------------------------------------------------------
--
-- `calendar_events` guarda os DOIS modelos da Google lado a lado —
-- `start_date`/`end_date` para o dia inteiro, `starts_at`/`ends_at` para o
-- marcado — porque é assim que a Google os manda e converter um no outro
-- é exatamente o erro que `lib/calendar.ts` proíbe no comentário de topo:
-- meia-noite UTC é o dia anterior a oeste de Greenwich. Um aniversário
-- importado que aparece um dia antes é o bug clássico desta integração.
--
-- Idempotente — seguro de re-executar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A conexão
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_connections (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Quem autorizou. Histórico, não chave: a conexão é da conta, e ela
  -- sobrevive à saída de quem clicou no botão. SET NULL pelo mesmo motivo
  -- que `tasks.created_by` — a pessoa vai embora, o vínculo fica.
  connected_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  provider       TEXT NOT NULL DEFAULT 'google'
                 CHECK (provider IN ('google')),
  provider_email TEXT NOT NULL,

  -- Os dois cifrados com o mesmo `ENCRYPTION_KEY` que a Cloud API já usa
  -- (`lib/whatsapp/encryption.ts`). O refresh token não expira sozinho e
  -- vale mais que a senha da conta: com ele se lê e se escreve a agenda
  -- da empresa até que alguém revogue.
  refresh_token  TEXT NOT NULL,
  access_token   TEXT,
  access_expires_at TIMESTAMPTZ,

  scopes         TEXT[] NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'connected'
                 CHECK (status IN ('connected', 'revoked', 'error')),
  last_error     TEXT,
  connected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (account_id, provider)
);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
-- E nenhuma política. Ver o cabeçalho.

-- ------------------------------------------------------------
-- 2. Quais agendas seguir
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_sources (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL
                REFERENCES calendar_connections(id) ON DELETE CASCADE,

  external_id   TEXT NOT NULL,
  summary       TEXT,
  color         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,

  -- 'in'   = só importa  (a agenda da diretoria aparece no CRM)
  -- 'out'  = só publica  (a agenda "Comercial" recebe as tarefas)
  -- 'both' = os dois
  --
  -- O padrão é 'in' porque importar não escreve nada na Google, e o lado
  -- conservador de errar numa integração é o que só lê.
  direction     TEXT NOT NULL DEFAULT 'in'
                CHECK (direction IN ('in', 'out', 'both')),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,

  -- O token incremental da Google. Guardá-lo é a diferença entre
  -- reimportar tudo a cada cinco minutos e pedir só o que mudou.
  sync_token     TEXT,
  last_synced_at TIMESTAMPTZ,
  next_poll_at   TIMESTAMPTZ,
  last_error     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, external_id)
);

ALTER TABLE calendar_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_sources_select ON calendar_sources;
CREATE POLICY calendar_sources_select ON calendar_sources
  FOR SELECT USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- 3. O espelho
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  ical_uid    TEXT,
  etag        TEXT,

  summary     TEXT,
  description TEXT,
  location    TEXT,
  html_link   TEXT,

  -- Os dois modelos, como a Google os manda. Ver o cabeçalho.
  all_day     BOOLEAN NOT NULL DEFAULT FALSE,
  start_date  DATE,
  end_date    DATE,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,

  status          TEXT,
  organizer_email TEXT,
  attendee_emails TEXT[],

  -- Casado por e-mail de participante com `contacts.email`. Nulo é o
  -- normal — a maioria dos eventos não é com cliente.
  contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,

  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source_id, external_id)
);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_events_select ON calendar_events;
CREATE POLICY calendar_events_select ON calendar_events
  FOR SELECT USING (is_account_member(account_id));

-- A agenda pergunta por janela de tempo, e os dois modelos precisam
-- responder rápido — daí dois índices e não um.
CREATE INDEX IF NOT EXISTS idx_calendar_events_window
  ON calendar_events(account_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_day
  ON calendar_events(account_id, start_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_contact
  ON calendar_events(contact_id) WHERE contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. O vínculo tarefa ↔ evento
-- ------------------------------------------------------------
--
-- Tabela e não coluna porque uma tarefa pode ser publicada em MAIS DE UMA
-- agenda — a pessoal do vendedor e a "Comercial" da empresa.
--
-- Nasce aqui e é usada na Fase 5, que é o envio. Criá-la agora custa nada
-- e evita uma migração `070` só para uma tabela que este desenho já
-- conhece inteira.

CREATE TABLE IF NOT EXISTS task_calendar_links (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,

  external_id TEXT,
  -- A versão que ESTE lado escreveu. A regra 2 do §D5 compara com o que
  -- volta da importação para saber se foi a Google que mudou, e não
  -- ricochetear a própria escrita.
  etag        TEXT,

  sync_state  TEXT NOT NULL DEFAULT 'pending'
              CHECK (sync_state IN ('pending', 'synced', 'error', 'deleted')),
  last_error  TEXT,
  retry_after TIMESTAMPTZ,
  pushed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (task_id, source_id)
);

ALTER TABLE task_calendar_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_calendar_links_select ON task_calendar_links;
CREATE POLICY task_calendar_links_select ON task_calendar_links
  FOR SELECT USING (is_account_member(account_id));

-- A drenagem do cron: os vínculos que ainda devem uma escrita.
CREATE INDEX IF NOT EXISTS idx_task_links_pending
  ON task_calendar_links(sync_state, retry_after)
  WHERE sync_state IN ('pending', 'error');
CREATE INDEX IF NOT EXISTS idx_task_links_task
  ON task_calendar_links(task_id);

-- A varredura do puxão: as fontes vencidas.
CREATE INDEX IF NOT EXISTS idx_calendar_sources_poll
  ON calendar_sources(next_poll_at) WHERE enabled = TRUE;
