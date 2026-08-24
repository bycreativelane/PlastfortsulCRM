# Worklog

Cada mudança, agrupada pelo pedido ou pelo achado que a causou. Índice:
[00-README.md](00-README.md).

---

## 1. O nome do cliente, terceira tentativa

A 0.8.2 criou `contacts.name_source` e o wrapper `withManualName`, e ligou
**um** dos três caminhos que gravam nome. Os outros dois continuavam
revertendo:

- `contacts/contact-detail-view.tsx` — a edição pela ficha do cliente. Também
  passou a normalizar o telefone com `toE164` no mesmo `update`, porque
  gravar `+55 (51) 99000-0001` cru abre uma segunda linha para a mesma pessoa
  no índice de dedup da migração 022.
- `contacts/import-modal.tsx` — o insert em lote **e** o retry linha a linha.
  Sem isso, a primeira mensagem de cada contato importado trocava o nome da
  planilha pelo do WhatsApp; a reversão chegava na escala do CSV.

## 2. Telefone

Três coisas separadas que o relatório chamava de uma:

**A máscara no segundo campo.** A ficha do cliente usava `Input` cru. Virou
`PhoneInput`, o mesmo do formulário.

**A função sem leitor.** `formatPhone` existia e nenhuma tela chamava — todas
imprimiam `+5551990000001`. Agora passam por ela: ficha, barra lateral do
inbox, cabeçalho da conversa, lista de contatos e detalhe do disparo. A
**exportação CSV continua em E.164**, que é o formato que um integrador
espera.

**O código de país.** `formatPhone` cortava dois dígitos fixos, então
`+595 991234567` virava `+59 5991234567` — um país que não existe, com um
dígito a menos no número. Os códigos E.164 têm um, dois ou três dígitos e a
regra é determinística (zona 1 e 7 têm um; existe uma lista fechada de dois;
o resto tem três), então agora é medido. O teste que fixava o comportamento
errado foi reescrito com a inversão registrada dentro dele.

## 3. Encerradas e Ocultas

A 0.8.2 rebaixou a aba "Finalizados" para filtro e as duas opções passaram a
ser contadas **contra a aba atual** — que por definição não contém nenhuma
delas. Contavam zero sempre, e o menu desabilita linha com zero. O efeito:
**conversa finalizada ficou inalcançável**, e "Ocultar" virou porta de mão
única. Agora são contadas contra tudo que a busca achou.

## 4. A fila do Esperando

`setConversationStatus` carimbava `waiting_since` sem olhar o estado atual,
então marcar como esperando uma conversa **que já esperava** reiniciava o
relógio. A aba Esperando é a única lista do produto ordenada da mais antiga
para a mais nova, então o efeito da escrita era pegar a conversa mais
esquecida da fila e jogá-la para o fim — exatamente a linha que a aba existe
para mostrar. `markWaitingOnInbound` guardava contra isso desde que foi
escrito; o caminho manual não.

O item do estado atual também ficou desabilitado, seguindo o precedente do
"Marcar como não lida".

E o cabeçalho da conversa passou a repassar o **patch inteiro** em vez de só
o status, então a linha ordena certo na hora em vez de pular quando o
realtime chega.

## 5. "Atribuir a…" — o item que nunca renderizou

Estava no componente e em três arquivos de idioma, atrás de uma prop
opcional que **nenhum ponto de chamada passava**. Virou um submenu de verdade
com os membros da conta e "Ninguém" (que devolve ao rodízio automático),
usando o mapa de nomes que a lista já carrega — uma consulta para a lista
toda, não uma por linha.

## 6. O clique direito quebrava a tela

`ContextMenuLabel` é o `Menu.GroupLabel` do base-ui, que lê um contexto que
só `Menu.Group` fornece e **lança no render** sem ele. O throw acontece
enquanto o menu monta, então o React desenrola até a fronteira de erro da
rota e todo clique direito virava "Algo quebrou nesta tela".

Atingia **dois** menus: o da conversa e o do card do Kanban. E a armadilha já
tinha sido encontrada e documentada em `flow-builder.tsx` antes dos dois
existirem — um comentário em um arquivo não impediu o mesmo erro em outros
dois. Agora tem teste: `components/ui/menu-label-group.test.ts` falha se
qualquer arquivo renderizar um label de menu sem grupo.

**Por que só apareceu agora:** o crash do `usePresence` derrubava o dashboard
antes, então o clique direito nunca chegava a montar. Consertar um defeito
revelou o outro.

## 7. Sala da equipe

Quatro defeitos, todos de alcance:

- **Sem saída no celular.** A lista de conversas some abaixo de `md` quando a
  sala abre, então o único jeito de sair era recarregar. Ganhou o mesmo
  chevron que `MessageThread` usa.
- **O ponto de não lida não apagava.** `localStorage` não é reativo:
  `markTeamRoomSeen` movia o marcador e não avisava ninguém. Agora dispara um
  evento (`TEAM_SEEN_EVENT`) que os dois pontos escutam.
- **O trilho recolhido escondia o card inteiro.** `data-nav-label` leva o
  elemento embora; o card é um ícone com um ponto, que é justamente o que um
  trilho de 62px serve para mostrar. Virou `data-nav-row`, com o texto saindo
  sozinho e o ponto migrando para o ícone.
- **`?team=1` funcionava uma vez por montagem.** Travava num sinalizador, e o
  segundo clique no card era uma navegação para a URL em que a página já
  estava. Agora sair da sala limpa o parâmetro, então cada clique é uma
  transição de verdade.

## 8. Notificações

Marcar como lida descartava o erro silenciosamente, deixando o painel todo
cinza ao lado de um contador que continuava contando. E a página tratava
toda linha como botão mesmo sem destino, além de não seguir o `contact_id`
que o sino já seguia. `destinationFor` virou módulo compartilhado.

## 9. A miniatura da mídia

A 047 ligou o webhook. Os **quatro caminhos de envio de bot** — fluxo texto,
fluxo mídia, fluxo interativo e automação — continuavam gravando só o texto.
Como as duas colunas novas não são limpas por uma escrita de texto, o
resultado era pior que miniatura faltando: o cliente manda uma foto, a
automação responde com uma frase, e a linha fica com **a foto dele ao lado da
frase nossa**. Todos passam por `writeLastMessage` agora, com recuo para
banco sem a 047.

## 10. Traduções

36 pontos. O `AiUsageCard` inteiro, os nove toasts de falha do inbox, os
sete do WhatsApp, membros, convites, fluxos, contatos, disparos, o `confirm()`
de excluir fluxo, status de template, temas, escopos de API, o "Close" de
todo diálogo e de toda gaveta.

O padrão que se repetia: `toast.error(err.message ?? t('chave'))`. O
`err.message` **sempre** vence, então a chave escrita para aquele caso nunca
renderizava. Agora o detalhe vai para o `console.error` e a pessoa lê a frase
que foi escrita para ela.

Duas exceções que valem nota: os nomes de moeda saem do `Intl.DisplayNames`
em vez de quinze strings por idioma, e os status de template passaram a
guardar uma **chave** em vez de uma palavra.

## 11. Barra do topo

Reorganizada em três zonas — `flex-1 basis-0` dos dois lados, o que faz o
meio ser um meio de verdade e não "o que sobrou":

- **Esquerda:** quem está online. As fotos e nada mais — o "3 online" escrito
  ao lado era a legenda embaixo da fotografia de uma cadeira dizendo
  "cadeira". Cada disco carrega seu próprio ponto de presença, que é o que
  substitui a palavra: verde é aqui, âmbar é ausente.
- **Meio:** a semana. Sete dias com ponto no dia que tem compromisso, setas
  de semana e "Hoje" (que só aparece quando faria alguma coisa). Clicar num
  dia abre o que está marcado nele, com link para cada item.
- **Direita:** o sino e o modo claro/escuro, como estavam.

A semana lê do `loadAgenda` que a Agenda do dashboard já usava — negócios
fechando, recompras, ocorrências, automações agendadas, disparos e
aniversários — e busca **uma semana por vez**, proporcional ao que está na
tela.

## 12. Cores livres para etiquetas e etapas

As duas colunas sempre guardaram um hex livre. O limite era do seletor: seis
cores para etapas, oito para etiquetas.

O primeiro rascunho usou `<input type="color">`, que resolve o limite e
entrega um painel desenhado pelo Chrome — caixa cinza, conta-gotas, três
campos R/G/B, nas fontes do navegador e sem nada nesta página que consiga
estilizar. Seria a única superfície do produto parecendo outro produto.

Então o seletor é nosso: quadrado de saturação/brilho, trilho de matiz,
presets, campo hex, e **a prévia de como a etiqueta vai ficar**. A prévia não
é enfeite — `stageChip` lava a cor em direção à superfície e caminha a tinta
até passar de 4.5:1, então nenhuma escolha produz um chip ilegível; mas um
amarelo-limão que vira tinta marrom sobre creme é legível **e** surpreendente,
e quem escolheu merece ver antes de salvar.

A matemática HSV↔RGB ficou em `lib/color-convert.ts`, com teste.

## 13. Um crash encontrado ao subir o app

`useTotalUnread` abria canal de realtime com nome fixo, então o segundo
componente a chamar o hook recebia o canal já inscrito e `.on()` depois de
`.subscribe()` lançava — **a mesma causa raiz** do que derrubou o atendimento
na 0.8.2, num hook diferente. Ficou latente enquanto a barra lateral era o
único consumidor.

Corrigido na raiz (um canal por consumidor via `useId`). O comentário do
`usePresence` afirmava que o `use-total-unread` "já fazia essa troca"; não
fazia, e o comentário foi corrigido junto.

## 14. As duas correções de banco

Feitas por último, depois de o resto da passagem estar fechado.

**A 047 ganhou o `GRANT` que faltava.** O arquivo revogava a execução de
`bump_conversation_on_inbound` de `PUBLIC`, `anon` e `authenticated` e nunca
reconcedia ao `service_role` — apesar de o comentário do próprio arquivo
prometer isso. `DROP FUNCTION` leva a ACL junto e o `REVOKE ... FROM PUBLIC`
remove o EXECUTE padrão, então não sobrava nada. Corrigido no lugar, porque
a 047 ainda não tinha sido aplicada.

**A 048 fecha a escrita entre contas do `team_messages`.** A política de
UPDATE da 046 perguntava só "esta mensagem é sua?", e `account_id` é uma
coluna gravável — então um `PATCH` movia a linha para a sala de outra conta,
onde o realtime a entregava ao vivo. Migração nova, porque a 046 já está
aplicada.

**E as duas viraram asserção de CI.** `verify-schema.sql` passou a checar que
o `service_role` executa a RPC de quatro argumentos e que as políticas de
UPDATE e DELETE do `team_messages` mencionam `is_account_member`. O `GRANT` é
o caso que mais precisava disso: por fora tudo parece certo — as colunas
chegam, a função tem a forma correta — e a única evidência do problema seria
um `console.error` por mensagem recebida.

## 15. O painel do cliente recolhe, em vez de sumir

Os 288px do painel do cliente apareciam e sumiam num quadro. O menu lateral,
na mesma tela, sempre deslizou — e o `globals.css` reserva `--dur-2`
exatamente para isso: _"algo MOVEU ou REDIMENSIONOU: … a sidebar
recolhendo"_. Eram dois controles idênticos, a um palmo um do outro, com
regras diferentes.

Agora a coluna anima a **largura**, e não um transform. É a mesma escolha que
o menu registra, pelo mesmo motivo: a coluna precisa devolver o espaço de
verdade, não apenas parecer mais estreita, ou a conversa não tem para onde
crescer.

`overflow-hidden` é o que transforma o redimensionamento em movimento. O
painel guarda os seus 288px, então a borda esquerda da caixa viaja para a
direita e o corte o come pela direita — ele sai por onde entrou, em vez de
288px de conteúdo refluindo para zero.

**A montagem sobrevive à animação.** Desmontar no clique esvaziava o painel
num quadro e deixava uma tira em branco fazendo o deslize. Montado sempre
também não serve: o `ContactSidebar` dispara três consultas por contato, e
quem recolheu o painel recolheu para parar de pagar por isso. Então a
montagem segue o estado _aberto_ na hora e o _fechado_ só quando o
`transitionend` da largura chega — com uma saída pelo `activeConversation`,
porque `transitionend` não avisa nada se a coluna deixar de existir no meio
do caminho, e o que sobraria é um painel invisível ainda consultando.

Nada disso anima ao abrir o app. A preferência guardada chega num efeito na
montagem, muito antes de qualquer conversa resolver, então a coluna ainda nem
existe — quem deixa o painel fechado não assiste a ele bater a porta a cada
recarga.

`app/(dashboard)/inbox/page.tsx`.

## 16. O selo de ocorrência saiu da fila de chips

Era um quadrado de 16px entre `Cliente` e `Em Andamento`. A primeira leitura
foi de altura: o `tag.tsx` diz que _"o app tem exatamente duas alturas de
chip"_, 18 e 20, e aquele quadrado era uma terceira. Dois pixels a menos não
leem como um selo menor — leem como **este aqui espremido**: o triângulo de
10px ocupava 62% da caixa, onde o texto dos vizinhos ocupa uns 44%.

Corrigir os dois pixels não corrigiu o que estava errado. Ele era o único
objeto da fila sem palavra nenhuma, então numa linha de chips lia como
sujeira em vez de membro do conjunto. E a fila de chips é a **linha mais
lenta** da conversa — lida depois do nome e depois da mensagem, que é o pior
lugar possível para o único fato ali que deveria mudar _como_ você lê a
mensagem de cima.

Subiu para o lado do nome e virou redondo, 18px — o mesmo tamanho do contador
de não lidas que a linha já carrega. Ao lado de um nome, um círculo lê como um
estado **daquela pessoa**; um quadrado lê como um controle.

O preço: numa linha que tem ocorrência, o nome trunca 24px antes. É a troca
certa — o selo existe para ser visto antes de qualquer promessa ao cliente, e
os dois últimos caracteres do nome não.

`components/inbox/conversation-list.tsx`. É o único lugar do app que desenha
esse selo.
