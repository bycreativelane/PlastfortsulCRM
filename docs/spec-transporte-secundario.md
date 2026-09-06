# Transporte secundário — Baileys ao lado da API oficial

> **Escrito em 4 de setembro de 2026, contra o código da 0.9.0.** Desenho de
> um transporte não oficial (Baileys) que **acrescenta** ao canal oficial da
> Cloud API em vez de substituí-lo: histórico, contatos e foto de perfil.
> Nada aqui está implementado.
>
> **Risco de termos de uso já registrado e decidido pelo Gabriel.** Este
> documento trata só de engenharia.
>
> **Numeração.** A `069` é do Google. A `spec-acoes-de-agente.md` reivindica
> **070–075**; este plano **colide** com aquela numeração e precisa ser
> renumerado no momento de escrever, conforme a ordem real de entrega.
> Conferir `ls supabase/migrations/` antes de nomear qualquer arquivo.

O desenho em uma frase: **dois transportes, faixas de tempo disjuntas, e o
secundário nunca envia nada.**

Toda a complexidade deste documento existe para sustentar essa frase. A
alternativa — dois transportes disputando a mesma conversa ao vivo — exige
reconciliar identidades de mensagem entre dois espaços de identificador
diferentes, e isso não tem solução confiável. A regra de faixa disjunta faz
o problema deixar de existir em vez de resolvê-lo.

---

## Parte 1 — O modelo de papéis

### 1.1 Autoridade

| Papel | Transporte | Pode enviar? | Autoridade sobre |
| --- | --- | --- | --- |
| **Primário** | Cloud API oficial | ✅ **Único que envia** | Tudo que ele consegue ver |
| **Secundário** | Baileys | ❌ **Nunca** | Só o que o primário estruturalmente não vê |

O secundário opera com **lista de permissão, não de proibição**. Se um dado
não está na tabela abaixo, o adaptador o descarta e incrementa um contador.
Essa inversão é deliberada: uma lista de proibição erra por omissão quando o
Baileys ganha um evento novo; uma lista de permissão erra por conservadorismo,
que é o lado certo de errar num CRM comercial.

### 1.2 A lista de permissão

| Dado | Primário vê? | Secundário pode escrever? |
| --- | --- | --- |
| Mensagem recebida ao vivo | ✅ | ❌ nunca |
| Mensagem enviada pela API | ✅ | ❌ nunca |
| Status (`sent`/`delivered`/`read`) | ✅ | ❌ nunca |
| Reação, edição, exclusão ao vivo | ✅ | ❌ nunca |
| **Mensagem anterior à marca d'água** | ❌ | ✅ **é o ponto do documento** |
| **Nome do contato vindo da agenda** | ❌ | ✅ só quando `contacts.name` está vazio |
| **Foto de perfil** | ❌ | ✅ |
| Mensagem enviada do celular ao vivo | ❌ | ⚠️ ver §1.3 |
| Mensagem de grupo | ❌ | ❌ fora de escopo (§7) |

### 1.3 A zona cinzenta: mensagem enviada do celular

Se alguém da equipe responde pelo aplicativo no telefone, o canal oficial não
vê — e o secundário vê, ao vivo, com `key.fromMe = true`. É o único dado ao
vivo que só o secundário enxerga, e é operacionalmente valioso.

**Decisão: fica fora da primeira entrega.** Escrevê-lo exige furar a regra de
faixa disjunta, e furar a regra reabre a colisão de identidade — porque uma
mensagem enviada pela API e uma enviada pelo celular chegam pelos dois
transportes com identificadores de espaços diferentes. Entra depois, com uma
regra própria, e só se a operação pedir.

---

## Parte 2 — A regra de sincronização

### 2.1 A marca d'água

```
marca_dagua = min(created_at) das mensagens que o canal oficial já tem
              para esta conta
              — ou, se não houver nenhuma, o instante em que o canal
                oficial entrou no ar
```

**Regra única:** o transporte secundário só pode inserir mensagem cujo
`messageTimestamp` seja **estritamente menor** que a marca d'água. Qualquer
coisa a partir dela é território do primário e é descartada pelo adaptador.

Três consequências, e todas boas:

1. **A colisão de identidade some.** Nenhuma mensagem existe nas duas faixas,
   então nunca é preciso correlacionar um `wamid.HBg…` com um `key.id` do
   Baileys. Não há decodificação de identificador, não há heurística.
2. **A idempotência já existe.** Dentro do espaço do secundário, o upsert
   `onConflict: (conversation_id, message_id)` de
   [route.ts:799](../src/app/api/whatsapp/webhook/route.ts:799) já protege a
   re-execução. Ressincronizar é seguro por construção.
3. **É auditável.** "Tudo antes de X veio do secundário, tudo a partir de X
   veio do oficial" é uma frase que se verifica com uma consulta.

### 2.2 A marca d'água é congelada, não calculada

Ela é gravada **uma vez**, na abertura da execução de sincronização, e lida
dali em diante. Calculá-la a cada lote faz a fronteira andar enquanto o
histórico chega — e uma mensagem que chega ao vivo durante a sincronização
moveria a linha e abriria a porta para duplicata.

### 2.3 Reexecução

Uma execução de sincronização é **repetível e não destrutiva**. Repetir
reprocessa a mesma janela; o upsert absorve o que já entrou. O que **não** é
permitido é mudar a marca d'água de uma execução já fechada: isso criaria uma
faixa nova, e a faixa nova pode sobrepor o primário.

Ressincronizar com marca d'água diferente exige uma execução nova, com
registro próprio, e o relatório precisa dizer que houve duas.

---

## Parte 3 — A análise dos dados de entrada

O que o Baileys entrega em `proto.IWebMessageInfo`, e para onde vai.

### 3.1 Mapa de campos

| Campo do Baileys | Destino no wacrm | Observação |
| --- | --- | --- |
| `key.remoteJid` | identidade do contato | ⚠️ **pode ser `@lid`** — ver Parte 4 |
| `key.fromMe` | `messages.sender_type` | `true` → `agent`, `false` → `customer` |
| `key.id` | `messages.message_id` | espaço de identificador **do secundário** |
| `key.participant` | remetente em grupo | fora de escopo |
| `messageTimestamp` | `messages.created_at` | ⚠️ vem como `Long` do protobuf, **não** como número — `Number(ts)` antes de multiplicar por 1000 |
| `pushName` | candidato a `contacts.name` | só preenche se estiver vazio |
| `message.conversation` | `content_text` | texto simples |
| `message.extendedTextMessage.text` | `content_text` | texto com citação/link |
| `message.imageMessage` | `content_type: image` | `.caption` → `content_text` |
| `message.videoMessage` | `content_type: video` | `.caption` → `content_text` |
| `message.audioMessage` | `content_type: audio` | `.ptt` distingue áudio de voz |
| `message.documentMessage` | `content_type: document` | `.fileName` |
| `message.documentWithCaptionMessage` | `content_type: document` | **embrulha** o anterior um nível abaixo |
| `message.locationMessage` | `content_type: location` | |
| `message.reactionMessage` | `message_reactions` | fora da faixa histórica na 1ª entrega |
| `messageStubType` | — | eventos de sistema; **descartar** |
| `status` (0–5) | `messages.status` | mapear para o CHECK existente |

### 3.2 Armadilhas confirmadas

**`messageTimestamp` é `Long`.** O protobuf entrega um objeto com `low`/`high`,
não um número. `parseInt` nele devolve `NaN`, e `NaN` vira `Invalid Date`, e
uma data inválida passa pelo insert e envenena a ordenação da conversa.

**`documentWithCaptionMessage` aninha.** O documento de verdade está em
`.message.documentMessage`. Um adaptador que só olha o primeiro nível perde
todo documento com legenda.

**O CHECK de `content_type` é fechado.** A tabela aceita
`text, image, document, audio, video, location, template, interactive`
(001 + 010). O adaptador precisa mapear para dentro dessa lista, como o
inbound oficial já faz com `ALLOWED_CONTENT_TYPES` — reusar aquele mapa, não
escrever outro.

**Normalizar perde dado.** A Evolution API descarta `referral`
(`ctwa_clid`, atribuição de anúncio Click-to-WhatsApp) na normalização, e
quem depende de atribuição descobre tarde. Decidir explicitamente o que se
guarda, e guardar o envelope bruto do que não se mapeia.

---

## Parte 4 — O problema de identidade (`@lid`)

**É o maior risco técnico do documento, e não tem solução completa.**

O WhatsApp está migrando para **LID** (Linked ID) como identificador interno
de multi-dispositivo. Em vez de `5511999999999@s.whatsapp.net`, o JID chega
como `123456789@lid` — e o número do LID **não é um telefone**, é arbitrário.

Isso ataca o wacrm no ponto mais sensível: **todo o modelo de contato é
chaveado por telefone.** `contacts.phone`, a resolução em
`resolve-conversation.ts`, a deduplicação da 036 — tudo assume que a
identidade de quem fala é um número.

E o relato da comunidade é direto: no Baileys v7 **não há forma confiável de
resolver todo `@lid` histórico de volta para um JID de telefone** quando o
WhatsApp não mandou o mapa junto no payload do histórico. Em conversa
privada, muitas vezes não existe caminho.

### 4.1 A cadeia de resolução

Tentar, nesta ordem, e parar no primeiro que responder:

1. **Mapa do próprio payload** — `messaging-history.set` às vezes traz a
   associação LID ↔ PN. É a única fonte autoritativa.
2. **Store de contatos da sessão** — o `contacts.upsert` acumulado pode já
   ter visto os dois lados da mesma pessoa.
3. **Consulta ao vivo** (`onWhatsApp`, mapa de LID da sessão) — funciona para
   quem ainda existe, custa round-trip, e **não** funciona para histórico
   antigo de quem saiu.
4. **Quarentena.**

### 4.2 A quarentena, e por que ela é a decisão certa

Um LID irresolvível **não vira contato e não vira conversa**. Vai para uma
tabela própria:

```
wa_unresolved_identities(
  account_id, sync_run_id, lid,
  sample_push_name, message_count,
  first_seen_at, last_seen_at
)
```

E aparece no relatório final: *"47 conversas não puderam ser associadas a um
número e não foram importadas."*

**Nunca adivinhar.** Anexar mensagens ao contato errado num CRM comercial é
pior que não importar: o histórico errado aparece na tela do vendedor no meio
de uma negociação, e ninguém vai saber que está errado. Não importar é um
buraco visível; importar errado é um buraco invisível.

A quarentena também é a peça que torna a decisão reversível — se um dia
existir mapa melhor, os LIDs guardados podem ser reprocessados.

---

## Parte 5 — As partes estruturais

Dez peças. As três primeiras são o esqueleto; a sétima é a que protege o
sistema existente.

### 5.1 O serviço lateral (contêiner)

Serviço novo no `docker-compose.yml` que já existe — e é por isso que este
desenho é viável: vocês rodam Compose com um serviço só, e o segundo é
natural. Em serverless seria impossível, porque o Baileys segura um WebSocket
permanente e o app inteiro tem `maxDuration = 60`.

O serviço **não fala com o banco do app**. Só com o WhatsApp, com seu próprio
armazenamento de credenciais, e com o app por HTTP.

### 5.2 Armazenamento do estado de autenticação

`useMultiFileAuthState` é marcado **"DO NOT USE IN PROD"** pelos mantenedores.
Implementar `AuthenticationState` + `SignalKeyStore` sobre Postgres:

```
wa_auth_state(account_id, key text, value jsonb, updated_at)
  PRIMARY KEY (account_id, key)
```

Duas naturezas convivendo: `creds` (um registro, muda pouco) e as chaves do
Signal (`pre-key`, `session`, `sender-key` — muitos registros, altíssima
rotatividade). Envolver em `makeCacheableSignalKeyStore` para não bater no
banco a cada mensagem.

**Cifrar.** Esse blob dá acesso total à conta de WhatsApp; é material de
credencial, não de configuração. Reusar o `encrypt` AES-256-GCM de
[encryption.ts:37](../src/lib/whatsapp/encryption.ts:37).

### 5.3 Gerente de sessões

Uma conta, um socket. O gerente cuida de:

- **Ciclo de conexão** — `connection.update`, distinguindo
  `DisconnectReason.loggedOut` (precisa QR novo; **não** reconectar em laço)
  de reinício/timeout (reconectar com recuo exponencial).
- **Entrega do QR** — publicar numa tabela e deixar o **Supabase Realtime**
  (migração 067) levar até o navegador. A infraestrutura já existe.
- **Teto por processo** — o custo de memória por socket cresce com o número
  de sessões Signal, que é uma por contato. Num CRM com milhares de contatos
  isso não é desprezível, e o processo precisa de um limite declarado.
- **Afinidade** — o serviço é **stateful**. Dois contêineres com o mesmo
  estado de autenticação se derrubam. Uma conta pertence a um contêiner, e
  isso precisa ser garantido antes de escalar horizontalmente.

Nota operacional confirmada: a conexão se invalida após ~14 dias sem uso do
aplicativo no telefone. O telefone não é opcional.

### 5.4 O adaptador

Traduz `proto.IWebMessageInfo` para o **envelope da Cloud API**, seguindo a
mesma base da Evolution API e do `unoapi-cloud`. É a maior superfície de
código e onde vão morar os bugs — a Parte 3 é a especificação dele.

Vantagem de emitir no formato da Meta: **o app não aprende que Baileys
existe.** Todo o pipeline (contato, conversa, dedup, mídia, agregados) é
reusado sem alteração.

### 5.5 O envelope e o tratamento de webhook

Payload no formato Cloud API, com metadado de transporte nos cabeçalhos:

| Cabeçalho | Papel |
| --- | --- |
| `X-Wacrm-Transport` | `secondary` — sempre |
| `X-Wacrm-Sync-Run` | UUID da execução, nos lotes de histórico |
| `X-Wacrm-Silent` | `true` — histórico não dispara efeito |
| `X-Wacrm-Signature` | HMAC do corpo, mesma disciplina de `webhook-signature.ts` |

**Rota separada, não ramificação.** O secundário entra por
`/api/whatsapp/secondary`, não por um `if` dentro do webhook oficial. O
caminho quente do oficial é o mais crítico do produto e não deve ganhar uma
ramificação para servir um caminho de importação — as duas rotas chamam a
mesma função de inserção extraída, com flags diferentes.

### 5.6 O orquestrador de sincronização — as etapas

Máquina de estados, com registro em `wa_sync_runs`, **retomável em cada
fase** (o `messaging-history.set` chega em pedaços, com `chunk_order` e
`progress`):

| Fase | O que faz | Retomável por |
| --- | --- | --- |
| **0 · Pareamento** | QR, estado de autenticação, conexão viva | — |
| **1 · Marca d'água** | Congela a fronteira, abre a execução | — |
| **2 · Contatos** | `contacts.upsert` → resolve identidade, quarentena | id do contato |
| **3 · Conversas** | `chats.set` → conversas, só as resolvidas | jid |
| **4 · Mensagens** | Lotes, caminho mudo, filtro da marca d'água | `chunk_order` |
| **5 · Mídia** | **Preguiçosa** — ver §5.8 | fila |
| **6 · Re-derivação** | `last_message_at`, `unread_count`, prévia | conversa |
| **7 · Fechamento** | Relatório e selo da execução | — |

A ordem não é negociável: contato antes de conversa, conversa antes de
mensagem, mensagem antes de agregado. Uma mensagem cuja identidade caiu na
quarentena na fase 2 é descartada na fase 4 sem consultar nada.

### 5.7 O caminho mudo — a peça que protege o sistema

**Pré-requisito bloqueante.** O caminho de inserção atual dispara automações,
fluxos, IA, webhooks de saída e contagem de não-lidas. Importar seis meses de
histórico por ele **dispara a automação de boas-vindas para cada contato
importado e manda mensagem de verdade para cliente real.** Não tem desfazer.

Extrair a inserção de mensagem do `route.ts` para uma função com
`silent: boolean`, onde `silent: true` significa:

- ❌ nenhum gatilho de automação
- ❌ nenhum avanço de fluxo
- ❌ nenhuma resposta de IA
- ❌ nenhum webhook de saída
- ❌ nenhum incremento de não-lidas
- ❌ nenhuma notificação
- ❌ nenhuma compreensão de mídia
- ✅ só a linha na tabela, com o timestamp certo

É a peça mais valiosa da entrega, e vale sozinha: serve importação de CSV,
migração de outro CRM e testes.

### 5.8 Mídia preguiçosa

**Não baixar seis meses de mídia durante a importação.** Cada arquivo exige
download e descriptografia (`downloadMediaMessage`) e depois upload para o
armazenamento — em rajada, isso é horas de I/O e um custo de storage que
ninguém aprovou.

Gravar a mensagem com o metadado de mídia e **sem** arquivo; baixar sob
demanda, na primeira vez que alguém abrir aquela conversa, ou por uma fila de
fundo com teto. Vocês já têm o destino: `mirror-inbound-media.ts` e
`src/lib/media/`.

### 5.9 Re-derivação de agregados

Como a fase 4 não incrementa nada, `conversations.last_message_at`,
`last_message_text` e `unread_count` precisam ser recalculados no fim, por
conversa tocada. A 036 já tem o precedente exato dessa re-derivação após
fusão de conversas — **reusar a mesma forma**, não inventar outra.

`unread_count` de histórico importado é **zero**. Ninguém tem 4.000 mensagens
não lidas; isso é ruído de importação, não informação.

### 5.10 Relatório e observabilidade

Toda execução fecha com números, e eles vão para a tela:

```
threads_vistas, threads_importadas, threads_em_quarentena,
mensagens_importadas, mensagens_descartadas_pela_marca_dagua,
mensagens_sem_tipo_mapeavel, midias_pendentes,
marca_dagua_congelada_em, duracao
```

Sem isso, "importou" é uma sensação. Com isso, é um fato conferível — e a
linha de quarentena é a que o operador precisa ver para saber o que **não**
tem.

---

## Parte 6 — O que ainda falta na base do wacrm

Duas lacunas estruturais que este desenho expõe e não resolve sozinho:

**Não existe entidade canal.** A migração 013 impõe um `phone_number_id` por
usuário e `whatsapp_config` é singular. Sem uma entidade de canal, "transporte
primário" e "transporte secundário" não têm onde ser declarados, e a marca
d'água não tem dono. **É pré-requisito da Parte 2.** É a mesma lacuna que a
`pesquisa-plataformas-de-agente.md` apontou pelo lado do agente — dois
caminhos independentes chegando à mesma peça faltante, o que é um bom sinal
de que ela é real.

**Não existe processo contínuo.** Nem um: o relógio das automações é um
endpoint HTTP batido de fora
([cron/route.ts:13](../src/app/api/automations/cron/route.ts:13)). Este
desenho introduz a primeira coisa com estado do sistema, e com ela um modelo
de operação novo — reinício, saúde de conexão, afinidade.

---

## Parte 7 — Fora de escopo

- **Envio pelo secundário.** Nunca. É o que mantém o desenho defensável.
- **Grupos.** O canal oficial não os tem; importá-los cria uma classe de
  conversa que o resto do produto não sabe representar.
- **Mensagem enviada do celular ao vivo** (§1.3) — entrega posterior.
- **Reações e edições históricas.** Baixo valor, alto custo de mapeamento.
- **Foto de perfil em massa.** Uma por contato sob demanda, não 4.000 no
  import.

---

## Parte 8 — Ordem de construção

Cada etapa é entregável e verificável sozinha.

| # | Etapa | Depende de |
| --- | --- | --- |
| 1 | **Caminho mudo** (§5.7) | nada — e vale sozinho |
| 2 | **Entidade canal** + marca d'água | nada |
| 3 | Serviço lateral + estado de autenticação + QR | 2 |
| 4 | Adaptador, só texto | 3 |
| 5 | Rota `/secondary` + envelope + assinatura | 1, 4 |
| 6 | Resolução de identidade + quarentena | 5 |
| 7 | Orquestrador de histórico (fases 1–4) | 6 |
| 8 | Re-derivação + relatório | 7 |
| 9 | Mídia preguiçosa | 8 |
| 10 | Foto de perfil sob demanda | 9 |

As duas primeiras não têm nada a ver com Baileys, valem em qualquer cenário —
inclusive no da coexistência oficial — e são as que ficam caras se forem
deixadas para depois.

---

## Referências

Baileys — [arquitetura e eventos](https://deepwiki.com/WhiskeySockets/Baileys),
[pacote](https://www.npmjs.com/package/@whiskeysockets/baileys) ·
`@lid` — [discussão de mapeamento em produção](https://github.com/WhiskeySockets/Baileys/issues/2414),
[resolver @lid no history sync](https://github.com/WhiskeySockets/Baileys/discussions/2551),
[guarda-chuva na Evolution](https://github.com/EvolutionAPI/evolution-api/issues/1872) ·
`unoapi-cloud` — [Baileys no formato da Cloud API](https://github.com/clairton/unoapi-cloud) ·
Evolution API — [webhooks](https://docs.evolutionfoundation.com.br/en/evolution-api/configuration/webhooks),
[perda de `referral` na normalização](https://github.com/evolution-foundation/evolution-api/issues/2645) ·
Meta — [webhooks da Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)
