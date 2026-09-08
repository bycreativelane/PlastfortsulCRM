# Worklog — redesenho de setembro de 2026

Na ordem em que aconteceu, agrupado pelo pedido que causou cada coisa. Cada
bloco cita o commit, para o `git show` ter o resto.

---

## Fase 1 a 2 — o quadro voltou a ser um quadro

**Pedido:** *"esse kanban tá mt feio, analisa o padrão de clickup, notion, e
etc, affine."*

Antes de qualquer questão de cor havia um defeito estrutural: o trilho não
tinha `min-h-0 flex-1` e o corpo da coluna não tinha `overflow-y-auto`, então
com muitas tarefas a PÁGINA crescia para baixo. A doutrina do quadro do funil
proíbe isso numa frase — *"a Kanban that grows vertically past the fold has
stopped being a board"*. Entraram junto o `DragOverlay` com clone e
`dropAnimation` de 180ms, o `StatePanel` na coluna vazia, o esqueleto, e a
scrollbar temática extraída do `<style jsx>` do funil para `@utility
board-scroll`.

Depois, os dois átomos que o app escrevia à mão: `CountBadge` e `IconTile`.

`9cfa774` e anteriores.

---

## Fase 3 — uma tarefa, um desenho

`24db7a7`. O mesmo objeto era implementado por três arquivos, divergindo em
cinco eixos: caixa (16px quadrada · 20px redonda âmbar · nenhuma), concluída,
atrasada (tinta · outra tinta · pílula), responsável (nome nu · ícone+nome ·
foto) e prazo (três funções de formatação).

**Uma correção ao plano aprovado.** Ele mandava usar a caixa redonda âmbar de
`/tasks`. Âmbar está errado por doutrina — no `globals.css` significa "uma
pessoa precisa agir", o oposto de concluído — e a caixa da casa é
`border-control`, não `border-input`: um quadrado de 16px sem nada dentro tem
a borda como componente inteiro, e é ela que carrega o 3:1 que o
`theme-contrast.test.ts` mede.

---

## Fase 4 — a varredura do vocabulário, sete commits

Uma família por commit, a pedido do Gabriel. `9cfa774` … `dac391e`.

| Família     | O que entrou                                                |
| ----------- | ----------------------------------------------------------- |
| ladrilho    | 14 → `IconTile`; o átomo ganhou o eixo `fill` (soft/solid)   |
| pílula      | 10 → `StatusBadge` / `Tag` / `SettingsChip`                  |
| contador    | 6 → `CountBadge`; o átomo ganhou o degrau `dot` de 16px      |
| painel      | 6 → `Panel`                                                  |
| hover       | 10 → `surface-interactive`                                   |
| notificação | menu e página passaram a compartilhar a linha (−165 linhas)  |

Achados que valem além do diff:

- **`attention-row` e `StatTile` defendiam a mesma regra com as mesmas
  palavras, cada um no seu arquivo** (*"a wash would read as a smudge in the
  corner"*). Uma regra escrita duas vezes é uma regra do sistema sem casa —
  virou `fill="solid"`.
- **O `ROLE_META` guardava a mesma escada de papéis duas vezes**, uma como
  variante e outra como Tailwind cru, e elas já tinham divergido: `viewer`
  era contorno numa e preenchido na outra.
- **A barra lateral tinha uma terceira escada de papéis**, com
  `border-amber-500/40 text-amber-300` — o erro que o `settings-chip.tsx`
  documenta ter removido, e um comentário afirmando ser a fonte única
  compartilhada com uma aba que lê outra coisa.
- **O `StatTile` tinha uma variante morta** (`interactive`), inalcançável, com
  metade da receita de hover. Vesti-la de `surface-interactive` teria sido
  enfeitar código morto; ela saiu.

---

## Fase 5 — o acabamento, e um item do plano que era falso

`0023304`. Foco visível no cartão do funil (o `KeyboardSensor` estava ligado
nos dois quadros e só um tinha anel), a legenda que ensina o arrasto, e as
ações do cartão ativo.

Este último não precisou de ações novas: **o cartão do funil já tinha sete** —
editar, mudar de etapa, ganhar, perder, duplicar, copiar telefone, excluir — e
todas custavam um clique-direito, que nada numa página web anuncia. Ganhou uma
porta visível (`ContextMenuActionsTrigger`), não um segundo menu.

**`AvatarGroup` era um item falso do plano.** Ele o tratava como adoção
pendente ("existe com zero call sites"). Zero call sites ali não queria dizer
*ainda não adotado*: o serviço principal do grupo é o anel, um seletor de
FILHO (`*:data-[slot=avatar]`), e o `MemberAvatar` embrulha o `Avatar` num
`<span>`. Sobrava `-space-x-2`, uma classe. Foram removidos.

---

## A crítica que mudou o rumo

> **do design dos prints de referência que mandei não vi nada aplicado de
> forma prática visual, ainda vejo mesmo padrão de design**

Ele estava certo, e a razão vale registrar. Das dez regras destiladas das nove
referências, as que entraram nas cinco fases foram as **invisíveis** — clone
de arrasto, foco de teclado, ações no hover, legenda. Vários commits diziam,
textualmente, "nenhuma muda de aparência". As quatro que mudariam o que se vê
ao abrir a tela ficaram todas de fora:

| # | Regra                                            | Estado na hora da crítica |
| - | ------------------------------------------------ | ------------------------- |
| 2 | Cartão elevado por sombra, borda quase invisível  | não feito                 |
| 3 | Cabeçalho: bolinha na cor + nome + contagem       | não feito                 |
| 5 | Anatomia chip → título → corpo → divisor → rodapé | só o divisor              |
| 6 | Chip com bolinha como átomo de metadado           | não feito                 |

**A lição:** um plano dividido em "defeitos, consistência, acabamento" entrega
as três coisas na ordem certa para o código e na ordem errada para quem pediu.
Quem pede "extremamente bonito" e recebe uma varredura de vocabulário recebeu
trabalho real e a resposta errada.

---

## A superfície, de fato

`dc97a99` e `1755c0f`.

**Sombra no lugar da borda.** Um cartão com borda dentro de uma raia com borda
é retângulo dentro de retângulo — é o que fazia a pilha ler como grade cinza.
Entrou `--card-shadow`, metade do peso do `--lift-shadow` para o hover ter
para onde ir; no escuro ele vira um fio de luz, pela mesma razão que o
`--lift-shadow` já virava.

**Seis das oito referências não têm fundo na coluna.** Só o Bond CRM tinge a
raia, e o dele é um tom por etapa que a doutrina de cor veta aqui. A raia
cinza preenchida era a diferença mais visível entre o nosso quadro e os deles.
O que segura a coluna sem o fundo é a régua fina sob o cabeçalho — o que as
imagens 6, 7 e 8 usam no lugar dele.

**Todo cartão das referências tem uma fileira de chips.** O nosso não tinha
nenhum. A primeira resposta foi "não há taxonomia no dado", e estava errada: o
cartão de tarefa tem `kind` e imprimia como texto cinza cru. Depois vieram as
etiquetas do contato no cartão do funil, que exigiram estender a consulta.

**Do banco para a tela:** `stage_entered_at` existe desde a migração 065 e só
o motor de automação lia, para disparar em negócio parado. Virou "41d aqui".

---

## O `/chart-lab` virou o banco de provas

O quadro vive atrás do login, e era por isso que o redesenho dele vinha sendo
discutido sobre maquetes. O próprio `chart-lab.tsx` documenta por que maquete
não serve: *"ela reproduz a marcação em que o autor já acredita."*

Ganhou o funil, o quadro de tarefas, a linha da lista e o calendário — peças
de produção contra fixtures escolhidas para cobrir o que o desenho tem de
decidir. **Dois defeitos apareceram só ali**, e um deles é do app inteiro: os
dois `DndContext` não tinham `id`, então o dnd-kit numerava os
`aria-describedby` pelo contador interno de montagem e o número do servidor
não batia com o do cliente — erro de hidratação em toda carga de qualquer
página com dois contextos.

---

## Os prints, e os três defeitos que eles mostraram

`e0476ff`. **O segmentado colado** — o `SegBar` nasceu numa coluna de 326px
onde `flex-1` reparte a largura; num toolbar que encolhe para caber não há
largura para repartir, e cada botão fica do tamanho do texto. Faltava `px-3`.

**O chip desligado invisível, e a primeira correção piorou.** Os seis tipos
nascem ligados, então com o azul do `FilterChip` a fileira inteira ficava azul
em repouso. A primeira correção tirou o preenchimento do desligado — e sobre
uma página branca `bg-transparent` e `bg-card` são a MESMA cor, então os dois
estados ficaram idênticos, pior que o `opacity-60` que tinha acabado de sair.
Só apareceu porque foi medido no navegador em vez de confiado ao que estava
escrito. O desligado é rebaixado e riscado agora.

**O mês não preenchia.** `/tasks` é de altura contida e o mês desenhava 240px
de grade seguidos de meia tela branca.

---

## A auditoria das nove superfícies

**Pedido:** *"o restante são tudo print da plataforma que eu quero que tu
analise imagem por imagem… faz mais essa revisão adicional dentro do plano e
documenta também"*, mais o cal.com como referência para calendário/semana/hora.

Workflow de 19 agentes. Resultado bruto e ressalvas em
[00-README.md](00-README.md#a-ressalva-sobre-a-auditoria--leia-antes-de-usar-o-02);
a lista em [02](02-auditoria-nove-superficies.md).

### O primeiro achado confirmado: a data que aparecia um dia antes

`937d671`. Vale sozinho o custo do workflow.

`new Date('2026-09-08')` é parseado como meia-noite UTC. A oeste de Greenwich
isso é o dia anterior. Medido:

```
TZ=America/Sao_Paulo
new Date('2026-09-08')  →  "7 de set."
fromISO('2026-09-08')   →  "8 de set."
```

Sete telas imprimiam a data errada por um dia: o cartão do funil (as duas
escritas), a ficha do contato (previsão de fechamento, última compra, próxima
compra, aniversário) e o histórico de ocorrências.

**A regra já estava escrita, em dois lugares.** O cabeçalho do
`lib/calendar.ts` documenta o defeito com estas palavras — *"the off-by-one
that shows a deal closing on the 22nd"* — e o `fromISO` existe para evitá-lo;
o `lib/dashboard/agenda.ts:728` tem uma guarda em código com o mesmo
comentário. A camada de biblioteca sabia; a de renderização não. Duas das sete
eram do dia anterior, ao reescrever o cartão do funil.

**Por que virou guarda e não atenção.** `new Date(x)` é a coisa óbvia de
escrever, o TypeScript aceita, e o erro SOME para quem roda em UTC: passa em
CI, passa em revisão, e só aparece para quem usa o produto no Brasil.
Conhecimento não resolve — a regra estava escrita duas vezes e foi violada
sete. O `date-only.test.ts` varre as seis colunas DATE do schema e tem um
segundo teste conferindo que cada coluna da lista ainda é declarada DATE em
alguma migração, senão a lista envelhece em silêncio depois de um rename.
Contra a versão anterior, ele acusa os sete.

---

## Fase 10 — o que o banco já sabia e a tela não dizia

Onze achados, e o fio entre eles é um só: **uma coluna gravada com cuidado
e nunca lida**. Nenhuma delas exigiu consulta nova — o dado já vinha
carregado até o componente e era descartado ali.

### A visão geral (A4, A5, A10, A12)

A janela do painel são seis semanas e ela quase sempre contém o passado, o
que significa que um fechamento atrasado três semanas era desenhado igual a
um da semana que vem. Agora a linha carrega um selo `Em atraso` — e **só**
para tarefa e negócio. A ocorrência fica de fora porque ela é retrospectiva
por desenho, e pintar de vermelho o estado normal de um tipo não informa
nada.

A campanha que falhou ganhou o seu próprio selo, restrito a `broadcast`: numa
TAREFA o campo `status` carrega o TIPO, não um estado, e o `to-agenda.ts` diz
isso com todas as letras. Ler `status === 'failed'` sem a restrição não
quebraria nada — simplesmente nunca seria verdade, que é pior.

O rosto do responsável entrou onde há um: só a tarefa tem dono. O diretório
de membros vem do PAI e não do componente da linha, e isso é obrigatório —
`useMemberDirectory` dispara um SELECT por montagem, então chamá-lo na linha
seria uma consulta a `profiles` por linha desenhada.

E o painel ganhou saída: `Agenda completa`, a mesma linha que o calendário de
`/tasks` já tinha. A visão geral era a única das três superfícies de
calendário em que o mês era um beco.

### A tabela de contatos (C8, C3)

O disco de ocorrência existia na caixa de entrada e não na tabela — e o
docstring do helper dizia literalmente que *"a barra lateral e a tabela de
contatos têm um e não o outro"*. Agora tem.

`opted_out` é **editável** na ficha e era ilegível nas duas telas. Entrou nas
duas, em cores diferentes de propósito: **neutro** na tabela e **âmbar** na
ficha. Âmbar é a única "venha aqui" do sistema; 25 selos âmbar numa tabela
seriam 25 chamados e nenhum. Na ficha é uma pessoa na tela — e logo abaixo
do aviso há um botão de enviar template.

### A ficha do negócio (S6, S7, S8)

Marcar como perdido **exige** um motivo, e ele não voltava em superfície
nenhuma do produto. Um campo obrigatório que ninguém relê é um formulário
cobrando trabalho que não usa. O motivo agora aparece na ficha, com o mesmo
ícone do diálogo que o gravou — `REASON_ICONS` deixou de ser privado em vez
de ser copiado.

Há uma guarda em volta dele. `noReply` saiu de `LOSS_REASONS` quando o fluxo
oficial mandou o cliente que não responde para a Geladeira, e continua no
catálogo por causa das perdas antigas. Sem a guarda, uma linha com essa chave
faria `t()` estourar; e como o mapa de ícones é indexado por `LossReason`, o
ícone dela é `undefined` — daí o `LossReasonIcon` devolver `null` em vez de
renderizar.

O desfecho também virou palavra: a ficha dizia "ganho" e "perdido" apenas
desabilitando botões, que é o mesmo desenho de "você não pode editar". Nada
quando aberto — o estado normal não é notícia.

E a previsão de fechamento vencida ganhou pílula na tela onde se muda a data.
O `hoje` daqui é o da **conta**, cópia literal do `task-list.tsx`, que roda a
poucos pixels daqui dentro desta mesma sheet: duas noções de hoje na mesma
tela seria o defeito. Não é o `todayIso()` do `deal-card.tsx` — aquele é o
dia do dispositivo, e promovê-lo a lib consagraria o segundo hoje.

### O diálogo de tarefa (T9)

Abrir uma tarefa atrasada para remarcar apagava exatamente o fato que
motivou a abertura. `task` e `todayIso` já estavam ambos no componente, o
segundo já no fuso da conta, e nenhum dos dois era usado para isto.

### As ocorrências (R6)

`resolved_at` era gravado e nunca lido — sem ele, "Resolvida" não distingue
ontem de março. Aqui `new Date()` está certo, ao contrário da linha logo
acima: `resolved_at` é TIMESTAMPTZ e `occurred_on` é DATE. É a distinção que
o `date-only.test.ts` guarda.

`handled_by` é o outro lado. Ele foi defendido linha a linha na migração 042
— inclusive a escolha de apontar para `auth.users(id)` e não para
`profiles(id)` — e nasceu **sem escritor nenhum**. Agora os dois caminhos
gravam. Isso não muda nada na tela hoje; muda o que dá para mostrar daqui a
um mês, e é a metade invisível que dá sentido à visível.


---

## Fase 5 — vazios e contagens que mentem

Sete achados, e o padrão é um número ou uma frase que **afirma algo falso
sobre o próprio produto**. Nenhum quebra; todos desinformam.

### O vazio que culpa o usuário (C2, F4, A1, R11)

Três telas respondiam a um filtro com a frase reservada para uma base vazia.
Segmentar 4.000 contatos por "sem compra nos últimos 90 dias" e receber
**"Nenhum contato ainda"** — com o botão "Cadastrar o primeiro contato" —
é o produto negando a existência do que ele mesmo acabou de esconder.

No catálogo o caso é mais fino: o corte por ESTADO vem antes do corte por
TERMO, então buscar um produto aposentado responde "Nada corresponde" com o
interruptor que o traria de volta fora do painel e abaixo da resposta. O
conserto foi separar os dois testes (`matchesTerm` virou função de módulo) —
só assim dá para perguntar *quantos o termo acharia se o aposentado
estivesse ligado* — e pôr a resposta como ação dentro do próprio vazio.

Na agenda da visão geral o vazio mandava "escolher outro dia" quando o que
precisava mudar era o filtro. O dia seguinte responderia a mesma coisa: o
filtro viaja junto. E a contagem dos chips não serve de prova, porque ela
mede a janela de seis semanas inteira — marcar 3 é compatível com o dia
selecionado vazio. A prova é contar o que ESTE dia tem escondido.

O histórico de ocorrências vazio era um parágrafo solto onde o diálogo irmão
da mesma pasta usa `StatePanel`.

### As contagens (C4, M5, M12)

O subtítulo de contatos imprimia `totalCount` dizendo "no total" — a mesma
variável que a barra de segmentação, dez linhas abaixo, imprime corretamente
como "no filtro". Buscar "silva" reescrevia o tamanho da base para 4. Agora
são dois números, e o da conta é uma consulta `head: true` por conta, não por
tecla. Ela **mantém** o `.eq('account_id')`: `is_account_member()` é SECURITY
DEFINER e o planner não a inlina, então tirá-lo transformaria o count numa
varredura da tabela inteira avaliando a função por linha. De quebra o
subtítulo deixou de dizer "1 contatos".

Na caixa de entrada, duas contagens quebravam a mesma promessa — escrita em
dois comentários do próprio código, o que torna o caso indiscutível:

> `seg-bar.tsx`: *a number you can't act on by clicking is worse than no
> number*

**Encerradas** era medida fora do escopo e o clique aplicava `isVisible`:
toda conversa encerrada E oculta era contada e não aparecia. **Entrada e
Esperando** contavam antes do filtro ativo, então com "Sem resposta há 24h"
ligado, Entrada podia dizer 12 e produzir 3.

Nos dois casos a escolha foi **estreitar**, não alargar — com uma exceção
nomeada: o filtro que substitui o escopo. Encerradas e Ocultas tiram a barra
de jogo inteira, e ali os segmentos contam o escopo a que você volta.

O caso de Encerradas virou teste, e o teste acusa a versão anterior: uma
conversa `closed` + `hidden_at` dá `count: 0` em Encerradas e `count: 1` em
Ocultas. Contra o código de ontem, `expected 1 to be +0`.


---

## Fase 6 — a caixa de entrada, e os menus do app inteiro

Nove achados. Seis são da lista de conversas; três saíram dela e viraram
regra de átomo, porque o defeito não era da inbox.

### O número da direita, na fila de espera (M1)

Esperando ordena por `waiting_since` — a mais antiga em cima, e é a única aba
que ordena assim. A linha imprimia a idade da **última mensagem**. Como
parquear normalmente é uma resposta, a conversa parqueada há três dias com um
"já te retorno" recente aparecia acima de uma com número menor: a lista
parecia ordenada ao contrário, e a suspeita natural é de bug na ordenação.

Só a base do cálculo mudou; o número curto é o mesmo, e ganhou `title` com a
frase inteira. A chave `waitingSince` já existia nos três catálogos e não era
usada em lugar nenhum de `src` — estava escrita esperando por isto.

### A barra que não fazia nada (M2)

Com Encerradas ou Ocultas em vigor, o escopo é substituído: a barra
Entrada/Esperando continuava acesa, clicável e inerte. Agora clicar num
segmento **larga o filtro** e vai para a aba. Não foi desabilitada de
propósito — apagar a barra tiraria a saída mais rápida do estado em que a
pessoa está presa, e é ali que ela mais precisa dela.

O vazio também mentia: *"Nada em Esperando com o filtro Encerradas"* descreve
uma interseção que o código nunca calculou.

### O menu de filtro (M6, M7, M8, M3)

Quatro defeitos empilhados no mesmo menu:

- **A opção ligada aparecia desabilitada.** As contagens são medidas antes do
  filtro, então ler as três não-lidas zera a linha que está em vigor — e o
  menu trancava a única saída visível dela. A exceção agora está nomeada no
  comentário, ao lado da regra que ela excetua.
- **Clicar na opção ativa não fazia nada.** Virou toggle, o mesmo destino do
  X ao lado do gatilho.
- **A marca de "ligado" era só negrito.** O ternário de cor comparava
  `--foreground` com `--popover-foreground`, que são o **mesmo oklch nos dois
  modos** — código que parece pintar e não pinta. Entrou o ✓ que as cinco
  marcas do menu vizinho já usam. A pílula de contagem fica neutra: são ~24
  numa lista só, e uma significando "onde você está" enquanto as outras
  significam "quantas são" é ruído, não marcador.
- **Os cabeçalhos de grupo eram `<div>` cru dentro de `role="menu"`.**
  Viraram `DropdownMenuGroup` + `DropdownMenuLabel`, o padrão do
  `flow-builder.tsx` — `role="group"`, cabeçalho anunciável, e o `px-1.5` do
  rótulo alinhando com os itens em vez do `px-2` que os deixava meio
  caractere fora da coluna.

E o rótulo do gatilho ganhou teto: ele é vocabulário livre da conta (o nome
de um funil, o de uma etapa) e abaixo de `lg` divide a linha com a busca.

### Os menus do app inteiro (M9, M10, M13)

Dois destes começaram como achados da inbox e terminaram em `globals.css` e
em dois átomos, porque o defeito nunca foi de lá.

**44px chega ao gatilho e para.** A regra do dedo cobre botões, gatilhos e
campos; o menu que eles abrem tinha linhas de 28px (dropdown) e de 32px
(contexto) — e o menu de contexto é justamente o que a lista abre por
**long-press**, um gesto de telefone respondido com alvo de mouse. Sete slots
passaram a crescer de verdade, e não pelo escudo `::before`: o comentário
daquele bloco já explica que numa grade apertada o escudo rouba o toque do
vizinho, e um menu é exatamente uma grade apertada — meia linha ficaria
dentro da linha de cima.

**Desabilitado era ilegível.** `opacity-50` sobre um item que existe *para
ser lido* — o menu desabilita as opções zeradas justamente porque "não há
nenhuma agora" é uma resposta, e uma resposta que não dá para ler não é
resposta. Agora é `text-muted-foreground` em opacidade cheia, nos dois menus,
com uma exceção: o item destrutivo fica com a opacidade, porque vermelho a
100% sem sinal nenhum de desabilitado seria pior que o problema.

E os dois ✓ da caixa de entrada tinham tamanhos diferentes.


---

## Fase 9 — rótulos, foco e átomos

Doze achados sobre o que um formulário deve ao teclado, ao dedo e a quem não
está vendo a tela.

### Rótulos que não apontavam para nada (S11, T10)

`grep -n 'id="'` no formulário de negócio não devolvia **uma linha**. Oito
rótulos, oito controles anônimos: clicar no rótulo não focava o campo, e um
leitor de tela anunciava o valor sem dizer de quê. No diálogo de tarefa eram
mais três, e o select de lembrete era o único controle do formulário sem nome
nenhum — o dia e a hora ao lado já tinham `aria-label`.

"Prazo" não virou `htmlFor` porque ele rotula **três** controles, e um rótulo
só aponta para um: virou `role="group"` com `aria-labelledby`. Os três
mantêm os seus próprios nomes — a repetição "Prazo, grupo / Prazo" custa
menos que um campo anônimo.

### `<button>` cru onde o resto do app usa `Button` (T7, R10, F16)

Os cinco presets de prazo eram `<button>` de 24px. O que a troca entrega não
é aparência — `size="sm"` já traz o mesmo `rounded-md text-xs` — é o
`data-slot="button"`, que é por onde o `globals.css` concede o alvo de 44px
no dedo. Eles conviviam com campos que a mesma folha eleva a 44.

A string `h-7 rounded-md border px-2.5 text-xs font-semibold` aparecia
idêntica, caractere por caractere, em três arquivos. Virou `ChoiceChip` — e
não `FilterChip`, porque a forma é significado nesta casa: pílula é estado,
retângulo é escolha entre poucas. Dos três chamadores, só um escrevia
`aria-pressed`; nos outros não havia como saber qual opção estava marcada.

E o catálogo tinha o único `<input type="checkbox">` cru do app, 14px pintado
com `accent-primary`.

### Cor que diz a coisa errada (S10, S13)

"Marcar como ganho" era **azul cheio** — o mesmo tratamento do Salvar ao lado
— enquanto "Marcar como perdido" era vermelho tingido. O par lia como uma
ação principal e uma secundária, quando são duas saídas simétricas; e o azul
disputava com o único "aperte aqui" da sheet. Entrou a variante `ok` no
`Button`, espelho exato da `destructive`.

"3 atrasadas" era um retângulo com `bg-danger-soft text-danger-ink` — o
`variant="danger"` do `StatusBadge` escrito à mão, letra por letra, só sem a
altura fixa e sem a forma. A forma é o que o componente documenta: estado é
pílula.

### O formulário de produto não era um formulário (F11, F12, F15)

Onze campos soltos com um `onClick` no fim: Enter não salvava, no catálogo
cujo próprio vazio manda cadastrar dez produtos seguidos. Virou `<form>` com
`onSubmit`.

A dica ficava **entre** o rótulo e o campo aqui e **abaixo** do campo no
formulário de contato. Abaixo é a ordem certa, e a razão está escrita no
cabeçalho do `ui/field.tsx`: embaixo ela é legenda do que acabou de ser lido;
no meio ela separa o rótulo do campo e vira mais um par de linhas
competindo.

E `Field` significava duas coisas. O `ui/field.tsx` exporta um `Field` que é
um `div` de margem sem rótulo nenhum; o catálogo declarava um `Field` local
com assinatura incompatível. Duas assinaturas sob a mesma palavra é o tipo de
coisa que só dá errado no dia em que alguém importa a errada. O local virou
`FieldRow` em `ui/field.tsx`, e o formulário de contato adotou — o que também
acabou com as **duas espessuras** que ele tinha para a mesma linha
(`space-y-2` nos quatro campos de cima, `space-y-1.5` nos dez da gaveta).

Três blocos ficaram de fora e está escrito por quê: o telefone (o que vem
depois do campo é um painel condicional, não dica), as etiquetas (fileira de
botões, não controle rotulável) e o descadastro (caixa com faixa âmbar).

### E dois detalhes (T12, C14)

O `<span />` de espaçamento no rodapé do diálogo de tarefa cobrava 8px de
faixa em branco abaixo de `sm` em **toda tarefa nova** — o rodapé é uma
coluna com `gap-2`, e um irmão vazio ainda é um irmão.

A zona de upload tinha dois ladrilhos: 36px com arquivo escolhido, 40px sem.
Escolher um arquivo encolhia o ladrilho e refluía a caixa. E 40 nem está na
escada que o `atoms.test.ts` nomeia.


---

## Fase 11 — formulários longos

Doze achados nos três formulários de entrada de dados. Dois deles são código
que nunca rodou; um é uma perda de trabalho silenciosa; um derruba a
aplicação.

### Código morto que parecia funcionar (F1, F5)

O aviso de **CNPJ duplicado nunca disparou**. A consulta era
`.select('id, name')` e a comparação lia `row.tax_id` — sempre `undefined`,
`normalizeTaxId(undefined)` devolvendo string vazia, nunca igual aos dígitos
digitados. O bloco que imprime "já existe um contato com este CNPJ" era
inalcançável desde que foi escrito.

De quebra, o corte no banco era "qualquer linha com CNPJ" com `.limit(200)` e
sem `order`: acima de 200 contatos com CNPJ na conta, um falso negativo
garantido mesmo com a coluna na projeção. Agora é `.in` das duas grafias — e
não `.eq` dos dígitos, porque a coluna não tem CHECK nem trigger de
normalização e linhas antigas podem estar pontuadas.

E "CNPJ inválido" piscava **sob o cursor**: `isValidTaxId(taxId)` era
avaliado a cada render, e no 11º dígito de um CNPJ a função cai no ramo de
CPF e reprova. O próprio campo já dizia, no comentário do `onBlur`, que a
checagem é na saída; e a `tax-id.ts` diz por quê — *a form that says "CNPJ
inválido" over three digits is a form people learn to ignore*. O veredito
agora é gravado no blur, e apagar o campo o limpa.

### Trabalho que some (F7)

O painel do formulário e a lista com os lápis ficam na tela ao mesmo tempo.
Com "Novo produto" meio preenchido, clicar num lápis sobrescrevia os onze
campos — e o painel **não desmonta**, porque só troca `editing` de `new` para
um id. Nada se move na tela e o trabalho some. Agora pergunta, e só quando há
rascunho sujo; a comparação é com o rascunho vazio e não com o nome, porque
sem nome o Salvar já está desabilitado e é justamente aí que o que se perde é
o resto.

### Soltar um arquivo derrubava a aplicação (C9)

`grep onDrop` no modal de importação não retornava nada. A borda tracejada é
o convite universal a arrastar, e sem `preventDefault` o navegador abre o CSV
como documento e leva a aplicação junto — trabalho não salvo, sessão. Os
handlers foram para o **diálogo inteiro**, não só para a zona: `preventDefault`
só na zona ainda deixa a página cair se o arquivo for solto dois centímetros
ao lado, que é o normal. O realce, esse sim, fica na zona.

Isso exigiu separar o caminho do arquivo do evento do `<input>`: um `drop`
entrega um `File`, não um `ChangeEvent<HTMLInputElement>`.

### Recusa com cara de aceitação (C10)

O arquivo era posto no estado **antes** do parse, então um CSV rejeitado
ficava com a moldura azul, o ladrilho azul e a pílula "0 linhas prontas" — a
aparência exata de sucesso. Azul dizendo "deu certo", que não é o que azul
quer dizer.

E as três causas de "nenhuma linha" — arquivo só com cabeçalho, sem coluna
`phone`, nenhum telefone preenchido — devolviam o mesmo aviso, que nomeia a
segunda. O parser agora devolve `failure`, e as três estão em teste.

### O resto (F6, F8, F13, F17, F18, C11, C15)

- **A gaveta comercial** abria por sete campos e edita onze. Origem, ticket
  médio, ciclo de recompra e UF — todos impressos na ficha — ficavam
  escondidos ao abrir a edição, que é exatamente o que o comentário logo
  acima jurava evitar. Virou lista nomeada: o próximo campo entra por
  acréscimo, e esquecer é visível.
- **Ticket médio** era um `type="number"` cru enquanto todo o resto do
  dinheiro do produto passa pelo `CurrencyInput` — e a ficha imprime esse
  mesmo valor com `formatCurrency`. Fica registrado o efeito: um ticket com
  centavos passa a ser exibido arredondado, e regravado inteiro **se** a
  pessoa mexer no campo. É o que já acontece com o preço do produto.
- **O aniversário** cobra um ano que o tipo, a migração e a automação dizem
  os três que ninguém usa. Ganhou dica — e ela ensina a data completa de
  propósito, porque o `DateField` engole "15/03" em silêncio.
- **O "40x60cm"** é coluna gerada, a lista imprime e a busca casa contra ela.
  Quem cadastra só via a string depois de salvar, que é tarde para notar que
  digitou 400. Agora tem prévia, com os quatro ramos do CASE da migração —
  não só o completo, porque é no meio-preenchido que o erro aparece.
- **O rodapé do formulário de contato** rolava para fora do diálogo. A
  correção é de uma linha e vale **só aqui**: o `DialogContent` é uma grade,
  e um filho direto de grade com `sticky` tem curso zero — este é o único
  diálogo que embrulha o corpo num `<form>`.
- **O diálogo de excluir campo** punha três frases no título e um "Confirmar"
  genérico no botão, com `description` e `confirmLabel` existindo no
  componente e sem uso.
- **O campo de renomear** só se anunciava no hover, e no toque não há hover.
  `bg-muted` em repouso também acaba com as duas aparências de campo no mesmo
  diálogo.


---

## Fase 12 — catálogos e comentários

Quinze achados, e a maioria é **texto**: frases da interface e comentários de
código que afirmam o contrário do que o código faz. São os mais baratos de
corrigir e os mais caros de deixar, porque quem lê acredita.

### Onze chaves que nunca foram lidas (C5)

`rowsReady_plural`, `toastSkipped_plural`, `ipCount_plural` — onze delas, nos
três catálogos. Esse sufixo é convenção do **i18next**, e este app roda
next-intl, que fala ICU e nunca olha a chave irmã. O singular saía sempre:
*"3 duplicado ignorado"* na importação, *"5 IP permitido"* nos webhooks.

A paridade entre catálogos estava perfeitamente satisfeita — o erro foi
cometido igual nos três. E o modo de falhar é o que justifica a guarda nova:
o singular está **certo** em `count: 1`, que é o primeiro caso que qualquer
pessoa testa à mão.

As onze chaves-base viraram ICU; o coreano leva só a categoria `other`,
porque a língua não flexiona número. E o `messages.test.ts` passa a reprovar
qualquer chave terminada em `_plural` — provado contra o catálogo de ontem.

### Frases que afirmam o contrário do código (F2, F9, C1, T1)

- **"O nome é obrigatório"**, no diálogo de contato. A única validação é o
  telefone, o asterisco está no rótulo do telefone, o nome é gravado como
  `null` quando vazio e a coluna é nullable desde a 001.
- **A dica da descrição do produto** manda escrever ali medidas e espessura;
  quatro controles acima, a dica das dimensões diz *"tipadas, e não escritas
  na descrição"*, e a 055 criou as três colunas. "Quantos por caixa" não tem
  coluna nenhuma e por isso continua legítimo na descrição.
- **"Criar campanha com este público"** não leva público nenhum: o push é
  seco e o assistente abre em `{ type: all }` — o `AudienceConfig` não tem
  cidade, UF, compra nem dias parados. O rótulo virou "Nova campanha", e o
  comentário deixou de prometer um handoff que não existe.
- **"O lembrete sai às 08:00"** só é verdade na antecedência zero. Nas outras
  cinco escolhas, `firstOpenTime` é a BASE e a antecedência é subtraída dela
  — o próprio `reminders.ts` escreve o contraexemplo. A frase passou a dizer
  o que ela sabe: *"o prazo conta como {time}"*.

### Comentários que discordam entre si (R14, S12, A14)

O diálogo de ocorrências dizia *"WAITING ON A MIGRATION… 042 is written and
not applied"* enquanto o `kinds.ts` — mais novo, e importado por ele — diz
que a 042 **foi** aplicada e mediu isso. Dois comentários do mesmo assunto
discordando é pior que nenhum: o leitor não sabe qual acreditar. O guard de
tabela ausente fica, agora com o motivo certo escrito.

O formulário de negócio prometia "the newest OPEN one" numa consulta sem
filtro de status. Aqui o certo era corrigir o **comentário**: a 036 põe
UNIQUE em `(account_id, contact_id)`, então filtrar por status esconderia a
única conversa do contato sempre que ela estivesse encerrada.

E a aritmética ao lado do esqueleto da agenda somava 66px onde o componente
desenha 58. Um esqueleto não pode se medir; a única defesa é a conta escrita
ao lado — e uma conta errada é pior que nenhuma, porque parece conferida.

### A tabela de contatos (C7, C13, C6)

A linha guardava **etiquetas resolvidas**, montadas contra o `tagsMap` do
momento com um `.filter(Boolean)` que descartava em silêncio a etiqueta que o
mapa ainda não conhecia. Uma automação que pendura uma etiqueta nova
disparava o realtime, a linha era rebuscada — e a etiqueta sumia até o F5,
que é exatamente o que o comentário do realtime jura evitar. Agora a linha
guarda **ids** e a resolução acontece na renderização, junto com o mapa; de
quebra o `tagsMap` saiu das dependências da busca, e com ele a segunda
consulta não-silenciosa que ele causava no mount.

Quais **três das sete** etiquetas apareciam era indefinido: a consulta de
`contact_tags` não tem `ORDER BY`, e sem ele o Postgres não promete ordem
nenhuma. Agora ordena por nome, no mesmo idioma do popover de filtro da
própria página, e o "+4" ganhou `title` com os nomes que ficaram de fora — o
número sozinho conta quantas e não diz nenhuma.

E cada tecla na busca era uma consulta `count: exact` **com** troca de tela:
escrever "Marcos" eram seis. O `fetchSeq` protegia contra resposta fora de
ordem, não contra disparar por tecla. Entrou o rascunho com 250ms — não é
número novo, é a mesma janela de rajada do realtime de contatos. O botão de
limpar lê o rascunho, para aparecer na primeira tecla.

### Os diálogos (R9, R12, R13, C12)

- **"Registrar ocorrência"** na ficha abria o histórico e pedia o mesmo
  clique de novo, num botão com o **texto idêntico**. Agora abre no
  formulário, com o cursor no campo, e o botão da esquerda vira Cancelar
  enquanto se digita — antes a única saída descartava o texto sem dizer.
- **Trocar o resultado da ligação** desmarcava o retorno que a pessoa tinha
  marcado à mão. O palpite existe para quem esqueceu; agora ele só vale
  enquanto ninguém tocou na caixa.
- **O aviso da tarefa de retorno** imprimia `2026-09-09` cru, num diálogo que
  escreve dd/mm/aaaa a poucos pixels dali — e escondia a hora, que o
  expediente da conta decidiu e que a tarefa vai gravar. Agora "9 set 08:00".
  E o `useMemo` ganhou `open` na lista de dependências: uma aba aberta desde
  ontem calculava "amanhã" a partir do dia em que foi montada, errando o
  texto **e** a data gravada.
- **Cidade na segmentação** era igualdade sensível a maiúsculas num campo sem
  placeholder: "porto alegre" devolvia zero numa base cheia deles. Virou
  `ilike`, com os curingas do LIKE escapados e o custo de índice registrado
  no comentário. A UF continua `eq` — ela vem de um campo que já faz
  `toUpperCase`.

