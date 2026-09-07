# Worklog

Cada mudança, por área, com os arquivos.

---

## Banco

| Migração | O que faz |
| --- | --- |
| `066_business_hours` | `accounts.timezone`, `week_starts_on`, `slot_minutes`; tabelas `business_hours` e `business_hours_exceptions`, com a semente seg–sex 08:00–12:00 / 13:30–18:00 |
| `067_realtime_contact_surface` | `contacts`, `contact_tags` e `deals` na publicação `supabase_realtime` |
| `068_tasks` | A tabela `tasks` com RLS e cinco índices; `notifications.type` aceitando `task_due` e `notifications.task_id` |
| `069_google_calendar` | `calendar_connections` (RLS sem política), `calendar_sources`, `calendar_events`, `task_calendar_links` |

Asserções em `supabase/ci/verify-schema.sql`.

## Horários

- `src/lib/hours.ts` (33 testes) — as funções puras: intervalos do dia,
  dia útil, aberto às, próxima vaga, `addBusinessDays`, `dayBounds`.
- `src/lib/hours-db.ts` — do banco para o tipo.
- `src/lib/automations/account-timezone.ts` (7 testes) — a precedência
  declarado > conta > constante.
- `src/hooks/use-business-hours.ts`, `src/components/ui/time-field.tsx`
  (9 testes), `src/components/settings/hours-panel.tsx`.

## Tarefas

- `src/lib/tasks/{queries,mutations,reminders}.ts` (21 testes) e
  `notify-client.ts`.
- `src/components/tasks/{task-dialog,task-list}.tsx`.
- Quatro superfícies: aba na ficha do contato, bloco no painel da caixa de
  entrada, bloco na oportunidade, caixa "criar tarefa de retorno" no
  registro de ligação.
- `tasks.view` em `src/lib/auth/capabilities.ts`; varredura de lembretes no
  tique de `src/app/api/automations/cron/route.ts`.

## Agenda

- `src/lib/agenda/view.ts` (20 testes) — semana, janela por modo, filtro,
  eixo, posição de um item.
- `src/components/agenda/` — `agenda-view.tsx` (o contêiner),
  `time-grid.tsx` (a grade compartilhada), `{month,week,day}-view.tsx`,
  `agenda-chip.tsx`, `tokens.ts`.
- `src/app/(dashboard)/agenda/page.tsx`; entrada na `sidebar.tsx`;
  `/agenda` em `PROTECTED_PATHS`.
- `src/lib/dashboard/agenda.ts` — `owner` no `AgendaItem`, `'external'` como
  oitavo tipo, `loadExternalEvents`, `href` da tarefa apontando para
  `/agenda?task=`.

**Consolidação:** `KIND_ICON`, `TONE_DOT` e `TONE_CHIP` estavam escritos
duas vezes, palavra por palavra, no painel do dashboard e na faixa do
cabeçalho. Viraram `components/agenda/tokens.ts` em vez de virarem três
cópias.

## Google Agenda

- `src/lib/calendar-sync/google/oauth.ts` (13 testes) — fluxo por `fetch`
  cru, `state` assinado, renovação.
- `client.ts` — a Calendar API e o significado de cada código de erro.
- `events.ts` — importação incremental, `showDeleted`, casamento por e-mail.
- `push.ts` (17 testes) — reconciliação e as regras 2, 3 e 4 do §D5.
- `map.ts` (21 testes) — o fim exclusivo, o id determinístico, tarefa ↔
  evento.
- `run.ts` — isolamento de falha por fonte, recuo por tipo de erro, dreno da
  caixa de saída.
- Rotas: `authorize`, `callback`, `connections`, `sources`, `sync`,
  `publish`, `cron`.
- `src/components/settings/calendars-panel.tsx`, em Configurações › Agendas.

## Automações

- `create_task` em `AutomationStepType`, com `CreateTaskStepConfig` e a
  execução no motor; `resolveDealOwner` faz o join `profiles` → `auth`.
- `task_completed` em `AutomationTriggerType`, com
  `TaskCompletedTriggerConfig` e o casamento por tipo.
- `src/app/api/automations/task-completed/route.ts`, que confere o estado no
  banco antes de disparar.
- Entradas no `automation-builder.tsx` e no `trigger-meta.ts`.
- 8 testes no prazo em dias úteis.

## API pública e documentação

- `src/lib/api/v1/tasks.ts` (15 testes) — serialização e validação.
- `src/app/api/v1/tasks/route.ts` e `[id]/route.ts`.
- Escopos `tasks:read` e `tasks:write`.
- Quatro endpoints em `src/lib/api-docs/endpoints.ts`, na página
  `/developers`.
- `docs/public-api.md`, `docs/releases/v0.10.0.md`, `docs/configuracao-env.md`,
  `docs/deploy.md`, `.env.local.example`.
- `src/lib/releases.ts` e o `WhatsNew` nos três idiomas.

## Fora do plano, mas na mesma entrega

- **Página `/developers`** — a documentação da API como página, modelada na
  anatomia do Chatwoot. `src/app/(docs)/`, `src/components/docs/`,
  `src/lib/api-docs/`.
- **`docs/estado-do-projeto.md`** — o estado vivo, versionado, para que o
  contexto não dependa da memória de uma sessão.
- **20,26 GB recuperados** apagando `.next` — o cache do Turbopack tinha
  6.131 arquivos `.sst` acumulados desde 22 de agosto.
