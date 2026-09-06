# Plataformas de agente e de canal — o que a concorrência resolveu

> **Escrito em 4 de setembro de 2026.** Companheiro de
> `spec-acoes-de-agente.md`: aquele documento desenha o que construir, este
> diz contra o que. Treze plataformas em quatro famílias, pesquisadas em 4
> de setembro de 2026. As fontes estão no fim.
>
> Onde a pesquisa contradiz a spec, está marcado **↺ revisa a spec** — são
> três pontos, e um deles muda a Fase 5.

O achado em uma frase: **o wacrm já entrega ferramentas de escrita a uma
IA — só não à sua.**

O `mcp-server/` publica `send_message`, `create_contact`, `update_contact` e
`send_broadcast` para o Claude Desktop, atrás de `WACRM_ENABLE_WRITES` e dos
escopos da chave de API. O agente interno tem quatro ferramentas de leitura.
O modelo de permissão já existe, o executor já existe, e o precedente de "uma
IA escreve no CRM" já foi aberto, documentado e publicado no npm. A pergunta
deixou de ser *se pode* e passou a ser *por que a nossa não*.

---

## Parte 1 — As quatro famílias

### A. Plataformas de agente sobre canal

#### Chatwoot — a mais próxima da nossa arquitetura

E não é coincidência: a página `/developers` já é modelada na anatomia da
referência deles (`src/components/docs/endpoint-view.tsx:12`).

**Agent Bots** são um contrato de webhook, não um SDK. O bot recebe
`message_created` e `conversation_updated` por POST assinado
(`X-Chatwoot-Signature`), entregue de forma assíncrona por job, e responde
mandando mensagem de volta na conversa.

O que vale copiar é o **modelo de estado da conversa**:

| Estado | Quem é o dono |
| --- | --- |
| `pending` | O bot. Adia o envolvimento humano até ele terminar ou escalar |
| `open` | Humanos. O bot escalou, ou nunca houve bot |
| `resolved` | Ninguém. Pode ser fechada pelo próprio bot |

O handoff é um método (`bot_handoff!`) que carimba `waiting_since`, move para
`open` e dispara `CONVERSATION_BOT_HANDOFF`. **Três estados dizem coisas que
um booleano não diz** — o nosso `ai_autoreply_disabled` não sabe expressar "o
robô é o dono desta conversa agora", só "ele parou".

**Captain**, a IA deles, tem sete ações nativas: busca em FAQ, repasse para
humano, nota no contato, nota privada, prioridade, etiqueta e **resolver a
conversa**. Quatro ainda estão marcadas como "em breve". Além delas, até
**15 ferramentas customizadas** — endpoints HTTP, de leitura ou de escrita.

Duas coisas importam mais que a lista:

1. **Um Assistant é uma persona ligada a inboxes específicas.** A conta tem
   vários: um de suporte no widget do site, um de vendas no WhatsApp.
2. **Não há aprovação humana.** O Captain decide e executa. O human-in-the-loop
   existe só no Copilot, que é voltado ao atendente, não ao cliente.

#### Intercom Fin — o referencial comercial

Números da própria Intercom, vivos em agosto de 2026: taxa de resolução de
30% para 76% desde o lançamento, 71% em mais de 7.000 clientes. Vale ler com
desconto — relatos de campo ficam bem abaixo da média anunciada — mas a ordem
de grandeza é o alvo do mercado.

A parte interessante é o vocabulário: **Actions** (conectores que leem e
escrevem no backend), **Procedures** (ex-"Tasks": fluxos de várias etapas
escritos em linguagem natural, com uso de ferramenta) e **Guidance** (regras
de comportamento). Mais conectores MCP.

Repare que **Guidance é exatamente a `ai_rules` da Fase 1** e Procedures é o
que a Nina tentou escrever no campo de treinamento.

**O padrão da família:** o agente é uma persona ligada a canais específicos,
com contrato de handoff explícito e um estado que diz de quem é a conversa.

### B. Construtores visuais com ações

#### Botpress

O **Autonomous Node** é um ponto do fluxo onde o controle passa ao modelo,
com instruções, conhecimento e ferramentas, e ele decide o que fazer em vez
de seguir ramificações escritas à mão.

A divergência técnica é grande e vale saber que existe: **eles não usam
tool-calling.** A instrução em linguagem natural vira **TypeScript**, que é
executado. Mais expressivo, e uma superfície de risco de outra ordem —
não é o caminho para um CRM comercial, mas explica por que o Botpress
consegue coisas que um catálogo de ferramentas não alcança.

Tem ainda **Tables**: dados estruturados nativos, ou CSV/planilha importada,
consultáveis dentro da conversa. É o que o `search_products` faz hoje em
código.

#### Voiceflow

O **Agent step** decide quando usar ferramenta, quando consultar a base e
**quando passar a conversa para outro Agent step**. Ferramentas: APIs,
funções JavaScript, **servidores MCP** e integrações prontas (Salesforce,
HubSpot, Zendesk, Shopify, Twilio, Gmail, Sheets).

Escala para humano **passando a conversa inteira** — o que valida
`buildHandoffSummary` como padrão ligado, não como opção.

#### Typebot

Já é cidadão de primeira classe na nossa entrada (`/api/hooks/<token>`). Um
fluxo roda em vários canais. A distinção de blocos é boa e nós não temos:
**HTTP Request** chama agora, **Webhook** pausa e espera o callback.

Limites conhecidos no WhatsApp: três botões por mensagem, sem automação de
grupo, mídia limitada, blocos avançados pulados. Self-hosted não cobra por
mensagem.

### C. Orquestradores com ferramentas

#### Dify

Duas estratégias de agente, instaláveis do Marketplace: **Function Calling**
(mapeia comando a função, extrai parâmetros) e **ReAct** (alterna raciocínio
e ação, a saída da ferramenta alimenta o próximo passo). O nó de agente
configura modelo, lista de ferramentas e **Maximum Iterations** — o nosso
`MAX_TOOL_ROUNDS = 3`, mas por agente em vez de constante de código.

**E aqui está a melhor ideia da pesquisa inteira:** ferramentas customizadas
entram por **importação de OpenAPI/Swagger**. Cola o schema, importa por URL,
ou parte do exemplo — e o Dify gera a interface da ferramenta. Também aceita
o padrão OpenAI Plugin.

#### n8n

Ferramentas são sub-nós do AI Agent node; memória também é sub-nó explícito
(curto prazo dentro de uma execução, persistente entre execuções). Desde 2026
há **validação de JSON schema em toda resposta de ferramenta, com retry
automático** quando o modelo devolve formato errado.

E o ponto que mais importa para nós: **human-in-the-loop é padrão de
produção documentado.** Nós de espera entre passos do agente pausam a
execução até alguém aprovar ou rejeitar; quando o modelo quer usar uma
ferramenta "gated", o fluxo para e manda o pedido de aprovação pelo canal
escolhido. A documentação é explícita: **essencial para agentes que tomam
ações irreversíveis.**

### D. Camada de canal pura

#### Evolution API

Baileys (WhatsApp Web, não oficial) **e** Cloud API (oficial), na mesma casa.
Já fala nativamente com **Chatwoot, Typebot, Dify e OpenAI** — ou seja,
metade das outras famílias. Transportes: webhook, Socket.io, RabbitMQ, Kafka,
SQS.

Cerca de 25 eventos, e a granularidade é bem maior que os nossos três:
`MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `MESSAGES_DELETE`, `CONNECTION_UPDATE`,
`QRCODE_UPDATED`, `PRESENCE_UPDATE`, `LABELS_ASSOCIATION`, `CALL`,
`GROUP_PARTICIPANTS_UPDATE`, `CHATS_*`, `CONTACTS_*`, `TYPEBOT_START`.

**A ressalva, dita com todas as letras:** o modo Baileys é WhatsApp Web
não oficial. Funciona, é o padrão de fato no mercado brasileiro, e viola os
termos da Meta — risco de banimento do número recai sobre o cliente. Para a
PlastfortSul, que já está na API oficial, adotar Evolution só faz sentido
como **camada de abstração de canal**, não como troca de transporte.

#### BSPs — a economia

Todo BSP paga a mesma tarifa à Meta; o que separa é a margem.

| Provedor | Modelo | Nota |
| --- | --- | --- |
| 360dialog | ~€49/mês fixo, margem zero | Ganha em volume alto |
| Twilio / Bird | ~US$ 0,005/msg | Cruzamento com a 360dialog em ~10.000 msgs/mês |
| Gupshup | ~US$ 0,001/msg | Alcance de canal limitado |
| Telnyx | ~US$ 0,004, sem mensalidade | Rede própria |

Twilio vira a escolha quando o requisito é **multicanal numa API só** (SMS +
WhatsApp + voz). Se o roteiro do wacrm inclui SMS ou voz, isso muda a conta.

---

## Parte 2 — A convergência

Cinco camadas, e as treze plataformas têm as cinco:

| # | Camada | wacrm |
| --- | --- | --- |
| 1 | Persona **estruturada** (não um campo de texto) | ✅ migração 053 |
| 2 | Conhecimento indexado e recuperado | ✅ busca híbrida |
| 3 | Ferramentas em **três níveis**: ações nativas + HTTP custom + MCP | ⚠️ só o 1º nível, e só leitura |
| 4 | Contrato de handoff com **estado** | ⚠️ booleano, um destino |
| 5 | Agente **escopado a canal** | ❌ um por conta |

A camada 3 é onde está a distância, e ela é de três degraus, não de um.

A camada 5 é a que ninguém discute e nós não temos: **em toda plataforma o
agente pertence a um canal, não à conta.** As telas da Nina mostram
exatamente isso do outro lado — dois agentes (Nina, Bella) para dois canais.
Hoje o wacrm não conseguiria representar essa conta.

---

## Parte 3 — As divergências que importam

### Aprovação humana — o campo se divide, e nós escolhemos o lado menor

| Plataforma | Aprovação antes de agir |
| --- | --- |
| Chatwoot Captain | Nenhuma, explicitamente |
| GPT Maker | Nenhuma |
| Intercom Fin | Nenhuma no caminho do cliente |
| **n8n** | **Primeira classe, e recomendada para ação irreversível** |

A decisão **D3** da spec (`confirm` como padrão) fica do lado do n8n, e a
pesquisa a sustenta — mas com um custo que precisa ser dito: **Chatwoot e Fin
tiram taxa de resolução justamente por não parar para perguntar.** Um agente
que propõe e espera não resolve sozinho; ele adianta trabalho.

**↺ Revisa a spec.** `confirm` por padrão continua certo, mas a spec devia
dizer como uma ferramenta *sai* de `confirm`: a métrica é a taxa de aprovação
sem edição. Se 95% das propostas de `add_contact_tag` são aprovadas intactas
ao longo de N execuções, a ferramenta ganhou o direito ao `auto` e a tela
devia oferecer isso. Sem esse caminho, `confirm` deixa de ser prudência e
vira teto.

### Definição de ferramenta — o Dify ganha, e barato

| Plataforma | Como se define uma ferramenta HTTP |
| --- | --- |
| GPT Maker | Tabela campo a campo (`fields`, `headers`, `params`) |
| Chatwoot | Até 15 endpoints, formulário |
| **Dify** | **Importa OpenAPI/Swagger e gera a interface** |
| Botpress | Gera TypeScript a partir da instrução |

**↺ Revisa a spec — este é o ponto que muda a Fase 5.** O desenho atual
copia o formulário campo a campo do GPT Maker. Importar OpenAPI é menos
interface para construir, produz `fields` tipados de graça, e é o formato em
que a integração já vem documentada. O formulário manual vira o caso de
exceção, para API sem spec.

Bônus que fecha o círculo: **o wacrm já publica o próprio OpenAPI** em
`/developers`. Uma conta poderia apontar o agente para a própria API do CRM.

### Iterações e validação

`MAX_TOOL_ROUNDS = 3` é constante de código; no Dify é configuração por
agente. E o n8n valida schema na **resposta** da ferramenta com retry — nós
validamos a entrada e confiamos na saída, que hoje é só `String(...).slice(0, 2000)`.

### MCP deixou de ser exótico

97 milhões de downloads mensais do SDK em março de 2026, mais de 10.000
servidores públicos, e OpenAI, Google, Microsoft e Salesforce embarcaram em
13 meses. Voiceflow, Intercom e Amazon Connect já consomem MCP.

**↺ Revisa a spec.** Manter o MCP na Fase 6 continua certo *por risco* — sem
modos e auditoria, conectar um servidor MCP é entregar ao modelo um conjunto
de ferramentas desconhecido em tempo de execução. Mas o argumento de "isso é
avançado demais" caiu: virou tabela de entrada. E nós **já somos servidor
MCP** — ser cliente é um passo menor do que a spec sugere.

### A exclusão mútua entre automação e IA é só nossa

Nenhuma das treze desliga o bot porque existe uma regra ativa. Elas convivem
porque o bot é escopado (a inbox, a conversa) e o fluxo é explícito
(o Chatwoot põe a conversa em `pending`, e aí o dono é o bot).

O nosso `SELECT ... LIMIT 1` em [auto-reply.ts:60](../src/lib/ai/auto-reply.ts:60)
é um martelo: **uma automação de palavra-chave para "boleto" cala o agente em
todas as conversas da conta.** O modelo de estado do Chatwoot resolve isso
sem nenhuma IA nova.

---

## Parte 4 — A base de melhorias

Em ordem de razão entre valor e custo, não de sofisticação.

**1. Estado de dono da conversa** (barato, destrava o resto).
`pending | open | resolved` no lugar de `ai_autoreply_disabled`. Resolve a
exclusão mútua com as automações, dá lugar ao `waiting_since` e ao repasse, e
é pré-requisito honesto de qualquer ação — uma ação precisa saber quem manda
na conversa.

**2. Agente por canal, não por conta** (estrutural, e quanto antes melhor).
`ai_configs` ganha `channel_id` nulo (= padrão da conta). Feito antes do
segundo canal, é uma coluna. Feito depois, é migração de dados.

**3. Ações nativas com confirmação** (a Fase 2 da spec, sem mudança).
As sete do Captain são um bom alvo de paridade, e cinco delas já existem como
passo de automação.

**4. Ferramenta HTTP por importação de OpenAPI** (Fase 5 revista).
Menos UI, `fields` tipados de graça, e o caminho para o agente consumir a
própria API pública do CRM.

**5. Caminho de graduação `confirm` → `auto`** (o que falta na D3).
Taxa de aprovação sem edição como métrica.

**6. Iterações por agente e validação de saída de ferramenta.**
Duas linhas de configuração e um schema. Barato.

**7. Camada de canal.**
Só quando houver um segundo canal pedido. Aí a escolha é entre Evolution
(abstração ampla, ressalva do Baileys) e Twilio (multicanal oficial, margem
por mensagem). Não decidir agora.

---

## Fontes

Chatwoot — [AI Actions](https://www.chatwoot.com/hc/user-guide/articles/1777328078-lesson-5-ai-actions),
[Agent Bots e integrações](https://deepwiki.com/chatwoot/chatwoot/9.3-agent-bots-and-integrations),
[Agent Bots: bring your own AI](https://www.chatwoot.com/features/chatbots) ·
Intercom Fin — [guia completo](https://www.getmacha.com/blog/intercom-fin-ai-agent-complete-guide) ·
Dify — [Agent node](https://docs.dify.ai/en/use-dify/nodes/agent),
[Tools](https://docs.dify.ai/en/cloud/use-dify/workspace/tools) ·
Botpress — [Autonomous](https://botpress.com/features/autonomous),
[Knowledge Bases](https://botpress.com/docs/studio/concepts/knowledge-base/introduction) ·
Voiceflow — [Agent step](https://www.voiceflow.com/stories/introducing-the-agent-step),
[Platform overview](https://www.voiceflow.com/features/platform-overview) ·
n8n — [Tools Agent](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent),
[HITL em produção](https://www.bovo-digital.tech/en/blog/n8n-ai-agents-production-human-in-the-loop-2026) ·
Typebot — [bloco Webhook](https://docs.typebot.io/editor/blocks/logic/webhook) ·
Evolution API — [repositório](https://github.com/EvolutionAPI/evolution-api) ·
MCP — [estado do padrão em 2026](https://chatforest.com/guides/mcp-ecosystem-2026-state-of-the-standard/) ·
BSPs — [12 provedores comparados](https://getkanal.com/blog/whatsapp-business-api-providers-compared)
