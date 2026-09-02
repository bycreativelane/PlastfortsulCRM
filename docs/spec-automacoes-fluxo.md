# Automações comerciais — o fluxo oficial contra o código

> **Estado na 0.8.5 (2 de setembro de 2026).** Revisão do documento
> `PlastfortSul_CRM_Automacoes_Fluxo_Correto.md` (daqui em diante, "o MD"),
> conferido contra o código em **2 de setembro de 2026**. O MD passa a ser a
> regra oficial do funil de Vendas (§25 dele). Este arquivo diz o que do MD
> já existe, o que colide com decisões já tomadas, e em que ordem construir
> o resto.
>
> **Implementado em 2 de setembro de 2026 e entregue na 0.9.0**, com os
> padrões recomendados da Parte 0. As fases 1 a 8 estão no código e na migração
> `065_deal_stage_events_and_automation_scope.sql`, que está **escrita e
> não aplicada** — nada do fluxo roda antes dela. As marcas da Parte A
> descrevem o estado ANTES desta entrega; o que continua em aberto está no
> fim da Parte D ("O que ficou de fora desta entrega").

O diagnóstico em uma frase: **o MD é escrito por oportunidade e por tempo na
etapa; o motor de automações é escrito por contato e por evento de
mensagem.** Dos seis gatilhos que o §20 exige, um existe. Das doze ações do
§21, seis existem. As três regras transversais — cancelamento por resposta,
controle de duplicidade e histórico por oportunidade — não existem.

| Marca | Significa                                         |
| ----- | ------------------------------------------------- |
| ✅    | Já existe. Não reimplementar                      |
| ⚠️    | Existe parcialmente, ou existe de forma diferente |
| ❌    | Não existe. É trabalho de verdade                 |
| 🔒    | Bloqueado por uma decisão que não é técnica       |

Como ler: a **Parte 0** são as decisões que travam o resto. A **Parte A**
percorre o MD seção por seção. A **Parte B** é o inventário do motor hoje.
A **Parte C** são os princípios de modelagem — como o MD vira blocos do
construtor sem reescrever o motor. A **Parte D** é o plano por fases, com a
migração 065 rascunhada. A **Parte E** mostra as automações do MD já
montadas com os blocos novos. A **Parte F** é a verificação, e a **Parte G**
o que fica de fora.

---

# 0. 🔒 As decisões que bloqueiam

Cada uma muda o que se constrói. Há uma recomendação para cada, para que a
resposta possa ser "ok" ou "não, assim".

| #   | Decisão                                                          | Recomendação                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Quais dias formam "a sequência dos primeiros 10 dias" (§3)       | **D1, D3 e D10**, depois o D30 do §4. São os quatro templates de follow-up que já existem, com `followup_d15` renomeado para `followup_d10` — o texto dele ("faz um tempo que enviamos seu orçamento") serve no D10. Nenhum template novo para aprovar                                 |
| 2   | Ligação é uma etapa ou uma tarefa (§15)                          | **Etapa, sem entidade tarefa.** O produto decidiu que "o CRM não disca nem agenda ligações" (`call-log-dialog.tsx`) e a Visão geral só mostra estados. A etapa "Ligação" já está na lista do MD: mover para ela **é** a tarefa; registrar a ligação é o resultado                      |
| 3   | Em qual etapa a venda acontece (§8 vs. código)                   | **Em Andamento**, como o MD diz. O valor passa a ser obrigatório ao entrar ali e a oportunidade vira `won`. Atendido continua reconhecido como ganho para uma oportunidade que pule a etapa, porque o gate só pergunta quando o valor ainda é zero                                     |
| 4   | Ordem das etapas no quadro                                       | O MD lista Follow-up na **oitava** posição, depois de Pós-venda. Parece ordem de digitação, não do funil. Recomendo: Novo Lead · Em Aberto · Follow-up · Em Negociação · Ligação · Em Andamento · Atendido · Pós-venda · Compra Futura · Geladeira 30D · Geladeira 60D · Venda Perdida |
| 5   | Recompra conta de Atendido (§11–12) ou de última compra + ciclo? | **Seguir o MD**: D60 e D120 por oportunidade, a partir de Atendido, cancelados se uma nova oportunidade do mesmo contato entrar em Em Andamento. `repurchase_cycle_days` e `last_purchase_at` ficam para segmentação e relatório, não para disparo                                     |
| 6   | Cliente responde **antes** da data de Compra Futura (§13)        | Mesma regra do §7: cancela a espera e vai para Em Negociação. O MD não diz; é a leitura coerente                                                                                                                                                                                       |
| 7   | Reabrir o que está estacionado desde 22/08                       | O seed dos pipelines e as automações de aniversário e recompra foram parados por decisão sua. O MD os pede de volta — com nomes de etapa **diferentes** dos do seed. Precisa de um "sim" explícito                                                                                     |
| 8   | O agendador                                                      | O evento de etapa (Parte C, §C4) chega ao motor pelo cron. Ele precisa rodar **a cada minuto**. O cron da Vercel no plano gratuito dispara uma vez por dia; é cron de VPS, `schedule` do GitHub Actions, ou plano pago                                                                 |

---

# PARTE A — O MD, seção por seção

## A0. ⚠️ O pipeline de doze etapas

O código não tem etapas fixas — são dados da conta, criadas em Configurações
› Pipelines. O que existe é o **seed estacionado** (`_removido-do-repo/scripts/seed-plastfortsul.mjs`),
com dez etapas e nomes antigos:

| Seed (parado)     | MD                          | Consequência                                                                                                                                                                                     |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Geladeira 30 dias | Geladeira 30D               | Só nome                                                                                                                                                                                          |
| Geladeira 60 dias | Geladeira 60D               | Só nome                                                                                                                                                                                          |
| Perdido           | **Venda Perdida**           | **Quebra o gate de motivo.** `isLostStage` em `src/lib/deals/outcome.ts` reconhece só `perdido`, `perdida` e `lost`. Com este nome, o motivo obrigatório do §14 deixa de ser pedido, em silêncio |
| —                 | Ligação                     | Nova. Ver decisão 2                                                                                                                                                                              |
| —                 | Compra Futura               | Nova. Hoje "compra futura" é uma **data no contato** (`next_purchase_expected_at`, migração 040), não uma etapa                                                                                  |
| Atendido = ganho  | Em Andamento = comprou (§8) | Ver decisão 3                                                                                                                                                                                    |

O pipeline **Operacional** do seed não é tocado pelo MD e não muda.

## A1. §1 `/aberto` → Em Aberto — ❌ gatilho, ✅ atalho

Os atalhos existem desde a migração 044: `quick_replies.shortcut`, único por
conta, minúsculo, sem espaço. `/aberto` é uma resposta rápida com esse
atalho. O que **não** existe é qualquer coisa acontecer quando ela é usada:

- `POST /api/whatsapp/send` não dispara automação nem webhook;
- o atalho é expandido no navegador (`message-composer.tsx`, `applyQuickReply`)
  e **descartado** — a linha em `messages` não guarda de qual resposta rápida
  veio. Não há coluna para isso em nenhuma migração.

E não existe a ação **mover oportunidade de etapa**.

## A2. §2 Em Aberto → 24 h sem resposta → Follow-up — ❌

Três coisas faltam, e nenhuma é a espera (essa existe):

- `deals` não guarda **quando** entrou na etapa. Não há `stage_entered_at`
  nem tabela de histórico; só o `updated_at` genérico.
- Não há gatilho de **entrada em etapa**. As quatro telas que movem uma
  oportunidade escrevem `stage_id` direto do navegador, sem evento
  (`pipelines/page.tsx`, `message-thread.tsx`, `deal-outcome.tsx`, `deal-form.tsx`).
- Não há condição **"o cliente respondeu desde X?"**.

## A3. §3–§4 Follow-up nos 10 dias e o D30 — ⚠️

O que serve: `send_template`, `wait` em dias, `condition`, o log por execução,
e os templates `followup_d1`, `followup_d3`, `followup_d15`, `followup_d30`
já escritos e validados. O que falta: a cadência (decisão 1), o cancelamento
quando o cliente responde (§A7) e o mover para Em Negociação e para
Geladeira 30D.

**Toda mensagem desta sequência sai fora da janela de 24 horas da Meta**, e
por isso só pode ser template aprovado. "Enviar mensagem" no MD é, na
prática, "Enviar template". A aprovação depende do número de teste da Meta,
que continua sendo o caminho crítico do projeto.

## A4. §5–§6 Geladeira 30D → 30 dias → Geladeira 60D — ❌ o mover, ✅ a espera

Sem mensagem em nenhuma das duas, por decisão do MD. O template
`reativacao_60d` fica **sem uso**; não apagar — é o que o §6 diz que virá
"depois".

## A5. §7 Regra geral de resposta do cliente — ❌

A fila de esperas (`automation_pending_executions`) tem os status `pending`,
`running`, `done` e `failed`. Nada a cancela: o webhook de entrada não a toca.
Os Fluxos fazem o **inverso** — pausam quando o **atendente** responde
(`send-message.ts`, `paused_by_agent`) — e nada acontece quando o cliente
responde.

Esta é a regra mais importante do MD e a que mais vezes aparece (§3, §4, §5,
§6, §7, §13, §22). Ela não pode ser um passo de automação: tem que ser uma
propriedade da automação que o motor aplica sozinho. Ver §C3.

## A6. §8 `/andamento` → Em Andamento, Lead → Cliente — ⚠️

`add_tag` e `remove_tag` existem, e `add_tag` já **não duplica**
(`addContactTagIfAbsent`). Faltam o gatilho de mensagem enviada (§A1) e o
mover. A regra "Em Andamento significa que o cliente comprou" é a decisão 3.

## A7. §9 `/atendido` → Atendido — ❌

Igual ao §A1.

## A8. §10 Pós-venda D20 — ⚠️

`wait` de 20 dias existe. O template é `posvenda_d10` e diz outra coisa
("o material chegou certinho?"); o MD pede quatro perguntas — entrega, uso,
tudo certo, avaliação — no D20. Um template novo, `posvenda_d20`, ou o D10
reescrito. E falta o mover para Pós-venda depois do envio.

## A9. §11–§12 Recompra D60 e D120 — ⚠️

`recompra_60d` existe e o número de dias é variável (`{{2}}`): serve para 60
**e** para 120 sem template novo. O modelo muda (decisão 5): a migração 040 e
o `docs/playbook-comercial.md` contam de `last_purchase_at` + ciclo por
cliente; o MD conta da entrada em Atendido.

## A10. §13 Compra Futura — ⚠️

O que existe: o campo no contato, o diálogo com os atalhos 15/30/60 dias
(`future-purchase-dialog.tsx`), a data na agenda da Visão geral com
reagendamento, e o template `compra_futura`. O que falta: a **etapa**, a
espera **até a data de um campo**, o envio na data, e a volta para Em
Negociação na resposta. O diálogo diz isso em comentário: _"choosing the
template to send on the day, and promising that the funnel moves itself —
neither exists yet."_

## A11. §14 Venda Perdida — ✅ o gate, ⚠️ o nome e a lista, ❌ o cancelamento

O motivo já é **obrigatório** em todas as quatro superfícies que fecham uma
oportunidade (`useDealOutcome`), e grava a chave em `deals.lost_reason`
(migração 043), nunca o rótulo. Duas diferenças:

- O nome "Venda Perdida" não é reconhecido (§A0).
- O código tem **sete** motivos; o MD lista **oito**. O MD tira "Sem
  resposta" e põe "Sem necessidade no momento" e "Desistiu". Tirar "Sem
  resposta" é coerente com o MD: quem não responde vai para a Geladeira, não
  para Venda Perdida. Não precisa de migração — a 043 é `TEXT` sem `CHECK`
  de propósito — mas muda `LOSS_REASONS`, os ícones e o catálogo nos três
  idiomas.

"Cancelar automações comerciais pendentes" é a regra do §C3.

## A12. §15 Ligação / chamada de vídeo — 🔒

O registro de ligação existe e vira **nota interna** (`call-log-dialog.tsx`),
de propósito. Os três desfechos do §15 (continuar, Compra Futura, Venda
Perdida) são movimentos manuais que já existem. O único item novo é "criar
tarefa de ligação" — decisão 2.

## A13. §16 Aniversário — ⚠️

Coluna `birthday`, índice parcial e template `aniversario_cliente` existem
desde a 040, que diz em comentário: _"the birthday automation compares month
and day only"_. **A varredura nunca foi escrita.** "Registrar o envio no
histórico" é o log de execuções, que já existe.

## A14. §17–§19 As jornadas resumidas

Não têm item próprio: são o §1 ao §12 encadeados. A Parte E monta cada uma.

## A15. §20 Gatilhos necessários

| Gatilho pedido                        | Estado | Hoje                                                                                                                                                              |
| ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mensagem enviada pela equipe          | ❌     | Nada dispara no envio; o atalho usado não é gravado (§A1)                                                                                                         |
| Mensagem recebida / cliente respondeu | ✅     | `new_message_received`, disparado pelo webhook em `webhook/route.ts`. Não sabe se há sequência ativa para aquela oportunidade — isso é o §C3                      |
| Etapa alterada / entrou na etapa      | ❌     | Quatro escritas client-side, nenhum evento, webhook (`lib/webhooks/events.ts` só tem `message.*` e `conversation.created`), auditoria ou endpoint                 |
| Tempo na etapa                        | ❌     | Sem `stage_entered_at`, sem histórico                                                                                                                             |
| Data de campo                         | ❌     | As colunas existem (040); a varredura não. `time_based` está no construtor com rótulo "Por horário" e **nada o dispara** — uma automação salva com ele nunca roda |
| Tarefa concluída                      | ❌     | Não existe entidade tarefa. Decisão 2                                                                                                                             |

## A16. §21 Ações necessárias

| Ação pedida                 | Estado | Hoje                                                                                                                                                                      |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enviar mensagem             | ✅     | `send_message`                                                                                                                                                            |
| Enviar template             | ✅     | `send_template`, com variáveis posicionais                                                                                                                                |
| Esperar                     | ✅     | `wait` em minutos, horas ou dias. Falta **esperar até a data de um campo** (§A10)                                                                                         |
| Condição se/senão           | ⚠️     | `condition` com quatro assuntos: etiqueta, campo do contato, texto da mensagem, horário. Faltam "cliente respondeu desde X?", "está na etapa X?" e "oportunidade aberta?" |
| Mover oportunidade de etapa | ❌     |                                                                                                                                                                           |
| Criar tarefa                | ❌     | Decisão 2                                                                                                                                                                 |
| Atualizar oportunidade      | ❌     | Só `create_deal`                                                                                                                                                          |
| Adicionar etiqueta          | ✅     | Idempotente                                                                                                                                                               |
| Remover etiqueta            | ✅     |                                                                                                                                                                           |
| Encerrar automação          | ❌     | Implícito no fim da lista; não existe como passo, e um ramo de condição não consegue "parar aqui"                                                                         |
| Cancelar outra automação    | ❌     |                                                                                                                                                                           |
| Iniciar outra automação     | ⚠️     | Só encadeando por etiqueta (`tag_added`), com limite de profundidade                                                                                                      |

## A17. §22 Regras de cancelamento — ❌

Ver §C3. As seis situações do §22 viram **uma lista de etapas** por
automação: "cancele-me quando a oportunidade entrar em qualquer uma destas".

## A18. §23 Controle de duplicidade — ❌

Uma automação dispara a cada evento, sem política nenhuma. O único freio é o
limite de profundidade das cadeias de etiqueta. **Os Fluxos já têm o
modelo**: um run ativo por contato, garantido por índice único no banco
(`010_flows.sql`, `idx_one_active_run_per_contact`), e um `end_reason`. É
isso, por oportunidade, que o §23 pede.

## A19. §24 Histórico da automação — ⚠️

`automation_logs` guarda contato, automação, gatilho, data/hora, e cada
passo com o que fez — mensagem enviada e seu id na Meta, espera e sua
duração, condição e o ramo tomado, erro. **Não guarda** oportunidade,
mudança de etapa, tarefa, cancelamento nem motivo de encerramento. Cinco
dos treze itens do §24.

## A20. §25 A regra oficial

É a Parte E, linha por linha.

---

# PARTE B — O motor hoje

Inventário curto do que a Parte D constrói em cima. Referências para quem
for mexer.

**Entrada única.** `runAutomationsForTrigger` em `src/lib/automations/engine.ts`
recebe `{ accountId, triggerType, contactId, context }`. O contexto carrega
texto da mensagem, conversa, etiqueta, botão tocado, variáveis de webhook.
**Não carrega oportunidade.**

**Quem chama.** O webhook de entrada (cinco gatilhos, em ordem:
`first_inbound_message`, `new_contact_created`, `new_message_received`,
`keyword_match`, `interactive_reply`), a escrita de etiqueta
(`addContactTagAndDispatch` em `src/lib/contacts/tag-events.ts` — o
precedente de "escreve e dispara" que a Parte D copia), o hook externo
(`/api/hooks/[token]`) e a rota manual `/api/automations/engine`.

**Quem espera.** Um passo `wait` grava uma linha em
`automation_pending_executions` e para. `GET /api/automations/cron` drena as
vencidas, cinquenta por chamada, com claim por `status='running'`. O
agendador é externo (`docs/deploy.md`, `AUTOMATION_CRON_SECRET`, cabeçalho
`x-cron-secret`; 503 sem o segredo).

**Quem mostra.** A agenda da Visão geral já lista as esperas pendentes
(`/api/agenda/scheduled`), os aniversários e as datas de próxima compra. Os
logs por automação em `/automations/[id]/logs`.

**Gatilhos mortos.** `time_based` e `conversation_assigned` estão no menu do
construtor (`automation-builder.tsx`, `TRIGGER_OPTIONS`) e nenhum código os
dispara. `webhook_received` funciona e **não** está no menu.

**Etiquetas por fora.** A importação por CSV grava `contact_tags` direto e
não dispara `tag_added`.

**Os Fluxos** são outro motor, com dez nós, sem espera, sem template, sem
oportunidade. O MD não precisa deles e este spec não os toca.

---

# PARTE C — Princípios de modelagem

O MD cabe no motor atual com **cinco acréscimos**, se forem os certos. Estes
princípios são o que evita reescrever o motor.

## C1. A oportunidade entra no contexto

Toda execução resolve **uma** oportunidade e a carrega até o fim
(`context.deal_id`, gravado na fila e no log):

- se o gatilho é de etapa, é a oportunidade do evento;
- se o gatilho é de contato (mensagem recebida, etiqueta, mensagem enviada),
  é a oportunidade **aberta mais recente** do contato no funil que a
  automação declara (`automations.pipeline_id`). Sem funil declarado, em
  qualquer funil.

Os passos e condições de oportunidade falham com mensagem clara quando não
há uma — como `send_message` já faz sem contato.

## C2. Esperar, não varrer

Tudo que é "D+N depois de entrar na etapa X" é **entrar na etapa + `wait`**.
A fila já existe, o cron já a drena, a agenda já a mostra. Assim, Em Aberto
24 h, a sequência de Follow-up, Geladeira 30D, pós-venda D20 e recompra
D60/D120 **não precisam de varredura nenhuma**.

Compra Futura usa uma variante de `wait`: **esperar até a data de um campo
do contato**. Ao acordar, o passo relê o campo: se a data andou, volta a
dormir; se foi limpa, encerra com motivo. Isso torna a espera imune ao
reagendamento pela agenda.

Sobra **uma** varredura de verdade: aniversário, que se repete e não tem
entrada em etapa. É o gatilho **Data de campo**, avaliado uma vez por dia
pelo mesmo cron.

## C3. Cancelar por regra, não por passo

Duas propriedades na automação, aplicadas pelo motor sem passo nenhum:

| Propriedade              | Quando o motor cancela as esperas pendentes desta automação  | Quem aplica                                                     |
| ------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `cancel_on_reply`        | O contato da execução mandou uma mensagem                    | O webhook de entrada, **antes** de disparar qualquer gatilho    |
| `cancel_when_stage_in[]` | A oportunidade da execução entrou em uma das etapas listadas | O drenador de eventos de etapa, **antes** de disparar o gatilho |

É exatamente o §22: a sequência de Follow-up lista Em Negociação, Em
Andamento, Atendido, Venda Perdida e Compra Futura. O passo explícito
**Cancelar automações** fica para o que a regra não cobre (ex.: uma nova
compra cancela a recompra da compra anterior).

Cancelar é `status = 'cancelled'` na fila e `end_reason` no log — nunca
apagar a linha. A agenda deixa de mostrar sozinha (ela filtra `pending`).

## C4. O evento de etapa nasce no banco

Há quatro escritas client-side de `stage_id` e nenhuma passa por servidor.
Refatorar as quatro para uma rota é possível, mas deixa aberta a quinta que
alguém escrever amanhã. Em vez disso:

- um **gatilho no Postgres** em `deals` grava `stage_entered_at` e insere uma
  linha em `deal_stage_events` a cada mudança de etapa e a cada criação —
  venha de onde vier, inclusive do próprio motor;
- o cron **drena** os eventos não despachados (padrão outbox): aplica o
  cancelamento (§C3) e dispara `deal_stage_entered`.

Custo: a latência de um tique do cron (decisão 8). Para um funil cujo menor
prazo é 24 horas, um minuto é nada; para o `/andamento → etiqueta Cliente`,
um minuto é aceitável e fica registrado como limitação. Uma rota
`POST /api/deals/[id]/stage` que grava **e** drena na hora pode entrar depois
para as telas, sem mudar o desenho.

Laço: uma automação de "entrou em Follow-up" que move para Geladeira 30D
dispara "entrou em Geladeira 30D" — é o encadeamento desejado. O freio é o
mesmo das etiquetas: profundidade em `vars._chain_depth`, limite 5.

## C5. Uma execução por (automação, oportunidade)

Regra dura do §23, sem configuração: nunca duas execuções **simultâneas** da
mesma automação para a mesma oportunidade. E a política de **reentrada**
(`reentry_policy`): `always` (o comportamento atual, padrão para não mudar
as automações que existem), `never`, `after_complete`, `after_days` +
`reentry_days`. Quando bloqueia, grava um log com status `skipped` e
`end_reason = 'reentry_blocked'` — a duplicidade evitada fica visível, não
some.

## C6. Fora da janela de 24 h só sai template

O construtor passa a **avisar** ao ativar: um `send_message` depois de um
`wait` de 24 horas ou mais vai falhar na Meta. É validação em
`src/lib/automations/validate.ts`, ao lado das que já existem.

---

# PARTE D — Plano de implementação

Nove fases. Cada uma fecha com suíte verde e é utilizável sozinha; a ordem
respeita as dependências. Tamanho: **P** cabe numa sessão, **M** em duas ou
três, **G** é uma passada.

| Fase | O quê                                 | Tamanho | Depende de |
| ---- | ------------------------------------- | ------- | ---------- |
| 0    | Decisões da Parte 0                   | —       | —          |
| 1    | Migração 065 e tipos                  | P       | 0          |
| 2    | Evento de etapa no motor              | M       | 1          |
| 3    | Oportunidade no motor e passos novos  | G       | 2          |
| 4    | Mensagem enviada pela equipe          | M       | 1          |
| 5    | Cancelamento e reentrada              | M       | 2, 3       |
| 6    | Data de campo (aniversário)           | P       | 1          |
| 7    | Histórico e telas                     | M       | 3, 5       |
| 8    | Dados, conteúdo e modelos instaláveis | M       | 3, 4, 5, 6 |
| 9    | Verificação ponta a ponta             | M       | tudo       |

As fases 4 e 6 não dependem de 2, 3 e 5 e podem correr em paralelo.

## Fase 1 — Migração 065 e tipos (P)

Uma migração, idempotente, seguindo o padrão das anteriores. Rascunho para
virar `supabase/migrations/065_deal_stage_events_and_automation_scope.sql`:

```sql
-- 1. Onde a oportunidade está e desde quando
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ;
UPDATE deals SET stage_entered_at = COALESCE(updated_at, created_at, NOW())
 WHERE stage_entered_at IS NULL;
ALTER TABLE deals ALTER COLUMN stage_entered_at SET DEFAULT NOW();

-- 2. O histórico de movimentação, que também é a caixa de saída do motor
CREATE TABLE IF NOT EXISTS deal_stage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id   UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  changed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL = motor/serviço
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ                                        -- NULL = o cron ainda não viu
);
CREATE INDEX IF NOT EXISTS idx_deal_stage_events_undispatched
  ON deal_stage_events(changed_at) WHERE dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal
  ON deal_stage_events(deal_id, changed_at DESC);
ALTER TABLE deal_stage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_stage_events_select ON deal_stage_events;
CREATE POLICY deal_stage_events_select ON deal_stage_events FOR SELECT
  USING (is_account_member(account_id));
-- Sem INSERT/UPDATE/DELETE para authenticated: só o gatilho abaixo escreve,
-- e só o service role marca dispatched_at.

CREATE OR REPLACE FUNCTION deals_touch_stage_entered_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := NOW();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_deals_stage_entered_at ON deals;
CREATE TRIGGER trg_deals_stage_entered_at
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_touch_stage_entered_at();

CREATE OR REPLACE FUNCTION deals_record_stage_event() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NULL;
  END IF;
  INSERT INTO deal_stage_events (account_id, deal_id, from_stage_id, to_stage_id, changed_by)
  VALUES (NEW.account_id, NEW.id,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id END,
          NEW.stage_id, auth.uid());
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_deals_record_stage_event ON deals;
CREATE TRIGGER trg_deals_record_stage_event
  AFTER INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_record_stage_event();

-- 3. A fila de esperas conhece a oportunidade e sabe ser cancelada
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

-- 4. O log responde "qual oportunidade" e "por que acabou"
ALTER TABLE automation_logs
  ADD COLUMN IF NOT EXISTS deal_id     UUID REFERENCES deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS end_reason  TEXT,
  ADD COLUMN IF NOT EXISTS trigger_key TEXT;  -- idempotência das varreduras: contato:data
ALTER TABLE automation_logs DROP CONSTRAINT IF EXISTS automation_logs_status_check;
ALTER TABLE automation_logs ADD CONSTRAINT automation_logs_status_check
  CHECK (status IN ('success', 'partial', 'failed', 'cancelled', 'skipped'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_logs_trigger_key
  ON automation_logs(automation_id, trigger_key) WHERE trigger_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_logs_deal
  ON automation_logs(deal_id) WHERE deal_id IS NOT NULL;

-- 5. A automação declara seu funil, suas regras de cancelamento e de reentrada
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

-- 6. A mensagem lembra de qual resposta rápida veio
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS quick_reply_id UUID REFERENCES quick_replies(id) ON DELETE SET NULL;
```

Notas do rascunho:

- `deal_id` com `CASCADE` na fila e `SET NULL` no log: apagar a oportunidade
  leva suas esperas junto e preserva o histórico — o mesmo par que a 004 e a
  006 usam para contato.
- `auth.uid()` no gatilho dá o autor quando a escrita vem do navegador, e
  NULL quando vem do motor ou do service role. Não há tentativa de
  distinguir "automação X" no banco; isso está no log da própria automação.
- O gatilho de evento é `AFTER` porque um `BEFORE INSERT` não tem `deals.id`
  para a chave estrangeira ainda.
- Sem `tasks` — decisão 2. Se ela for "tarefa", é uma 066.

Junto: `src/types/index.ts` (novos campos em `Deal`, `Automation`,
`AutomationLog`, status novos), asserções em `supabase/ci/verify-schema.sql`
(a tabela, o gatilho `trg_deals_record_stage_event` e as duas colunas de
status novos), e a Novidades/`docs/deploy.md` só na fase 9.

## Fase 2 — Evento de etapa no motor (M)

**Gatilho novo** `deal_stage_entered`, config `{ pipeline_id, stage_id }`.
Contexto que ele carrega: `deal_id`, `stage_id`, `from_stage_id`,
`stage_event_id`, `vars._chain_depth`.

**Drenador** no cron, `drainStageEvents()`, chamado **antes** de retomar as
esperas — para que um cancelamento (fase 5) valha antes de uma espera vencida
acordar. Cem eventos por chamada; o claim é `UPDATE ... SET dispatched_at = NOW()
WHERE id = ? AND dispatched_at IS NULL`, como o cron já faz com `running`.
Para cada evento: carrega a oportunidade (contato, funil), dispara com
`contactId = deal.contact_id`.

**Casamento** em `triggerMatches`: `stage_id` igual. `pipeline_id` é
redundância para o construtor filtrar as etapas.

Arquivos: `engine.ts`, `trigger-meta.ts` (`KNOWN_TRIGGERS` falha o build até
listar), `validate.ts`, `automation-builder.tsx` (`TRIGGER_OPTIONS` e um
seletor funil → etapa; o construtor já carrega funis e etapas para
`create_deal`), `messages/{pt-BR,en,ko}.json` em `Automations.builder.triggers`,
`cron/route.ts`.

Testes: `engine.test.ts` (casamento por etapa, profundidade da cadeia),
teste do drenador (claim, ordem, evento sem oportunidade), `validate.test.ts`,
`src/i18n/messages.test.ts` já cobra a paridade das chaves.

## Fase 3 — Oportunidade no motor e passos novos (G)

**Resolução** (`resolveDealId`, §C1), com cache no contexto e gravação de
`deal_id` na fila e no log.

**Passos novos:**

| Passo                | Config                                                                     | Faz                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `move_deal_stage`    | `{ stage_id, lost_reason? }`                                               | Grava `deals.stage_id` (o gatilho da 065 registra o evento). Se a etapa é ganha, `status = 'won'`; se é perdida, `status = 'lost'` e exige `lost_reason` — o motor respeita os mesmos gates que a tela |
| `update_deal`        | `{ field: 'title' \| 'value' \| 'expected_close_date' \| 'notes', value }` | `notes` acrescenta uma linha, não substitui. Interpola `{{vars.*}}`                                                                                                                                    |
| `cancel_automations` | `{ scope: 'deal' \| 'contact', automation_ids?: [] }`                      | Cancela as esperas pendentes das automações listadas (ou de todas) para a oportunidade ou o contato da execução, com motivo `cancelled_by:<automation>`                                                |
| `end`                | `{ reason? }`                                                              | Encerra a execução aqui, inclusive dentro de um ramo, e grava `end_reason`                                                                                                                             |

**Condições novas** (`ConditionSubject`):

| Assunto                  | Operando                         | Verdadeiro quando                                                                                                                           |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `deal_in_stage`          | lista de `stage_id`              | A oportunidade da execução está em uma delas                                                                                                |
| `deal_is_open`           | —                                | `status = 'open'`                                                                                                                           |
| `customer_replied_since` | `'stage_entry'` ou `'run_start'` | Existe `messages.sender_type = 'customer'` na conversa da oportunidade com `created_at` maior que `stage_entered_at` ou que o início do log |

**`wait` ganha um modo:** `{ mode: 'until_contact_date', field: 'next_purchase_expected_at', at: 'HH:mm', timezone }`.
Ao acordar: campo vazio → `end` com `end_reason = 'date_cleared'`; data no
futuro → nova linha na fila; senão, segue. O `at` é lido no fuso do passo
(padrão `America/Sao_Paulo`), pelo motivo dado na fase 6.

`stepNeedsMessagesScope` (`src/lib/hooks/inbound.ts`) não muda: nenhum passo
novo manda mensagem. A validação ganha as regras dos passos novos e o aviso
do §C6.

Arquivos: `engine.ts`, `validate.ts`, `types/index.ts`, `automation-builder.tsx`
(`ADDABLE_STEPS`, `blankConfig`, formulários; o seletor de etapa da fase 2 é
reaproveitado), catálogo em `Automations.builder.steps` e `kinds`,
`automations/[id]/logs/page.tsx` (renderizar os passos novos).

Testes: um por passo e por condição em `engine.test.ts`; `validate.test.ts`;
o modo de espera com data movida, limpa e vencida.

## Fase 4 — Mensagem enviada pela equipe (M)

**Gatilho novo** `team_message_sent`, config `{ quick_reply_id?, template_name? }`
— pelo menos um. Casa quando a mensagem enviada por um atendente carrega
aquela resposta rápida ou aquele template.

Caminho da informação, de ponta a ponta:

1. `message-composer.tsx`: ao escolher uma resposta rápida
   (`applyQuickReply` → `handlePickQuickReply`), guardar `quickReplyId` no
   estado; limpar ao esvaziar o campo; mandar no corpo de `POST /api/whatsapp/send`.
2. `send/route.ts`: aceitar `quick_reply_id`, validar que pertence à conta,
   passar a `sendMessageToConversation`.
3. `send-message.ts`: gravar `messages.quick_reply_id`; **depois** do insert,
   e **só** quando `sender_type = 'agent'` (o próprio arquivo já distingue
   envio humano de envio do motor, dos Fluxos e do assistente), disparar
   `team_message_sent` com `{ message_id, conversation_id, quick_reply_id,
shortcut, template_name }`. Fire-and-forget, como o webhook.

Templates enviados pelo seletor do compositor já chegam com `template_name`
— entram de graça.

Arquivos: os três acima, `engine.ts` (casamento), `types`, `trigger-meta.ts`,
`validate.ts`, construtor (seletor de resposta rápida; `GET /api/quick-replies`
já existe), catálogo.

Testes: `send-message.test.ts` (grava o id; dispara só para agente),
`engine.test.ts` (casamento por id e por template).

## Fase 5 — Cancelamento e reentrada (M)

Dois pontos de aplicação (§C3):

- `cancelPendingOnReply({ accountId, contactId })` em
  `src/lib/automations/cancel.ts`, chamado no webhook de entrada logo depois
  de resolver o contato e **antes** dos disparos. Cancela as `pending` do
  contato cujas automações têm `cancel_on_reply`, com
  `cancelled_reason = 'customer_replied'`, e fecha o log correspondente com
  `status = 'cancelled'`, `end_reason = 'customer_replied'`.
- `cancelPendingOnStageEnter({ dealId, stageId })`, chamado pelo drenador da
  fase 2 antes de disparar o evento. Mesma mecânica, motivo
  `stage_entered:<stage_id>`.

**Reentrada** em `executeAutomation`, antes de criar o log: regra dura por
(automação, oportunidade) e política (§C5). Bloqueado → log `skipped`.

Construtor: dois controles novos no cabeçalho da automação — "Cancelar
quando o cliente responder" e "Cancelar quando a oportunidade entrar em…"
(multi-seleção de etapas) — e a política de reentrada. As rotas
`POST /api/automations` e `PATCH /api/automations/[id]` passam a aceitar e
validar os campos.

Testes: cancelamento por resposta com duas automações (uma com a flag, uma
sem), cancelamento por etapa, log fechado com motivo, cada política de
reentrada, e o caso "espera vencida **e** cancelada no mesmo tique" — a
ordem do cron garante que o cancelamento vence.

## Fase 6 — Data de campo (P)

**Gatilho novo** `date_field_reached`, config `{ field: 'birthday', at: 'HH:mm', timezone }`
(`field` aceita também `next_purchase_expected_at`, embora Compra Futura use
a espera da fase 3). Varredura no cron, uma vez por dia por conta. **O dia é
o do fuso configurado, nunca o do servidor**: o cron roda num processo que
pode estar em UTC, e "hoje" em UTC vira "amanhã" às 21h de Brasília. Não há
fuso por conta no esquema; o gatilho carrega o seu, com padrão
`America/Sao_Paulo`, e a mesma regra vale para o `at` do `wait` até data da
fase 3. Para aniversário compara mês e dia. Idempotência por
`trigger_key = '<contact_id>:<YYYY-MM-DD>'` no log, com o índice único da
065 — rodar duas vezes no mesmo dia não manda duas mensagens. Contatos com
`opted_out` são pulados antes de disparar; `loadSendableContact` recusaria
o envio de qualquer forma.

`time_based` sai de `TRIGGER_OPTIONS` (fica no tipo, para linhas antigas
não quebrarem); `conversation_assigned` idem, até ter um produtor.

Testes: aniversário hoje, ontem e ano bissexto; segunda passada no mesmo
dia; `opted_out`.

## Fase 7 — Histórico e telas (M)

O mínimo para o §24 e para operar:

- `automations/[id]/logs/page.tsx`: oportunidade (link para o quadro),
  `end_reason`, os status `cancelled` e `skipped`, os passos novos.
- Lista de automações: os dois cancelamentos e a reentrada visíveis na
  linha, para bater o olho e saber o que uma automação faz sozinha.
- Ficha da oportunidade (`deal-form.tsx` ou a sheet do quadro): "automação
  ativa: X — próximo passo em <data>", lido de uma rota como
  `/api/agenda/scheduled` filtrada por `deal_id`. É o §64 da especificação
  antiga, e o que faz alguém confiar que a máquina está com aquela
  oportunidade.
- Relatórios e Visão geral: onde contam execuções por status, somar
  `cancelled` e `skipped`.

## Fase 8 — Dados, conteúdo e modelos instaláveis (M)

Só depois do motor, porque tudo aqui referencia etapas e passos que ainda
não existem.

- `src/lib/deals/outcome.ts`: `LOST_STAGE_NAMES` ganha `venda perdida`;
  `WON_STAGE_NAMES` ganha `em andamento` (decisão 3). `LOSS_REASONS`: entram
  `noNeedNow` e `gaveUp`, sai `noReply`; ícones em `deal-outcome.tsx`;
  catálogo em `Pipelines.outcome.reasons` nos três idiomas; o relatório de
  perdas agrupa pela chave e não precisa mudar.
- `src/lib/whatsapp/plastfortsul-templates.ts`: `followup_d15` → `followup_d10`
  (decisão 1); `posvenda_d10` → `posvenda_d20` com as quatro perguntas do
  §10; `recompra_60d` serve a 60 e a 120; `reativacao_60d` fica, sem uso.
  Nenhum dos doze foi submetido à Meta ainda — renomear agora é grátis;
  depois da aprovação é um template novo. O teste do arquivo acompanha.
- Etapas: as doze do MD, na ordem da decisão 4, com as cores do seed. O
  seed vive em `_removido-do-repo` e o `package.json` ainda aponta
  `seed:crm` para um arquivo que não está no repositório. Ou o seed volta
  com os nomes novos, ou as etapas são criadas em Configurações › Pipelines
  — são doze linhas.
- `docs/playbook-comercial.md`: cadência `d1 → d3 → d10 → d30`, pós-venda
  D20, "Em Andamento = ganha", Compra Futura e Ligação como etapas.
- **Modelos instaláveis.** As dez automações da Parte E entram em
  `src/lib/automations/templates.ts` como `AutomationTemplateDefinition`,
  com nome, descrição e textos em `Automations.templates.*` — o mecanismo
  que já existe para os quatro modelos atuais. Etapas, etiquetas e
  templates são referenciados **por nome** e resolvidos por conta na
  instalação; o que não resolver deixa a automação instalada **inativa**
  com a dica "configure a etapa X". É o substituto do seed de automações
  apagado, e é o que um segundo cliente da Creative Lane usaria.

## Fase 9 — Verificação ponta a ponta (M)

Ver Parte F. Fecha com `docs/deploy.md` (cron a cada minuto),
`docs/configuracao-env.md`, a Novidades da versão, e a atualização deste
arquivo com as marcas viradas.

## O que ficou de fora desta entrega (2 de setembro de 2026)

O que o código entregou difere do plano em quatro pontos, todos
deliberados:

- **Aplicar a 065 e as doze etapas.** A migração está escrita; quem aplica
  é o Gabriel, pelo Cursor. As etapas com os nomes do MD são criadas em
  Configurações › Pipelines (o seed continua fora do repositório); os
  modelos instaláveis resolvem os nomes na hora — e aceitam os nomes
  antigos do seed (`Geladeira 30 dias`, `Perdido`) como apelidos.
- **Ficha da oportunidade com "automação ativa"** (fase 7) — não feita. O
  histórico por automação mostra oportunidade e motivo de encerramento; a
  agenda continua mostrando as esperas. A ficha vem noutra passada.
- **Rota síncrona de mover etapa** — não feita, como previsto na Parte G. A
  latência é a do cron, que precisa rodar a cada minuto.
- **Ponta a ponta com a Meta** (Parte F) — não rodado: depende da 065
  aplicada e do número de teste. O que foi verificado: `tsc`, `eslint`,
  a suíte inteira (as 1.508 anteriores mais as novas) e `next build`.

Três detalhes de implementação que a Parte C não dizia:

- Os modelos do funil interpolam `{{contact.first_name}}` e
  `{{deal.title}}` nas variáveis dos templates — o motor passou a
  resolver essas duas famílias além de `{{vars.*}}` e `{{message.text}}`.
- Uma espera dentro de um ramo de condição continua NÃO parando os passos
  que vêm depois da condição — era assim antes e há automações montadas
  nessa forma. `Encerrar` dentro de um ramo, esse sim, para tudo.
- Ao entrar numa etapa ganha sem valor na oportunidade, o motor move mas
  deixa `status = open` e escreve isso no log, em vez de registrar uma
  venda de zero.

---

# PARTE E — As automações do MD, montadas

Como cada seção do MD fica no construtor depois da Parte D. Nomes de etapa
e template resolvidos por conta na instalação (fase 8). Todas declaram
`pipeline_id = Vendas`.

| #   | Automação                     | Gatilho                                        | Passos                                                                                                                                                         | Cancela quando                                                                            | Reentrada                                         |
| --- | ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | `/aberto` (§1)                | Mensagem enviada · resposta rápida `aberto`    | Mover → **Em Aberto**                                                                                                                                          | —                                                                                         | `always`                                          |
| 2   | Em Aberto 24 h (§2)           | Entrou em **Em Aberto**                        | Esperar 24 h → Se "cliente respondeu desde a entrada" → sim: Encerrar · não: Mover → **Follow-up**                                                             | Responder · entrar em Em Negociação, Em Andamento, Atendido, Venda Perdida, Compra Futura | `after_complete`                                  |
| 3   | Sequência de Follow-up (§3–4) | Entrou em **Follow-up**                        | Template `followup_d1` → Esperar 2 d → `followup_d3` → Esperar 7 d → `followup_d10` → Esperar 20 d → `followup_d30` → Esperar 24 h → Mover → **Geladeira 30D** | Responder · as cinco etapas do §22                                                        | `after_complete`                                  |
| 4   | Cliente respondeu (§7, §13)   | Mensagem recebida                              | Se "oportunidade em Follow-up, Geladeira 30D, Geladeira 60D ou Compra Futura" → sim: Mover → **Em Negociação** · não: Encerrar                                 | — (as esperas já foram canceladas pela regra antes deste disparo)                         | `always`                                          |
| 5   | Geladeira 30D (§5)            | Entrou em **Geladeira 30D**                    | Esperar 30 d → Mover → **Geladeira 60D**                                                                                                                       | Responder · Em Negociação, Em Andamento, Atendido, Venda Perdida, Compra Futura           | `after_complete`                                  |
| 6   | `/andamento` (§8)             | Mensagem enviada · resposta rápida `andamento` | Mover → **Em Andamento** → Remover etiqueta **Lead** → Adicionar etiqueta **Cliente** → Cancelar automações (escopo contato: #8, para a compra anterior)       | —                                                                                         | `always`                                          |
| 7   | `/atendido` (§9)              | Mensagem enviada · resposta rápida `atendido`  | Mover → **Atendido**                                                                                                                                           | —                                                                                         | `always`                                          |
| 8   | Pós-venda e recompra (§10–12) | Entrou em **Atendido**                         | Esperar 20 d → Template `posvenda_d20` → Mover → **Pós-venda** → Esperar 40 d → `recompra_60d` [60] → Esperar 60 d → `recompra_60d` [120] → Encerrar           | Entrar em Venda Perdida (o cancelamento por nova compra é o passo da #6)                  | `after_complete`                                  |
| 9   | Compra Futura (§13)           | Entrou em **Compra Futura**                    | Esperar até `next_purchase_expected_at` às 09:00 → Template `compra_futura` → Encerrar (a resposta é a #4)                                                     | Responder (decisão 6) · Em Negociação, Em Andamento, Venda Perdida                        | `after_complete`                                  |
| 10  | Aniversário (§16)             | Data de campo · `birthday` às 09:00            | Template `aniversario_cliente`                                                                                                                                 | —                                                                                         | `always` (a chave contato:data já impede o dobro) |

Sobre a #4: o mover para Em Negociação é uma automação, não código fixo, de
propósito — as etapas que contam são as da conta e vão mudar. A mensagem do
cliente na #2 não precisa de passo: a regra `cancel_on_reply` cancela a
espera antes, e a #4 move.

Sobre a #8: **não** lista Em Andamento em "cancela quando", porque ela mesma
não passa por ali; quem cancela a recompra da compra anterior é a #6, ao
registrar a compra nova. Um `Cancelar automações` com escopo de contato e
a #8 na lista.

Venda Perdida (§14) e Ligação (§15) **não têm automação**: o gate de motivo
já existe e o cancelamento é a coluna "cancela quando" das outras. Geladeira
60D (§6) também não: é só o destino da #5.

---

# PARTE F — Verificação

**Por fase:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
A migração roda no `migrations.yml` do zero e o `verify-schema.sql` assere o
que a 065 criou. `messages.test.ts` cobra a paridade dos catálogos.

**Ponta a ponta, com o número de teste da Meta**, esperas em minutos na
conta de teste (o banco de `.env.local` pode ser resetado à vontade):

| #   | Cenário                                                     | Esperado                                                                                                           |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Contato novo escreve; vendedor manda `/aberto`              | Oportunidade em Em Aberto; log da #1 com `deal_id`; evento em `deal_stage_events` com `changed_by` do vendedor     |
| 2   | 24 h (minutos) sem resposta                                 | Move para Follow-up; `followup_d1` sai como template; espera do d3 aparece na agenda                               |
| 3   | Cliente responde durante a sequência                        | Espera cancelada com `customer_replied`; oportunidade em Em Negociação; log da #3 `cancelled`                      |
| 4   | Sequência inteira sem resposta                              | D30 sai; 24 h depois Geladeira 30D; 30 d depois Geladeira 60D; nada mais é enviado                                 |
| 5   | Vendedor move à mão de Follow-up para Em Negociação         | Espera cancelada com `stage_entered:…`; nada sai                                                                   |
| 6   | `/andamento` em contato com etiqueta Lead                   | Em Andamento; pede valor; Lead sai, Cliente entra; segundo `/andamento` não duplica                                |
| 7   | `/atendido`                                                 | Atendido; D20 na agenda; no D20 template sai e oportunidade vai para Pós-venda; D60 e D120 saem com o número certo |
| 8   | Nova compra do mesmo contato antes do D120                  | A recompra da compra anterior é cancelada pela #6                                                                  |
| 9   | Compra Futura com data; data movida pela agenda; data limpa | Espera acompanha a data; limpar encerra com `date_cleared`                                                         |
| 10  | Mover para Venda Perdida                                    | Motivo obrigatório com os oito do MD; esperas da oportunidade canceladas                                           |
| 11  | Aniversário hoje; cron chamado duas vezes                   | Um envio, um log, `trigger_key` preenchido                                                                         |
| 12  | Contato com `opted_out`                                     | Nenhum template de marketing sai; o passo aparece no log como recusado                                             |
| 13  | Cron parado por uma hora e religado                         | Eventos e esperas acumulados são processados na ordem; nenhum é perdido nem duplicado                              |

---

# PARTE G — O que fica de fora

- **Entidade tarefa**, salvo decisão contrária (decisão 2).
- **`time_based` como agendador genérico** e **`conversation_assigned`**:
  saem do menu; ganham produtor noutra passada, se algum dia for preciso.
- **Fluxos**: não mudam.
- **Pipeline Operacional**: não muda.
- **Rota síncrona de mover etapa** (`POST /api/deals/[id]/stage`): opcional,
  depois da fase 2, para tirar o minuto de latência das telas.
- **n8n / integrações**: o MD não pede; `webhook_received` e `send_webhook`
  já existem para quem precisar.

## Achados laterais, fora do escopo do MD

Vistos durante a conferência. Nenhum é desta entrega.

- `POST /api/v1/deals` insere `status: 'active'`, que a migração 002 rejeita
  (`open`, `won`, `lost`). Toda criação de oportunidade pela API pública
  falha hoje.
- `package.json` aponta `seed:crm`, `seed:automations`, `seed:inbox` e
  `seed:notifications` para arquivos que não estão no repositório.
- `webhook_received` funciona e não tem entrada no construtor.
- A importação por CSV grava etiquetas sem disparar `tag_added`.

---

# Regras de implementação

1. Migração aplicada nunca é editada; a 065 é o próximo número livre —
   conferir `ls supabase/migrations/` antes de nomear.
2. Nenhuma linha da fila ou do log é apagada por cancelamento. Status e
   motivo, sempre.
3. O motor respeita os mesmos gates que a tela: mover para ganho sem valor
   ou para perdido sem motivo falha o passo com mensagem clara.
4. Nomes de etapa são dados da conta. Código compara por `id`; só
   `outcome.ts` compara por nome, e é uma lista curta e documentada.
5. Palavras que o cliente lê ficam no catálogo, não em código — os modelos
   instaláveis seguem `templates.ts` como está.
6. Fora da janela de 24 h só sai template, e o construtor avisa.
7. Antes de escrever um spec, conferir o que já existe. Este arquivo
   substitui as marcas do `PlastfortSul_CRM_Automacoes_Fluxo_Correto.md`
   e deve ser atualizado a cada fase fechada.
