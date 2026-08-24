# Defeitos encontrados e corrigidos

Cada entrada: o que se via, o que causava de verdade, o que corrigiu, e como a
causa foi estabelecida. Ordenados por quanto custou entender, não por
gravidade. Índice: [00-README.md](00-README.md).

---

## 1. "Esperando" queria dizer duas coisas, e nenhuma delas era a certa

**Reportado três vezes, em três sessões diferentes:**

> _"Cliente não está saindo do 'esperando' quando responde"_
> _"Mensagens novas de clientes antigos não estão indo para esperando"_
> _"As que estão em entrada, quando mandam mensagem novamente não vai para esperando"_

Lidas separadamente, as três se contradizem: a primeira quer tirar da fila, as
outras duas querem colocar. Foi o que me fez errar na primeira tentativa.

### Causa

A palavra existia duas vezes no produto, com significados diferentes e sem
nenhuma relação entre eles.

Na lista, `conversation-filters.ts:88` definia a aba como
`esperando: (c) => !c.assigned_agent_id` — "ninguém pegou esta conversa".

No cabeçalho da conversa, `message-thread.tsx:169` oferecia o status `pending`,
que o `pt-BR.json` traduz para a mesma palavra:

```
Inbox.conversationList.scopeWaiting = "Esperando"
Inbox.messageThread.statusPending  = "Esperando"
```

Dois controles, uma palavra. Marcar como Esperando no cabeçalho deixava a
conversa parada na aba Entrada, e o cliente respondendo não mexia em nada em
lugar nenhum.

**Como foi estabelecida.** No banco de teste, entre 8 conversas, havia
exatamente uma com `status='pending'` **e** responsável — marcada como
Esperando no cabeçalho e aparecendo em Entrada na lista. O bug reproduzido em
dado real, sem precisar de repro.

### A leitura errada, registrada de propósito

Perguntei ao Gabriel qual semântica ele queria e descrevi a opção que ele
escolheu como _"cliente responde → volta pra Entrada"_. **A descrição era
minha e estava errada.** Implementei assim, e o terceiro relato — _"as que
estão em entrada, quando mandam mensagem novamente não vai para esperando"_ —
é a prova de que estava.

A leitura certa: **Esperando quer dizer que o cliente está esperando
resposta.**

```
cliente escreve      →  Esperando
um atendente responde →  Entrada
alguém finaliza      →  Finalizados
```

Assim, _"cliente não está saindo do esperando quando responde"_ é o
**atendente** respondendo e a conversa não saindo — não o cliente. Uma regra,
três relatos.

### Correção

`SCOPES` passou a ler `status`. A entrada em
[`lib/conversations/reopen.ts`](../../src/lib/conversations/reopen.ts), a saída
em [`lib/whatsapp/send-message.ts`](../../src/lib/whatsapp/send-message.ts) —
que é o caminho da resposta humana. Automação e fluxo **não** limpam: um
"recebemos sua mensagem" não respondeu ninguém, e uma conversa que sai da fila
porque um robô falou é exatamente a falha que a fila existe para impedir.

Os testes de `reopen.test.ts` foram reescritos duas vezes e o arquivo registra
as duas leituras erradas anteriores. Um teste que afirma o comportamento errado
é pior que nenhum teste: ele defende o bug.

---

## 2. A notificação de mensagem nova nunca existiu

**Reportado como:** _"Algumas conversas não vêm notificação"_.

### Causa

Nenhuma vinha. A migração 027 criou a tabela de notificações com um `CHECK`
que aceita exatamente um valor — `conversation_assigned` — e um gatilho que
dispara quando alguém te passa uma conversa. Mensagem de cliente não notificava
em lugar nenhum do sistema.

**Por que o relato diz "algumas".** A notificação de atribuição funciona, então
o sino está demonstravelmente vivo — e as conversas que nunca avisam parecem as
quebradas. É a forma mais cara de um recurso faltar: parecendo um recurso
defeituoso.

### Correção

[`lib/notifications/new-message.ts`](../../src/lib/notifications/new-message.ts),
chamada do webhook dentro do `after()`. Vai para o responsável quando há um;
para quem pode atender quando não há.

---

## 3. A notificação estava no lugar errado, e travava o resto

**Reportado como:** _"ajusta a fila de notificações para não travar tudo"_.

A primeira versão do §2 era um gatilho `AFTER INSERT ON messages`. Duas coisas
erradas nisso, e a segunda é séria.

**Disparava em toda linha da tabela.** Uma campanha escrevendo três mil
mensagens de saída chamava a função três mil vezes para ler `sender_type` e
retornar. Sobrecarga pura no caminho que já é o mais lento do produto.

**E fazia o trabalho dentro da transação do insert.** Um `INSERT ... SELECT`
espalhando uma linha por membro da equipe, segurando lock, enquanto a instrução
que precisa dar certo para a mensagem existir esperava atrás dela. A
notificação é a coisa menos importante daquele request e estava na frente de
tudo.

### Correção

Migração 046 ficou só com o schema — a constraint e o índice — e **derruba o
gatilho** se uma cópia anterior tiver sido aplicada. O `verify-schema.sql`
falha o CI se ele reaparecer. A escrita foi para a aplicação, num `after()` que
já existia para trabalho diferido: não pode atrasar o insert, não pode
derrubá-lo, e não existe para os outros noventa por cento das escritas.

---

## 4. A trava anti-repetição era desfeita por quem estava lendo a conversa

Encontrado numa revisão do próprio trabalho, antes de qualquer relato.

### Causa

A trava do §2 usava `unread_count = 0` como "primeira da rajada": o webhook
insere a mensagem antes de incrementar o contador (037), então zero significa
primeira.

O `MessageThread` **zera `unread_count` a cada mensagem que chega com a
conversa aberta** — é isso que faz ler marcar como lido. Então: atendente A com
a conversa aberta, cliente manda cinco linhas, o contador é zerado cinco vezes,
as cinco parecem "primeira da rajada", e **o atendente B recebe cinco
notificações**. O sino que se aprende a ignorar, justo na situação em que a
conversa já está sendo atendida.

### Correção

A pergunta mudou: em vez de "quantas não lidas tem", **"eu já avisei sobre esta
conversa nos últimos 5 minutos"**. É imune ao reset porque é uma pergunta sobre
o que foi *anunciado*, não sobre o que foi *lido*. Com índice parcial próprio,
já que roda em toda mensagem que entra.

---

## 5. O nome editado do cliente voltava sozinho

**Reportado como:** _"Ao salvar/editar nome do cliente, depois de alguns
minutos volta o nome que estava antes"_.

### Causa

`webhook/route.ts:1198`. **Toda** mensagem recebida comparava o nome do perfil
do WhatsApp com o nome salvo e sobrescrevia se diferisse. Os "alguns minutos"
eram o tempo até o cliente escrever de novo.

A sobrescrita não é errada em si — é o que transforma um telefone nu em nome, e
o que mantém o nome atual para os contatos que ninguém editou. O errado é que
ela não distinguia um nome que ela mesma escreveu de um que uma pessoa digitou.

### Correção

`contacts.name_source` (045). O webhook só sobrescreve o próprio trabalho.
Todos os caminhos que uma pessoa usa — formulário, renomear na ficha, importação
CSV — passam por `withManualName`, que reclama a autoria e degrada para o
comportamento antigo enquanto a 045 não estiver aplicada.

**Backfill deliberadamente não feito.** Marcar `'manual'` para todo contato cujo
nome difere do telefone era o movimento óbvio e é errado: congelaria também
todos os nomes que vieram do próprio WhatsApp, que são a maioria.

---

## 6. Ocorrência registrada não aparecia em lugar nenhum

**Reportado como:** _"Botão de ocorrência não está aparecendo como 'etiqueta'
no cliente"_.

### Causa

Duas fontes de verdade e só uma escrita. `occurrence-dialog.tsx:112` gravava a
linha em `contact_occurrences`. O triângulo na lista, o aviso na sidebar e o
filtro liam `hasOccurrence()`, que procurava a etiqueta `Possui Ocorrência` nas
tags do contato — **e nada, em lugar nenhum do código, jamais escreveu essa
etiqueta.**

### Correção

Não foi criar a etiqueta: foi parar de depender dela. A migração 042 — que já
estava aplicada, ao contrário do que o comentário no código dizia — mantém
`contacts.occurrence_count` por gatilho. `hasOccurrence()` lê o contador, com a
etiqueta como reserva para contas que a aplicaram à mão.

De brinde, a sidebar ganhou a contagem: _"2 ocorrências no histórico"_ diz mais
que _"já teve um problema"_ para quem está prestes a prometer um prazo.

---

## 7. A assinatura vazava para a nossa própria tela

**Reportado como:** _"Mensagens assinadas não precisa enviar no front o
'*Matheus*' aparecendo"_.

### Causa

`signMessage()` prefixa `*Nome*\n` no texto na hora de enviar. Isso está certo
para o cliente — o asterisco vira negrito no WhatsApp dele — mas o mesmo texto
é o que a bolha e a prévia da lista desenham.

### Correção

Resolvido na **leitura**, não no envio. Um `splitSignature()` estreito de
propósito: só em mensagem de saída, só quando os asteriscos envolvem a primeira
linha inteira, só com mais mensagem embaixo, no máximo 40 caracteres e sem
asterisco dentro. Um `*urgente*` sozinho é ênfase e não é tocado.

Fazer na leitura conserta o histórico inteiro de graça. Fazer no envio exigiria
coluna nova e não faria nada pelas mensagens já gravadas.

---

## 8. `[audio]` na lista de conversas

**Reportado como:** _"Implementar prévia da mídia anexada ou melhor
identificação no front"_.

### Causa

`webhook/route.ts:779`: `p_last_message_text: contentText || \`[${message.type}]\``.
O nome do tipo cru da Meta virando a prévia da linha. Uma string de debug que
chegou em produção.

### Correção

Resolvido na leitura, pelo mesmo motivo do §7: toda linha já no banco diz
`[audio]` hoje, e uma correção que só valesse para amanhã deixaria a lista pela
metade. Ícone e a palavra em português.

---

## 9. O botão de criar conta estourava a lateral

**Reportado com print.**

### Causa

`w-full` num botão dentro de uma linha flex que também carrega o botão de
voltar — e `ui/button.tsx:27` traz `shrink-0` na base de **todo** botão do app.
Ele pede 100% da linha e se recusa a devolver, então a linha estoura na largura
exata do botão de voltar mais o espaçamento.

### Correção

`flex-1 min-w-0`. Medido depois a 375px: campo de senha e linha dos botões
terminam os dois em 334px, overflow horizontal da página zero.

---

## 10. Dois estados vazios encostados no topo

**Reportados separadamente:** _"Centralizar (centro x centro) conteúdo ao lado
do calendário"_ e _"mensagem de quebra precisa ficar centro x centro"_.

### Causa

A mesma nos dois. O `StatePanel` centraliza nos dois eixos por dentro — só não
tinha altura nenhuma para centralizar **dentro de quê**. Na agenda, a coluna da
direita era um bloco simples ao lado de um calendário bem mais alto; na
fronteira de erro, o painel renderizava na altura do próprio conteúdo.

É o mesmo formato do bug do `min-h-0 flex-1` documentado no
[03-bugs.md §14](../ux-overhaul/03-bugs.md) da revisão anterior: um flex item
não faz o que se espera até alguém decidir sua altura.

---

## 11. O contador cobria o sino

**Reportado como:** _"ícone de notificação ficou ofuscado"_.

### Causa

O badge era `absolute top-1 right-1` — quatro pixels para dentro de um botão de
36px, que é o tamanho para o qual foi escrito. A caixa de entrada monta o mesmo
componente a **28px**, e quatro pixels para dentro de uma caixa menor põem um
badge de 16px em cima de um sino de 18. Um valor absoluto dentro de uma caixa
de tamanho variável.

### Correção

Ancorado no canto, ligeiramente para fora, com um anel na cor da superfície.
Funciona nos dois tamanhos porque deixou de ser função da largura do botão.

---

## 12. O botão de recolher estacionando em cima do conteúdo

**Reportado quatro vezes seguidas**, o que é o registro mais honesto de que
levou quatro tentativas.

O botão estava `right-0 translate-x-1/2` — metade dele pendurada sobre o que
estivesse do outro lado da divisa. No `top-1/2` esse outro lado é o meio da
lista de conversas: um disco de 24px estacionado no avatar de alguém.

| Tentativa | O que fiz | O que quebrou |
| --------- | --------- | ------------- |
| 1 | `right-1.5`, dentro da barra | Ficou em cima da pílula ativa |
| 2 | `bottom-3`, fora das linhas | Foi parar em cima do nome do usuário |
| 3 | `top-1/2 right-0` | Certo em todas as telas menos mensagens |
| 4 | `+ opacity-0 group-hover` só em `/inbox` | — |

A resposta final não é uma posição: é que **na tela de mensagens ele só aparece
quando a mão vai buscá-lo**. Escondido por opacidade, não desmontado — continua
na ordem de tabulação e `focus-visible` traz de volta, então quem usa teclado
não fica sem jeito de recolher a barra justo na tela onde o espaço mais
importa.

---

## 13. Nove strings em inglês num app em português

Encontrado ao usar `formatLastSeen` num componente novo.

### Causa

`lib/presence.ts` retornava `"just now"`, `"5 minutes ago"`, `"3 days ago"` e
mais seis, e a `presenceLabel` mais três — `"Online — active now"`. Apareciam
no tooltip e no `aria-label` de todo pontinho de presença do produto. Um leitor
de tela lia a única string da página que não estava no idioma do leitor.

**Como sobreviveram a uma suíte verde.** Os testes **rodavam em inglês**: o
`vitest.config.ts` não definia `NEXT_PUBLIC_APP_LOCALE`, então `APP_LOCALE`
caía no `'en'` do fallback, `dateLocale` resolvia para `enUS`, e as asserções
fixavam os literais em inglês. O teste não deixou o bug passar — ele o
defendia.

### Correção

Três camadas, e a primeira é a que importa: `vitest.config.ts` passou a rodar
em `pt-BR`, o idioma que a instalação usa. Isso quebrou exatamente dois testes,
os dois que fixavam os literais. `formatLastSeen` usa `dateLocale`;
`presenceLabel` recebe o tradutor por parâmetro, mesmo padrão do
`notifications/text.ts`.

---

## 14. A sala da equipe dizia estar vazia quando não existia

Encontrado ao investigar _"o chat da equipe faz funcionar"_.

### Causa

`loadTeamMessages` devolvia `[]` tanto para "nenhuma mensagem" quanto para "a
tabela não existe", e a tela desenhava o estado vazio nos dois casos. É a pior
das três telas possíveis: diz que o recurso funciona e ninguém usou, então a
pessoa digita e vê a mensagem sumir.

### Correção

As duas respostas são diferentes e a sala diz qual. Enquanto a 046 não estiver
aplicada, o campo fica desabilitado com o motivo — a mesma cortesia que o
`occurrence-dialog` já estendia para a 042.

---

## 15. Marcar como não lida se desfazia sozinha

Encontrado escrevendo a ação, antes de qualquer relato.

### Causa

O `MessageThread` zera `unread_count` sempre que um contador aparece na
conversa que ele está mostrando. Marcar como não lida e continuar dentro dela
disparava esse efeito no mesmo segundo.

### Correção

A ação fecha a conversa — que é o que ela **significa**. "Marcar como não lida"
numa caixa compartilhada é como se devolve um atendimento para a fila, e ficar
dentro de um atendimento que você acabou de devolver é a contradição, não a
correção.

---

## 16. Três funções que podiam derrubar o webhook inteiro

Encontrado porque os testes do webhook quebraram — duas vezes.

### Causa

`autoAssignConversation` e `markWaitingOnInbound` estão documentadas como
"best-effort", e "best-effort" precisa ser **imposto**, não pretendido. Um
`throw` ali aborta o resto da mensagem — despacho de fluxos, automações, a
escrita de opt-out — e faz a Meta reentregar tudo.

O stub de teste do webhook não tinha `conversations.update`, então a mudança
passava por um caminho que os testes nunca exercitaram. Foi o que revelou o
problema: três testes não relacionados quebraram de uma vez.

### Correção

`try/catch` nas duas, e o harness ganhou os métodos que faltavam. Uma conversa
na aba errada é um problema muito menor que uma mensagem entregue duas vezes.

---

## 17. Um alarme falso meu, registrado porque mudou uma recomendação

Eu disse que a migração 043 não estava aplicada e recomendei conferir produção
antes de qualquer coisa.

**Estava errado.** Sondei a coluna pelo nome `loss_reason`; ela se chama
`lost_reason`. A 043 está aplicada, junto com a 042 e a 044. A única parada é a
041, exatamente como o Gabriel deixou.

Fica registrado porque a recomendação chegou até ele antes da correção, e uma
sondagem que erra o nome da coluna responde 400 de um jeito indistinguível de
"não existe".
