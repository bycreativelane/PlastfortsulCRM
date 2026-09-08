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

