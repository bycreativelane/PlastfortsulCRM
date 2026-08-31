# Worklog — 0.8.4

Cada mudança, sob o pedido que a causou.

---

## 1. A foto que existia e não aparecia

**Pedido:** *"nao ta puxando a foto do perfil do usuário aqui / Nem no
chat da equipe"*

`profiles.avatar_url` está no schema desde a **001**. A tela de perfil
faz upload, o ladrilho da conta na barra lateral desenha, a aba Equipe
desenha, a visão geral de Configurações desenha. Quatro lugares onde a
foto aparece, e quatro onde não aparecia — porque cada um deles tinha
escrito o seu próprio `SELECT`:

```
online-members.tsx      select('user_id, full_name')
team-channel.tsx        select('user_id, full_name')
use-member-names.ts     select('user_id, full_name')   ← team-room-card
```

Nenhuma consulta pedia a coluna. A pessoa subia a foto, via em dois
lugares, e concluía que o upload tinha falhado pela metade.

**O que mudou**

- **`hooks/use-member-directory.ts`** (novo). Um `SELECT` com a foto
  junto, `Map<user_id, {full_name, avatar_url}>`. É o hook que as três
  superfícies passam a usar.
- **`components/presence/member-avatar.tsx`** (novo). O disco de uma
  pessoa: foto quando existe, iniciais coloridas pelo nome quando não, e
  o ponto de presença opcional por cima. Quatro versões escritas à mão
  viraram uma — e as quatro discordavam entre si sobre três decisões
  (tentar a foto, semear a cor pelo nome, mostrar presença).
- `online-members.tsx`, `team-channel.tsx` e `team-room-card.tsx` passam
  a desenhar `<MemberAvatar>`.

O card da rail ganhou algo a mais: o disco era o mesmo ícone `Users` em
toda conta e em toda mensagem. Com a rail recolhida em 62px esse disco
**é o card inteiro** — a coluna de texto sai —, então o único aviso
sempre-visível de que um colega escreveu não conseguia dizer qual colega.
Agora é a cara de quem falou. O ícone genérico continua para a sala
vazia, onde não há ninguém para mostrar.

---

## 2. O nome era um título; virou legenda

**Pedido:** *"Ali da pra deixar o nome acima menor e focar na mensagem
para aparecer melhor"*

O nome do autor usava a utilidade `eyebrow`: 10px, peso **700**,
`text-transform: uppercase`, `letter-spacing: 0.05em`. É o tratamento
desenhado para cabeçalho de seção — e dentro de um balão ele fazia
"**VITOR**" ser a coisa mais alta de uma linha cujo conteúdo era uma
palavra. O print do pedido mostra exatamente isso.

Virou `text-3xs font-medium`, caixa normal, sem tracking. Mesmo tamanho,
metade do peso, e o olho cai na frase.

---

## 3. Editar e apagar na sala da equipe

**Pedido:** *"Tem que pensar em como otimizar e liberar melhor a edição
da Minha equipe que faz parte também do chat interno"*

`team_messages.edited_at` está na tabela desde a **046** e as pendências
da 0.8.3 o listavam como peso morto — *"escritos por ninguém, lidos por
ninguém"*. Não era morto. Era não ligado.

**O que mudou**

- **`lib/team/messages.ts`** ganhou `editTeamMessage` e
  `deleteTeamMessage`. A edição carimba `edited_at`; a sala desenha
  "editada" ao lado da hora. Uma mensagem que muda em silêncio é uma
  mensagem que ninguém consegue citar de volta.
- O balão vira o editor no lugar, sem diálogo por cima. `Esc` cancela,
  `Enter` salva, `Shift+Enter` quebra linha. Um modal moveria a frase
  para o meio da tela e depois de volta.
- Menu de três pontos no hover **e no foco de teclado** — algo alcançável
  por Tab que fica invisível é uma armadilha. Ele reserva os 16px sempre,
  então uma sequência de balões mantém uma borda esquerda só.
- **Editar é só do autor. Apagar é do autor ou de um admin.** É o que a
  política da 046 já diz (`team_messages_update` checa autoria e nada
  mais); a interface passa a concordar com ela na frente, em vez de
  descobrir no round trip.
- Apagar é apagar. Sem lápide "esta mensagem foi apagada": os dois lados
  olham para a mesma tabela ao vivo, e uma lápide guardaria a interrupção
  jogando fora o conteúdo — a metade errada.
- O canal de realtime passa a ouvir `UPDATE` e `DELETE`, não só `INSERT`.
  Sem isso a correção de um colega só chegaria depois de um reload, e a
  sala mostraria históricos diferentes para duas pessoas.

O `DELETE` é assinado **sem filtro de `account_id`**, e há um motivo: a
linha "antiga" que o Postgres envia num delete carrega só a identidade de
réplica — a chave primária. Um filtro por `account_id` casaria com nada e
todo apagamento chegaria invisível.

---

## 4. Palavras para as mensagens que não têm nenhuma

**Pedido:** *"Tem que implementar transcrição de áudio automático e
imagem (não necessariamente já mostrar no front de cara)"*
**Decisão do Gabriel:** automático, com chave para desligar.

Um áudio e uma foto chegam com `content_text` vazio. E `content_text` é o
que **todo o resto do produto** lê:

- a linha de prévia na lista de conversas
- a busca global
- todo gatilho de automação por palavra
- o motor de fluxos
- a própria porteira da resposta automática (`if (inboundText.trim())`)

Cinco leitores, string vazia nos cinco. "Preciso de 200 unidades até
sexta", falado, é uma linha escrita `[audio]` que não casa palavra
nenhuma, não dispara nada, e cujo conteúdo o atendente descobre pondo
fone de ouvido.

**Migração 049** — `049_media_understanding.sql`

| Coluna | Para quê |
| ------ | -------- |
| `messages.media_transcript` | O texto falado, ou a descrição da imagem |
| `messages.media_transcript_status` | `none` / `done` / `failed` / `unsupported` |
| `messages.media_transcript_at` | Quando a tentativa terminou |
| `ai_configs.media_understanding_enabled` | A chave. **DEFAULT TRUE** |
| `ai_usage_log.mode` | CHECK ampliado com `transcription` e `vision` |

**Uma coluna para os dois tipos**, e é decisão e não atalho: transcrever
um áudio e descrever uma foto são coisas diferentes de produzir e a mesma
coisa de consumir — um parágrafo em português dizendo o que chegou. Duas
colunas fariam todo leitor futuro escrever `COALESCE(a, b)` para sempre,
e um deles esqueceria.

**O `DEFAULT TRUE`** alcança só quem já colou a própria chave em
Configurações › IA e ligou o assistente, e tudo aqui passa pelo mesmo
`is_active`. Para essa população o comportamento surpreendente é o outro.
A chave existe para tornar isso reversível num clique.

**Código**

- **`lib/ai/media-understanding.ts`** (novo).
  `transcribeAudio` (OpenAI `/v1/audio/transcriptions`),
  `describeImage` (visão, nos dois provedores),
  `understandInboundMedia` (orquestra e grava),
  `dispatchInboundMediaUnderstanding` (a porta do webhook).
- **Anthropic não escuta.** A API deles não tem entrada de áudio. Numa
  conta configurada em Anthropic o recuo é a `embeddings_api_key`, que é
  uma chave OpenAI por definição. Sem nenhuma das duas o resultado é
  `unsupported` — não `failed`: nada quebrou, a conta só não deu uma
  chave que saiba fazer isso.
- **Os bytes vêm da Meta**, não da `media_url`. Aquela coluna guarda ou
  uma URL pública do bucket (com o espelho ligado) ou o caminho relativo
  `/api/whatsapp/media/<id>` (sem ele) — e o segundo não é buscável de um
  servidor sem origem e sem sessão. Ir na fonte funciona nas duas
  configurações.
- **O prompt da imagem não é "descreva esta imagem".** Numa distribuidora
  a foto do cliente é quase sempre um documento — uma peça com código
  gravado, uma nota, um comprovante, uma caixa amassada. Números e nomes
  na coisa são o valor inteiro, e um captioner genérico devolve "uma peça
  metálica sobre uma mesa". O prompt manda transcrever literalmente o que
  estiver escrito e proíbe inferir intenção.
- **Chamado por último** no `processMessage`. É a coisa mais lenta do
  handler — um download mais uma ida ao provedor — e tudo acima dela ou
  tem alguém esperando (a notificação, a atribuição) ou é máquina que não
  pode ser segurada (fluxos, automações). Nada a jusante consome a
  transcrição ainda, então estar no fim da fila custa zero.
- **Nunca lança.** Uma mensagem recebida que falhasse ao persistir porque
  um provedor de transcrição caiu seria uma troca espetacularmente ruim.

**No front, apesar do "não necessariamente"**

Um `<details>` fechado sob o player e sob a foto: uma linha de metadado
com o ícone de legendas, e o texto a um clique. Fechado porque um mural de
fala transcrita em todo balão tornaria o player mais difícil de achar, não
mais fácil — e porque assim o balão tem a mesma altura de antes.

`failed` e `unsupported` não desenham nada. Um balão dizendo "não
consegui transcrever" é um pedido de desculpas num lugar onde o cliente
está esperando, e quem pode agir sobre isso não está olhando para essa
tela.

**Custo, visível.** As duas chamadas escrevem em `ai_usage_log` nos modos
novos, então Configurações › IA mostra o gasto da única superfície de IA
que roda sem ninguém apertar nada.

---

## 5. Os gráficos falando a mesma língua

**Pedido:** *"Precisa deixar o design dos gráficos dos relatórios mais
agradaveis e harmonicos visualmente com a estrutura no geral"*

Três coisas concretas, não três opiniões.

**Um preenchimento só.** A área de Conversas dissolvia num gradiente até
o zero; as barras de Tempo de resposta eram `fill="var(--chart-1)"`
chapado. Lado a lado na mesma página, um bloco de tinta saturada ao lado
de uma série que se dissolve lê como gráficos de dois produtos. Nasceu
`ChartGradient` nos primitivos e os dois passam a usá-lo. A rampa da
barra para em 55% e não em 0: uma área tem um traço na aresta de cima
segurando a forma, e uma barra não — uma que apagasse até o fim perderia
o próprio apoio no eixo.

**Uma largura de eixo Y.** Era 36 na área e 40 nas barras. Quatro pixels,
que ninguém nomearia — e quatro pixels de **aresta esquerda diferente**
para a área de plotagem de dois painéis empilhados na mesma coluna da
mesma página, sob títulos que se alinham perfeitamente. É a classe de
desalinhamento que se lê como "esta página foi montada" sem se conseguir
dizer por quê. `Y_AXIS_WIDTH = 40`.

**Duas colunas em vez de uma.** O gráfico de tempo de resposta ocupava a
largura toda sozinho: **sete** categorias em ~1300px, com `maxBarSize`
travando cada barra em 44px — então o que crescia eram os vãos, e uma
semana de atendimento lia como sete palitos solitários. Agora divide a
linha com o feed de atividade, no mesmo ritmo que a seção Comercial acima
já usa. Os dois têm a mesma altura em repouso: 260px de plotagem sob um
cabeçalho, contra as cinco linhas do feed entre cabeçalho e rodapé.

**Menos tinta na grade.** `stroke-border` cheio é a mesma tinta da borda
do card, então o andaime sob os dados falava tão alto quanto a moldura em
volta. `stroke-border/60`.

---

## 6. A caixa de texto e o ponto no avatar

**Pedido:** *"otimizar as caixas de texto do chat da equipe e no avatar
deixar o icone de online, ausente e etc"*

- **O anel de foco é da pílula**, não do `<textarea>` dentro dela. O
  destaque só no retângulo interno lia como um segundo campo desalinhado
  dentro do primeiro. Mesma receita `focus-within` do compositor da caixa
  de entrada.
- **`min-h-9`** iguala a caixa ao botão de enviar ao lado, então um
  compositor vazio é uma barra só, e não um campo baixo com um botão alto
  estacionado do lado.
- **Uma função de auto-crescimento**, `autosize()`, para a caixa e para o
  editor de mensagem. Estava inline no `onChange`; com a edição entrando,
  uma segunda cópia seria um segundo teto para manter em sincronia.
- **O botão gira** enquanto envia, em vez de ficar parado.
- **`presence` no disco de cada balão** — verde, âmbar, cinza, com o
  rótulo completo no `title` ("Vitor — Ausente há 4 min"). A sala é onde
  se pergunta algo a um colega e se decide se vale esperar a resposta, e
  essa decisão é exatamente "essa pessoa está na mesa".

---

## 8. Auditoria de conta

**Pedido:** *"Auditoria de conta"*

Nada no produto registrava que um cargo mudou, um membro saiu, uma chave
de API foi criada ou o número do WhatsApp foi repontado. Numa conta de
cinco pessoas isso não é uma lacuna de conformidade, é um problema
ordinário de terça: *"quem tirou o Vitor do funil"* não tem resposta, e o
único jeito de descobrir é perguntar para todo mundo.

**`account_audit_log`** (migração 050) — **append-only por construção**.
Não existe política de UPDATE nem de DELETE para ninguém, incluindo o
proprietário. Um log que um membro edita não é um log; é um documento, e
a única pergunta que ele existe para responder — "alguém mexeu nisso?" —
é exatamente a que ele deixaria de conseguir responder. O CI assere a
ausência das duas políticas, porque ausência é o tipo de coisa que uma
migração futura devolve por acidente.

`actor_label` guarda o nome **congelado no momento do ato**. Não é
gentileza: as linhas que interessam daqui a um ano são justamente as de
quem já saiu, e `actor_user_id` é `SET NULL` para exatamente essas — sem
o rótulo, a metade interessante do log diria "alguém".

**Quem escreve o quê**

| Evento | Onde |
| ------ | ---- |
| `session.signed_in` | `record_sign_in()`, chamado pelo navegador |
| `member.invited` / `member.invite_revoked` | rotas de convite |
| `member.role_changed` / `member.removed` | `members/[userId]` |
| `member.permissions_changed` | rota nova de permissões |
| `account.ownership_transferred` | `transfer-ownership` |
| `api_key.created` / `api_key.revoked` | rotas de chaves |
| `ai.config_updated` / `whatsapp.config_updated` | rotas de config |

A mudança de cargo grava **os dois** cargos. "O Vitor virou admin" é meia
frase — a metade que alguém pergunta um mês depois é o que ele era antes.

`logAuditEvent` **nunca lança e nunca falha o chamador**, e isso está
escrito no arquivo com o custo junto: este log pode ter buracos. Uma
linha que faltou porque o insert falhou é indistinguível de um ato que
não aconteceu. É a troca certa — a alternativa é uma tela de
configurações que cai quando uma tabela cai — mas faz disto um registro
para humanos perguntando "quem mexeu nisso", não uma prova.

---

## 9. Último acesso

**Pedido:** *"Ultimo acesso"*

São **dois fatos**, e a lista mostra o mais recente dos dois:

- `profiles.last_sign_in_at` (050) — quando a pessoa se autenticou.
- `member_presence.last_seen_at` (024) — quando estava de fato fazendo
  algo.

Qualquer um sozinho lê como errado para metade da equipe: quem entrou na
segunda e deixou a aba aberta desde então é "ativo há 2 minutos", não
"visto na segunda"; quem entrou hoje de manhã e fechou é o caso oposto.

Aparece na aba Equipe, **só para admins** — a rota devolve `null` para os
outros. Um atendimento compartilhado onde todo atendente vê o horário de
sessão de todos os outros é outro tipo de local de trabalho.

`record_sign_in()` grava **no máximo uma linha por hora** no log. O
chamador é um efeito React numa página que sobrevive à navegação mas não
a um reload, e um navegador que volta do sono redispara o callback de
sessão — sem essa guarda, uma manhã comum escreveria uma dúzia de "entrou"
idênticos. O carimbo em `last_sign_in_at` continua se movendo toda vez,
então "último acesso" segue exato.

---

## 10. O painel "Na equipe agora" saiu

**Pedido:** *"Aquela aba quando clica no avatar q aparece, pode remover"*
**Confirmado:** é o popover de presença, não o menu do perfil.

Clicar na pilha abria "Na equipe agora": as mesmas caras, os mesmos
pontos, a mesma ordem, mais os nomes. Um popover cujo conteúdo inteiro é
a coisa que você já estava olhando, num produto onde a lista com cargos e
horários está a dois cliques em Configurações › Equipe.

A pilha virou um `<span>`, não um botão: não há nada atrás para abrir, e
um estado de hover em algo que não responde ao clique é a interface
prometendo uma ação que não tem. Os nomes não sumiram — cada disco carrega
o próprio `title`, então passar o mouse ainda diz "Vitor — Ausente há 4
min".

---

## 11. Acesso e permissões

**Pedido:** *"Ter uma sessão de configuração para visibilidade de membros
e permissões"*
**Decisão do Gabriel:** por pessoa, sobre o cargo.

Seção nova em **Configurações › Acesso e auditoria**, logo abaixo de
Equipe — porque é a outra metade da mesma coisa: a aba Equipe responde
"quem está aqui", esta responde "o que essa pessoa pode" e "o que ela
fez", e se chega à segunda vindo da primeira, sempre.

**A forma**

```
efetivo(cap) = override[cap] ?? cargoPermite(cap)
```

Chave ausente = "pergunte ao cargo". É essa propriedade que torna seguro
ligar isto numa conta viva: uma conta que ninguém configurou se comporta
exatamente como antes da coluna existir, e uma capacidade adicionada ano
que vem cai no cargo, não num vazio.

**Onde já vale**

- A barra lateral esconde a linha inteira (Atendimento, Funil, Contatos,
  Automações, Disparos, Fluxos, Relatórios).
- `/relatorios` deixou de checar o cargo e checa a capacidade — menu e
  página passam a concordar.
- A sala da equipe usa `team-room.write` em vez do "pode enviar mensagens"
  global: escrever para um colega e escrever para um cliente são duas
  permissões diferentes.

**O limite, dito em voz alta na própria tela**

Estas exceções são aplicadas **pela interface e pelas rotas deste app** —
a mesma força que a porta de `/relatorios` já tinha — e **não** por RLS,
que continua respondendo só ao cargo. Isso basta para "o Vitor não
precisa ver isso" e não basta para "o Vitor não pode ver isso, de jeito
nenhum". Quem está configurando acesso merece saber qual dos dois está
comprando antes de comprar. O aviso está no painel, em português, e o
mesmo texto está no comentário da migração e no `capabilities.ts`.

`rlsBacked` marca as capacidades onde o banco também diz não. Nessas o
override só **tira** — a chave de liberar aparece desabilitada, porque
desenhar o controle e deixar o pedido falhar move a decepção para depois
da decisão.

**Um defeito encontrado antes de sair**

A primeira versão da rota fazia `UPDATE profiles ... WHERE user_id = alvo`
com o cliente RLS. `profiles_update` (017) é `auth.uid() = user_id` nas
duas metades: um membro atualiza a **própria** linha e nenhuma outra.
Então o UPDATE de um admin na linha de um colega casa **zero linhas e não
retorna erro** — a tela diria "salvo" e não mudaria nada, para sempre, e
o único jeito de perceber seria recarregar e ver a chave onde estava.

Virou `set_member_permissions()`, SECURITY DEFINER, no mesmo formato de
`set_member_role` (018). E o gatilho `guard_permission_overrides` cobre o
outro lado: a única linha que o navegador **pode** escrever é a própria,
e essa é exatamente a que não pode se auto-servir — `permission_overrides`
mora na `profiles` ao lado de `account_role`, e RLS restringe linhas, não
colunas. É o mesmo buraco que a 034 teve de fechar com gatilho.

O CI assere as duas funções, o gatilho, e a ausência das políticas de
UPDATE/DELETE no log.

---

## 12. O logo do WhatsApp onde é WhatsApp

**Pedido:** *"Pode implementar o logo do whatsapp onde for referente a
ele"*

`SECTION_META.whatsapp` desenhava `PlugZap` — uma tomada. É um substituto,
e um substituto é uma coisa que só se identifica lendo o rótulo ao lado.
A mesma entrada alimenta **duas** superfícies (a trilha de Configurações
e o ladrilho da Visão geral), então trocar uma linha resolve as duas dos
prints.

**`components/whatsapp-mark.tsx`** (novo). SVG inline, mesmo padrão do
`BrandMark`: herda `currentColor` e o tamanho, não custa requisição, e
não pode chegar atrasado numa trilha que renderiza em toda rota.

**O viewBox é `-2.4 -2.4 28.8 28.8` e não `0 0 24 24`**, e isso foi
medido, não chutado. Um ícone do lucide desenha dentro de ~20 das suas 24
unidades — a margem de 2 é o que faz uma coluna deles parecer uma coluna
só. O traçado oficial do WhatsApp preenche a caixa de ponta a ponta.
Medido no navegador, em `size-4`:

| | tinta renderizada |
| - | - |
| `message-square` do lucide (referência) | 13,33 × 12,66 px |
| WhatsApp com `0 0 24 24` | **15,92 × 16,00 px** |
| WhatsApp com `-2.4 -2.4 28.8 28.8` | 13,27 × 13,33 px |

Sem o acolchoamento o logo sairia ~20% maior que os vizinhos e a trilha
leria como um ícone que cresceu. Com ele, meio por cento de diferença.

**`currentColor`, não `#25D366`.** A marca pega a tinta do contexto:
apagada na trilha, o accent dentro do ladrilho. Pintá-la de verde meteria
uma sexta cor num produto onde cor é carga — e verde aqui já significa
"conectado", falado pelo pontinho de status que fica **no mesmo
ladrilho** que este ícone encabeça. A forma carrega o reconhecimento; a
cor continua significando o que significa.

(O `BrandMark` faz o contrário e guarda as três cores da PlastfortSul.
Não é contradição: aquela marca **é** o produto, desenhada uma vez, no
topo da rail, sem nada em volta para discordar dela.)

**Onde entrou**

| Onde | Era | Por quê |
| ---- | --- | ------- |
| Trilha de Configurações › WhatsApp | `PlugZap` | É a conexão do WhatsApp |
| Ladrilho da Visão geral | `PlugZap` | Mesma entrada do `SECTION_META` |
| "Enviar pelo WhatsApp" no convite | `MessageCircle` | O link abre `wa.me` |
| Auditoria, linhas `whatsapp.*` | `PlugZap` da área | "Integração" junta IA e WhatsApp; num log que se varre, o ícone é como se acha a linha. As linhas de IA ganharam `Bot` pelo mesmo motivo |

**Onde NÃO entrou, de propósito**

- **A linha "Atendimento" da barra lateral.** É um lugar do app, não a
  integração — e desde a 046 ela também guarda a sala da equipe, que
  nunca toca o WhatsApp. Um logo ali diria que a sala é WhatsApp também.
- **O painel de login** (*"Caixa de entrada compartilhada do WhatsApp"*).
  Os três ícones ali espelham de propósito as três primeiras linhas da
  barra lateral — está escrito no comentário do `auth-shell`. Trocar um
  dos três quebra o espelho.
- **`WifiOff` nos avisos de "não conectado"** (sininho e /notificações).
  A mensagem ali é o **estado**, não a marca.

---

## 13. A mesma cara duas vezes no pé da rail

**Pedido:** *"Ficou repetindo a foto ali, ve uma atualização bacana de
layout que fique legal para solucionar isso e manter a função"*

Efeito colateral do [§1](#1-a-foto-que-existia-e-não-aparecia). O card da
sala passou a mostrar a cara de quem falou por último; o ladrilho da
conta, logo abaixo, é **sempre** você. Quando a última mensagem era sua,
a rail terminava na mesma foto duas vezes — e isso lê como falha de
renderização, não como dois controles.

Duas coisas causavam a leitura de "duplicado", e as duas foram
resolvidas.

**A cara, e nunca a sua.** "Qual colega" é uma pergunta sem conteúdo
quando a resposta é você — você sabe o que acabou de escrever. Então a
sua vez cai no ícone da sala, e a cara fica para o caso pelo qual foi
adicionada. Os dois cards agora **não conseguem** mostrar a mesma pessoa:
um é sempre você, o outro nunca é.

Não foi um disco menor nem um formato diferente. Duas fotos da mesma
pessoa empilhadas continuam sendo duas fotos da mesma pessoa, em qualquer
tamanho.

**A moldura.** O card era `bg-muted rounded-xl` — o mesmo preenchimento,
em quase o mesmo raio, do ladrilho da conta a poucos pixels dali. Dois
retângulos preenchidos da mesma cor, cada um com um disco sobre duas
linhas de texto: mesmo com caras diferentes dentro, leem como um controle
desenhado duas vezes.

Ele passa a usar a gramática que as **nove linhas de navegação acima dele
já usam**, literalmente: transparente com `hover:bg-muted`, e
`bg-primary-soft` para o estado que pede atenção. Este card **é** uma
linha de navegação — ele vai para `/inbox?team=1` —, então parecer uma é
a resposta consistente, não a discreta. E o preenchimento finalmente
significa algo: aparece quando há mensagem não lida, em vez de ser a
fantasia permanente do card.

Medido no navegador, contra a folha de estilo real:

| | fundo | borda | raio |
| - | - | - | - |
| Card da sala, em repouso | `rgba(0,0,0,0)` | 0px | 11,2px |
| Ladrilho da conta | opaco (`--muted`) | 1px | 8px |
| Card da sala, não lida | accent a 10% | 0px | 11,2px |

**O nome, curto.** *"Gabriel Spencer: fsdafas"* gastava a maior parte de
um card de 200px dizendo quem, por extenso, logo acima de um ladrilho que
diz o mesmo nome por extenso de novo. Passa a ser o primeiro nome — que é
como uma sala de quatro pessoas se refere umas às outras — e **"Você"**
quando é sua. A frase inteira, com nome completo e mensagem, ficou no
`title` do link.

O ícone da sala também deixou de ser `bg-card` e virou `bg-primary-soft`,
para ter o mesmo peso visual de uma foto: sem isso a coluna piscava entre
duas densidades conforme as mensagens chegavam.

---

## 14. Três alturas numa linha só

**Pedido:** *"ajuste de alinhamento"* (print da auditoria)

Medido antes de mexer, contra a folha de estilo real:

| | centro |
| - | - |
| A frase | y = 20 |
| O disco de 28px | y = **26** |
| A hora | y = **18** |

Oito pixels de desacordo em uma linha, na tela cujo trabalho inteiro é
ser varrida. A causa: o disco carregava `mt-0.5` dentro de uma `<li
items-start>`, e a maioria das entradas tem **uma** linha — um acesso não
tem detalhe — então o disco caía 6px e a hora, mais curta, subia 2.

A linha passa a dizer o que ela de fato é: uma primeira linha que segura
o glifo, a frase e a hora juntos, com o detalhe opcional pendurado
embaixo. `min-h-7` dá a essa linha a altura do próprio disco, então
`items-start` alinha os dois por construção e `items-center` acomoda o
texto dentro. Uma entrada de duas linhas continua com o disco na
**primeira**, que é onde ele pertence.

Medido depois: offset 0 nos três, em linha simples e em linha dupla.

---

## 15. Atribuição automática ganha uma aba

**Pedido:** *"crie uma nova aba nas configurações focada apenas para essa
função, onde quero disponibilizar personalização na forma que vai ser
feito essa função de atribuição"*

Era **um interruptor** no rodapé de Equipe, sob um comentário que dizia
que o rodízio "não tem opções que valham ser expostas" e que cada botão
seria "um jeito de a equipe acabar com uma regra de roteamento que
ninguém lembra de ter combinado".

Estava certo sobre um recurso que ninguém tinha usado e errado sobre um
em uso. Três comportamentos dele são **decisão**, não fato — e uma
decisão que o produto toma em silêncio no seu lugar é exatamente a regra
que ninguém lembra de ter combinado. Escrita, numa página com nome, é uma
regra que a equipe **pode** combinar.

**Migração 051** — `051_assignment_rules.sql`

| Coluna | O que decide |
| ------ | ------------ |
| `auto_assign_mode` | CHECK ampliado com `least_busy` |
| `auto_assign_min_role` | Cargo mínimo para receber. **DEFAULT `agent`** |
| `auto_assign_offline_fallback` | Ninguém online: atribuir mesmo assim, ou deixar na fila |
| `auto_assign_max_open` | Teto de conversas abertas por pessoa. 0 = sem teto |
| `profiles.auto_assign_opt_out` | "Eu não" |
| `set_member_auto_assign()` | RPC — você mesmo sempre, os outros só como admin |

**O piso de cargo é a correção de um defeito, não uma preferência.** A
auditoria da 0.8.2 confirmou e a fila da 0.8.3 registrou: *"Um `viewer`
pode vencer o rodízio e ser o único notificado."* Um leitor é somente
leitura no produto inteiro — o compositor fica desabilitado para ele —
então atribuir a um arquiva um cliente esperando atrás de um dono que não
pode responder, **e tira a conversa da fila sem dono, que é onde um
colega teria encontrado**. É o único comportamento que esta passagem
muda; todo o resto assume o padrão que o motor já tinha.

**O teto é um pulo, nunca uma recusa.** Se todo mundo estiver no limite
ele é ignorado e a conversa é atribuída assim mesmo — um teto capaz de
travar a fila na única tarde em que ela enche é pior que teto nenhum. Há
um teste para essa propriedade.

**`least_busy` desempata pelo rodízio.** Numa manhã tranquila todo mundo
está em zero, e sem o desempate toda conversa iria para quem estivesse
primeiro no array. Também há teste.

Oito testes novos no `auto-assign.test.ts`, incluindo um que assere que
`nextInRotation(members, cursor)` sem regras continua **idêntico** ao que
era — que é o que garante que aplicar a 051 não muda nada até alguém
abrir a tela.

**Um defeito evitado antes de sair:** `profiles_update` (017) é
`auth.uid() = user_id`, então um admin tirando um colega do rodízio
acertaria zero linhas e receberia sucesso. Mesma armadilha da 050, mesma
resposta — `set_member_auto_assign()`, SECURITY DEFINER, e o CI assere
que ela existe.

---

## 16. Salas internas, com nome e descrição

**Pedido:** *"seja possivel modificar o nome e descrição dessa equipe ou
criar outra salas internas de acordo com funções"*

A 046 construiu **uma sala por conta** e argumentou por isso — "cada
nível a mais de estrutura é uma decisão que alguém tem que tomar antes de
conseguir digitar". E disse o que fazer se estivesse errada: *"Uma
segunda sala, se um dia for desejada, é uma coluna com um padrão —
adicionar depois é barato, e chutar agora não é."*

Foi desejada. **Migração 052** é essa coluna, e o barato se confirmou.

`team_rooms` com nome, descrição, posição, `is_default` e `archived_at`;
`team_messages.room_id` anulável, com CASCADE.

**O nome da sala padrão é NULL no banco**, e esse é o truque que mantém a
migração sem opinião sobre idioma. Toda conta ganha uma sala no backfill,
e essa sala precisa se chamar alguma coisa — mas SQL não lê os catálogos
de tradução, então semear um literal cravaria "Minha equipe" no banco de
uma instalação em inglês ou coreano, **como dado**, onde ninguém acharia
para corrigir. NULL significa "a sala com que esta conta começou", e o app
renderiza `Inbox.team.title` no idioma configurado. No momento em que
alguém renomeia, o nome é dele.

**Arquivar, não apagar.** `room_id` faz CASCADE, então apagar uma sala
leva seis meses de decisões junto. "Apagar essa sala" quase sempre quer
dizer "para de me mostrar ela", e as duas não são recuperáveis uma da
outra — então a interface só oferece a reversível.

**A sala padrão não pode ser apagada**, e isso é um gatilho e não uma
política: RLS decide QUEM, não QUAL. O gatilho distingue um DELETE direto
de um cascade vindo de `accounts` — o segundo passa, senão contas ficariam
indeletáveis.

**O que continua não existindo, pelo mesmo motivo da 046: participação.**
Toda pessoa da conta lê e escreve toda sala. Salas aqui são pastas, não
canais privados, e a interface não sugere o contrário. Membership seria um
sistema de permissão inteiro — tabela, RLS, tela, e uma resposta para "o
que acontece com as mensagens quando alguém sai" — e nada disso foi
pedido.

Nova seção **Configurações › Salas da equipe**, e um seletor no cabeçalho
da sala que **só aparece quando há mais de uma**: uma conta que nunca
abrir essa tela tem exatamente o cabeçalho que tinha antes da 052.

---

## 17. Três linhas e um número no card da equipe

**Pedido:** *"em vez de aparecer só 1 linha de mensagem, pode aumentar
para 3 linhas... ele deve aparecer na sequencia igual no chat"* e *"o
número de mensagens no grupo que foram enviadas até a última que constar
na notificação"*

**Três linhas**, mais antiga em cima, cada uma truncando por conta
própria em vez de o bloco quebrar. Três mensagens meio mostradas ganham de
uma mostrada inteira e duas ausentes, porque o que o card faz é ajudar a
decidir se vale abrir a sala.

Uma linha é uma notificação — *alguém falou*. Três é a menor quantidade
que mostra uma **conversa**: uma pergunta e uma resposta ainda cabem.

**Na sequência, igual ao chat**: o nome só aparece quando o autor muda em
relação à linha anterior. É a mesma regra que os balões da sala já
seguem, e é o que faz três linhas lerem como conversa em vez de três
avisos.

**As três são da MESMA sala.** Com mais de uma sala, as três últimas
mensagens da conta podem ser três conversas empilhadas — o oposto do que
três linhas servem para mostrar. A mensagem mais nova escolhe a sala, e as
linhas são dela; o título do card passa a ser o nome dessa sala.

**O número** substitui o pontinho, revertendo o que estava escrito ali —
*"quantas mensagens não lidas existem não é um número sobre o qual alguém
aja diferente"*. Aquilo era um julgamento sobre uma sala que ninguém tinha
usado. Em uso, uma mensagem e onze mensagens são situações diferentes: a
primeira é um comentário que dá para ler depois, a segunda é uma conversa
que você perdeu.

Contado, não recontado: o valor exato vem de um `count` na montagem, e
cada INSERT do realtime incrementa — a alternativa seria uma consulta por
mensagem recebida, em toda rota. Na rail recolhida continua sendo um
ponto, porque em 62px não cabem dois dígitos.

---

## 18. O nome acima da mensagem

**Pedido:** *"o nome de quem enviou tem q ficar identificado fixo acima
da mensagem e não do lado, se não quebra igual no print"*

E quebrava por aritmética, não por gosto. O card tem cerca de 150px de
texto: `Vitor: ` come um terço, e a frase é cortada a um terço do
caminho — então o que o card mostrava era **quem falou e quase nada do
que foi dito**. Com três linhas piorou, porque o nome era pago de novo a
cada turno.

Acima, uma vez por turno, custa uma linha curta e devolve a largura
inteira a cada mensagem. É também o que os balões da própria sala fazem —
o nome do autor fica **sobre** o primeiro balão de um turno, não dentro
dele — então o card e a sala passaram a ler do mesmo jeito.

---

## 19. O Agente IA, em profundidade

**Pedido:** *"deixe mais robusto a função Agente IA... tanto para
possiveis tools, rag, prompt, tudo que é o padrão de configuração, mas
pode até bolar alguma ideia de configuração via steps"* — com ênfase.

A 029 deu ao assistente tudo que ele precisava para existir: provedor,
chave, modelo e **`system_prompt`** — um campo de texto livre onde a
personalidade inteira, o contexto do negócio inteiro e cada regra tinham
que ser escritos como prosa. A 030 deu a base de conhecimento. Entre as
duas, um assistente que funciona — e a superfície de configuração
inteira.

**Migração 053** — `053_ai_agent_depth.sql`

| O que entrou | Por quê |
| ------------ | ------- |
| `persona_name`, `business_description`, `tone`, `guardrails`, `escalation_rules` | O prompt era um bloco. "Somos uma distribuidora", "fale formal" e "nunca prometa prazo" são um **fato**, uma **instrução** e uma **proibição** — três coisas diferentes, escritas num parágrafo só, e o modelo tirava a média delas |
| `enabled_tools TEXT[]` | Ele só sabia falar |
| `retrieval_top_k` | Quatro trechos era uma constante no código |
| `assist_enabled` | O apoio ao humano, separado da resposta automática |
| `setup_completed_at` | Se alguém já configurou de propósito |
| `ai_knowledge_documents.pinned` | Os dois ou três documentos relevantes a **toda** pergunta |

**A proibição vai por último, e a posição é o argumento.** Uma proibição
no meio de um prompt longo é uma proibição que o modelo pesa contra tudo
que vem depois dela; no fim, é a última coisa que ele leu antes de
escrever.

**Ferramentas** — `lib/ai/tools.ts`, com três regras que são o que
tornam isso seguro de soltar:

1. **Toda ferramenta é somente leitura.** Nada aqui escreve, etiqueta,
   move um negócio ou envia. Um assistente que age em nome do cliente sem
   ninguém olhando é outro produto, com outro risco.
2. **Toda ferramenta é escopada a uma conta e a um contato.** O modelo
   **não tem argumento** pelo qual pudesse nomear outro.
3. **Nada vem ligado.** `enabled_tools` começa vazio.

Quatro ferramentas: ler o cadastro do cliente, ler a oportunidade aberta,
buscar no catálogo, buscar na base. As duas provedoras ganharam laço de
tool-calling — OpenAI por `tool_calls`, Anthropic por `tool_use` — com
teto de três rodadas e **soma de uso em todas elas**, porque uma resposta
com ferramenta é duas, três ou quatro requisições cobradas e reportar só
a última subestima exatamente as conversas que mais custam.

**RAG** ganhou o teto configurável e os documentos **fixados**, que
entram antes da busca e fora do orçamento de top-k — porque a lista de
preço e a regra de entrega são relevantes a toda pergunta e perdiam para
um trecho semanticamente mais próximo sobre outra coisa, no exato momento
em que eram necessárias.

**Os passos** — `step-flow.tsx` e `ai-setup-wizard.tsx`. Onze campos numa
página são **seis perguntas numa ordem**, e quatro delas só fazem sentido
depois da anterior:

1. Qual provedor, e na chave de quem
2. Quem é este assistente
3. O que ele sabe
4. O que ele pode consultar
5. Onde ele para
6. Onde ele roda

**Acordeão e não assistente com botões Próximo**, e essa é a decisão de
desenho: um assistente modal é certo para algo que se faz uma vez. Isto
se faz uma vez e depois se volta seis vezes para mudar uma linha — e um
modal torna a sexta visita pior do que a parede era. Aqui todo passo está
na página, recolhido, na ordem, com o estado visível. E **um passo salva
por vez**: a rota lê campo ausente como "não mexa", então as guardas
escritas no passo cinco sobrevivem a uma edição no passo dois.

O formulário completo continua, atrás de um link. Apagá-lo seria uma
melhoria para quem nunca configurou um LLM e uma piora para quem já sabe.

---

## 20. IA de apoio, na mensagem do cliente

**Pedido:** *"ao clicar em uma mensagem de cliente solicitar busca de
resposta com uma ia e um rag interno sobre a empresa"* — IA para auxílio
do atendente humano, não agente.

O compositor já tinha um botão de IA, e ele responde **a conversa** — a
coisa mais nova dita. Certo na maior parte das vezes e errado exatamente
quando importa: o cliente manda quatro mensagens seguidas, a útil é a
segunda, e é com ela que o atendente quer ajuda.

O ponto de entrada mudou para a mensagem. **A mesma rota**, um campo a
mais — duplicar seria duas cópias do rate limit, do carregamento de
config, do log de uso e do mapeamento de erro, divergindo a partir da
primeira correção.

Três coisas que este painel faz e que jogar texto no compositor não faz:

1. **Mostra as fontes.** Os trechos da base em que a resposta se apoiou.
   Uma sugestão que ninguém consegue conferir é uma sugestão que as
   pessoas colam sem ler ou param de usar — as duas piores que não
   oferecer.
2. **Mostra o que consultou.** "Ele leu o cadastro do cliente" é a maior
   parte do motivo pelo qual uma resposta sobre aquele cliente pode ser
   confiada.
3. **Não toca no compositor até pedirem.** O botão antigo sobrescreve o
   que o atendente tinha meio digitado, e texto meio digitado é a coisa
   que um atendente menos aceita perder.

A transcrição conta: um áudio não tem `content_text`, e "sugerir
resposta" num áudio que o atendente ainda não ouviu é uma das versões
mais úteis deste botão — ver a migração 049.

Só em mensagem de cliente. Sugerir resposta para algo que a própria
empresa disse é um pedido que só pode ser engano — e a rota recusa de
qualquer forma, então oferecer o botão seria oferecer um erro.

**Nada é enviado daqui.** O botão entrega texto ao compositor; uma pessoa
aperta Enviar.

---

## 21. Produtos

**Pedido:** *"tem um plano de implementação de Produtos, analisa ele de
acordo com as ultimas atualizações e implementa"*

**Não encontrei um arquivo com esse nome** — procurei por `*produt*`,
`*plano*` e por cabeçalhos em todo o repositório, incluindo o
`_removido-do-repo/`. O que existe é a especificação original, e nela
"produtos" aparece três vezes e **nunca como tabela**:

- **§10** — cada oportunidade deve possuir `produtos`
- **§11** — o cadastro do cliente tem `produtos de interesse`
- **§44** — "Campanha por produto"

Implementei contra ela. **Migração 054**: `products`, `deal_items` e
`contacts.product_interest`.

**O que isto deliberadamente NÃO é:** controle de estoque. Sem saldo, sem
reserva, sem movimentação — adicionar depois seria outro recurso, com
outra tabela. Um CRM que controla estoque pela metade é pior que um que
não controla: o número está errado, alguém cota em cima dele, e o cliente
recebe uma mentira dita com convicção.

**O preço é copiado para a linha, não lido pela chave estrangeira.**
Escolher um produto semeia o preço do catálogo e daí o número **pertence
à linha**. Três motivos, e o terceiro é o que importa: desconto tem que
ser expressável; mudar o preço do catálogo não pode reescrever os
negócios fechados do trimestre passado; e um negócio tem que sobreviver
ao produto ser aposentado.

**`deals.value` deixou de ser digitado.** O total de cada linha é
`GENERATED` no banco e um gatilho soma para o negócio — então nenhuma
aplicação pode calcular diferente. Remover a **última** linha não zera o
negócio: quem apaga uma linha que adicionou por engano queria remover uma
linha, não apagar o valor que a oportunidade tinha antes de alguém
itemizar.

**Índice único parcial no código do produto**, e ele existe por causa de
uma reclamação documentada sobre outro CRM: *"a plataforma permite
duplicar registros sem restrições na importação"*. Catálogo com o mesmo
código em duas linhas é catálogo onde o preço que você passa depende de
qual linha a consulta achou. Parcial porque dois produtos **sem** código
não são duplicatas — e um `UNIQUE` comum deixaria existir exatamente um
deles.

**Uma linha de texto livre é permitida.** "Frete" e "montagem" estão em
metade dos orçamentos de uma distribuidora e no catálogo de ninguém.
Obrigar toda linha a referenciar um produto significaria ou um produto
falso chamado Frete, ou a linha ficando de fora — e a segunda é como o
total do orçamento para de bater com a nota.

**§44 está fechado**: o assistente de disparo ganhou o público **"por
produto"**, que consulta `contacts.product_interest` com `overlaps` — o
teste de contenção para o qual o índice GIN da 054 foi criado.

---

## 22. CNPJ conferido, e a duplicata avisada

Item 2 da pesquisa que veio junto com o pedido: *"cadastro de empresa por
CNPJ gerando duplicação de informações"*.

`lib/contacts/tax-id.ts` — forma canônica (só dígitos, para que
`12.345.678/0001-90` e `12345678000190` sejam **um** valor comparável),
dígito verificador mod-11 para CPF e CNPJ, e a rejeição dos
`111.111.111-11` da vida, que passam na aritmética e são o que alguém
digita para vencer um campo obrigatório. **Doze testes.**

No formulário: formata e confere **ao sair do campo**, nunca sob o cursor
— reformatar enquanto alguém digita é um campo brigando com a pessoa que
o usa. E avisa quando outro cadastro já tem o número, com o nome de quem.

**Aviso, não bloqueio.** Duas filiais de um grupo dividem CNPJ
legitimamente, e um CRM que recusa um registro que a pessoa precisa é um
CRM que ela mantém numa planilha.

O que falta: a mesma checagem na **importação em massa**, que é onde a
reclamação original acontece. Está na análise de mercado, item 7.

---

## 23. Relatórios, outro desenho

**Pedido:** *"deixe mais estético com outro design os relatórios"*

**Os quatro números viraram um objeto.** Eram quatro cards separados num
`grid gap-4` — quatro bordas, quatro sombras e três vãos em volta de
quatro **leituras do mesmo período**. Quatro cards é o que se constrói
quando cada um é algo em que se pode clicar (é assim que `StatTile`
funciona no painel, onde toda peça leva a algum lugar). Estes não levam a
lugar nenhum. Um painel, dividido: as divisórias dizem "isto se lê
atravessando", que é o que uma faixa de métricas de período é.

E ele **empilha por divisória, não por card** — abaixo de `sm` vira
linhas separadas por régua em vez de quatro caixas com vãos, o que num
celular é a diferença entre uma tela e uma tela e meia. Medido: cabe em
375px, e em 768px vira 2×2 com células de 351px.

A linha de movimento ocupa o espaço dela **mesmo quando não há nada a
dizer**, senão quatro leituras em que uma tem variação e três não ficam
em quatro alturas diferentes — o tipo de desalinhamento que se lê como
"montado" sem ninguém saber nomear.

**O período subiu para o cabeçalho da página.** Ele morava dentro do
cabeçalho de **um** gráfico, o que fazia parecer propriedade daquele
gráfico — e era, e esse era o problema: todo o resto da página reporta
uma janela fixa (tempo de resposta é a última quinzena, o funil é agora,
a atividade são as últimas cinquenta coisas) enquanto um painel tinha um
controle insinuando que a página inteira tinha período. Quem move para 7
e olha o funil embaixo foi informado de algo falso pelo layout.

---

## 24. Mobile e tablet

**Pedido:** *"otimizar a versão mobile ao maximo... verifica se não ta
puxando nada das antigas versões, tanto mobile e tablet"*

**Nada de versão antiga.** Varri o `src` inteiro por módulos que ninguém
importa: três resultados, os três falsos positivos (`global-error.tsx` e
`page.tsx` são convenção do Next, `types/index.ts` é importado como
`@/types`). Não há código morto de versões anteriores.

O alicerce de mobile deste código já estava bom — `dvh` em vez de `vh`
com a aritmética do zoom, alvos de 44px sob ponteiro grosso, o inbox que
troca lista por thread abaixo de `md`. O que **faltava** eram três coisas
que só aparecem no aparelho:

1. **`env(safe-area-inset-*)` não era usado em lugar nenhum.** Num iPhone
   isso aparece: o compositor — o único controle pelo qual a tela inteira
   existe — fica **embaixo da barra de gestos**, e um toque perto do
   botão de enviar vira um swipe. O app é `overflow: hidden` com filhos
   rolando dentro, então o navegador nunca rola o inset para fora do
   caminho como faria num documento comum. Entraram as utilidades
   `pb-safe-*` / `pt-safe-*`, com `max()` — nos aparelhos sem inset o
   valor é o mesmo de antes (medido: 12px), nos com inset ele cresce.
2. **O teclado do Android.** O padrão (`resizes-visual`) mantém a
   viewport de layout na altura cheia e desliza o teclado **por cima** —
   então o compositor fica embaixo do teclado que a pessoa abriu para
   digitar nele. `interactiveWidget: 'resizes-content'` faz a viewport
   encolher, que é contra o que todo `dvh` e todo `flex-1` desta casca já
   estão escritos.
3. **`themeColor` era um valor só**, então a barra de status de um
   aparelho no tema escuro era uma faixa clara que alguém esqueceu de
   estilizar. Agora são dois, por `prefers-color-scheme`.

Mais duas apertadas por medida: a linha do catálogo põe o preço **sob** o
nome abaixo de `@sm` (senão nome, preço e dois botões dividem ~200px num
celular de 360 e o nome fica com quatro caracteres), e os três números de
uma linha de orçamento empilham abaixo de `@xs` — a ~70px o valor some
atrás das setinhas do stepper.

Medido no navegador: **nenhum overflow horizontal em 375px nem em
768px.**

---

## 25. Harmonia nas outras seções

**Pedido:** *"As mesmas melhorias para a sessão do agente ia tu pode
seguir como base para todas as outras das configurações e manter uma
harmonia"*

Feito: **`StepFlow` é um componente compartilhado**, não uma peça do
assistente — está em `components/settings/` e qualquer seção que seja
mesmo uma sequência pode usá-lo. E a seção do Agente IA, que era a única
que abria com um `<p>` solto em vez do `SettingsPanelHead` de todas as
outras, passou a abrir igual. É pequeno, e é exatamente o tipo de coisa
pequena que faz andar entre duas telas de configuração parecer andar
entre dois produtos.

**Não feito, e é a decisão que mais quero registrar:** converter
**WhatsApp** para passos.

É a candidata óbvia — é a outra parede técnica, é onde as pessoas mais
travam, e a pesquisa que veio no pedido tem um caso de alguém que
*"seguiu o tutorial passo a passo e o resultado foi o WhatsApp banido"*.
Mas o arquivo tem mais de mil linhas, com alertas e botões de ação
entremeados entre os painéis, e é **a tela mais carga-viva de
configuração do produto**: um erro ali não é cosmético, é o número parar
de receber.

Reescrever isso numa passagem em que ninguém pode olhar o resultado seria
trocar um ganho de forma por um risco de função. Fica registrado como o
próximo item, com o motivo — e quando for feito, merece uma sessão em que
alguém acompanha.

---

## 26. O plano de Produtos, encontrado — e as divergências corrigidas

O "plano de implementação de Produtos" existe. É uma **sessão de chat**,
não um arquivo, e por isso a busca por `*produt*` e `*plano*` no
repositório não achou nada. A comparação completa está em
[07-plano-produtos-comparado.md](07-plano-produtos-comparado.md); aqui
fica o que mudou no código.

**A área saiu de Configurações e virou rota.** `/products`, no grupo
Operação, abaixo de Clientes — que é o que o plano decidiu, com o teste
que o próprio `sidebar.tsx` documenta: *"é um lugar onde você TRABALHA,
ou onde você muda como o trabalho se comporta?"*. O atendente abre o
produto **no meio da conversa** para consultar medida e preço. E o plano
já tinha antecipado e descartado a aba: *"foi exatamente o arranjo que a
0.8.2 desfez… Escolher uma. Não as duas."*

O `proxy.test.ts` pegou o que eu teria enviado junto: `/products` fora de
`PROTECTED_PATHS`. Uma rota do painel sem guarda de sessão, encontrada
pelo teste que existe para exatamente esse esquecimento.

**Migração 055** resolveu as outras duas divergências:

- **Quem escreve.** Nem admin (plano) nem agent (o que eu fiz):
  **corrigir** é do agente, **criar e aposentar** é do admin. Os dois
  primeiros cabem em policy; "aposentar" é um UPDATE em `active` e RLS
  restringe linhas, não colunas — daí o gatilho
  `products_guard_active`, terceira vez que esta base bate nessa parede
  (034, 050, agora).
- **Medida e espessura viraram colunas tipadas**, respondendo a pergunta
  1 do plano. `width_cm`, `height_cm`, `thickness_micron`, mais
  `material` e `color` em texto. **A unidade está no nome da coluna** —
  a alternativa (valor + coluna de unidade) é o que produz 40 cm numa
  linha e 400 mm na outra e uma busca por 40x60 que acha metade.
- **`size_label` é GENERATED** — "40x60cm" — para que a lista, o item de
  orçamento e a resposta do assistente não formatem diferente, e para
  que a busca case com o jeito como o produto é pedido ao telefone. A
  ferramenta de catálogo da IA passou a procurar por ele e a devolver
  medida e espessura como números.

O que continua em aberto está no fim do 07: o vocabulário de unidades, o
resto do P1 (busca global, painel da conversa) e o P2.


---

## 27. O modelo do WhatsApp na lista — e a autoria que nunca foi gravada

O retorno de quem está testando com o time:

> Envios de mensagens deixar no modelo de whatsapp / Quando lead responde
> fica sem os verificados / Quando matheus responde aparece os
> verificados e o nome do matheus / Quando thales responde aparece os
> verificados e o nome do thales / Puxando sempre o nome do atendente que
> esta mandando a mensagem

A regra é de **direção**, e o WhatsApp a aplica sem exceção: o que saiu
leva tique e nome, o que entrou não leva nada. O WhatsApp escreve
"Você:" porque o aparelho é de uma pessoa; aqui o número é do time
inteiro, então "Você" é mentira na tela de qualquer colega. O nome do
atendente é a mesma ideia dita com verdade.

### O buraco não era a tela

**`messages.sender_id` existe desde a 001 e nenhum caminho de envio a
escreveu.** `send-message.ts` gravava `sender_type: 'agent'` e parava
aí. O único rastro de autoria no sistema era o prefixo `*Nome*` da
assinatura — que vem **desligada** por padrão, mora no `localStorage`
(apelido por máquina, não identidade) e é endereçado ao **cliente**, não
ao time.

Ou seja: o CRM não sabia quem respondeu. Não faltava uma tela, faltava o
dado. A [056](../../supabase/migrations/056_message_authorship.sql) e o
código que a acompanha passam a gravá-lo.

### Um gatilho, não seis chamadas

Quem escreve `last_message_*` hoje: a RPC do webhook (037/047), o envio,
o motor de fluxos, as automações, o disparo em massa e a API pública.
Seis lugares para manter em sincronia é seis lugares para esquecer um.

O gatilho deriva tudo da própria linha de `messages`, então nenhum desses
caminhos muda. E cobre o que uma chamada no envio **não** cobriria: o
tique que muda depois. "Entregue" e "lido" chegam por webhook de status
minutos mais tarde, como UPDATE em `messages.status` — sem o segundo
gatilho a lista congelaria em um tique cinza para sempre.

### Na thread, a corrida quebra por pessoa

O agrupamento quebrava só quando o **lado** mudava. Matheus responde
duas vezes, Thales responde uma: uma corrida só, desenhada como um turno
de uma pessoa. Agora quebra também quando o autor muda — que é
literalmente o caso do relato — e o nome aparece **na primeira bolha de
cada corrida**, como num grupo do WhatsApp. Em toda bolha viraria
transcrição.

O nome vem do `sender_id`; a assinatura `*Nome*` fica de reserva para
todo o histórico anterior à 056.

---

## 28. A paleta de cores que estava lá o tempo todo, fora da caixa

> Pipeline nao apareceu palheta de cores para modificar

Estava aparecendo. **Fora do diálogo.**

`DialogContent` é `max-h-vh-85 overflow-y-auto`, e as duas cópias
artesanais do popover (`pipeline-settings.tsx` e `tag-manager.tsx`)
usavam um painel `absolute` dentro dele. Medido no app rodando:

| | antes | depois |
| - | ----- | ------ |
| `overflow-x` computado do diálogo | **`auto`** | — |
| painel além da borda do diálogo | **200 px** | 0 |
| `elementFromPoint` no centro do painel | **não é o painel** | é o painel |
| clicável | **não** | sim |

`overflow-y: auto` faz o `overflow-x` computar `auto` também — o diálogo
recorta nos **dois** eixos. Numa etapa perto do fim da lista o painel
nascia inteiro fora da área visível. E o `fixed inset-0` que capturava o
clique de fora fazia o primeiro toque de rolagem **fechar** a paleta em
vez de trazê-la para a tela: no celular, que é onde o relato aconteceu,
não havia gesto que a mostrasse.

A correção é o `Popover` que o projeto já tem: renderiza em portal, então
**não tem ancestral para recortá-lo**, e vira para cima quando não há
espaço embaixo — que é exatamente o caso deste bug. As duas cópias viraram
[`ui/color-swatch.tsx`](../../src/components/ui/color-swatch.tsx).

E o botão do Pipeline era um ponto de 16 px sem borda e sem seta: a única
coisa que o separava dos pontos decorativos do resto do app era ser
clicável. Ganhou borda e chevron — oito pixels que dizem "isto abre".


---

## 29. A IA de apoio sai de dentro do Agente IA

> quero separar as funções de ia do agente de ia, funções como resposta
> sugerida, transcrição de audio, analise de imagem e documento, isso
> fica pra uso manual, então tem q configurar separado do agente de ia

O pedido parece de organização e é de **defeito**.

`loadAiConfig` recusava a linha inteira quando `is_active` era falso — e
`is_active` é o interruptor do **agente**, a coisa que responde cliente
sozinha. Três caminhos passavam por ali:

| Caminho | É o agente? |
| ------- | ----------- |
| auto-reply | sim — certo que morra junto |
| `/api/ai/draft` (resposta sugerida) | **não** |
| `media-understanding` (áudio, imagem) | **não** |

O comentário da própria 049 admitia: *"Gated behind is_active like
everything else here."* E no assistente de configuração os dois
interruptores estavam literalmente `disabled={!draft.isActive}`.

Resultado: quem não quer robô falando com cliente — que é a posição mais
comum e é legítima — também ficava sem áudio transcrito. **O botão que
deveria dizer "sem robôs" estava dizendo "sem ajuda também".**

### O que separa, e o que não

A [057](../../supabase/migrations/057_ai_assist_split.sql) dá interruptor
mestre próprio (`assist_is_active`) e um modelo opcional. O que **não**
se separa é a credencial: uma conta, um provedor, uma chave. Pedir duas
vezes seria dois lugares para rotacionar e dois para errar.

O modelo se separa porque as cargas são opostas — o agente responde todo
mundo o dia inteiro e quer modelo barato; o apoio roda quando alguém pede
e às vezes vale um melhor. `forAssist()` faz a troca num lugar só, para
que nenhum chamador precise lembrar do `?? config.model`.

### Um interruptor por função, não um por "mídia"

`media_understanding_enabled` cobria áudio **e** imagem num booleano só.
Viraram três, porque o custo não é comparável: um minuto de fala custa
uma fração de uma foto, e um PDF de vinte páginas custa mais que os dois.
Áudio e imagem herdam o valor antigo; documento nasce **desligado**.

### E o PDF passou a ser lido

`readDocument()` — capacidade nova. Hoje todo pedido, boleto e tabela de
preços que chega em PDF vira `[document]` no CRM: invisível para a busca,
para os gatilhos por palavra e para quem olha a lista. Anthropic recebe
como bloco `document`, OpenAI como parte `file`; o resto — timeout, erro,
normalização de uso — é o mesmo caminho da imagem, de propósito, porque
são duas funções que não podem divergir.

Só PDF. Nenhum dos dois provedores lê `.docx`, `.xlsx` ou o `.p7s` que
embrulha uma NF-e — aceitar `application/*` inteiro seria pagar pelo
upload de uma planilha para receber uma recusa.

O `filename` viaja junto desde o webhook: em pedido e boleto ele é
rotineiramente o único lugar onde o número aparece — `PED-4471.pdf` diz
mais que a primeira página às vezes diz.

### O que o teste pegou

`Settings.aiTools` **já existia** — é o registro de coisas que o agente
pode chamar (`getContact`, `searchProducts`). Eu ia escrever a seção nova
por cima dele, o que teria apagado os rótulos na tela do agente. O
`keys-exist.test.ts` reprovou antes de chegar em ninguém.

A resolução final não foi desviar do nome, foi **arrumar o dono dele**: a
seção se chama **Ferramentas de IA**, que é como quem abre Configurações
a chama, e o que o agente invoca no meio da frase virou
`Settings.agentLookups` — **consultas**, que é o que são e é o que o
próprio passo do assistente já dizia ("O que ele pode consultar"). Duas
coisas diferentes não dividem uma palavra.

### O interruptor que mentia

E a seção ganhou a coisa que faltava para "ativar o que faz sentido":
**a Anthropic não transcreve áudio.** Numa conta Anthropic a transcrição
roda na chave OpenAI de embeddings — e sem essa chave o interruptor fica
ligado, o áudio chega e nada acontece. Em silêncio:
`understandInboundMedia` devolve `unsupported`, que é a resposta interna
certa e uma coisa inútil para nunca ser dita a ninguém.

Agora a linha avisa, em âmbar, no lugar onde a decisão está sendo
tomada. Um interruptor que mente é pior que um interruptor ausente.


---

## 30. A navegação do celular desceu para o polegar

A barra inferior substitui o hambúrguer como navegação primária no
telefone. Ver [08-auditoria-front.md](08-auditoria-front.md) para o
levantamento completo; aqui fica o desenho.

**Por que.** Todo destino custava dois toques e um deles ficava no canto
superior esquerdo — que num telefone de 6,7" segurado com uma mão é um
regripe, não um toque. E este é um app que se usa em pé, com uma caixa na
outra mão. Uma barra embaixo custa um toque, cai dentro do arco do
polegar, e faz a coisa que uma gaveta nunca faz: **fica visível**. Gaveta
responde "para onde posso ir" só depois de você já ter decidido ir; a
barra responde também "onde eu estou", continuamente, que é a pergunta de
quem acabou de chegar por uma notificação.

**Três destinos e "Mais".** Não cinco. Passando de quatro, os rótulos
truncam em 360px e os alvos caem abaixo de 44px — e uma barra que não se
lê nem se acerta é um hambúrguer pior. Os três foram escolhidos pelo que
se faz num **telefone**, que não é o que se faz numa mesa: atender,
mover um negócio, procurar alguém. Relatórios, Disparos, Fluxos e
Configurações são trabalho de mesa e continuam um toque mais longe,
atrás de "Mais" — que é a mesma gaveta de sempre, não uma segunda lista
para manter.

**É filho do flex, não `fixed`.** Essa é a diferença entre uma barra de
abas e um relatório de bug. Fixa, ela flutua sobre os últimos 56px de
tudo — a última conversa da lista, a última linha da tabela de contatos,
o pé da coluna do Kanban — e cada uma dessas telas precisaria do seu
próprio `padding-bottom` para compensar. Seis paddings para manter, e a
sétima tela que alguém criar esquece. Como irmã do `<main>`, ela ocupa o
espaço dela e o app fica 56px mais curto; **não existe "atrás" para
esconder nada.**

**E some dentro da conversa.** Com uma thread aberta a barra não
renderiza. Dois motivos, e o segundo é o de verdade: 56px é muito para
tirar de um compositor que já divide a tela com o teclado — e ler uma
conversa é uma tarefa em que se está **dentro**, onde uma faixa de abas
permanente convida a sair sem querer, com o mesmo polegar que está
tentando digitar. O WhatsApp esconde as próprias abas dentro de um chat
exatamente por isso.

Saber se há thread aberta vem de `?c=` na URL — a caixa de entrada já
publica isso para deep link, então o fato é público e não precisou de
contexto novo.

### Medido, a 375 e a 320

| | 375×812 | 320×568 |
| - | ------- | ------- |
| Altura da barra | 57px | 57px |
| Alvo por célula | 94 × 56 | 80 × 56 |
| Rótulo | 10px, nenhum truncado | 10px, nenhum truncado |
| Overflow horizontal | não | não |

`env(safe-area-inset-bottom)` no padding: sem ele, os últimos 34px de
cada aba num iPhone moderno são o gesto de home, não um botão.

---

## 31. Os gráficos: o funil, e a legenda que virou leitura

### O donut estava respondendo a pergunta errada

Donut responde "que fatia do total é cada parte". Etapas de funil **não
são partes de um total** — são uma **sequência**, e as duas coisas que se
abre esse painel para descobrir são destruídas por um anel:

- **A ordem.** Novo → Qualificado → Proposta → Fechado é o significado
  inteiro do dado. Um anel não tem primeiro nem último; quem lê tem que
  reconstruir a ordem pela legenda, toda vez.
- **A perda entre etapas.** *"Onde os negócios morrem?"* é A pergunta de
  vendas, e é a razão entre duas fatias **adjacentes** — que num anel são
  dois arcos em dois ângulos, a única comparação em que a visão humana é
  péssima.

O [funil](../../src/components/dashboard/pipeline-funnel.tsx) põe as
etapas em ordem descendo a página, codifica valor como comprimento a
partir de uma borda esquerda comum (a comparação em que a visão humana é
ótima) e imprime a perda **no vão entre cada par** — onde a pergunta é
feita.

Duas decisões que não são óbvias:

- **A largura é contra a MAIOR etapa, não contra o total.** Contra o
  total, um funil saudável de seis etapas desenha seis tocos — as barras
  passariam a codificar "fatia de tudo", que é a pergunta do donut de
  novo, numa forma pior.
- **A perda é medida em QUANTIDADE, não em valor.** "Sete viraram três" é
  um fato sobre negócios. Valor se move por motivo que não é evasão: um
  negócio grande numa etapa final faz o dinheiro **subir** por um funil
  que está perdendo todo mundo, e a seta anunciaria melhora enquanto a
  empresa sangra.

O dashboard **mantém o donut**: lá o painel responde "como está dividido
o funil agora", que é a única pergunta em que um anel é bom.

Sem Recharts, e isso não é regressão: este painel não tem eixo, grade nem
tooltip sobre os quais ser inconsistente, e é feito de divs — então todo
rótulo é pixel de CSS de verdade em qualquer largura, que era o problema
original que o `chart-primitives.tsx` foi criado para resolver. O que ele
herda é a regra que importa: **a cor da etapa vem do banco**, porque a
cor é a identidade dela no quadro.

Medido a 375px: 304px de altura para quatro etapas, barras 341 → 198 →
85 → 58 (forma de funil de verdade), nome longo sem truncar, sem overflow.

### A legenda passou a carregar os números

Duas palavras e dois pontinhos acima do gráfico é uma chave de cor lida
**uma vez** — e paga em toda visita, ocupando a linha mais valiosa do
painel. Com os totais do período dentro, ela responde "quantas, no total?"
antes de alguém passar o mouse em qualquer ponto. A chave de cor continua
funcionando: mesmo ponto, mesma palavra.


---

## 32. A comparação com o período anterior

Um gráfico de tendência sem linha de base é decoração. **142 conversas**
não é bom nem ruim até se saber que o mês passado foram 96 — e o painel
não sabia dizer.

A legenda-leitura da §31 agora carrega a variação ao lado de cada total.
Só totais, não uma segunda série: uma linha fantasma sobre um gráfico de
duas áreas são quatro linhas numa caixa, e a comparação que as pessoas
realmente fazem com ela ("mais ou menos que antes?") é um número só, que
elas já liam nas pontas.

**Cinza, não verde e vermelho.** Neste painel "mais mensagens" não é boa
notícia e "menos" não é má — uma semana tranquila e uma integração
quebrada são idênticas daqui. A seta carrega a direção; o julgamento é de
quem lê. Colorir seria o gráfico torcendo por volume.

**`null` quando não há base, e não zero.** Um período sem nada antes dele
não é um período que ficou estável, e imprimir "0%" reivindicaria uma
medição que ninguém fez.

### A janela, que é onde estava o erro fácil

A primeira versão media a janela anterior em **dias inteiros**, e isso
está errado de um jeito completamente plausível:

> A janela visível vai de `daysAgoStart(rangeDays - 1)` até **agora** —
> então às nove da manhã ela é 29 dias inteiros mais duas horas, enquanto
> "os 30 dias anteriores" seriam 30 dias inteiros.

Comparadas assim, uma terça-feira de manhã perfeitamente normal reporta
uma queda de dois dígitos que é só o relógio. Na aba de 7 dias, um dia
parcial é um sétimo da amostra.

A janela anterior passou a ser medida em **tempo decorrido**: exatamente
tão longa quanto a visível, terminando onde ela começa. Cinco testes
seguram isso, e o que importa é o segundo — `previousSpan` tem que estar
entre o relógio de antes e o de depois da chamada.


---

## 33. Os oito diálogos do navegador

> Quando fui apagar a mensagem no grupo da equipe interna apareceu essa
> caixa no padrão do navegador

Era `window.confirm`. E não era um caso isolado: **oito** deles espalhados
— apagar um fluxo, um campo personalizado, uma mensagem da equipe, uma
resposta rápida, arquivar uma sala, resetar a conexão do WhatsApp — mais
um `window.prompt` para nomear uma resposta rápida.

O problema estético é o que se vê: uma caixa cinza dizendo
"localhost:3000 diz" no meio de um produto que desenha todos os outros
diálogos. Mas os dois que doem não aparecem:

- **Ela trava a thread principal.** Tudo para enquanto a caixa está
  aberta — a inscrição de realtime, o heartbeat de presença, o contador
  de não lidas. Deixa uma aberta e a caixa de entrada fica para trás em
  silêncio.
- **Ela pode ser suprimida.** O navegador oferece "impedir esta página de
  criar mais caixas", e vários webviews de app recusam de saída.
  `confirm()` então devolve **false sem mostrar nada**: o apagar
  simplesmente não acontece, para sempre, e nada no produto consegue
  perceber.

O `window.prompt` é pior — bloqueado por padrão em mais lugares, e
devolve string crua sem superfície de validação.

### Um diálogo, com forma de promessa

[`confirm-dialog.tsx`](../../src/components/ui/confirm-dialog.tsx) expõe
`await confirm({...})` e `await prompt({...})`, que é **a mesma forma que
a chamada nativa tinha**:

```ts
if (!(await confirm({ title, destructive: true }))) return;
```

Foi isso que fez a troca dos oito ser uma linha em cada, em vez de oito
componentes aprendendo a segurar um `open` e partir o handler ao meio em
volta dele.

Três decisões pequenas que importam:

- **Escape, o fundo e o X resolvem `false`.** Uma promessa pendurada é um
  handler que nunca retorna e um botão que fica desabilitado para sempre.
- **Prompt vazio é cancelamento.** O nativo devolvia `""` e cada chamador
  tinha que lembrar de checar; devolver `null` faz "não digitou nada" e
  "apertou Escape" serem a mesma coisa — que é o que significam.
- **`useConfirm` fora do provider lança**, em vez de cair para
  `window.confirm`. Um recuo silencioso devolveria a caixa cinza na tela
  que esquecesse de montar o provider, e a razão de este arquivo existir
  é que ninguém reparou nessas caixas por meses.

### E um teste que lê os arquivos

`no-native-dialogs.test.ts` varre `src/` inteiro. Isto precisa ser teste
e não observação de code review porque **elas funcionam**: nada falha,
nenhum teste fica vermelho, e quem clica na própria funcionalidade vê um
diálogo e segue em frente. A falha só aparece na frente de um usuário.

Ele foi verificado ao contrário — pondo um `window.confirm` de volta no
`rooms-panel.tsx` e vendo o teste apontar arquivo e linha.




---

## 34. A porta de entrada: Typebot, n8n e o gclid

O CRM já era um n8n pequeno e ninguém tinha reparado. O motor de
automação tem sete gatilhos, quatro condições, **onze ações** e
interpolação de `{{vars.qualquer_coisa}}`. O que faltava era um jeito de
alguém de fora ENTREGAR essas vars.

`POST /api/hooks/<token>` é essa porta. E `automations.trigger_type` é
`TEXT` sem CHECK, então o gatilho novo não custou migração nenhuma — só
a tabela dos hooks custou.

### O modelo de ameaça define o schema

Uma rota pública que dispara automações consegue acionar `send_message`.
Quem alcançar a URL faz **o número da empresa mandar WhatsApp para
qualquer telefone** — e a consequência não é constrangimento, é a Meta
banir o número. Para uma distribuidora cujo canal comercial é aquele
número, é existencial.

E o risco maior **não é o atacante**. É o laço: um fluxo do n8n com um
`for` mal fechado dispara do IP autorizado, com o token correto, mil
vezes. Toda defesa baseada em "quem é você" deixa passar, porque a
resposta está certa.

Daí as quatro camadas, nesta ordem de importância invertida:

| Camada | Contra o quê |
| ------ | ------------ |
| token com SHA-256 no banco | dump do banco; revogação por hook |
| lista de IPs | a internet — grátis quando as duas pontas são próprias |
| teto de 60/min | **o laço do próprio fluxo** |
| **escopo, aplicado no MOTOR** | tudo acima que passar |

O escopo é o que carrega o peso, e mora deliberadamente **fora da rota**.
A rota sabe qual hook chamou; só `runStep` sabe qual passo vai rodar.
Checar na porta significaria a porta prever toda automação que um admin
possa vir a ligar no gatilho — e errar na primeira vez que alguém
acrescentar um passo.

`messages` fora do padrão é a decisão que faz um token vazado ser
**poluição de dados** — chato, reversível — em vez de um banimento.

### Quatro defeitos, e quem pegou cada um

Vale registrar porque três dos quatro foram achados por testes que já
existiam ou que escrevi antes do código funcionar:

1. **`flattenToVars` estourava em estrutura cíclica.** `JSON.stringify`
   lança, e a rota depende dessa função nunca lançar. Inalcançável pela
   rota — `JSON.parse` não produz ciclo — mas "inalcançável hoje" é
   propriedade do chamador, não da função.
2. **`ipAllowed` normalizava só um lado.** Funcionava porque o chamador
   normalizava antes. Uma função de segurança cuja correção depende do
   chamador é uma que quebra no segundo chamador.
3. **`{{vars.campo}}` no texto da tela.** O `icu-safety.test.ts` pegou:
   o next-intl lê `{` como placeholder ICU e renderizaria o keypath cru.
4. **As chaves do gatilho na forma errada.** O construtor lê
   `triggers.<tipo>.label` e `.hint`, aninhado; eu escrevi plano. **Este
   nenhum teste pega** — a chave é dinâmica, e o `keys-exist` diz no
   próprio comentário que não enxerga `t(\`x.${y}\`)`. Achado lendo.

### Decisões que não são óbvias

- **A rota nunca CRIA contato.** Ela encontra por telefone ou segue sem
  nenhum. Endpoint público que cria linha por chamada é endpoint público
  que enche a base de lixo — o abuso mais barato de uma URL vazada.
  Criar contato é passo de automação, que um admin ligou de propósito.
- **200 em tudo depois do token válido.** Typebot e n8n reenviam em
  não-2xx; devolver 500 por automação falha replicaria o payload a cada
  minuto, e cada réplica rodaria de novo os passos que **deram certo**.
  O que deu errado fica na linha de entrega.
- **404 igual para token errado e hook desligado.** Distinguir diria a
  quem sonda quais tokens são reais. Mas **403 para IP recusado**: ali o
  token estava certo, e quem depura a própria integração precisa
  diferenciar "endereço errado" de "token errado".
- **A entrega é gravada ANTES do trabalho.** O índice único é o que faz
  a segunda tentativa perder a corrida; gravar depois deixaria as duas
  passarem e criar o negócio duas vezes — exatamente o que a chave
  existe para impedir.
- **Retenção de 7 dias.** O payload traz telefone e nome. Guardar
  indefinidamente é criar um banco paralelo de PII que ninguém sabe que
  existe, e é o que a LGPD alcança.


---

## 35. A tela de entregas, e a API que faltava

Três coisas que fecham a decisão "webhook ou n8n" honestamente, porque
antes delas o webhook perdia por falta de visibilidade e a API perdia
por falta de rota.

### A entrega passou a dizer o que causou

A 058 registrava o que chegou e parava aí. A [059](../../supabase/migrations/059_delivery_trace_and_api.sql)
acrescenta `automation_logs.delivery_id`.

**A chave estrangeira aponta do log para a entrega, e não o contrário.**
Uma entrega dispara N automações — todas que escutam `webhook_received`
e passam nas condições. Guardar um array na entrega exigiria que o
dispatch devolvesse os ids (hoje é `Promise<void>`, dentro de `after()`)
e um array crescendo depois da inserção. Do lado do log é muitos-para-um,
escrito quando a linha nasce.

`ON DELETE SET NULL` e nunca CASCADE: a retenção de 7 dias apaga a
entrega, e o registro operacional da automação vive muito mais.

A tela mostra três estados, que são três problemas com três soluções
diferentes:

| O que aparece | O que fazer |
| ------------- | ----------- |
| **Chegou, mas nenhuma automação rodou** | falta automação com o gatilho, ou as condições barraram |
| **Rodou e falhou** | a automação está ligada, um passo quebrou |
| **Rodou e pulou** | `skipped: hook não pode enviar mensagens` — é **configuração**, não defeito |

O terceiro é o que pareceria bug e é ajuste, e ele só aparece porque
`runStep` escreve a frase no resultado do passo.

### A API ganhou as rotas que travavam o caso

Eu tinha dito que não construiria `/v1/deals` "só para viabilizar o
caminho pelo n8n" — e continuo achando errado duplicar as regras do
motor como CRUD. O que mudou é o motivo: agora é para **ler e integrar
de fora**, que é o caso que eu mesmo disse justificar.

| Rota | Por quê |
| ---- | ------- |
| `GET /v1/custom-fields` | o id do campo era impossível de descobrir sem copiar de uma URL do navegador |
| `GET`/`PUT /v1/contacts/{id}/custom-fields` | os valores |
| `GET /v1/pipelines` | de onde vem um `stage_id` |
| `GET`/`POST /v1/deals` | **não existia rota de oportunidade nenhuma** |

Decisões que valem registro:

- **`automation_field_key` é publicado.** `custom:<uuid>` é a string que
  o passo de automação quer; publicá-la significa que ninguém precisa
  saber a codificação, e que mudá-la depois é uma mudança aqui em vez de
  uma no fluxo n8n de todo mundo.
- **PUT que não apaga por omissão.** Campo não citado no corpo fica como
  está. Um PUT literal convidaria a zerar `utm_campaign` ao atualizar
  `gclid`.
- **Id desconhecido é 400 nomeando o id**, não um pulo silencioso. Quem
  não vê o valor aparecer não tem como distinguir "id errado" de
  "gravou mas a tela não mostra".
- **`value` no deal é provisório e o doc diz isso.** A 054 fez o gatilho
  somar os itens; um valor postado vale até alguém acrescentar uma linha.
  É a diferença entre receita rastreável a um produto e receita igual ao
  que a última pessoa digitou.
- **`kind_hint`, não `kind`.** A etapa "ganho" é inferida do NOME
  (`isWonStage`), então uma chamada "Faturado" reporta `open`. Chamar de
  `kind` faria o integrador supor que alguém declarou aquilo.
- **Tenancy checada nas duas referências.** A chave é de uma conta, mas
  `contact_id` e `stage_id` vêm do chamador — e um UUID estrangeiro não
  é algo que a RLS pegue num INSERT cujo próprio `account_id` está certo.


---

## 36. Administração separada, score, repasse e o menu de IA

Cinco pedidos numa leva. Quatro entregues inteiros, o quinto com a
metade que funciona e a ressalva escrita.

### A área de Administração

Configurações tinha crescido para dezoito seções, e não eram dezoito da
mesma coisa. Seis são **suas** — perfil, aparência, e os dois que um
atendente usa no turno. As outras doze são da **conta**: a conexão do
WhatsApp, as chaves de IA, quem pode o quê, como as conversas são
distribuídas.

Misturadas numa lista só, as telas mais perigosas do produto ficavam um
scroll abaixo de "Aparência". Separadas, cada porta responde uma
pergunta — *"como eu quero trabalhar"* e *"como esta conta está
montada"* — e um agente nunca abre uma lista cheia de coisa que não pode
usar.

A divisão mora em `SectionMeta.area`, então mover uma seção é uma flag.
Duas listas mantidas à mão é como Templates foi parar em dois lugares na
0.8.2.

### Score, e por que ele não é uma coluna

Não existe `score` em lugar nenhum do banco. É calculado a cada leitura,
de mensagens e conversas que já existem.

Guardar seria mais rápido e estaria errado dentro de uma hora: um número
gravado envelhece em silêncio, e na primeira vez que a distribuição
mandar tudo para quem foi bom semana passada, ninguém vai saber que a
coluna parou de ser atualizada.

Três decisões que os testes seguram:

- **Mediana, não média.** Uma conversa respondida na segunda depois de
  passar o fim de semana parada são 3.000 minutos: ela leva a média de
  dez respostas de quatro minutos para trezentos, e move a mediana em
  uma posição.
- **Resolver pesa 60%, responder rápido 40%.** Distribuir só por
  velocidade manda tudo para quem responde mais rápido — e o jeito mais
  rápido de responder é dizer alguma coisa, não terminar nada.
- **Empate cai no rodízio, e quem não tem histórico conta como
  mediano.** Sem as duas, o segundo melhor nunca receberia o trabalho
  que o faria melhorar, e um recém-chegado nunca receberia a conversa
  que lhe daria um score.

### Repasse por ausência: três condições, e a terceira é a que importa

Só repassa quando **o cliente está esperando**, **há mais que o limite**,
e **quem tem a conversa sumiu de verdade** (`member_presence`).

Sem a terceira, isto vira "tirar conversa de quem é mais lento" — outra
funcionalidade, que ninguém pediu, e a maneira mais rápida de um roteador
comprar briga com a equipe.

E nunca para outra pessoa também ausente: passar de um ausente para
outro é movimento sem progresso, e como reinicia o relógio, a mesma
conversa ficaria quicando pela equipe a noite toda.

Zero é o padrão. Mover trabalho entre pessoas sem ninguém pedir é decisão
da equipe, não comportamento a herdar.

### O menu de IA no clique direito

A barra tinha uma estrela ligada direto em "sugerir resposta", e a conta
tem quatro funções de IA agora. Virou menu, e o menu só oferece o que se
aplica à mensagem sob o cursor — um áudio não tem o que descrever.

Junto veio `POST /api/ai/understand`, que fecha um buraco real: a leitura
de mídia só rodava na chegada, então tudo anterior ao dia em que a conta
ligou o recurso não tinha transcrição **e não tinha como ter**.

O `menu-label-group.test.ts` pegou um crash meu aqui — `DropdownMenuLabel`
fora de um grupo faz o Base UI lançar em render, e a rota inteira vai para
o error boundary. Não é aviso.

### Permissões: a metade que funciona, e a armadilha

A matriz saiu do código (`role_capabilities`), com três camadas —
produto, conta, pessoa — e uma que não se move: **uma capacidade
protegida por RLS só pode ser ESTREITADA aqui.** Conceder `inbox.view` a
quem o banco recusa desenharia uma tela que não carrega nada, e a pessoa
culparia a si mesma.

Sobre criar permissões novas, a ressalva que a tela precisa dizer com
todas as letras: **uma permissão que nada consulta não faz nada.** Criar
`desconto.acima_de_10` não faz aparecer controle de desconto nem impede
ninguém de dar desconto — cria uma chave que responde sim ou não a quem
perguntar, e por enquanto ninguém pergunta. Vale para quem for escrever
um controle novo (a chave já existe, sem migração) e para a API pública.
Fora isso é rótulo.

**Falta a tela dessa parte** — a migração, o resolvedor e os doze testes
estão prontos; o painel não.

## 37. O botão direito, Contatos, as rotas que não iam a lugar nenhum, e o período livre

Quatro dos nove pontos da última lista, e um quinto pela metade.

### O botão direito não abria menu nenhum

O relato: *"botão direito não tá funcional em cima das mensagens com as
ações, ele só aparece o hover em cima sem poder selecionar."*

O mecanismo explica exatamente isso. `MessageActions` fazia à mão:
`onContextMenu` → `preventDefault()` → um `touchOpen` que prendia a
barra de hover visível. **A tecla nunca abriu um menu.** Ela revelava um
alvo — uma fita de círculos de 20px — que ainda tinha que ser acertado,
e o `onBlur` do mesmo elemento (que é `focusout`, e sobe na árvore)
podia guardar a fita de volta no caminho até lá.

Um clique direito que revela um alvo em vez de oferecer uma escolha não
é um menu de contexto. Agora é um: o mesmo primitivo que a lista de
conversas e os cards do funil já usavam — com a ancoragem no cursor e a
correção de zoom que aqueles precisaram — então os três gestos do
produto se comportam igual.

Levou o toque junto. O `touchOpen` sumiu: o Base UI já trata o
pressionar-e-segurar, e assim os dois deixam de brigar pelo mesmo evento
`contextmenu`. **O menu carrega tudo** (reagir, responder, copiar, IA); a
barra de hover repete os três que valem um clique só no desktop.

As opções de IA são renderizadas uma vez e passadas por qualquer um dos
dois primitivos, do jeito que o `conversation-menu.tsx` já fazia —
escrever duas vezes garantiria que divergissem.

> Uma armadilha que eu mesmo criei e o typecheck não pegaria: o menu e a
> barra chamavam o hook cada um, então o `busy` do spinner do gatilho não
> era o `busy` do item que o liga. A engrenagem nunca giraria.

### Clientes → Contatos

A rota e o namespace **já eram `contacts`**; só o texto pt-BR dizia
Clientes. 97 strings.

A regra, que é o motivo do pedido: **onde o texto nomeia o registro ou a
seção vira "contato"; onde nomeia a pessoa da conversa continua
"cliente".** Nem todo mundo na lista é cliente — é por isso que a seção
mudou de nome. Manter "cliente" para quem está sendo atendido não é
inconsistência, é a distinção que a renomeação existe para fazer.

Então: "Novo contato", "Importar contatos", "Campo do contato",
"Etiquetar contato". E segue: "Sem mensagens do cliente", "Nada escrito
aqui chega no cliente", "O cliente toca num botão".

### Seis links que iam para o lugar errado, em silêncio

A separação Administração levou doze seções para `/admin` e deixou seis
links apontando para a porta antiga: o WhatsApp na tela de notificações,
o mesmo no sino, o "Ferramentas de IA" do assistente, dois "voltar para o
agente" e uma nota de versão.

**Nenhum dava 404.** Os seis resolviam para o Overview, em silêncio, com
a URL ainda dizendo a seção que a pessoa pediu. É a pior forma que um
link quebrado pode ter, porque nada em lugar nenhum diz que quebrou.

Três coisas:

- `sectionHref('whatsapp')` não tem como estar errado — lê a mesma tabela
  que decide onde a seção mora, e mover uma seção move os links dela.
- `/settings?tab=<seção de admin>` agora **redireciona** em vez de trocar
  a seção e continuar. O simétrico também: `/admin?tab=aparencia` vai
  para Configurações, e `/admin?tab=tags` finalmente resolve o valor
  legado em vez de mostrar WhatsApp.
- `section-links.test.ts` quebra o build no próximo link escrito à mão
  que discorde do registro. Ele ignora comentários — a prosa fala desses
  links o tempo todo, e um teste que não distingue um link de uma frase
  sobre um link obriga todo mundo a escrever comentários piores.

### Período livre nos relatórios

*"falta uma opção para selecionar período específico para análise."*

Os três presets contam para trás a partir de hoje. Eles respondem "como
estamos indo ultimamente" e **não têm como responder "como foi julho"** —
um quarto preset (180? 365?) não resolveria, porque a pergunta não é
quão longe, é QUAL janela.

Então o período virou dois instantes. Três coisas caíram fora junto:

- **`to` é exclusivo.** "1 a 31 de julho" escrito fechado (`<= 31/07`)
  descarta tudo que aconteceu no dia 31 depois da meia-noite, que é o dia
  31. Toda fronteira aqui é semiaberta.
- **A comparação continua sendo de igual duração**, medida em tempo
  decorrido e nunca em dias de calendário — a janela do preset termina
  AGORA, então às nove da manhã "30 dias" são 29 dias e duas horas, e
  comparar contra 30 dias inteiros reportaria uma queda de dois dígitos
  feita só do relógio. A regra já existia; mudou de lugar para a janela
  escolhida à mão ganhar de graça.
- **A busca de mensagens agora pagina.** O PostgREST corta a resposta em
  `db-max-rows` e **não avisa** — a requisição tem sucesso e o array vem
  curto. Com 7 dias isso nunca mordeu; com os 366 que o período livre
  permite, uma conta movimentada perderia a maior parte do tráfego e o
  gráfico desenharia uma linha crível e errada.

O `TeamPerformance` foi junto: recebia um número de dias, que só sabe
dizer "terminando agora". Pedir julho teria pontuado a equipe pelos
últimos 31 dias, e o número pareceria perfeitamente razoável.

### A barra de cima, medida

*"barra em cima tá com desperdício de espaço."*

O controle foi para a linha do título, onde o espaço vazio já estava. Aí
apareceu o problema de verdade, que não era desta página: o bloco do
título era `min-w-0 flex-1` e as ações `shrink-0`, então **o título
encolhia até sumir em vez de as ações quebrarem a linha.**

Medido no viewport real, com o controle de período no slot:

| viewport | cabeçalho | largura do título |
|---|---|---|
| 390px | 208px → **134px** | 53px → **358px** |
| 360px | 248px → **154px** | 23px → **328px** |
| 768px e acima | 88px, sem mudança | sem mudança |

A 390px a descrição virava sete linhas de uma palavra cada. `max-sm:basis-full`
dá ao título a linha dele e empurra as ações para baixo, alinhadas à
direita — e vale para toda página com ações, não só esta.

### O que não fechei

**As cores das etiquetas no light.** Medi os tokens no navegador: o chip
está fraco nos dois modos (1.14:1 no light contra o card, 1.09:1 no dark)
e o texto está legível em ambos (7.02:1 e 9.26:1). A matemática do
`stageChip` está certa nas duas superfícies, e o único lugar que usa chip
preenchido é a lista de conversas. **Não achei nada que quebre só no
light** — preciso ver a tela de novo.

## 38. A porta dupla desfeita: Configurações volta a ser uma só

*"não gostei muito da área de administrador e configurações, pode juntar
tudo em uma só e dps o tipo de usuário limita o que vai ver de acordo com
as permissões."*

O §36 tinha separado em duas: `/settings` para o que é seu, `/admin` para
a estrutura da conta. O raciocínio estava certo — dezoito seções não são
dezoito da mesma coisa, e as telas mais perigosas do produto ficavam uma
rolagem abaixo de "Aparência".

O raciocínio estava certo e **a resposta estava errada**, porque resolveu
um problema de VISIBILIDADE com um de LOCALIZAÇÃO. Duas portas significa
que alguém precisa saber atrás de qual porta um ajuste está antes de
poder procurá-lo, e a resposta ("isso é sobre você ou sobre a empresa?")
só é óbvia para quem desenhou a linha. Templates são seus; quem pode
aprovar um é da empresa. Mesma tela.

Uma porta, e a permissão decide as linhas.

### O gate é uma capacidade, não um papel — com um limite

Cada seção declara a capacidade que a torna visível. Papel é fixo;
capacidade passa por `permission_overrides` e pela matriz da conta, então
dá para abrir uma seção para uma pessoa pelo Acesso em vez de promover
alguém a admin e entregar todo o resto junto.

**E aqui o teste que eu escrevi me corrigiu.** Eu tinha afirmado, no
comentário do próprio registro, que uma conta podia entregar a conexão do
WhatsApp a um atendente por override. Não pode: `settings.manage` é
`rlsBacked`, e `can()` **recusa alargar** uma capacidade que o banco
também protege. Honrar a concessão desenharia uma tela de WhatsApp que
carrega e depois falha ao salvar, e a pessoa culparia a si mesma.

Então a verdade é mais estreita e está escrita: para as onze seções atrás
de `settings.manage` o gate é "admin para cima" na prática, porque a
policy diz o mesmo. `audit.view` **não** é rls-backed — por isso Acesso é
a seção que realmente pode ser entregue a uma pessoa. As duas metades
estão fixadas em teste, para ninguém "consertar" o registro prometendo
uma flexibilidade que o banco não vai honrar.

Quem vê o quê, hoje:

| papel | seções |
|---|---|
| dono / admin | 18 |
| atendente | 7, e todas funcionam |
| leitor | as 7 não-restritas |

### Quatro grupos, porque quinze linhas não são uma estrutura

"Espaço de trabalho" com quinze linhas é uma lista que se lê procurando
uma palavra. O corte é a costura que já existia no array: **Atendimento**
(o que sai para o cliente — WhatsApp, templates, respostas rápidas,
agente, ferramentas, atribuição, salas) e **Espaço de trabalho** (o que dá
forma à conta — campos, negócios, equipe, acesso, webhooks, API,
novidades).

`whats-new` voltou a ser de todo mundo. Ficou restrito a admin durante o
release em que a divisão existiu, o que significava que um atendente
nunca ficava sabendo o que tinha mudado no produto que ele usa o dia
inteiro. Não configura nada.

### O trilho precisou saber rolar

De doze linhas para dezoito em quatro grupos. Medido: **796px**, a 36px
por linha mais três cabeçalhos de grupo — num viewport de 800px sobram
quatro pixels, antes do respiro de 24px do topo. Ou seja: em laptop
nenhum cabe.

E um `sticky` mais alto que o viewport **deixa de ser sticky em silêncio**
— passa a rolar junto com a página. O topo do trilho sumiria enquanto
você estivesse no fundo de um painel, sem volta a não ser rolando a
página inteira. Agora tem teto e rola sozinho: caixa de 736px, conteúdo
de 796px, última linha alcançável, e nenhuma barra horizontal fantasma
(`overflow-x-hidden` explícito — `visible` num eixo com o outro não-visible
computa para `auto`).

O `scrollIntoView` da linha ativa deixou de pular o desktop pelo mesmo
motivo: `?tab=whats-new` é a última, e abriria fora de vista.

### E as tiles do Overview

Quatro das seis (WhatsApp, equipe, negócios, campos) estão atrás de
`settings.manage`. Sem filtro, a página inicial de um atendente seria
majoritariamente porta que não abre — exatamente o que a fusão existe
para evitar.

### `/admin` não é mais uma rota

Virou `redirects()` no `next.config.ts`, ao lado do `/agents`: resolve no
passo 2 do roteamento do Next, antes do middleware no passo 3, então um
favorito nunca sobe a casca do dashboard só para jogá-la fora um frame
depois. A query vem junto — `/admin?tab=whatsapp` cai na seção certa.
Verificado: 307 com `location: /settings?tab=whatsapp`.

O `middleware.test.ts` pegou a entrada órfã em `PROTECTED_PATHS` sozinho,
que é para isso que ele existe.

## 39. Revisão das mudanças: sete defeitos, três deles meus por escrito

Passada de revisão sobre o §37 e o §38, a pedido. Sete, em ordem de gravidade.

### 1. Paginar sem `ORDER BY` corrompe o número

`loadConversationsPrevious` ganhou `.range()` no §37 e **não ganhou
`.order()`**. `range()` é OFFSET/LIMIT, e o Postgres não promete ordem
alguma sem `ORDER BY` — duas páginas de uma consulta não ordenada podem
repetir uma linha e pular outra.

Essa função **conta** linhas, e a contagem é a base contra a qual o
`+12%` da legenda é calculado. Ou seja: não é ordem errada, é número
errado. Só acima de mil linhas na janela de comparação, e completamente
invisível quando acontecia.

O mock do teste agora grava a ordenação e afirma.

### 2. O teto de páginas devolvia curto, em silêncio

`MAX_PAGES = 40` saía do laço e retornava o que tinha. Isso é
exatamente o defeito que a paginação existe para remover, mudado de 1.000
para 40.000 linhas.

O paginador foi para `lib/supabase/paged.ts` e **lança** no teto. A
página captura e diz uma frase que a pessoa pode usar: "período grande
demais para somar aqui, escolha uma janela menor" — que é verdade,
enquanto um gráfico faltando quatro quintos dos dados não é.

### 3. `loadTeamPerformance` ficou sem paginação nenhuma

Eu abri a janela dela de 30 dias fixos para qualquer período de até 366
dias e **deixei a consulta de mensagens sem paginar**. Trunca no teto do
PostgREST e o score sai calculado sobre uma amostra parcial, sem aviso.

O mesmo defeito que eu tinha acabado de corrigir no arquivo ao lado, no
arquivo que eu editei para aceitar a janela maior.

### 4. As duas metades do score cobriam janelas diferentes

A consulta de conversas **não tinha filtro de data nenhum**. Então
`handled`/`closed` eram totais de sempre, enquanto a mediana de resposta
era do período. Escolher julho e escolher os últimos sete dias dava a
mesma taxa de resolução.

E o §37 piorou isso: o subtítulo do painel passou a dizer "De 1 jul a 31
jul" — uma afirmação precisa sobre números que ignoravam o período.

A coorte agora são as conversas que **começaram** na janela. Carrega o
viés usual de coorte (uma aberta no último dia não teve tempo de fechar),
que é uma forma conhecida e explicável. Um número de sempre sob um título
de julho não é. `closed_at` permitiria a outra definição e a coluna não
existe.

### 5. `access` estava atrás de uma permissão que a tela não honra

Minha. Escrita no comentário do registro **e** afirmada num teste que
passava.

Eu gatei Acesso em `audit.view` com a teoria de que, por não ser
rls-backed, a seção poderia ser entregue a uma pessoa. Não pode:
`AccessPanel` recusa qualquer um abaixo de admin por conta própria, e
`/api/account/audit` chama `requireRole('admin')`. A concessão produzia
uma linha no trilho que abria "Acesso restrito" — exatamente o que o
desenho diz para nunca desenhar.

O teste passava porque testava o registro, não a tela.

Agora está em `settings.manage`, e o teste varre **todas** as capacidades
afirmando que nenhuma abre uma seção — em vez de uma só, que foi como o
caso passou. O que a capacidade compra de verdade está escrito: só a
direção de **tirar** (uma conta pode esconder as chaves de IA dos
próprios admins), nunca a de dar.

### 6. Construí `ready` para isso e não usei

`useCapabilityCheck` devolve `ready` justamente porque todo gate responde
`false` enquanto o perfil carrega. O trilho e as tiles do Overview
desestruturavam só o `can`: um admin via sete linhas e depois as outras
onze aparecerem — um trilho que muda de tamanho sob o cursor.

### 7. Texto apontando para uma área deletada

`Inbox.aiMenu.errorDisabled`, nos três idiomas: "Ligue em **Administração**
› Ferramentas de IA". A Administração deixou de existir no §38.

### E uma que não era das mudanças novas

Nenhuma das seis cargas do Relatórios tinha `.catch`. Qualquer rejeição
deixava o `…Loading` em `true` para sempre — esqueleto que nunca resolve,
promise rejeitada solta no console, e nada na tela. Com o teto do item 2
passando a lançar, isso deixou de ser teórico.

---

## 40. O celular: o menu duplicado, o orçamento de tela, e o app que dá para instalar

**Pedido:** *"revisão da forma atual que ta configurado o mobile... o
botão de menu está duplicado no mobile... precisa focar em usabilidade
agil e fácil... que seja possivel ele funcionar como um aplicativo mesmo
que acessando via navegador em tela full screen ou permitindo baixar no
iphone ele como atalho"*

O alicerce já estava bom — a passagem 0.8.4 resolveu isso nos §24 e §30.
O que faltava eram três coisas de natureza diferente.

### O menu duplicado, e por que era 100% redundante

Os dois botões chamavam o mesmo `setSidebarOpen(true)`, com o mesmo ícone
`Menu` do lucide, no mesmo `lg:hidden`. E — a parte que fecha o caso — os
dois somem sob a **condição idêntica** (`insideThread`): o cabeçalho por
`insideThread && 'hidden'` no `app-chrome.tsx`, a barra por
`if (insideThread) return null`. Não existia uma rota no app inteiro em
que o hambúrguer fosse a única saída para a navegação.

O comentário que estava lá dizia que ele era "a ÚNICA maneira de voltar à
navegação num telefone". Era verdade até a barra de abas entrar no §30, e
ninguém voltou para apagar a frase — um comentário descrevendo um app que
não existe mais. Removido, junto com a prop `onOpenSidebar` (o `Header`
não recebe mais nada) e a chave morta `Header.openMenu` nos três idiomas.

Os 44px voltam para o título da página, que agora começa na margem
esquerda da barra como em qualquer app nativo. O seletor de tema saiu
junto (`hidden lg:inline-flex`): é uma decisão que se toma uma vez na
vida do aparelho e já mora em Configurações › Aparência, e estava
ocupando um dos quatro lugares permanentes que a barra tem no celular.

### O orçamento de 812 pixels

Três telas gastavam a primeira tela inteira antes de dizer alguma coisa.

**Visão Geral** — quatro atalhos de 68px empilhados, mais os vãos: 320px
de "criar alguma coisa" no topo de uma tela cujo próprio subtítulo promete
dizer o que depende de uma pessoa hoje. Viraram uma **barra**: ícone sobre
rótulo, uma linha, ~80px. `flex-1 basis-0` com um piso de 76px — a 375px
os quatro dividem a linha exatamente e nada rola; a 320px eles estouram o
piso e a linha rola com `snap-x`. Devolve ~240px.

**Contatos** — o painel de segmentação, sempre aberto, é uma coluna de
cinco controles rotulados (~350px) mais "Criar campanha com este público",
entre o título e todo o resto. A primeira linha da tabela caía na borda de
baixo: uma página chamada Contatos que não mostrava contato nenhum sem
rolar. A busca subiu para logo abaixo do título e o painel desceu,
**fechado abaixo de `lg`**, atrás de um botão com o contador de filtros
ativos (`countSegmentationFilters`, novo em `segmentation.ts`, e
`isSegmentationActive` agora é derivado dele). Nada é condicional em JS —
só a visibilidade muda, então abrir não custa consulta nenhuma e fechar
nunca descarta um filtro em silêncio.

**Atendimento** — quatro faixas empilhadas antes da primeira conversa. A
busca e a linha do filtro dividem uma linha só no celular
(`lg:flex-col lg:items-stretch` devolve o desenho de mesa intacto), e a
contagem corrida sai do celular: a barra Entrada/Esperando logo acima já
carrega uma contagem por aba.

### O cabeçalho da conversa, que passava fome de largura

No print: **"Marcos Al…"**. A conta em 390px: voltar 36 + avatar 36 +
pílula da janela 76 + chip do responsável 112 + menu 28 + gutters 24 +
vãos 32 = **344px**. Sobravam 46 para o nome. E a distribuição estava
invertida — 112px para o nome de quem **já** atende, 46 para o nome de
quem você **está** atendendo.

Abaixo de `sm` os dois encolhem: a pílula perde as palavras e fica o
cadeado na cor (`aria-label` carrega o texto para quem usa leitor), e o
chip do responsável vira um disco de 28px com as iniciais — ou o
`UserPlus` âmbar quando ninguém assumiu, que é onde o âmbar sempre foi o
recado de verdade. Sobram ~159px para o nome, contra 46.

### App de verdade

Não havia **nenhuma** peça de PWA: `/manifest.json` e
`/manifest.webmanifest` davam 404, nenhum `apple-touch-icon`, nenhum
`apple-mobile-web-app-capable`, `display-mode` nunca `standalone`. No
iPhone o "Adicionar à Tela de Início" produzia um favorito que abria
dentro do Safari com ~110px de barra; no Android o Chrome nem oferecia
instalar, porque ele exige manifest com ícone de 192 **e** de 512.

Entraram:

- **`src/app/manifest.ts`** — `display: 'standalone'`,
  `start_url: '/dashboard'` (e não `/`, que custa um redirect em todo
  arranque frio), `scope`, `orientation: 'portrait'`, `lang: 'pt-BR'`.
  `background_color` é o fundo **claro** do app e não o navy da marca: ele
  pinta o splash, então é uma promessa sobre o que aparece a seguir.
- **`scripts/generate-app-icons.mjs`** — 192, 512, maskable 512 e o
  `apple-icon.png` de 180, rasterizados da mesma marca do `icon.tsx` via
  sharp. Arquivos e não rotas `next/og`: as convenções de metadata
  publicam URL com hash, e um manifest precisa nomear caminho literal. O
  maskable é um arquivo **separado** com a arte a 56% — declarar o
  full-bleed como maskable é o que raspa as pontas das setas num launcher
  Android.
- **`metadata.appleWebApp`** mais o `apple-mobile-web-app-capable` legado
  em `other` (esta versão do Next emite só o nome moderno; conferido no
  `metadata.js`).
- **Uma descoberta que custou uma rodada:** declarar `metadata.icons`
  **desliga** as convenções de arquivo. O `apple-icon.png` era servido em
  `/apple-icon.png` mas nenhum `<link rel="apple-touch-icon">` chegava ao
  head, porque o objeto `icons` já estava lá. Agora os dois estão
  declarados.
- **`theme-color` amarrado ao `data-mode`**, não ao sistema. Ele estava em
  duas entradas por `prefers-color-scheme` — a preferência do SO —
  enquanto o modo do app é `localStorage`, padrão claro, sem opção "seguir
  o sistema". O caso comum (aparelho no escuro, app no claro) pintava a
  barra de status de `#0f1115` sobre uma interface branca. Saiu do
  `viewport` e passou a ser escrito pelo boot script junto com o
  `data-mode`, e reescrito pelo `use-theme` a cada troca — uma tag só, ou
  o navegador honraria a primeira, que seria a estática.
- **`InstallAppCard`** em Configurações › Aparência, com três respostas:
  botão nativo no Chrome, a instrução Compartilhar → Adicionar à Tela de
  Início no Safari do iPhone, e **nada** em navegador que não faça nem uma
  coisa nem outra. O `beforeinstallprompt` é capturado no boot script e
  não num efeito: ele dispara uma vez, logo depois do manifest ser lido,
  muito antes de alguém navegar até essa seção.
- **Insets** — `pb-safe-3` no rodapé da gaveta (o "Sair" ficava embaixo do
  gesto de home; o app é `overflow: hidden`, então o navegador nunca rola
  isso para fora do caminho) e `min-h-14 pt-safe-0` no cabeçalho e na
  faixa da marca. Em aba de navegador o inset é 0 e a geometria é a mesma
  de sempre; instalado, não há barra de endereço segurando o notch.

### Higiene de toque, em regra e não em call site

O escudo `::before` sob `pointer: coarse` cobria quatro slots. Faltavam
dois, e um deles não podia usar o escudo:

- **`[data-slot='option-select']`** — o `OptionSelect` renderiza um
  `SelectTrigger` mas **sobrescreve** o `data-slot` com o próprio nome, e
  a regra que apontava para o nome antigo ficou para trás. Todo select do
  painel de segmentação era um alvo de 32px ao lado de um botão de 44.
- **`input` e `textarea` não podem usar o escudo.** `<input>` é elemento
  substituído: não tem caixa de conteúdo gerado, então `::before` nunca
  renderiza. Adicionar `[data-slot='input']` à lista pareceria conserto e
  não faria nada — vale escrever isso, porque é exatamente o que a forma
  da regra convida a fazer. Eles crescem de verdade, com
  `min-height: 2.75rem`, que ganha do `height` que os componentes
  declaram: uma regra levanta os 143 usos de `<Input>` sem tocar em
  nenhum. Os selects vêm junto de propósito — 44 ao lado de 32 na mesma
  linha de formulário lê como desalinhado.

E os dois tells de "isto é um site": `-webkit-tap-highlight-color:
transparent` (o retângulo cinza do Android ignora todo `rounded-lg` do
desenho; na barra de abas é um bloco de 94×56 sobre um ícone) e
`select-none` **só na moldura** — barra de abas, barra do app, trilho —
nunca no conteúdo, que precisa continuar copiável.

Das 26 sobrescritas `[@media(pointer:coarse)]` escritas à mão, **duas**
eram redundantes de fato e saíram: o único `<Input>` do app que lembrava
de crescer sozinho, e um escudo `pointer-coarse:before:` reimplementado à
mão em `automations/page.tsx` cujo comentário dizia que a regra central
"não cobre menu trigger" — verdade quando foi escrito, e a lista cresceu
desde então. As outras crescem o **desenho**, não a área de toque, e
continuam sendo decisões.

### Um fato, um lugar

- `sessionTimer.expired` era **"Fechada"** — colidindo com
  `statusClosed: "Encerrada"` a dois centímetros dela. Virou **"Janela
  fechada"**. No celular a pílula nem mostra o texto (acima), então
  sobrava o cadeado e um `title=` que num aparelho de toque não abre
  nunca.
- Com a janela fechada, uma tela de 375px carregava **três** enunciados do
  mesmo fato: a pílula, a tarja no meio da conversa e o placeholder do
  compositor. A tarja virou `hidden sm:flex`. O compositor é o que fica —
  é onde a pessoa vai bater na parede, já se explica no momento da
  tentativa, e o `+` dele alcança os templates (o item está
  `disabled={readOnly}`, não `inputsDisabled`, então segue vivo com a
  janela fechada).
- **Configurações** tinha dois índices completos das mesmas 18 seções
  empilhados num telefone: o trilho de chips e a própria "Visão geral",
  que é uma lista de cartões para as mesmas seções. Abaixo de `lg` o
  trilho se recolhe **enquanto você está na Visão geral** e volta assim
  que uma seção abre — onde ele deixa de ser duplicata e vira o caminho
  entre seções.

### Gestos na lista de conversas

`SwipeRow`: esquerda oculta, direita marca como não lida. As duas são
reversíveis; estacionar, atribuir e apagar continuam no menu, porque nada
atrás de um gesto pode ser irreversível nem envolver uma escolha.

`touch-action: pan-y` é toda a história de segurança, e é **declarado** em
vez de calculado: o navegador fica com o eixo vertical e só entrega o
horizontal. Um dedo que desce rola a lista e este código nunca o vê — sem
limiar para calibrar, sem corrida com `preventDefault`, e sem chance de
uma lista que não rola porque uma linha achou que o arrasto era dela.

Dois detalhes que decidem se funciona:

1. **Dentro do `ContextMenu`, não em volta.** O `ContextMenuTrigger`
   renderiza o filho como a coisa que se pressiona; envolver o menu
   deixaria a camada de swipe fora do trigger e o toque longo pararia de
   alcançar a linha. Aninhado assim os dois gestos dividem um elemento e
   nunca disputam — um toque que **move** é swipe, um que não move é toque
   longo.
2. **O clique depois do swipe é engolido.** A linha embaixo é um
   `<button>`, e uma sequência de ponteiro que se move ainda termina em
   `click`. Sem isso o gesto funcionava **e** abria a conversa: você
   ocultava a thread e caía dentro dela. `onClickCapture` na fase de
   captura, senão a conversa já abriu.

Os limiares e as regras de direção estão em `swipe-row-logic.ts`, sem DOM,
com **15 testes**. O ambiente de teste deste projeto é `node` sem jsdom,
então uma regra que mora dentro de um handler é uma regra que não pode ser
testada — e é justamente a metade que erra em silêncio (um off-by-one no
limiar, uma direção que continua viva depois que a conta perde escrita). A
permissão é conferida **de novo** ao soltar: entre o dedo mover e o dedo
levantar cabe um patch de realtime.

### Medido

`npm run build` limpo, 1443 testes passando (15 novos). No navegador a
375×812: `/manifest.webmanifest` servido com os três ícones em 200,
`<link rel="apple-touch-icon">` no head, **uma** tag `theme-color` que
acompanha o `data-mode` (`#f5f6f7` no claro, `#0f1115` no escuro), campo
de texto a 44px sob ponteiro grosso, e nenhum overflow horizontal.

**Não verificado em aparelho físico.** Duas coisas só o hardware responde:
o `beforeinstallprompt` não dispara no navegador embutido desta sessão
(critério de engajamento do Chrome), e o gesto de swipe não foi tocado por
um dedo de verdade — a lógica está testada, a mecânica não.
