# Worklog — 0.9.0

Cada mudança, por área, com os arquivos. Índice em
[00-README.md](00-README.md). O porquê de cada forma está em
[02-decisoes.md](02-decisoes.md); o que cada peça faz, em detalhe, na
Parte C e na Parte D do [spec](../spec-automacoes-fluxo.md).

---

## 1. A migração 065

**`supabase/migrations/065_deal_stage_events_and_automation_scope.sql`** —
nova. Sete blocos, idempotentes:

| Bloco | O quê                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------- |
| 1     | `deals.stage_entered_at`, com backfill de `updated_at` e gatilho `BEFORE UPDATE OF stage_id`                                |
| 2     | `deal_stage_events` + gatilho `AFTER INSERT OR UPDATE OF stage_id` (SECURITY DEFINER; `changed_by = auth.uid()`)            |
| 3     | `automation_pending_executions.deal_id`, `cancelled_reason`, status `cancelled`, dois índices parciais                      |
| 4     | `automation_logs.deal_id`, `end_reason`, `trigger_key` (índice único parcial por automação), status `cancelled` e `skipped` |
| 5     | `automations.pipeline_id`, `cancel_on_reply`, `cancel_when_stage_in`, `reentry_policy`, `reentry_days`                      |
| 6     | `messages.quick_reply_id`                                                                                                   |
| 7     | `contacts_with_birthday_on(account, month, day)`, só para o service role                                                    |

O gatilho de evento é `AFTER` porque um `BEFORE INSERT` ainda não tem
`deals.id` para a chave estrangeira; a criação conta como entrada na
etapa, de propósito.

**`supabase/ci/verify-schema.sql`** — sete asserções novas: a tabela, os
dois gatilhos, as colunas de fila e log, `cancel_on_reply`,
`quick_reply_id` e a função.

## 2. Tipos

**`src/types/index.ts`** — três gatilhos, quatro passos, dois status de
log, `AutomationReentryPolicy`, as configs dos gatilhos e passos novos,
`WaitStepConfig.mode`, três assuntos de condição, os cinco campos de
regra em `Automation`, `deal_id`/`end_reason`/`trigger_key` em
`AutomationLog`, `stage_entered_at` em `Deal`, `DealStageEvent`,
`quick_reply_id` em `Message`.

## 3. O motor

**`src/lib/automations/engine.ts`** — reescrito por cima do que existia,
sem mudar nenhum caminho antigo:

- `AutomationContext` carrega `deal_id`, `stage_id`, `quick_reply_id`,
  `template_name`, `date_field`, `trigger_key`, `run_started_at` e um
  `_wait_until` interno.
- `executeAutomation` resolve a oportunidade **só** quando a automação é
  deal-aware (gatilho de etapa ou `pipeline_id` declarado), consulta a
  reentrada, e grava o log com `deal_id` e `trigger_key` — com recuo sem
  as colunas novas, e retorno silencioso em `23505` (chave já usada).
- `executeStepsFrom` devolve `done | ended | waiting`; `end` para tudo,
  inclusive a partir de um ramo; uma espera dentro de um ramo continua
  não parando o que vem depois da condição (ver decisões).
- `wait` ganha `until_contact_date`, que calcula o instante no fuso e
  parca com `_wait_until`; `resumePendingExecution` relê o campo ao
  acordar e re-parca ou encerra com `date_cleared`.
- Passos `move_deal_stage` (gates de ganho e perda), `update_deal`,
  `cancel_automations`, `end`; condições `deal_in_stage`, `deal_is_open`,
  `customer_replied_since`.
- `triggerMatches` para `deal_stage_entered`, `team_message_sent`,
  `date_field_reached`, todos fechados na falta de configuração.
- `interpolate` virou assíncrono e resolve `{{contact.*}}` e `{{deal.*}}`
  com cache por execução (`WeakMap` pelo contexto); `first_name` vazio
  vira "cliente".

## 4. Módulos novos

| Arquivo                               | O quê                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/automations/cancel.ts`       | `cancelPendingOnReply`, `cancelPendingOnStageEnter`, `cancelPendingByStep`; status e motivo, nunca delete; guarda de corrida em `status = pending` |
| `src/lib/automations/reentry.ts`      | Regra dura por oportunidade + as quatro políticas; falha aberto num banco pré-065                                                                  |
| `src/lib/automations/stage-events.ts` | O drenador da caixa de saída: claim, cancela, dispara; freio de laço por taxa (`MAX_EVENTS_PER_HOUR`)                                              |
| `src/lib/automations/date-sweep.ts`   | A varredura de datas, agrupada por (conta, campo, fuso, hora), idempotente por `trigger_key`                                                       |
| `src/lib/automations/local-time.ts`   | Dia e hora locais num fuso nomeado; `zonedTimeToUtc` em duas passadas                                                                              |
| `src/lib/automations/rule-fields.ts`  | Lê os cinco campos de regra de um body — só os enviados                                                                                            |

## 5. O cron

**`src/app/api/automations/cron/route.ts`** — quatro trabalhos, na ordem:
eventos de etapa, esperas vencidas, varredura de datas, passagem de
conversas paradas. A ordem é a regra: um cancelamento que chega no mesmo
minuto de uma espera vencida tem de valer antes de ela acordar.

## 6. O webhook de entrada

**`src/app/api/whatsapp/webhook/route.ts`** — `cancelPendingOnReply`
logo depois de resolver o contato e **antes** dos Fluxos e das
automações. Um "SAIR" também cancela.

## 7. O envio pela equipe

- **`src/lib/whatsapp/send-message.ts`** — `quickReplyId` nos parâmetros,
  conferido contra a conta; gravado na mensagem (com recuo sem a coluna);
  `team_message_sent` disparado **só** quando há `senderId` e a origem é
  o Atendimento.
- **`src/app/api/whatsapp/send/route.ts`** — aceita `quick_reply_id`.
- **`src/components/inbox/message-composer.tsx`** — guarda o id da
  resposta rápida escolhida (texto e mídia), limpa ao esvaziar o campo,
  entrega no `onSend` e no `onSendMedia`.
- **`src/components/inbox/message-thread.tsx`** — passa `quick_reply_id`
  nos dois envios.

## 8. Validação

**`src/lib/automations/validate.ts`** — regras dos passos, gatilhos e
condições novos; `validateAutomationSettings` para as regras;
`collectActivationWarnings`, não bloqueante, para mensagem de texto após
24 h de espera (os ramos herdam a espera do pai).

**`src/lib/automations/trigger-meta.ts`** — os três gatilhos em
`KNOWN_TRIGGERS`.

## 9. O construtor

**`src/components/automations/automation-builder.tsx`** — `BuilderInitial`
com as regras e `DEFAULT_RULES`; `STEP_META` e `ADDABLE_STEPS` com os
quatro passos; `TRIGGER_OPTIONS` sem os gatilhos mortos, mas o tipo atual
sempre presente na lista; recursos de respostas rápidas e automações;
`QuickReplySelect`, `StageSelect`, `StageChecklist`,
`AutomationChecklist`; formulários dos gatilhos e passos novos; espera
com modo; condição com os três assuntos; `RulesCard` entre o gatilho e o
primeiro passo; `previewFor` com nomes de etapa; aviso do servidor como
toast.

## 10. A API de automações

- **`src/app/api/automations/route.ts`** e **`[id]/route.ts`** — leem e
  validam as regras, devolvem `warnings`, refazem a escrita sem as
  colunas novas num banco pré-065. Um PATCH que só manda `is_active` não
  toca em regra nenhuma.
- **`[id]/duplicate/route.ts`** — a cópia leva as regras.

## 11. Telas

- **`automations/[id]/logs/page.tsx`** — oportunidade (com link),
  motivo de encerramento em palavras, status `cancelled` e `skipped` em
  cinza; o embed da oportunidade recua num banco pré-065.
- **`automations/page.tsx`** — badges das regras na linha; seção "Funil
  de Vendas" com os dez modelos, aberta numa conta vazia e dobrada
  quando há lista.
- **`automations/new/page.tsx`** — carrega funis, etapas, etiquetas e
  respostas rápidas quando o modelo precisa, resolve os nomes, avisa o
  que não encontrou.
- **`automations/[id]/edit/page.tsx`** — carrega as regras.

## 12. Modelos instaláveis

**`src/lib/automations/templates.ts`** — os dez `funnel_*` como
`AutomationTemplateDefinition` com `refs` (nomes, não ids), `rules` e
`group`; `resolveTemplateReferences` com `normalizeName` (caixa,
acentos, espaços) e `STAGE_ALIASES`; preferência pelo funil declarado
quando dois funis têm uma etapa com o mesmo nome.

## 13. Dados e conteúdo

- **`src/lib/deals/outcome.ts`** — `em andamento` ganho, `venda perdida`
  perdido; `LOSS_REASONS` com oito, sem `noReply`.
- **`src/components/pipelines/deal-outcome.tsx`** — ícones dos dois
  motivos novos.
- **`src/lib/whatsapp/plastfortsul-templates.ts`** — `followup_d15 →
followup_d10`; `posvenda_d10 → posvenda_d20` com o texto do D20.
- **`messages/{en,pt-BR,ko}.json`** — 112 chaves por catálogo para o
  construtor, o histórico, a lista e os modelos, mais os dois motivos e
  a Novidades da 0.9.0.

## 14. Testes

Oito arquivos novos: `engine-deals`, `cancel`, `reentry`, `stage-events`,
`date-sweep`, `local-time`, `validate-rules`, `templates-funnel` (que
prova que todo template Meta que um modelo envia existe e recebe
exatamente as variáveis que declara), `send-message-quick-reply`,
`outcome`. Os antigos não mudaram, salvo o dos templates Meta, pelos
renomes.

## 15. Docs e release

`README.md`, `deploy.md`, `docker.md`, `configuracao-env.md`,
`.env.local.example`, `public-api.md`, `playbook-comercial.md`,
`spec-automacoes-fluxo.md`, `releases/v0.9.0.md`, `src/lib/releases.ts`,
`package.json` a 0.9.0, e esta pasta.
