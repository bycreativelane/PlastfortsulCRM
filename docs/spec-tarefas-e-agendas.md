# Tarefas e agendas — plano de ação

> **Escrito em 2 de setembro de 2026, contra o código da 0.9.0.** Este
> arquivo reverte a **decisão 2** do `spec-automacoes-fluxo.md` ("Ligação é
> uma etapa, sem entidade tarefa") e responde ao pedido de integrar agendas
> externas. É o que construir, em que ordem, e quais decisões travam cada
> parte.
>
> **Estado em 3 de setembro de 2026.** A **Fase 1 está no banco**: a
> `066_business_hours.sql` foi aplicada pelo MCP do Supabase e conferida
> contra o projeto (`accounts.timezone` = `America/Sao_Paulo`, dez linhas de
> expediente semeadas, exceções vazias). A **Fase 2 está no código**, na
> `068_tasks.sql` — **aplicada em 3 de setembro de 2026** e conferida
> contra o projeto em 6 de setembro (tabela `tasks` respondendo, vazia). As
> fases 3 a 7 não começaram.
>
> **Numeração.** A `066_business_hours.sql` foi aplicada em 3 de setembro de
> 2026, junto com a 065 e a 067. A **067 é de outra entrega**
> (`067_realtime_contact_surface`), então este plano ocupa agora a **068**
> (tarefas) e a **069** (Google). Conferir `ls supabase/migrations/` antes de
> nomear qualquer arquivo — este bloco já ficou desatualizado uma vez.

O diagnóstico em uma frase: **o CRM já tem um calendário, mas não tem um
relógio nem um compromisso.** `lib/dashboard/agenda.ts` reúne seis fontes
datadas e as desenha em dois lugares (o painel do dashboard e a faixa do
cabeçalho) — mas cinco dessas seis são datas de OUTRA coisa: uma oportunidade
que fecha, um aniversário, uma campanha que saiu. Nenhuma é um compromisso que
alguém marcou. E o produto inteiro só conhece o DIA: das seis fontes, apenas
duas carregam hora, e o fuso horário da empresa está escrito à mão em
`lib/automations/local-time.ts:12`.

Três coisas faltam, nesta ordem de dependência:

1. **Uma base de horários** — em que fuso a empresa vive, que dias e que horas
   ela atende. Sem isso, "às 14h" não tem dono e a agenda não sabe entre que
   linhas desenhar um dia.
2. **A entidade tarefa** — o compromisso que uma pessoa marca, com dono,
   prazo, hora e desfecho.
3. **A ponte com a Google** — trazer o que já está agendado lá para dentro, e
   publicar lá o que é criado aqui.

| Marca | Significa                                         |
| ----- | ------------------------------------------------- |
| ✅    | Já existe. Não reimplementar                      |
| ⚠️    | Existe parcialmente, ou existe de forma diferente |
| ❌    | Não existe. É trabalho de verdade                 |
| 🔒    | Bloqueado por uma decisão que não é técnica       |

Como ler: a **Parte 0** são as decisões que travam o resto. A **Parte A** é o
inventário do que já existe. As **Partes B, C e D** desenham cada uma das três
coisas que faltam. A **Parte E** é o plano por fases, com as migrações
rascunhadas. A **Parte F** é a verificação e a **Parte G** o que fica de fora.

---

# 0. 🔒 As decisões que travam

Cada uma muda o que se constrói. Há uma recomendação para cada, para que a
resposta possa ser "ok" ou "não, assim".

| #   | Decisão                                   | Recomendação                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Onde as tarefas moram                     | **Uma página `/agenda`**, promovendo o painel do dashboard. O produto já desenha calendário em dois lugares que leem o mesmo `lib/dashboard/agenda.ts`; uma terceira tela desconectada ("Tarefas") parte a mesma pergunta em duas. A agenda vira **mês · semana · dia**, e a lista de tarefas é um filtro dela. O painel do dashboard segue sendo o resumo |
| 2   | A tarefa é de uma pessoa ou da conta      | **Da conta, com um responsável.** `assigned_to` obrigatório na tela, anulável na coluna (quem sai da empresa não apaga a tarefa). Todos veem tudo — num CRM de equipe pequena, "quem ficou de ligar" é justamente o que se quer ver; o filtro "Minhas" é o padrão da tela, não uma política                                                                |
| 3   | Como a tarefa guarda a hora               | **`due_on DATE` + `due_time TIME`, no fuso da conta** — não um `TIMESTAMPTZ`. É o modelo da própria Google (`start.date` para o dia inteiro, `start.dateTime` para o marcado), evita a armadilha de UTC-meia-noite que `lib/calendar.ts` documenta no topo, e mantém `dayOf()`/`timeOf()` da agenda funcionando sem tocar em nada                          |
| 4   | A conexão Google é do usuário ou da conta | ✅ **Decidido em 2026-09-02: uma conta só, a principal.** Um admin conecta a conta Google da empresa e escolhe quais agendas dela entram; todo mundo lê as mesmas. `calendar_connections` ganha `UNIQUE (account_id, provider)` em vez de ser por usuário, e guarda `connected_by`. Simplifica a Fase 4 e reduz a decisão 5 a um único usuário de teste    |
| 5   | Verificação do OAuth na Google            | **Modo "Testing" agora** (até 100 usuários, sem revisão). Os escopos de Calendar são _sensitive_: publicar o app exige revisão da Google — semanas, vídeo de demonstração e política de privacidade hospedada. Para a equipe da PlastfortSul, Testing basta. Publicar é decisão de outro momento, e precisa entrar no cronograma como tal                  |
| 6   | Evento importado da Google vira tarefa?   | **Não.** Espelho de leitura, em tabela própria, faixa própria na agenda, sem botão de concluir. Importar como tarefa duplica a cada sincronização, cria um "concluir" que não significa nada do outro lado, e transforma apagar num cabo de guerra                                                                                                         |
| 7   | Quem manda quando os dois lados mudam     | **O CRM manda no que ele criou; a Google manda no resto** — com uma exceção deliberada: mover no Google um evento que o CRM criou **move a tarefa**. É o que se quer de verdade (arrastar no celular e o CRM acompanhar), e é regra pequena o bastante para ser escrita e testada. Ver §D5                                                                 |
| 8   | O agendador                               | Continua sendo a **decisão 8 do spec anterior**, agora com um segundo consumidor: sem cron não há lembrete de tarefa nem importação. Recomendo um tique dedicado `/api/calendar/cron` a cada **5 minutos**, separado do de automações (que precisa de 1 minuto) — a Google não merece 1440 chamadas por dia por agenda                                     |
| 9   | Base de horários: da conta ou por pessoa  | **Da conta agora, com a coluna `user_id` já existindo e nula.** A tabela nasce pronta para o dia em que um vendedor tiver horário próprio, sem migração nova; a tela só edita o da conta                                                                                                                                                                   |
| 10  | Feriados                                  | **Tabela de exceções, preenchida à mão.** Sem calendário nacional embutido: são doze linhas por ano, e a empresa tem os dias dela (a emenda, o aniversário da cidade). Uma lista pronta que erra é pior que uma vazia                                                                                                                                      |

---

# PARTE A — O que já existe (e não se reimplementa)

## A1. A agenda — ✅

`src/lib/dashboard/agenda.ts` (≈620 linhas, com teste) já é o agregador: seis
`AgendaKind` (`deal`, `repurchase`, `occurrence`, `automation`, `broadcast`,
`birthday`), quatro tons (`human`, `auto`, `danger`, `neutral`), carga
tolerante a falha por fonte (`safe()`), agrupamento por dia (`groupByDay`),
contagem por tipo (`countByKind`) e reagendamento (`rescheduleItem`) para as
**duas** datas de que uma pessoa é dona.

Esta é a peça mais importante deste plano e **não muda de forma**: tarefa e
evento externo entram como mais dois `AgendaKind`, e as duas telas que já
consomem o módulo acendem sozinhas.

## A2. As duas telas do calendário — ✅

- `src/components/dashboard/agenda-calendar.tsx` — o mês, no dashboard.
- `src/components/layout/calendar-strip.tsx` — a semana, no cabeçalho.
- `src/components/ui/month-grid.tsx` + `src/lib/calendar.ts` — a aritmética do
  calendário, com o comentário de topo que explica por que tudo é local.

## A3. O que falta é o relógio — ❌

- Nenhuma vista com **eixo de horas**. Só grade de mês e faixa de semana.
- `AgendaItem.time` existe e só é preenchido por campanha e automação.
- O fuso é `DEFAULT_TIMEZONE = 'America/Sao_Paulo'`, constante de código em
  `src/lib/automations/local-time.ts:12`.
- A agenda agrupa por dia **no fuso do navegador** (`dayOf()`), não no da
  empresa. Hoje é invisível porque todos estão no mesmo fuso; quando a conta
  declarar um, vira diferença real — corrigir junto, na fase 1.
- Nenhum campo de hora na UI: existe `ui/date-field.tsx`, não existe
  `ui/time-field.tsx`.

## A4. Peças de apoio que já existem — ✅

| Peça                         | Onde                                    | Serve para                                                       |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| Cifra AES-256-GCM            | `src/lib/whatsapp/encryption.ts`        | Guardar o refresh token da Google, com `ENCRYPTION_KEY`          |
| Cliente service-role         | `src/lib/automations/admin-client.ts`   | Ler/escrever tabela sem política para o navegador                |
| Rota com segredo de cron     | `src/app/api/automations/cron/route.ts` | Molde do `/api/calendar/cron`                                    |
| Padrão "rota em vez de RLS"  | `src/app/api/agenda/scheduled/route.ts` | Exatamente o que os tokens da Google precisam                    |
| Notificações                 | migrações 027 e 046                     | Lembrete de tarefa. Basta alargar o CHECK de `type`              |
| Capacidades                  | `src/lib/auth/capabilities.ts`          | `tasks.view` entra na lista; `settings.manage` cobre os horários |
| `is_account_member(id,role)` | migração 017                            | RLS das tabelas novas, com piso de papel quando preciso          |
| Cliente HTTP sem SDK         | `src/lib/whatsapp/meta-api.ts`          | Molde para falar com a Google por `fetch`, sem dependência nova  |

---

# PARTE B — Base de horários

## B1. As quatro perguntas que ela responde

1. **Em que fuso esta empresa vive?** Hoje a resposta é uma constante de
   código. Passa a ser `accounts.timezone`, e `DEFAULT_TIMEZONE` vira o
   _fallback_ dela, não a verdade.
2. **Entre que linhas desenhar um dia?** Uma vista de dia que começa à
   meia-noite gasta metade da tela com horas em que ninguém trabalha.
3. **Que hora é "amanhã"?** Uma tarefa criada com o atalho "amanhã" cai na
   primeira hora útil do dia seguinte, não às 00:00.
4. **Este dia é útil?** "Daqui a 3 dias úteis" e "não lembrar no feriado"
   dependem disso.

## B2. O modelo

Três coisas: colunas na conta, uma tabela de intervalos semanais, uma tabela
de exceções por data.

```sql
-- 1. O relógio da conta
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS timezone       TEXT     NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS week_starts_on SMALLINT NOT NULL DEFAULT 0,  -- 0 = domingo
  ADD COLUMN IF NOT EXISTS slot_minutes   SMALLINT NOT NULL DEFAULT 30;

-- 2. A semana. Um intervalo por linha — manhã e tarde são DUAS linhas,
--    que é como se representa o almoço sem inventar uma coluna "pausa".
CREATE TABLE IF NOT EXISTS business_hours (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NULL = o horário da conta. Preenchido = o horário próprio de uma
  -- pessoa. A coluna nasce aqui e fica nula até alguém precisar dela
  -- (decisão 9): é uma coluna hoje ou uma migração depois.
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday    SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at   TIME NOT NULL,
  closes_at  TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_hours_order CHECK (closes_at > opens_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_hours_account_slot
  ON business_hours(account_id, weekday, opens_at) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_hours_user_slot
  ON business_hours(user_id, weekday, opens_at) WHERE user_id IS NOT NULL;

-- 3. O que foge da semana: feriado, emenda, sábado de balanço.
CREATE TABLE IF NOT EXISTS business_hours_exceptions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  on_date    DATE NOT NULL,
  closed     BOOLEAN NOT NULL DEFAULT TRUE,
  opens_at   TIME,
  closes_at  TIME,
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_hours_exceptions_open_has_range
    CHECK (closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL
                      AND closes_at > opens_at))
);
```

RLS: `SELECT` para qualquer membro (`is_account_member(account_id)`) — todo
mundo precisa ler o horário para a agenda se desenhar. Escrita com piso de
admin: `is_account_member(account_id, 'admin')`.

Semente na própria migração: seg–sex, 08:00–12:00 e 13:30–18:00, para cada
conta existente. Uma conta sem horário nenhum é uma conta cuja agenda não
sabe se desenhar, e "vazio" aqui não é um estado que alguém escolheu.

## B3. O que passa a ler dela

| Consumidor                      | Antes                          | Depois                                     |
| ------------------------------- | ------------------------------ | ------------------------------------------ |
| `lib/automations/local-time.ts` | Constante `America/Sao_Paulo`  | Fuso da conta, com a constante de fallback |
| `lib/dashboard/agenda.ts`       | `dayOf()` no fuso do navegador | No fuso da conta                           |
| Vista de dia/semana (fase 3)    | —                              | Primeira e última linha da grade           |
| Atalhos de prazo da tarefa      | —                              | "Amanhã" = primeira hora útil de amanhã    |
| Lembretes (fase 2)              | —                              | Não notificar fora do horário              |

Módulo novo `src/lib/hours.ts`, puro e testável, no mesmo espírito de
`lib/calendar.ts`:

```ts
isOpenAt(hours, date): boolean
intervalsFor(hours, date): Array<{ opens: string; closes: string }>
nextOpenSlot(hours, from, minutes): Date        // "o próximo horário livre"
addBusinessDays(hours, date, n): Date
dayBounds(hours, week): { firstHour: number; lastHour: number }
```

---

# PARTE C — A entidade tarefa

## C1. O modelo, e o porquê de cada escolha

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  title       TEXT NOT NULL,
  description TEXT,

  -- TEXT e não enum, pela doutrina da 042: a lista é da conta e vai
  -- crescer. O app oferece ligação / reunião / visita / follow-up /
  -- orçamento / outro; a coluna aceita o que a conta escrever.
  kind        TEXT NOT NULL DEFAULT 'todo',

  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'done', 'cancelled')),

  -- Decisão 3. Dia e hora separados: o dia é o que a agenda agrupa e
  -- nunca passa por `new Date()`; a hora é opcional, e a ausência dela
  -- É a informação ("é para hoje, sem hora marcada").
  due_on      DATE,
  due_time    TIME,
  duration_minutes SMALLINT,

  -- Lembrete: minutos ANTES, não um instante. Mover a tarefa move o
  -- lembrete junto, sem recalcular coluna nenhuma.
  remind_minutes_before SMALLINT,
  reminded_at TIMESTAMPTZ,

  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- A quem a tarefa se refere. CASCADE no contato (tarefa sem cliente é
  -- ruído), SET NULL na oportunidade (apagar o negócio não apaga o que
  -- ficou combinado) — o mesmo par da 042.
  contact_id      UUID REFERENCES contacts(id)      ON DELETE CASCADE,
  deal_id         UUID REFERENCES deals(id)         ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  completed_at    TIMESTAMPTZ,
  completion_note TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Concluída sabe QUANDO — o mesmo constraint que a 042 usa, e pela
  -- mesma razão: "feito" sem data é a versão inútil desta linha.
  CONSTRAINT tasks_done_has_date
    CHECK (status <> 'done' OR completed_at IS NOT NULL),
  -- Hora sem dia não existe.
  CONSTRAINT tasks_time_needs_day
    CHECK (due_time IS NULL OR due_on IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_tasks_account_due
  ON tasks(account_id, due_on) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_due
  ON tasks(assigned_to, due_on) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal    ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder
  ON tasks(due_on)
  WHERE status = 'open' AND remind_minutes_before IS NOT NULL
    AND reminded_at IS NULL;
```

RLS: `SELECT`/`INSERT`/`UPDATE` para membros da conta; `DELETE` só para o
autor ou admin. Uma tarefa concluída **não é apagada** — é a mesma regra que
o spec anterior fixou para a fila e o log: status, sempre.

## C2. Como a tarefa entra na agenda

Cinco edições em `src/lib/dashboard/agenda.ts` e nada mais:

1. `'task'` entra em `AgendaKind` e na **primeira** posição de
   `AGENDA_KINDS` — a ordem de desenho é "trabalho humano primeiro", e uma
   tarefa é o item mais humano que a lista tem.
2. `AGENDA_TONE.task = 'human'`.
3. `loadTasks()` como sétima fonte dentro do `Promise.all`, sob `safe()`.
4. `RescheduleTarget` ganha `'task'`, e `rescheduleItem()` um terceiro ramo.
   Isto **cabe na doutrina existente** em vez de esticá-la: o comentário de
   topo diz que só se move "as duas datas de que uma pessoa é dona", e o
   prazo de uma tarefa é a terceira — talvez a mais óbvia das três.
5. `href` = `/agenda?task=<id>`.

Nas telas, um ícone (`ListChecks`) em `KIND_ICON` nos dois componentes, e as
chaves de tradução em `Today.agenda.kind` / `kindShort` nos três idiomas.

**Uma tarefa vencida.** Ela não muda de tipo — muda de tom. `overdue` é
derivado (`status = 'open' && due_on < hoje`), desenhado com o tom `danger`
que já existe, sem coluna nova e sem varredura que "marque atrasadas".

## C3. Lembretes

O CHECK de `notifications.type` cresce para
`('conversation_assigned', 'new_message', 'task_due')`. A tabela já não tem
política de INSERT para o navegador — quem escreve é o service role, que é
exatamente o que a varredura do cron usa.

A varredura (`src/lib/tasks/reminders.ts`, chamada no tique de automações):
tarefas abertas com `remind_minutes_before` e `reminded_at IS NULL` cujo
instante calculado (dia + hora, no fuso da conta, menos os minutos) já
passou. Escreve a notificação, carimba `reminded_at`. O carimbo é o
anti-duplicidade — dois tiques concorrentes não notificam duas vezes, o
mesmo raciocínio do `claim` no drenador de eventos.

Uma tarefa **sem hora** lembra na primeira hora útil do dia (§B), não à
meia-noite.

## C4. Onde se cria uma tarefa

| Superfície                              | Como                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `/agenda`                               | Botão principal; clicar num dia/hora já vem com o prazo preenchido       |
| Painel do contato (`contact-sidebar`)   | Bloco "Tarefas" acima ou junto ao de ocorrências, já com `contact_id`    |
| Cartão da oportunidade (`deal-card`)    | Item de menu, já com `deal_id` e `contact_id`                            |
| Registro de ligação (`call-log-dialog`) | Caixa "criar tarefa de retorno" — é o §15 do MD, finalmente com entidade |
| Automação (fase 7)                      | Passo `create_task`                                                      |

O `call-log-dialog.tsx` diz hoje que "o CRM não disca nem agenda ligações".
Continua verdade sobre discar; deixa de ser sobre agendar, e o comentário
precisa ser reescrito na mesma passada — um comentário que descreve uma
decisão revogada é pior que nenhum.

---

# PARTE D — Google Agenda

## D0. Uma conexão, a da empresa

Decisão 4: **uma linha em `calendar_connections` por conta**, não por
usuário. Um admin autoriza a conta Google principal da empresa e escolhe
quais agendas dela entram; todos os membros leem as mesmas, e uma tarefa
publicada vai para uma agenda que a empresa controla — não para a conta
pessoal de quem a criou.

O que isso muda no desenho da Parte D: `UNIQUE (account_id, provider)` em
vez de `UNIQUE (user_id, provider, provider_email)`; `user_id` vira
`connected_by`, que é histórico e não chave; e a autorização fica atrás de
`settings.manage`. O resto — espelho, vínculo, as cinco regras — não muda.

O dia em que cada vendedor quiser a agenda dele é uma migração que relaxa o
índice único, não um redesenho.

## D1. Sem SDK

`googleapis` são dezenas de megabytes para usar três endpoints. O repositório
já fala com a Graph API da Meta por `fetch` cru (`lib/whatsapp/meta-api.ts`) e
a Calendar API não é mais difícil: `POST /token` para renovar, `GET
/users/me/calendarList`, `GET/POST/PATCH/DELETE /calendars/{id}/events`.
**Nenhuma dependência nova**, e a imagem Docker não engorda.

## D2. Conectar

Fluxo OAuth 2.0 _authorization code_ com `access_type=offline` e
`prompt=consent` (sem isso não vem refresh token na segunda autorização).

**Escopos**, os dois mais estreitos que resolvem:

- `.../auth/calendar.readonly` — listar as agendas e ler eventos (importar).
- `.../auth/calendar.events` — criar e editar os eventos do CRM.

Variáveis novas em `.env.local.example` e `docs/configuracao-env.md`:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`.
`ENCRYPTION_KEY` já existe e é a mesma.

**CSRF no `state`.** O parâmetro leva um nonce assinado, guardado em cookie
`httpOnly` de vida curta e conferido no retorno. Sem isso, o callback aceita
uma autorização que outro site iniciou.

```sql
CREATE TABLE IF NOT EXISTS calendar_connections (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  provider_email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,       -- encrypt()
  access_token  TEXT,                -- encrypt(), vida de uma hora
  access_expires_at TIMESTAMPTZ,
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'connected'
                CHECK (status IN ('connected', 'revoked', 'error')),
  last_error    TEXT,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider, provider_email)
);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
-- E NENHUMA POLÍTICA. Deliberado, e é o mesmo padrão de
-- `automation_pending_executions` explicado em `api/agenda/scheduled`:
-- a linha guarda um token que abre a agenda pessoal de alguém, e uma
-- política é uma concessão permanente. O navegador nunca lê esta tabela;
-- o estado da conexão vem por rota, com os campos escolhidos à mão.
```

## D3. Importar: um espelho, nunca uma tarefa

Duas tabelas: quais agendas seguir, e o que há nelas.

```sql
CREATE TABLE IF NOT EXISTS calendar_sources (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,          -- o calendarId da Google
  summary       TEXT,
  color         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,

  -- 'in'  = só importa    (a agenda pessoal do vendedor aparece aqui)
  -- 'out' = só publica    (a agenda "Comercial" recebe as tarefas)
  -- 'both'= os dois
  direction     TEXT NOT NULL DEFAULT 'in'
                CHECK (direction IN ('in', 'out', 'both')),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,

  -- O token incremental da Google. Guardá-lo é a diferença entre
  -- reimportar tudo a cada cinco minutos e pedir só o que mudou.
  sync_token    TEXT,
  last_synced_at TIMESTAMPTZ,
  next_poll_at   TIMESTAMPTZ,
  last_error     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, external_id)
);

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

  -- Os dois modelos da Google, guardados como a Google os manda. Um
  -- evento de dia inteiro NÃO vira timestamp: é exatamente a conversão
  -- que `lib/calendar.ts` proíbe no comentário de topo.
  all_day     BOOLEAN NOT NULL DEFAULT FALSE,
  start_date  DATE,
  end_date    DATE,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,

  status      TEXT,                   -- confirmed | tentative | cancelled
  organizer_email TEXT,
  attendee_emails TEXT[],
  -- Casado por e-mail de participante com `contacts.email`. Nulo é o
  -- normal; quando bate, o evento aparece na ficha do cliente.
  contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,

  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_window
  ON calendar_events(account_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_day
  ON calendar_events(account_id, start_date);
```

Na agenda isso vira o `AgendaKind` `'external'`, tom `neutral`,
`reschedule: null`, `href` = o `html_link` da Google. Sem botão de concluir,
sem arrastar: é a mesma linha que a agenda já traça entre o que uma pessoa
comanda e o que ela apenas observa.

## D4. Publicar: uma tabela de vínculo

"Vincular a outra agenda uma tarefa criada" é literalmente esta tabela.

```sql
CREATE TABLE IF NOT EXISTS task_calendar_links (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  external_id TEXT,                  -- o eventId criado lá
  etag        TEXT,                  -- a versão que ESTE lado escreveu
  sync_state  TEXT NOT NULL DEFAULT 'pending'
              CHECK (sync_state IN ('pending', 'synced', 'error', 'deleted')),
  last_error  TEXT,
  retry_after TIMESTAMPTZ,
  pushed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, source_id)
);
```

Uma tarefa pode ter **mais de um** vínculo — a agenda pessoal do vendedor e a
"Comercial" da empresa. É por isso que é tabela e não coluna.

**Id determinístico.** A Google aceita id de evento fornecido pelo cliente
(base32hex, 5–1024 caracteres). Usar `'wacrm' || replace(task_id::text,'-','')`
em minúsculas torna o envio idempotente de graça: uma repetição por timeout
devolve 409 em vez de criar um evento gêmeo, e o 409 é tratado como "já
existe, então PATCH". A linha de vínculo continua sendo a verdade — o id
determinístico é o cinto, ela é o suspensório.

**Envio síncrono, com rede de retorno.** O evento aparece na Google no
momento em que a tarefa é salva (é o que a pessoa espera ver); se a chamada
falhar, a linha fica `pending` com `retry_after` e o cron drena. O mesmo
padrão de caixa de saída que a 065 usa para eventos de etapa.

## D5. As cinco regras de sincronização

Escrever isto agora evita a semana perdida depois.

1. **Evento vinculado não entra no espelho.** Ao importar, um evento cujo
   `external_id` tem linha em `task_calendar_links` é ignorado — senão a
   mesma tarefa aparece duas vezes na agenda, uma como tarefa e outra como
   evento importado.
2. **Mover na Google move a tarefa.** Se um evento vinculado volta da
   importação com `etag` diferente do gravado e horário diferente,
   `due_on`/`due_time` da tarefa são atualizados — e o `etag` novo é gravado
   **antes** de qualquer envio, para não ricochetear.
3. **Apagar na Google desvincula, não apaga a tarefa.** O vínculo vai para
   `sync_state = 'deleted'` e a tarefa segue viva, com um aviso na tela. O
   contrário — sumir com o compromisso do CRM porque alguém limpou a agenda —
   é perda de dado silenciosa.
4. **Concluir/cancelar no CRM não apaga o evento**; marca o título com um
   prefixo (`✓`) e, no cancelamento, apaga. Cancelado é o único caso em que
   o evento some, porque é o único em que ele deixa de ser verdade.
5. **Token expirado (410) força reimportação completa** daquela fonte, com
   janela limitada. É o comportamento documentado da própria API e a única
   forma de voltar a um estado consistente.

## D6. Como o sync roda

- **Puxar:** `/api/calendar/cron` a cada 5 minutos, mesmo cabeçalho
  `x-cron-secret` da rota de automações. Para cada `calendar_sources`
  habilitada com `next_poll_at` vencido: renova o access token se preciso,
  chama `events.list` com `syncToken` (ou, na primeira vez, `timeMin`/
  `timeMax` de −30 a +90 dias), grava o espelho, guarda `nextSyncToken`.
- **Empurrar:** síncrono ao salvar a tarefa; o cron drena os `pending`.
- **`events.watch` (tempo real) fica para depois.** Exige endpoint público,
  tabela de canais e renovação antes de expirar — custo operacional real
  para ganhar quatro minutos. A importação por `syncToken` é barata e
  correta; o watch é otimização, e está na Parte G.

---

# PARTE E — O plano por fases

Cada fase é aplicável e útil sozinha. Tamanhos: **(P)** pequena, **(M)**
média, **(G)** grande.

## Fase 1 — Base de horários · migração `066` — (M) — ✅ ENTREGUE

**Banco:** `066_business_hours.sql`, com as três coisas do §B2 e a semente
seg–sex 08:00–12:00 / 13:30–18:00 por conta. **Aplicada em 3 de setembro
de 2026** (dez linhas de expediente semeadas).

**Código:**

- `src/lib/hours.ts` + `hours.test.ts` — as cinco funções puras do §B3.
- `src/lib/automations/local-time.ts` — `DEFAULT_TIMEZONE` vira fallback;
  quem chama passa o fuso da conta.
- `src/lib/dashboard/agenda.ts` — `dayOf()`/`timeOf()` no fuso da conta.
- `src/components/ui/time-field.tsx` — o par que falta do `date-field`.
- `src/components/settings/hours-panel.tsx` + entrada em
  `settings-sections.ts` (grupo "A forma da conta", junto de `deals`),
  atrás de `settings.manage`.
- `src/hooks/use-business-hours.ts` — carrega uma vez, serve as telas.
- i18n nos três arquivos de `messages/`.
- Asserções em `supabase/ci/verify-schema.sql`.

**Entregue:** `lib/hours.ts` (33 testes), `ui/time-field.tsx` (9 testes),
`hooks/use-business-hours.ts`, `settings/hours-panel.tsx` em
Configurações › Horários, `lib/automations/account-timezone.ts` com a
precedência declarado > conta > constante (7 testes), a agenda agrupando no
fuso da conta (2 testes), i18n nos três idiomas e as asserções da 066 em
`verify-schema.sql`.

**Aplicada em 3 de setembro de 2026.** A tolerância continua no código de
propósito: `useBusinessHours` e `accountTimeZone()` caem no padrão quando a
coluna não responde, que é o que mantém uma instância nova de pé antes da
migração — e o motivo de o CI checar a coluna em vez de confiar no silêncio.

## Fase 2 — A entidade tarefa · migração `068` — (G) — ✅ ENTREGUE

**Banco (068):** `tasks` do §C1, RLS, índices; CHECK de `notifications.type`
alargado com `task_due`.

**Código:**

- `src/types/index.ts` — `Task`, `TaskKind`, `TaskStatus`.
- `src/lib/tasks/{queries,mutations,reminders}.ts` + testes.
- `src/lib/dashboard/agenda.ts` — as cinco edições do §C2.
- `src/components/tasks/task-dialog.tsx`, `task-list.tsx`, `task-row.tsx`.
- Ganchos nas quatro superfícies do §C4.
- `src/lib/auth/capabilities.ts` — `tasks.view` (piso `viewer`, rls-backed).
- Varredura de lembretes no tique de automações.
- Ícone e traduções nas duas telas de calendário.

**Entregue.** `lib/tasks/{queries,mutations,reminders}.ts` (21 testes),
`components/tasks/{task-dialog,task-list}.tsx`, tarefa como sétimo
`AgendaKind` com `reschedule: 'task'`, `tasks.view` nas capacidades,
`notifications.type = 'task_due'` com varredura no tique do cron, e i18n nos
três idiomas.

Aparece em quatro lugares: aba **Tarefas** na ficha do contato, bloco no
painel da caixa de entrada, bloco na ficha da oportunidade (abaixo do
roteiro da etapa) e a caixa **"criar tarefa de retorno"** no registro de
ligação — pré-marcada em "não atendeu" e "retornar depois", que é o §15 do
MD finalmente com entidade.

**Sem rotas `/api/tasks`.** O resto do CRM escreve direto do navegador sob
RLS — `lib/dashboard/agenda.ts` já faz isso com `deals` — e uma rota seria um
segundo caminho para a mesma tabela, com uma segunda regra de permissão para
manter. A API pública (`/api/v1/tasks`) continua na Fase 7, que é outra
coisa: um contrato para fora.

**Aplicada em 3 de setembro de 2026**, e conferida contra o projeto em 6 de
setembro: `tasks` e `notifications.task_id` respondendo. A fase está
fechada.

## Fase 3 — `/agenda`, com eixo de horas — (M)

- `src/app/(dashboard)/agenda/page.tsx` + entrada na `sidebar.tsx` e na
  `mobile-tab-bar.tsx`.
- `src/components/agenda/{month,week,day}-view.tsx` — a de mês reaproveita
  `MonthGrid`; as de semana e dia desenham entre os limites do §B.
- Filtros por tipo e por responsável; "Minhas" como padrão.
- Deep link `?task=<id>` e `?d=<YYYY-MM-DD>`.

**Fica pronto:** o calendário deixa de ser um painel e vira um lugar.

## Fase 4 — Conectar e importar da Google · migração `069` — (G)

- Banco: `calendar_connections`, `calendar_sources`, `calendar_events`,
  `task_calendar_links` (a tabela nasce aqui, é usada na fase 5).
- `src/lib/calendar-sync/google/{oauth,client,events,map}.ts` + testes do
  mapeamento (dia inteiro ↔ `start.date` é onde os erros moram).
- Rotas: `GET /api/calendar/google/authorize`, `GET .../callback`,
  `GET|DELETE /api/calendar/connections`, `GET|PATCH /api/calendar/sources`,
  `POST /api/calendar/sync` (manual), `GET /api/calendar/cron`.
- `src/components/settings/calendars-panel.tsx` — conectar, escolher agendas,
  direção por agenda, "sincronizar agora", desconectar.
- Fonte `external` na agenda + casamento por e-mail com `contacts`.
- `.env.local.example`, `docs/configuracao-env.md`, `docs/deploy.md` (o cron
  novo).

**Fica pronto:** o que já está agendado no Google aparece no CRM.

## Fase 5 — Publicar tarefas na Google — (M)

- Envio síncrono ao salvar, com id determinístico e drenagem no cron.
- Seletor "publicar em" no diálogo de tarefa (agendas com `direction`
  `out`/`both`), com padrão por usuário.
- As cinco regras do §D5, cada uma com teste.
- Estado do vínculo visível na linha da tarefa (sincronizada / pendente /
  erro / removida no Google).

**Fica pronto:** o pedido inteiro está atendido.

## Fase 6 — Automação e tarefa (fecha a decisão 2 do spec anterior) — (M)

`automations.trigger_type` e `step_type` **não têm CHECK** no banco, então
isto é só código:

- Ação `create_task` — título, tipo, responsável (fixo ou o dono da
  oportunidade), prazo relativo (`+3 dias úteis`, lendo o §B).
- Gatilho `task_completed`, com filtro por tipo de tarefa.
- Entradas no `automation-builder.tsx` e no catálogo de blocos.

Isto preenche as duas linhas ❌ das tabelas §A15/§A16 do spec anterior.

## Fase 7 — Documentação e entrega — (P)

- `src/lib/releases.ts` + `WhatsNew` nos três idiomas.
- `docs/releases/v0.10.0.md`.
- API pública: `/api/v1/tasks` e a página `/developers` (o spec tipado de
  `lib/api-docs`).
- Atualizar `docs/spec-automacoes-fluxo.md`: a decisão 2 foi revogada, com
  ponteiro para este arquivo.
- Reescrever o comentário de `call-log-dialog.tsx`.

---

# PARTE F — Verificação

| #   | Cenário                                                             | Esperado                                                                                    |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Conta com fuso `America/Sao_Paulo`, leitor em `Asia/Seoul`          | A tarefa das 14h aparece no dia 12 para os dois; o agrupamento não escorrega                |
| 2   | Tarefa criada com o atalho "amanhã", numa sexta                     | Cai na segunda às 08:00 se sábado e domingo estiverem fechados                              |
| 3   | Feriado cadastrado como exceção fechada                             | A vista de dia mostra fechado; "+2 dias úteis" pula                                         |
| 4   | Tarefa arrastada na agenda para outro dia                           | `due_on` muda, o vínculo Google fica `pending`, o evento move em até um tique               |
| 5   | Tarefa concluída                                                    | `completed_at` gravado; evento na Google ganha `✓`; gatilho `task_completed` dispara (f. 6) |
| 6   | Contato apagado                                                     | Suas tarefas somem junto; as oportunidades apagadas deixam a tarefa viva sem `deal_id`      |
| 7   | Importação inicial de uma agenda com 400 eventos                    | Janela de −30/+90 dias, `nextSyncToken` guardado, nada duplicado numa segunda chamada       |
| 8   | Evento criado no celular durante o dia                              | Aparece no CRM em até 5 minutos, sem botão de concluir e sem poder ser arrastado            |
| 9   | Evento de dia inteiro importado                                     | Cai no dia certo (não no anterior) para leitores a oeste de Greenwich                       |
| 10  | Tarefa publicada e depois movida DENTRO da Google                   | O CRM segue o novo horário; não há segundo evento nem ping-pong de escrita                  |
| 11  | Evento vinculado apagado na Google                                  | Vínculo `deleted`, tarefa viva, aviso na linha                                              |
| 12  | `syncToken` expirado (410)                                          | Reimportação completa da fonte, sem duplicar linhas do espelho                              |
| 13  | Usuário revoga o acesso na conta Google                             | Conexão vira `revoked`, painel pede reconexão, cron para de tentar                          |
| 14  | Cron parado por duas horas                                          | Ao voltar, importa o acumulado e envia os `pending` na ordem; nenhum lembrete duplicado     |
| 15  | Dois tiques concorrentes na varredura de lembretes                  | Uma notificação, um `reminded_at`                                                           |
| 16  | Membro `viewer` abre `/agenda`                                      | Vê tudo, não cria nem conclui; a conexão Google dele é dele                                 |
| 17  | Instância sem `SUPABASE_SERVICE_ROLE_KEY` ou sem Google configurado | A agenda carrega com as fontes que consegue, como já faz hoje                               |

---

# PARTE G — O que fica de fora

- **`events.watch`** (importação em tempo real). Ver §D6.
- **Outros provedores** (Microsoft 365, CalDAV). A camada
  `lib/calendar-sync/` nasce com o `google/` embaixo justamente para que um
  segundo provedor não seja uma reescrita — mas nenhum é desta entrega.
- **Feed `.ics` de assinatura** (`/api/calendar/feed/[token].ics`), que
  deixaria qualquer agenda ler o CRM sem OAuth. É pequeno e útil; se a
  Fase 4 atrasar por causa da verificação da Google (decisão 5), este é o
  plano B e vira fase própria.
- **Convidar o cliente por e-mail** a partir de uma tarefa. Requer decidir
  quem é o remetente e cai em política de mensagem, não de agenda.
- **Videochamada** (Meet/Zoom) anexada à tarefa.
- **Recorrência de tarefas.** A Google tem `RRULE`; o CRM não precisa dela
  para "ligar na quinta". Se entrar, entra como campo próprio e não como
  cópia da semântica da Google.
- **Horário por pessoa.** A coluna existe (§B2); a tela não.
- **Sub-tarefas, checklist, anexos.** O playbook já cobre roteiro.

---

# Riscos

| Risco                                              | Peso  | O que fazer                                                                                |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| Verificação do OAuth na Google (escopos sensíveis) | Alto  | Decisão 5 — ficar em Testing. Se precisar publicar, começar o processo **antes** da fase 4 |
| Não existe cron rodando                            | Alto  | É a decisão 8, herdada. Sem ela, fases 2 (lembrete) e 4 (importar) entregam metade         |
| Fuso: a agenda hoje agrupa no fuso do navegador    | Médio | Corrigir na fase 1, com teste, antes de existir tarefa com hora                            |
| Ping-pong de escrita entre CRM e Google            | Médio | Regras 1 e 2 do §D5, com teste dedicado. É o defeito clássico desta integração             |
| Custo de i18n: cada string em `en`, `ko` e `pt-BR` | Baixo | Contar as chaves ao planejar cada fase; são três arquivos por texto novo                   |
| A 065 ainda não foi aplicada                       | Baixo | Aplicar antes de escrever a 066, ou o número muda                                          |

---

# Regras de implementação

1. Migração aplicada nunca é editada; conferir `ls supabase/migrations/`
   antes de nomear. A 066 só existe depois que a 065 estiver aplicada.
2. Token de terceiro nunca chega ao navegador. `calendar_connections` não
   tem política de RLS — o estado da conexão sai por rota, com os campos
   escolhidos à mão, como em `api/agenda/scheduled`.
3. Nada é apagado por conclusão ou cancelamento. Status, sempre.
4. Data que uma pessoa é dona pode ser movida da agenda; data que a máquina
   ou outro sistema é dono, não. É a doutrina que `lib/dashboard/agenda.ts`
   já enuncia — tarefa entra do lado humano, evento importado do outro.
5. Nenhuma conversão de dia inteiro para timestamp. `lib/calendar.ts` explica
   por quê no topo, e a Google modela do mesmo jeito.
6. Sem dependência nova para falar com a Google.
7. Este arquivo é atualizado a cada fase fechada, e a decisão 2 do
   `spec-automacoes-fluxo.md` passa a apontar para cá.
