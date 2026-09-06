# Ações de agente — o que a IA pode fazer

> **Escrito em 4 de setembro de 2026, contra o código da 0.9.0.** Levanta a
> plataforma **GPT Maker** como sistema de referência (documentação em
> `developer.gptmaker.ai`, OpenAPI de 74 endpoints em `api.gptmaker.ai`,
> conferida em 4 de setembro de 2026), audita um agente real rodando lá
> ("Nina", da Naldo Correntes), e define o que o wacrm constrói na próxima
> release. **Nada deste arquivo está implementado.**
>
> **Numeração.** A `068_tasks.sql` está escrita e não aplicada; a **069 é do
> Google** (`spec-tarefas-e-agendas.md`). Este plano ocupa a **070** em
> diante. Conferir `ls supabase/migrations/` antes de nomear qualquer
> arquivo — o outro plano já ficou desatualizado uma vez.

O diagnóstico em uma frase: **o motor de automações já sabe executar
dezessete ações, e a IA não pode acionar nenhuma delas.**

`AutomationStepType` (`src/types/index.ts:805`) move oportunidade de etapa,
escreve campo de contato, cria negócio, etiqueta, atribui conversa, dispara
webhook, encerra atendimento. `AI_TOOLS` (`src/lib/ai/tools.ts:297`) tem
quatro ferramentas e **todas as quatro são de leitura, por regra escrita**.
As duas metades do produto nunca se encontram: o motor age mas não entende,
o modelo entende mas não age. Entre elas há um `handoff` — a única coisa que
a IA sabe fazer além de falar é desistir.

Isso torna o trabalho **mais barato do que parece**. O caro num sistema de
ações é o executor: validar, aplicar, registrar, desfazer. Esse já existe e
está testado. O que falta é a tomada.

| Marca | Significa                                         |
| ----- | ------------------------------------------------- |
| ✅    | Já existe. Não reimplementar                      |
| ⚠️    | Existe parcialmente, ou existe de forma diferente |
| ❌    | Não existe. É trabalho de verdade                 |

---

## Parte A — O sistema de referência (GPT Maker)

### A.1 Forma geral

`https://api.gptmaker.ai`, `Bearer` no cabeçalho, chave em
`app.gptmaker.ai/browse/developers`. Hierarquia **workspace → agente →
(canais, treinamentos, intenções, MCP, regras)**. 74 endpoints, sem `tags`
no OpenAPI — a navegação é toda pela documentação, não pelo spec.

Ausentes do spec, e a ausência é informação: **não há rate limit
documentado, não há formato de erro padronizado, não há convenção de
paginação além de `page`/`pageSize` solto em alguns endpoints, e não há
versionamento além do `/v2` no caminho.**

### A.2 As cinco primitivas de ação

Tudo que um agente do GPT Maker sabe *fazer* — em oposição a *dizer* — cabe
em cinco primitivas. Vale listar cada uma pelo schema real, porque é o
schema que revela o desenho.

#### 1. Intenção `WEBHOOK` — a ferramenta HTTP declarativa

`POST /v2/agent/{agentId}/intentions`. É o núcleo do sistema.

| Campo | Tipo | Papel |
| --- | --- | --- |
| `description`\* | string | O que o modelo lê para decidir chamar |
| `instructions` | string | Quando usar (só quando `type=INSTRUCTIONS`) |
| `details` | string | Como interpretar a saída |
| `type`\* | `WEBHOOK` \| `INSTRUCTIONS` | Chama HTTP, ou só injeta instrução |
| `httpMethod`\* | `GET` \| `POST` | Sem `PUT`/`PATCH`/`DELETE` |
| `url`\* | string | Aceita variável interpolada com `@` |
| `fields[]` | name, jsonName, description, type, required | **O JSON Schema que o modelo preenche** |
| `headers[]` | name, value | Autenticação — em texto claro |
| `params[]` | name, value | Query string fixa |
| `requestBody` | string | JSON como **string**, não objeto |
| `variables[]` | valueExpression, defaultFieldKey, customField | **Escreve de volta no contato** |
| `autoGenerateParams`\* | boolean | Deixa o modelo montar a query |
| `autoGenerateBody`\* | boolean | Deixa o modelo montar o corpo |

`fields[].type` ∈ `STRING, URL, DATE_TIME, DATE, NUMBER, BOOLEAN`.

Três coisas aqui merecem atenção.

**`fields[]` é um JSON Schema disfarçado.** `name`/`jsonName`/`description`/
`type`/`required` é exatamente o que um `parameters` de tool call carrega —
só que numa forma tabular, editável por quem não escreve JSON. O `jsonName`
separado do `name` existe porque o operador digita "CEP do cliente" e a API
espera `zipcode`. É uma boa ideia de produto.

**`variables[]` é a única ação de escrita nativa, e ela é oblíqua.**
`valueExpression` extrai algo da resposta e grava em `defaultFieldKey` —
`chat_id, contact_name, contact_phone, contact_email, contact_gender,
contact_birthday, contact_job_title, contact_org_name, contact_org_state,
contact_org_city` — ou num campo customizado. Ou seja: **o agente escreve no
CRM como efeito colateral de uma chamada HTTP**, não como ação declarada. Um
operador que quer só "gravar o e-mail que o cliente falou" precisa inventar
um endpoint para chamar.

**`autoGenerateParams` / `autoGenerateBody` entregam a requisição ao
modelo.** Ligados, o modelo monta query string e corpo. É o que torna a
primitiva flexível e é, ao mesmo tempo, o maior risco do desenho: uma
alucinação vira um POST bem-formado contra um sistema de terceiros. Não há
confirmação, não há *dry run*, não há registro de auditoria da chamada no
spec.

#### 2. Intenção `INSTRUCTIONS` — regra condicional sem HTTP

Mesmo endpoint, `type=INSTRUCTIONS`. Não chama nada: injeta `instructions`
no contexto quando o modelo julga a intenção relevante. É **prompt
condicional** — o jeito certo de dizer "quando o cliente for pessoa física,
faça X" sem gastar o campo de comportamento. A Parte B mostra um agente que
não sabe disso.

#### 3. MCP — ferramentas externas dinâmicas

`POST /v2/agent/{agentId}/mcp/add` → `{name, description, mcpUrl, urlType:
SSE|STREAMABLEHTTP, authType: NO_OAUTH|OAUTH|HEADERS, headers}`. Devolve
`{connected, id, url}`; se OAuth, `POST /v2/mcp/connect` com `{code, state}`
fecha o fluxo.

Depois: `GET /v2/mcp/{mcpId}/tools` lista as ferramentas com `inputSchema`
real, e cada uma liga/desliga individualmente
(`/tool/{toolId}/active|inactive`), com `sync-tools` para re-sincronizar.
**É a parte mais bem desenhada do sistema**: catálogo dinâmico,
granularidade por ferramenta, re-sincronização explícita. É o modelo a
copiar.

#### 4. Ações de inatividade — a ação proativa

`POST /v2/agent/{agentId}/idle-actions`: `actions[]` de
`{instructions, seconds, allowAllHours, workingHours}` mais
`finishOn: {seconds}`. Escadinha de cutucadas: aos N segundos de silêncio o
agente diz algo, e ao fim encerra o atendimento. Respeita expediente.

É a única primitiva **disparada por tempo, não por turno de conversa** — e é
a que o wacrm mais sente falta, porque hoje o assistente só existe enquanto
alguém está digitando.

#### 5. Regras de transferência — para quem entrega

`POST /v2/agent/{agentId}/transfer-rules`:
`{instructions, returnOnFinish, type: HUMAN|AGENT, userId, agentId}`.

`type=AGENT` é **encaminhamento entre agentes** — um triador que passa para
um especialista. `returnOnFinish` devolve a conversa ao agente de origem
quando o destino termina. Isso é orquestração multiagente com uma superfície
de três campos.

### A.3 Webhooks de saída

`PUT /v2/agent/{agentId}/webhooks` — oito eventos, cada um uma URL:
`onNewMessage`, `onLackKnowLedge`, `onTransfer`, `onFirstInteraction`,
`onStartInteraction`, `onFinishInteraction`, `onCreateEvent`,
`onCancelEvent`.

`onLackKnowLedge` é o mais interessante e o wacrm não tem equivalente:
**dispara quando o agente não soube responder**. É um gerador de pauta de
treinamento vindo da operação real, não de adivinhação.

### A.4 O que as configurações revelam

`PUT /v2/agent/{agentId}/settings` carrega, além do modelo preferido (33
opções, de `GPT_5_6_SOL` a `SABIA_3`), quatro chaves que valem cópia:

- **`messageGroupingTime`** (`NO_GROUP` … `ONE_MINUTE`) — espera o cliente
  terminar de digitar antes de responder. Quem atende no WhatsApp manda
  quatro mensagens seguidas; sem agrupamento, o agente responde quatro
  vezes.
- **`maxDailyMessages` + `maxDailyMessagesLimitAction`** (`TEMP_BLOCK_30S` …
  `BLOCK`, `TRANSFER`) — teto de interações com ação ao estourar. O wacrm
  tem o teto (`autoReplyMaxPerConversation`), não tem a escolha do que
  fazer.
- **`knowledgeByFunction`** — transforma a base de treinamento em **uma
  ferramenta que o modelo chama**, em vez de recuperação empurrada no
  contexto. O wacrm já tem os dois lados (`retrievalTopK` e a tool
  `search_knowledge`), mas não como uma escolha declarada.
- **`enabledReminder`** — o agente pode registrar lembretes.

### A.5 Onde o desenho do GPT Maker é fraco

Para não copiar defeito junto:

- **Nenhuma confirmação humana.** Nada no spec permite "faça, mas pergunte
  antes". Toda intenção é executada direto.
- **Segredos em texto claro.** `headers[].value` vai e volta no JSON de
  listagem — `GET /intentions` devolve os cabeçalhos.
- **Sem proteção de destino declarada.** A URL da intenção é livre; nada no
  spec indica bloqueio de rede interna.
- **Sem auditoria de ação.** Há histórico de *comportamento*
  (`list-behavior-history`), não de *execução*.
- **`GET`/`POST` apenas.** Integrar com uma API REST que exige `PATCH`
  obriga a um proxy.
- **`requestBody` é string.** Empurra a montagem de JSON para o operador, ou
  para o modelo via `autoGenerateBody`.

---

## Parte B — Auditoria do agente "Nina" (Naldo Correntes)

Agente de vendas B2B em produção, GPT-5 Mini, canal WhatsApp conectado
(`+5511989372403`). O que as telas mostram:

| # | Achado | Evidência | Gravidade |
| --- | --- | --- | --- |
| 1 | **Zero intenções.** O agente não tem nenhuma ação. | Tela de Intenções no estado vazio ("Cadastrar primeira intenção") | Alta |
| 2 | **Zero integrações, zero MCP.** | ElevenLabs, Google Calendar, Plug Chat e E-vendi todos em "Ativar"; MCP vazio | Alta |
| 3 | **Comportamento a 2970/3000 caracteres — 99% do teto.** Não cabe mais nada. | Aba Perfil | Alta |
| 4 | **Treinamento duplicado, byte a byte.** A regra de varejo (`wa.me/5538999042070`) aparece duas vezes idênticas. | Treinamentos, itens 1 e 2 | Média |
| 5 | **A mesma proibição escrita três vezes:** "nunca agendar reunião ou passar horarios", "voce não marca reunião em nenhum momento", "A ia não marca reunião". | Treinamentos, itens 3–5 | Alta |
| 6 | **Regras de comportamento guardadas como treinamento.** | Os cinco itens visíveis são todos regra, nenhum é conhecimento | Alta |
| 7 | **"Resumo ao transferir" desligado**, com transferência ligada. | Configurações → Conversa | Média |
| 8 | **"Restringir temas permitidos" desligado**, num agente cujo comportamento se declara "exclusiva da equipe Naldo Correntes". | Configurações → Conversa | Média |
| 9 | **Site oficial vazio** — treinamento por website não foi usado. | Aba Trabalho | Baixa |
| 10 | **Canal órfão:** "Priscila WPP" → agente Bella, desconectado. | Tela de Canais | Baixa |

**O achado 5 é o diagnóstico do resto.** Ninguém escreve a mesma proibição
três vezes porque gosta: escreve porque a primeira não pegou, e a segunda
também não. E não pegou porque **treinamento é recuperação semântica** — o
trecho só entra no contexto se a pergunta do cliente se parecer com ele. Um
cliente que diz "podemos conversar quinta às 10h?" não puxa um chunk que
começa com "A ia não marca reunião". A regra some justo na hora em que era
para valer.

O lugar certo dessa regra é **comportamento** (sempre no contexto) ou uma
**intenção `INSTRUCTIONS`** (condicional, explícita). O comportamento está a
99% do teto, e as intenções estão vazias porque ninguém mostrou para que
servem. Os três achados são um só.

Vale o mesmo para a regra de varejo: "menos de 4 peças → manda o link" é
**roteamento**, e roteamento tem primitiva própria (regra de transferência).
Escrito como treinamento, depende de o modelo lembrar de colar uma URL — e é
por isso que foi cadastrado duas vezes.

**A lição que o wacrm tira daqui não é sobre o GPT Maker, é sobre produto:**
quando o operador repete a mesma regra três vezes, a interface deixou de
oferecer o lugar certo para ela. Se o wacrm expuser ações sem expor *onde
cada tipo de regra mora*, reproduz isto na primeira semana.

---

## Parte C — O que o wacrm tem hoje

| Capacidade | Estado | Onde |
| --- | --- | --- |
| Loop de tool calling nos dois provedores | ✅ | `src/lib/ai/providers/{openai,anthropic}.ts`, `MAX_TOOL_ROUNDS = 3` |
| Registro de ferramentas tipado | ✅ | `src/lib/ai/tools.ts:44` (`AiTool`) |
| Ligar/desligar ferramenta por conta | ✅ | `ai_configs.enabled_tools`, migração 053 |
| Ferramenta que falha sem derrubar a geração | ✅ | `runTool` — "NEVER THROWS" |
| Ferramentas de **escrita** | ❌ | Regra 1 de `tools.ts`: todas são de leitura |
| Ferramentas **definidas pela conta** (não em código) | ❌ | `AI_TOOLS` é array literal |
| Chamada HTTP a serviço externo pelo modelo | ❌ | — |
| Proteção SSRF para URL de terceiro | ✅ | `isDeliverableUrl`, `src/lib/webhooks/ssrf.ts:56` |
| Cripto de segredo em repouso (AES-256-GCM) | ✅ | `src/lib/whatsapp/encryption.ts:37` |
| Interpolação `{{contact.*}}` / `{{deal.*}}` / `{{vars.*}}` | ⚠️ | `interpolate`, `src/lib/automations/engine.ts:1616` — privada do motor |
| Trilha de auditoria | ⚠️ | `logAuditEvent` existe; `AUDIT_ACTIONS` não tem família de ação de IA |
| Repasse para humano | ⚠️ | Sentinela + nota (`handoff.ts`); um destino só (`handoffAgentId`), sem regra |
| Resumo no repasse | ✅ | `buildHandoffSummary` — determinístico, sem custo de token |
| Repasse **para outro agente** | ❌ | Não há segundo agente |
| Ação proativa por inatividade | ❌ | O assistente só existe dentro de um turno |
| Agrupamento de mensagens antes de responder | ❌ | — |
| Ação ao estourar o teto de respostas | ⚠️ | `autoReplyMaxPerConversation` para; não escolhe o que fazer |
| Webhook "não soube responder" | ❌ | Não existe equivalente a `onLackKnowLedge` |
| Eventos de saída | ⚠️ | Três apenas, `src/lib/webhooks/events.ts:10` |
| **Motor que executa 17 ações** | ✅ | `AutomationStepType`, `src/types/index.ts:805` |
| **…acionável pelo modelo** | ❌ | É a lacuna inteira |

---

## Parte D — O que construir

### Decisões que travam o desenho

**D1. As três regras de `tools.ts` continuam valendo, com uma emenda.** A
regra 1 ("toda ferramenta é de leitura") foi escrita prevendo este momento:
*"o registro é moldado para que uma ferramenta de escrita tivesse que ser
adicionada deliberadamente, e não chegar por acidente."* A emenda é essa
deliberação, e ela tem forma: **uma ferramenta de escrita é declarada com
`writes: true`, exige opt-in próprio, grava auditoria, e nunca é ligada por
padrão.** As regras 2 (escopo de conta + contato) e 3 (nada ligado por
padrão) ficam intactas.

**D2. Ação é passo de automação, não invenção nova.** O modelo não ganha um
executor próprio: ganha permissão de chamar `update_contact_field`,
`add_tag`, `move_deal_stage`, `create_deal`, `assign_conversation` — os
mesmos que o motor já valida e registra. Uma ação da IA vira uma execução
com origem `ai` no log de automações. **Um executor, dois chamadores.**

**D3. Confirmação humana é primeira classe, não opção.** É a lacuna A.5 do
GPT Maker e a diferença de postura do wacrm. Cada ação de escrita nasce em
um de três modos: `off`, `confirm` (a IA propõe, aparece na conversa como
sugestão, um atendente aplica), `auto`. **`confirm` é o padrão**, e para o
primeiro release pode ser o único modo de escrita disponível — não é
covardia, é o caminho para descobrir o que o modelo erra antes de deixá-lo
errar sozinho.

**D4. A sintaxe de variável é `{{contact.name}}`, não `@`.** O produto já
tem uma, documentada na `/developers` (`src/lib/api-docs/guides.ts:753`) e
nos modelos de automação. Um segundo dialeto é dívida no dia 1.
`interpolate` sai de `engine.ts` para `src/lib/template/interpolate.ts`.

**D5. Ferramenta HTTP definida pela conta vem depois, e reusa a defesa que
existe.** `isDeliverableUrl` já barra rede interna; `encrypt`/`decrypt` já
guardam segredo. Não escrever nada novo para isso.

**D6. Ordem de entrega é a de risco crescente**: instrução condicional (não
executa nada) → escrita interna com confirmação → proativo → transferência →
HTTP externo → MCP. Cada fase é entregável sozinha.

### Fase 1 — Regras condicionais (migração 070)

O equivalente à intenção `INSTRUCTIONS`, e a resposta direta ao achado 5.
Tabela `ai_rules`: `{account_id, when (texto), then (texto), active,
position}`. Compõem-se no prompt como bloco próprio, sempre presente, acima
do conhecimento recuperado.

Não executa nada, não chama nada, não pode errar de forma cara. É a fase mais
barata e resolve o problema mais comum: **quem hoje escreve regra dentro da
base de conhecimento passa a ter onde escrevê-la.** Sai junto o alívio no
campo de comportamento.

### Fase 2 — Ações internas com confirmação (migração 071)

`AiTool` ganha `writes?: true` e o registro ganha ferramentas que embrulham
passos do motor:

| Ferramenta | Passo | Argumentos |
| --- | --- | --- |
| `update_contact_field` | idem | `field`, `value` |
| `add_contact_tag` | `add_tag` | `tag` |
| `move_deal_stage` | idem | `stage` |
| `create_deal` | idem | `title`, `value` |
| `assign_conversation` | idem | — (fila) |

Continuam **sem id no argumento**: contato e conversa vêm do `ToolContext`
(regra 2). Uma chamada em modo `confirm` grava linha em `ai_pending_actions`
e devolve ao modelo a frase "anotado, aguardando confirmação" — o cliente vê
uma resposta coerente, e o atendente vê um cartão para aplicar ou descartar.

Sai junto: família `ai.action_*` em `AUDIT_ACTIONS`
(`src/lib/audit/events.ts:17`) e coluna de origem no log de automações.

### Fase 3 — Proativo e limites (migração 072)

- **Inatividade**: `ai_idle_actions` — escadinha `{seconds, instructions}` +
  `finish_after`, respeitando `business_hours` da 066. Roda no mesmo relógio
  das esperas de automação; não inventar agendador.
- **Agrupamento** (`messageGroupingTime` da A.4): janela de espera antes de
  gerar. É a melhoria de qualidade percebida mais barata do documento.
- **Ação ao estourar o teto**: `pausar | transferir | encerrar`, em vez do
  silêncio de hoje.
- **Falta de conhecimento**: quarto evento em `WEBHOOK_EVENTS` e uma fila de
  "perguntas sem resposta" na tela de conhecimento.

### Fase 4 — Regras de transferência (migração 073)

`ai_transfer_rules`: `{when, target_user_id | target_queue, instructions,
return_on_finish}`. Substitui o `handoffAgentId` único por roteamento — e
mata o padrão "cole este link do WhatsApp" do achado 4. Ligar
`buildHandoffSummary` por padrão: o achado 7 é um botão que ninguém achou, e
com regra de transferência o resumo deixa de ser opcional.

Sem `type=AGENT` por enquanto — o wacrm tem um agente por conta.

### Fase 5 — Ferramentas HTTP da conta (migração 074)

Só agora, e com as defesas nomeadas em D5.

`ai_http_tools`: `{name, description, method, url, headers (cripto),
fields (jsonb), body_template, write_back (jsonb), mode, active}`.

Diferenças deliberadas em relação ao GPT Maker:

- `PUT`/`PATCH`/`DELETE` permitidos, e `DELETE` sempre em modo `confirm`.
- `body_template` é **jsonb**, não string.
- `headers` cifrados em repouso e **mascarados na leitura** — a API nunca
  devolve o valor.
- `isDeliverableUrl` na criação **e** em cada execução (DNS muda).
- Timeout, e uma execução por rodada.
- Toda execução vira linha de auditoria com URL, status e duração — nunca o
  corpo.

`write_back` é o `variables[]` do GPT Maker, com a diferença de que escrever
no contato é uma ação de escrita como as outras: passa pelo modo, pela
auditoria, pela confirmação.

### Fase 6 — MCP (migração 075)

O catálogo dinâmico da A.2. É a última porque é a que mais depende das
anteriores: sem modos, sem auditoria e sem confirmação, conectar um servidor
MCP é entregar ao modelo um conjunto de ferramentas desconhecido em tempo de
execução. Com elas, é a extensão natural — e o desenho por-ferramenta do GPT
Maker (`active`/`inactive`/`sync`) é o que copiar.

---

## Parte E — Fora de escopo

- **Multiagente** (`type=AGENT`, `returnOnFinish`). Um agente por conta.
- **Voz** (ElevenLabs). Não há caso de uso pedido.
- **Marketplace de ações prontas.** Depois de existirem ações.
- **`autoGenerateBody`.** Deixar o modelo montar corpo livre contra API de
  terceiro é o risco da A.5 sem a contrapartida — os `fields` tipados cobrem
  o caso real.

---

## Anexo — Superfície do GPT Maker por grupo

74 endpoints, `https://api.gptmaker.ai`:

| Grupo | Qtd | Observação |
| --- | --- | --- |
| Agente (CRUD, ativar, créditos, conversa, contexto) | 14 | `conversation` aceita texto, imagem, áudio, vídeo, documento |
| Configurações e webhooks | 4 | 33 modelos de LLM |
| Treinamentos | 4 | `TEXT`, `WEBSITE` (com subpáginas e reindexação), `VIDEO`, `DOCUMENT` |
| Intenções | 4 | A primitiva principal |
| MCP | 7 | O melhor desenho do conjunto |
| Ações de inatividade | 4 | Único disparo por tempo |
| Regras de transferência | 4 | `HUMAN` \| `AGENT` |
| Campos customizados | 4 | `STRING, DATE, DATE_TIME, NUMBER, BOOLEAN, MONEY` |
| Chats e mensagens | 9 | Inclui `start-human` / `stop-human` |
| Contatos | 4 | |
| Atendimentos (interactions) | 3 | Mais exportação |
| Canais | 12 | WhatsApp (QR), widget, etc. |
| Workspace | 5 | |

**Cópia local do spec:**
`curl -sL https://developer.gptmaker.ai/api-reference/openapi.json`
(296 KB, OpenAPI 3.0.1). Índice legível por máquina em
`https://developer.gptmaker.ai/llms.txt`.
