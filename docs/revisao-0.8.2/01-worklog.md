# Worklog

Cada mudança, agrupada pelo pedido que a causou. Índice e os outros
documentos: [00-README.md](00-README.md).

---

## 1. O modelo de estado da conversa

> _"Cliente não está saindo do 'esperando' quando responde. E não tem opção de
> tirar cliente do 'esperando' manualmente."_

Três relatos, uma regra, e uma leitura errada minha no meio do caminho — a
história completa está no [02-bugs.md §1](02-bugs.md).

**Novo:** `Scope` passou a ler `status` em vez de `assigned_agent_id`. Entrada
é `open`, Esperando é `pending`. "Sem responsável" desceu para o menu Filtrar,
que é onde sempre pertenceu: numa caixa compartilhada "quem tem isto" é uma
pergunta real, só não é a mesma pergunta que "isto está terminado".

**Renomeado:** `reopenClosedConversation` → `markWaitingOnInbound`. O nome
antigo descrevia o caso da issue #409; o novo descreve a regra.

**Novo:** `answeredPatch()`, aplicado em `send-message.ts` — o caminho da
resposta humana. Dobrado dentro do `UPDATE` que já acontecia para
`last_message_text`, porque é o caminho quente de apertar Enter.

**A aba Esperando ordena do mais antigo para o mais novo**, e é a única que faz
isso. Em todo lugar "mais recente primeiro" está certo porque a mensagem nova é
a que alguém precisa responder. Numa fila parada o item novo é o que **menos**
precisa de atenção — foi parado há um minuto — e a conversa que ninguém olha
desde terça é a razão inteira de a aba existir. Ordenar por mais recente
enterraria exatamente a linha para a qual a aba serve.

`conversations.waiting_since` (045) é o que torna isso possível, e é carimbado
só na **entrada**: um cliente que manda quatro mensagens está esperando desde a
primeira, e recarimbar a cada uma faria a conversa mais negligenciada parecer a
mais fresca.

---

## 2. Ações na conversa

> _"E não tem opção de tirar cliente do esperando manualmente. Opção de excluir
> chat."_

A linha da lista era um `<button>` puro: clicar abre, e esse era o vocabulário
inteiro.

**Novo:** `components/inbox/conversation-menu.tsx`, irmão do
`deal-context-menu.tsx` — mesma primitiva, mesmo formato, mesmo gating. Um card
do funil e uma linha da caixa de entrada são o mesmo tipo de objeto: uma coisa
numa lista sobre a qual você quer agir enquanto olha a lista.

**Dois gatilhos, um menu.** Botão direito é o gesto do desktop e não existe no
celular, que é onde isto mais falta — o cabeçalho da conversa não tem espaço
para estes controles a 390px. Os mesmos itens renderizam sob um `⋯`, e o
`variant` escolhe qual. Escrever duas vezes garantiria que divergissem.

| Item | Nota |
| ---- | ---- |
| Mover para Entrada / Esperando / Finalizar | Três destinos com o atual marcado, não um alternador — "marcar como esperando" sem volta era metade do relato |
| Marcar como não lida | Desabilitado quando já tem contador. Fecha a conversa aberta — ver [02-bugs.md §15](02-bugs.md) |
| Atribuir a… | Entrega para o fluxo que já existe |
| Ocultar / Mostrar | O item 3 abaixo |
| Excluir | Só admin, e a trava real é a RLS |

---

## 3. Ocultar, que é a resposta que faltava para "excluir chat"

`conversations.hidden_at` / `hidden_by` (045).

Some das listas sem apagar nada, e **volta sozinha quando o cliente escreve** —
o mesmo `markWaitingOnInbound` limpa o campo. Essa promessa é o que torna
ocultar seguro de usar sem pensar: se ela dependesse de alguém lembrar,
ninguém ocultaria nada.

Excluir continua existindo para o que ocultar não resolve — uma conversa de
teste, um número errado, um pedido de apagamento — e virou ato de admin.
Migração 045 aperta a política `conversations_delete`, que a 017 tinha aberto
para `agent`.

**Isso tem que estar na política, não só na interface.** Enviar uma mensagem e
destruir a conversa inteira com todas as mensagens dela não são atos
comparáveis, e um item de menu escondido é uma sugestão — o PostgREST é
alcançável com o token de qualquer sessão logada. O diálogo pede o nome do
contato digitado: um botão de confirmar embaixo do ponteiro que acabou de abrir
o menu é um botão que se aperta por reflexo.

---

## 4. Atribuição automática

> _"Criar atribuição de conversa automática"_

O passo `assign_conversation` já oferecia um modo `round_robin` desde que o
motor de automações foi escrito. **O modo era mentira:** lia
`profiles ... limit(1)` e entregava toda conversa para quem voltasse primeiro,
para sempre. O comentário no `engine.ts` admitia isso em tantas palavras.

**Novo:** `lib/conversations/auto-assign.ts`. O cursor mora em
`accounts.auto_assign_cursor` (045) — é o que faz de uma rotação uma rotação;
sem lugar para lembrar quem pegou a última, todo despacho recomeça do início,
que é exatamente o bug.

**O cursor é o vencedor anterior, não um índice.** Membros entram e saem, e um
índice numa lista que mudou de tamanho silenciosamente entrega três conversas
seguidas para a mesma pessoa. Retomar "depois de quem pegou a última" sobrevive
à lista mudar, e degrada para "começa do topo" quando essa pessoa não está mais
lá — que é correto, não meramente seguro.

**Presença é o ponto.** Uma rotação que ignora quem está na mesa é pior que
nenhuma: pega um cliente esperando e arquiva sob alguém que foi embora, que é
como uma conversa termina com dono e sem resposta — invisível na fila de sem
responsável justamente por ter dono. Usa o mesmo `derivePresence` que os
avatares do cabeçalho usam, para que o que a interface mostra e o que o
roteador acredita não possam discordar.

Com ninguém online, roda entre todos em vez de desistir. Fora do horário a
escolha é entre um dono que verá de manhã e nenhum dono, e um nome na conversa
é o mais útil dos dois.

**Interface:** um interruptor em Ajustes › Equipe. Desligado por padrão — um
CRM que começa a rotear conversas sozinho no dia em que é instalado é um CRM em
que a equipe para de confiar.

---

## 5. O nome do cliente, a ocorrência, e a foto

Três coisas sobre o mesmo objeto.

**Nome** ([02-bugs.md §5](02-bugs.md)) — `contacts.name_source` (045), e
`withManualName` em todos os caminhos que uma pessoa usa.

**Ocorrência** ([02-bugs.md §6](02-bugs.md)) — `hasOccurrence()` passou a ler
`contacts.occurrence_count`, mantido por gatilho desde a 042. A etiqueta
`Possui Ocorrência` sobrevive só como reserva; **não escreva nela**.

**Foto** — metade já existia e ninguém via: `contacts.avatar_url` estava no
schema e no tipo, e duas telas já a desenhavam quando existia. Faltava
qualquer lugar para colocar uma. `contact-avatar-field.tsx` no formulário, e o
avatar da sidebar virou o caminho para lá — uma foto com um "escolher arquivo"
ao lado são duas coisas para entender onde há uma coisa para fazer.

Sobre o balde escolhido e sobre "manual por enquanto" ser manual e ponto: ver
[03-decisoes.md §7](03-decisoes.md).

---

## 6. A sala da equipe

> _"Criação de aba minha equipe, uma conversa apenas para equipe Plastfortsul"_

`team_messages` (046), uma sala por conta.

Toda conversa neste CRM é com alguém de fora da empresa. Nunca houve lugar para
as pessoas **de dentro** dizerem algo umas às outras — então "o Cleiton ligou,
vai buscar amanhã" é dito no WhatsApp, num celular, e a resposta volta num lugar
que o CRM nunca vai ver. O que se perde não é a conversa: é que a frase que
explica o pedido mora em outro aplicativo, longe do pedido.

Sobre por que não é uma linha em `conversations` e por que a tela não é o
`MessageThread`: [03-decisoes.md §2](03-decisoes.md).

**Uma linha fixa acima das abas, não uma quarta aba** — foi pedida como aba e
entregue diferente, o que é uma decisão que ele pode reverter em uma linha.
Entrada e Esperando respondem "onde esta conversa está"; a sala não é uma
conversa com cliente, então não é um terceiro estado. E quatro rótulos não
cabem em 288px. Acima da divisão ela aparece em qualquer aba, que é o que
precisa ser: mensagem de colega não para de importar porque você está olhando
outra coisa.

---

## 7. Notificação de mensagem nova

> _"Algumas conversas não vem notificação"_

Nenhuma vinha ([02-bugs.md §2](02-bugs.md)). E a primeira correção estava no
lugar errado ([§3](02-bugs.md)), com uma trava que não travava
([§4](02-bugs.md)).

O estado final: `lib/notifications/new-message.ts`, chamado do webhook **depois
da atribuição** — quando o rodízio acabou de dar a conversa a alguém, essa
pessoa é a única que precisa saber, e avisar a equipe inteira um milissegundo
depois de dar dono é a ordem mais barulhenta possível de fazer essas duas
coisas.

---

## 8. Leitura da conversa

Quatro pedidos, todos sobre o que a tela mostra em vez do que ela faz.

**Assinatura** ([02-bugs.md §7](02-bugs.md)) e **prévia de mídia**
([§8](02-bugs.md)) — os dois resolvidos na leitura, em
`lib/inbox/message-preview.ts`, o que conserta o histórico inteiro sem
migração.

**Ctrl+V** — não existia `onPaste` nem arrastar-e-soltar no compositor. Anexo
só entrava pelos três `<input type="file">` escondidos atrás do clipe. Não era
uma quebra, era uma ausência — e numa mesa de atendimento o print **é** a
mensagem metade das vezes. O arquivo colado passa por `stageUpload` como
qualquer anexo, então cai na prévia com legenda em vez de disparar sozinho.

**Placeholder e maiúscula no celular** — o texto era "Escreva uma mensagem...
(Shift+Enter quebra linha)", 45 caracteres num `textarea` de uma linha: quebra
e a segunda linha é cortada pela própria altura do campo. O texto curto não é
uma truncagem, é a cópia correta para o aparelho — não existe Shift+Enter num
teclado de toque, então a dica nunca foi endereçada a esse leitor.

---

## 9. O cabeçalho da conversa no celular

Voltar, avatar, nome, informações, ligar, atualizar, status e responsável são
uns 330px de controles que todos se recusam a encolher, contra uma janela de
390. Abaixo de `sm`, tudo que é secundário foi para o menu `⋯` — que é o mesmo
botão que o item 2 já precisava criar, então os dois se pagam.

**Não medido no aparelho.** É o item 10 da lista original e continua sem
medição — ver [04-verificacao.md](04-verificacao.md).

---

## 10. Telas fora da caixa de entrada

**Agenda e fronteira de erro** ([02-bugs.md §10](02-bugs.md)) — o mesmo defeito
nas duas.

**Botão de criar conta** ([§9](02-bugs.md)) — e a varredura pelo mesmo par
`w-full` + `shrink-0` no resto do `src/` não achou outra ocorrência.

**Tela de convite** — era um card cru num fundo liso, enquanto login e cadastro
tinham a moldura dividida com logo e foto. A tela mais pobre do produto era a
vista pela única pessoa que nunca viu o produto. O `AuthShell` saiu do layout
de `(auth)` e virou componente; os dois layouts o renderizam, então o convite
não pode mais divergir das telas para as quais ele encaminha.

**Cadastro só por convite** — `/signup` sem `?invite=` redireciona para
`/login`, e o link "Criar conta" só aparece quando há um convite em mãos.

O aviso que vale repetir: **isto é só a porta da frente.** O endpoint de
cadastro do Supabase continua alcançável com a chave anon. Fechar de verdade é
desligar "Allow new users to sign up" no painel e criar o usuário pelo servidor
após validar o token — e fazer isso sem a rota nova quebra também quem foi
convidado.

---

## 11. Novidades

> _"Criar página de Novidades como se fosse os releases"_ — e depois
> _"em vez de conteúdo baseado em lista separa sessões mais interativas e
> explicativas com resumo e opção de ver todas"_

A primeira versão era uma lista. Dezenove linhas de peso idêntico é uma página
que ninguém lê: "Esperando quer dizer outra coisa agora" ficava do mesmo
tamanho de "um botão parou de estourar", então uma passada de olho ensinava
nada.

O formato final: dois ou três destaques com uma frase cada, uma linha dizendo o
tamanho do resto, e a lista completa atrás de um clique. As versões antigas
colapsam inteiras — um release da semana passada é história, não novidade.

**Desceu para baixo de Chaves de API.** Estava em segundo, logo abaixo de Visão
Geral, na teoria de que alguém chega em Configurações já com a pergunta "o que
mudou". Chega — mas raramente, e a barra é lida de cima para baixo por quem
procura um ajuste para mexer. Um log de versões é a única entrada ali que não
configura nada.

**Ícone `Megaphone`, não `Sparkles`.** O brilho é a marca de "a IA fez isto" no
produto inteiro — está no rascunho com IA, no selo da bolha, no card do Hermes
— e nada naquela página foi escrito por máquina. Emprestá-lo ali faria o único
ícone que significa alguma coisa não significar nada.

---

## 12. Os dois editores sobre a mesma grade

> _"Sessão de fluxos tu pode deixar todo o background como principal do
> diagrama e o restante dos elementos em cima do bg pontilhado, e o mesmo
> padrão pode implementar para automações"_

Fluxos tinha a grade dentro de uma caixa com borda, recuada de todas as bordas,
com a barra de ferramentas, a legenda e a barra de validação empilhadas fora
dela, sobre outra superfície. Duas superfícies, uma moldura entre elas, e a
coisa que você de fato manipula ficando com a menor parte da tela — num laptop,
as calhas e a barra de baixo custavam perto de um quinto da área útil, que num
editor onde se navega arrastando é o quinto caro.

Automações já tinha grade, com espaçamento diferente e só dentro da área de
rolagem. Agora é uma `@utility editor-grid` só, usada pelos dois, e o React
Flow foi configurado para casar com ela.

A vista de lista mantém superfície própria: uma coluna de linhas sobre grade
pontilhada é ilegível, e o pontilhado significa "você pode arrastar coisas
aqui", o que na lista é mentira.

**No topo:** a legenda de dez tipos era uma faixa de texto de 10px que corria
para fora da tela abaixo de ~1400px e é lida aproximadamente uma vez. Material
de referência, não controle — virou popover. As cores também já estão nos
próprios nós.

**Zoom:** o React Flow empilha três botões numa torre vertical de 26×78px, que
é o formato de uma barra de ferramentas de outro aplicativo — nada mais no
produto é uma tira vertical de quadrados sem rótulo. Na horizontal casa com as
pílulas que o compositor e as barras de segmento já usam. Minimapa encolhido
para 160×110 com o mesmo recuo e fundo: a 200×150 opaco era o objeto mais
pesado do canvas, e é o único com que ninguém interage.

---

## 13. A barra lateral

Quatro pedidos em sequência, e o último desfez parte do primeiro.

**Títulos de separação removidos** — eram três (OPERAÇÃO, AUTOMAÇÃO, ANÁLISE)
sobre nove linhas. Nove é um comprimento que o olho lê como uma lista só, então
os títulos não ajudavam ninguém a achar nada; o que faziam era quebrar a coluna
em quatro blocos, cada rótulo recuado diferente das linhas embaixo dele.

**Espaçamento uniforme** — com os rótulos fora, a pausa entre grupos não
pontuava mais nada. A regra veio pronta: o CSS já tinha
`[data-nav-group]:not(:first-child) { margin-top: 0.25rem }` para o estado
recolhido, com o comentário "nove ícones, oito espaços idênticos". Aplicada nos
dois estados, em vez de manter duas respostas para a mesma pergunta.

**BETA** — era pílula com borda, fundo e tinta âmbar: três dispositivos para
uma palavra, na única cor que este sistema reserva para "alguém precisa fazer
algo". Ninguém precisa fazer nada sobre um recurso estar em beta. Virou a
palavra em cinza, sem moldura.

**Botão de recolher** — quatro tentativas, registradas em
[02-bugs.md §12](02-bugs.md).

---

## 14. Prévia da equipe e quem está online

> _"implementa prévia e notificações do grupo interno da equipe ali abaixo das
> novidades / ali em cima eu quero que tu adicione usuários online"_

**`layout/team-room-card.tsx`** — a última linha da sala, abaixo do card de
novidades e acima da conta. A sala mora na caixa de entrada, que é a casa certa;
o que isso custa é todo o resto: quem está no Kanban não tem como saber que um
colega acabou de perguntar algo. A barra é a única superfície que sobrevive a
todas as rotas.

Não desenha nada antes da 046 — um card dizendo "não consegui carregar" em toda
rota do app seria pior que card nenhum.

**`layout/online-members.tsx`** — três discos sobrepostos e a contagem, com
popover. Uma caixa compartilhada é uma sala onde a equipe trabalha sem se ver, e
o produto inteiro age sobre esse fato: conversas são passadas, threads são
paradas para alguém, o rodízio só roteia para quem está online. Cada uma dessas
decisões fica mais fácil sabendo quem está na mesa, e até aqui o único lugar
que mostrava isso era o dropdown de atribuir.

Some em conta solo: um disco do seu próprio rosto dizendo "1 online" responde
uma pergunta que ninguém naquela conta pode ter.

---

## 15. Máscara de telefone

> _"precisa padronizar mascara no telefone"_

`ui/phone-input.tsx`, irmão do `currency-input.tsx` — mesmo problema de cursor,
recolocado à mão contando **dígitos** em vez de caracteres, que é a única coisa
que sobrevive à reformatação.

O que é guardado, e por que formatar era seguro:
[03-decisoes.md §6](03-decisoes.md).

---

## 16. Traduções

> _"Faz pacote de traduções"_

O print mostrava um fluxo em inglês. **Não é bug de código:**
`localizeFlowTemplate` traduz no clone, é chamado nos dois caminhos, e o
catálogo pt-BR está completo (`welcome_menu.name` = "Menu de boas-vindas"). O
"Welcome menu" do banco é uma linha de **23/08**, criada antes. Apagar e clonar
resolve.

O que **era** bug estava em outro lugar, e foi encontrado por acidente ao usar
uma função num componente novo: nove strings em inglês em `lib/presence.ts`,
mais três na `presenceLabel`, aparecendo no tooltip de todo pontinho de
presença — e uma suíte de testes que rodava em inglês e as defendia. Ver
[02-bugs.md §13](02-bugs.md).

---

## 17. Duas coisas que não foram feitas, de propósito

**Criptografar o frontend contra cópia da estrutura** — pedido e recusado com
argumento. O navegador precisa executar o código, então precisa conseguir
lê-lo; ofuscação é lombada, não fechadura. E é irrelevante aqui: o cliente fala
direto com o Supabase, então cada consulta vai pela rede como URL do PostgREST
com nome de tabela e coluna legíveis. **O schema é público por desenho, e a RLS
é a única parede que existe** — é ali que vale gastar esforço. O instrumento
para "cópia da estrutura" é a licença, não o código.

**Filtro "não respondidas"** — ideia minha, listada no plano, não entregue.
Precisa de uma coluna nova e de escrita em quatro caminhos de envio. Não estava
na lista do Gabriel.
