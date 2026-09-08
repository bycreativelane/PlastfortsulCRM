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
