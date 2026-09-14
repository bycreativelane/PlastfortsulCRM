# Pacote de correções — 7 de setembro de 2026

> **A origem.** [`pacote-correcoes-v2.md`](./pacote-correcoes-v2.md), 59 itens
> em 2138 linhas, escrito a partir de **testes reais de uso** e com imagens dos
> erros. Desde 8 de setembro ele está no repositório — antes só existia na
> máquina do Gabriel, e este documento era a única memória do que ele pedia.
>
> **Mantenha a tabela de status em dia.** Ela é a resposta para "isto já foi
> revisado?", e uma tabela desatualizada responde errado com confiança.

O pacote é diferente dos anteriores: `spec-automacoes-fluxo.md` desenhava um
fluxo a partir de um modelo comercial, e este corrige o que quebrou quando
esse fluxo encontrou a operação. Quase todo item nasce de uma tela que não
fez o que devia.

---

## Revisão do pacote — 8 de setembro de 2026

Leitura item a item contra o código, e não contra este documento. Nove
achados, e nenhum deles é "falta implementar" — esses estão nas tabelas
abaixo. Estes são os que **mudam o que vale a pena fazer**.

### R1. O item 37 estava arquivado no lugar errado, e ia se perder

Este documento dizia "itens 37–59: oportunidade e orçamento". **O bloco do
orçamento começa no 38.** O item 37 é outra coisa — _Chat Interno, simplificar
visual_ — e estava enfileirado atrás da maior release do pacote sem nunca ter
sido lido como o que é: um ajuste visual de meia hora, da mesma família do
item 2.

Corrigido nas tabelas: 37 virou um item de P2.

### R2. O item 37 tem alvo e origem exatos, e os dois já existem

O pacote descreve um "Chat Interno" carregado (avatar, nome, data, prévias
empilhadas) e pede que ele fique como um "Minha equipe" limpo, com dúvida
sobre qual nome usar. No código não há dúvida — **são dois componentes vivos,
e um é literalmente o desenho que o outro deveria ter**:

|             | Componente                                    | O que desenha                                                          |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| o carregado | `layout/team-room-card.tsx` (trilho lateral)  | ícone, título, **três linhas** de histórico com autor e hora, contagem |
| o desejado  | `inbox/conversation-list.tsx` → `TeamRoomRow` | ícone, "Minha equipe", "Conversa interna da PlastfortSul", um ponto    |

`Inbox.team.title` e `Inbox.team.rowHint` são, palavra por palavra, a
"referência desejada" transcrita no pacote. Então o item 37 é: **fazer o card
do trilho virar a linha da caixa de entrada.** Não há decisão de nomenclatura
a tomar — a área se chama Minha equipe nas duas superfícies desde sempre.

### R3. …e ele contraria uma decisão registrada no próprio arquivo

`team-room-card.tsx` argumenta em comentário por que carrega três linhas:

> Era uma, e uma linha é uma notificação: alguém disse alguma coisa. Três é o
> menor número que mostra uma CONVERSA — uma pergunta e uma resposta ainda
> cabem […]. Essa decisão é o trabalho inteiro deste card.

O pedido do item 37 remove exatamente isso. **A chamada é do Gabriel** e o
pacote nasceu de uso real, que ganha de um comentário. Mas vale saber o que se
troca: sem prévia, o card do trilho vira um item de navegação — e o trilho já
tem uma lista de navegação. Se a prévia sai, a pergunta honesta é se o card
deve **virar uma linha do menu** em vez de virar um terceiro padrão de card.

### R4. O item 9 já está feito, e o pacote foi escrito antes disso

"Não manter duas experiências diferentes para editar o mesmo registro."

O `inbox/page.tsx` monta o **mesmo** `ContactForm` e o **mesmo**
`ContactDetailView` que o `contacts/page.tsx`, e diz por quê em comentário:
_"Same component the Contacts page opens, so there is one contact record in
the product rather than a panel and a page that drift."_ O `ContactForm` tem
todos os campos que o item 9 lista — cargo, CNPJ, cidade, UF, aniversário,
origem, última compra, próxima prevista, ciclo, ticket.

O que a imagem do pacote mostra (nome, telefone, e-mail, empresa + abas +
"Enviar template") é o `inbox/contact-sidebar.tsx`, que é um **painel de
leitura**, não um editor — e o lápis dele já chama `onEditContact`, que abre o
formulário completo.

**Resta verificar em tela, não implementar.** O item sai de P1.

### R5. Os itens 43, 45 e 46 mandam apagar e reconstruir a mesma coisa

- **43** — remover "O que tem nesta oportunidade" e "Adicionar linha".
- **45** — criar um campo Produto que reutilize os produtos cadastrados e
  guarde produto, SKU, quantidade, valor unitário, subtotal.
- **46** — o Valor deve ser calculado a partir dos itens.

A tabela `deal_items` (migração 054) já é: `product_id` → `products`, `name`
congelado, `quantity`, `unit_price`, `discount_percent` e um `total`
**GENERATED** — e `Pipelines.form.valueFromItems` já diz "Somado a partir das
linhas abaixo". O 45 e o 46 pedem, coluna por coluna, o que o 43 manda apagar.

O próprio 43 nomeia o risco que criaria: _"Não deixar dois sistemas diferentes
de itens dentro da mesma oportunidade."_

**Leitura para o plano:** a queixa do 43 é de **apresentação**. A seção é
pesada e o vazio dela diz "Sem linhas. O valor acima é o que alguém digitou.",
que é uma frase de diagnóstico interno numa tela de vendedor. Então: manter
`deal_items`, redesenhar a seção como **Produto**, e o 43, o 45 e o 46 se
resolvem juntos sem migração destrutiva.

### R6. O item 39 colide de frente com o item 3, que já está no ar

O 39 troca o rótulo `Título` por **`Pedido de venda`**, para receber o número
do Bling (`14349`).

O item 3 — já implementado — deixou o título **opcional** e fez
`resolveDealTitle` preenchê-lo sozinho com o nome do contato, caindo no
telefone. E o item 17 — também já implementado — faz **toda conversa nova**
criar uma oportunidade por esse caminho.

Somados: todo negócio criado pelo produto nasce com `Euclides Fernando
Goncalves` num campo que passará a se chamar **Pedido de venda**.

Não é motivo para não fazer o 39; é motivo para o 39 **não reaproveitar a
coluna `title`**, apesar de o pacote permitir ("internamente pode continuar
usando o campo existente de título se isso evitar migration desnecessária").
A migração deixou de ser desnecessária no dia em que o título virou um rótulo
gerado por automação.

### R7. O padrão é BRL no pacote e `USD` no banco

O item 41 tira `Moeda` da tela e diz "usar `BRL` como padrão, manter isso
internamente". Hoje:

- `021_account_default_currency.sql`: `default_currency TEXT NOT NULL DEFAULT 'USD'`
- `engine.ts:1032`: `currency: acct?.default_currency ?? 'USD'`

Esconder o campo sem corrigir os dois defaults transforma um erro visível num
erro silencioso: a oportunidade nasce em dólar e ninguém mais tem onde ver.
**Os dois andam juntos ou nenhum anda.**

### R8. O item 10 responde uma pergunta que estava aberta aqui

`toE164` devolve `+51990000001` para `51990000001` — que é Peru. O código
registrava isso como "precisa de uma decisão de produto sobre país padrão".

O item 10 **é** essa decisão, e ela está completa: Brasil é o padrão; sem
código de país, prefixar `+55`; começando com `+55`, não duplicar; começando
com `+` e outro código, preservar. Nada mais a perguntar — é implementação.

### R9. Uma coisa que eu fiz ontem, o item 41 manda apagar

O commit `62b4d47` arrumou o selo "Prazo vencido" do campo **Previsão de
fechamento**, e o `04e9e61` mexeu na linha em que ele vive. O item 41 remove
esse campo da interface.

Fica registrado sem drama: o trabalho não foi perdido (a linha do grid e o
padrão de rótulo-com-selo seguem valendo para o campo de data das tarefas),
mas **não vale voltar a mexer nesse campo** antes de o bloco 38–59 decidir se
ele fica.

---

## Ordem de execução

A do próprio pacote (item 34), com o 37 recolocado.

|        |                                       | Estado                                                                     |
| ------ | ------------------------------------- | -------------------------------------------------------------------------- |
| **P0** | bugs que bloqueiam operação           | 5,5 de 6 — a auditoria corrigiu 5 defeitos; sobra o que só a Meta responde |
| **P1** | experiência de atendimento            | 6 de 6 — fechado em 8 de setembro                                          |
| **P2** | produtividade                         | 3 de 4 — falta a revisão visual em tela autenticada                        |
| —      | itens 38–59: oportunidade e orçamento | feito e aplicado em 8 de setembro                                          |
| —      | a oportunidade no modelo do Bling     | escrito em 8 de setembro; **falta aplicar as migrações 074, 075 e 076**     |
| —      | Minha equipe: prévia, @menção, número | escrito em 14 de setembro; **menção e número dependem da 077**              |

---

## P0 — bugs que bloqueiam operação

### ✅ 1. `Cannot keep automation active with invalid configuration` (item 3)

Eram **duas** causas, e a segunda só apareceu ao mexer na primeira.

O validador exigia `title` no passo `create_deal`, e a UI sempre desenhou
esse campo como um input comum, sem marca de obrigatório. Quem montava a
automação mais comum do produto batia numa parede que não dizia qual campo
faltava.

E o resolvedor de modelos preenchia `stage_id` mas **nunca `pipeline_id`** —
então um `create_deal` vindo de modelo nascia com o funil vazio e era
recusado pelo mesmo erro, por outro motivo.

O título deixou de ser obrigatório: `resolveDealTitle` usa o nome do
contato, cai no telefone, e nunca num UUID. `refs.pipeline` fecha o segundo.

> **Cuidado ao chegar no item 39.** Este conserto é o que colide com "Pedido
> de venda". Ver R6.

### ✅ 2. Seletor de etapa mostrando UUID (item 30)

Ele já escolhia por nome — exceto quando `pipelines.length === 0`, que caía
em dois campos de texto cru. E a lista começa vazia: **vazia e ainda-não-
carregada davam a mesma resposta**, então o instante inicial de toda edição
desenhava UUIDs. O contexto ganhou uma flag `loading`.

> **O mesmo defeito está vivo no item 12**, no campo Contato. Ver a nota de
> P1 abaixo — o remédio já existe e é este.

### ✅ 3. Erro Meta `#132000` (item 7)

Também duas causas.

`buildBodyComponent` só pulava o componente de corpo quando
`varCount === 0 && body.length === 0` — as duas coisas. Com um template sem
variável e um valor sobrando, emitia `{ type: 'body', parameters: [] }`: um
componente de corpo **vazio**, que a Meta recusa. O caminho é banal e foi o
que aconteceu — a automação foi montada quando o template tinha `{{1}}` para
o nome, o template foi recriado sem variável, e a automação seguiu mandando
o valor.

E as automações apontavam para **templates que não existem**: mandavam
`followup_d1`, `posvenda_d20`, `compra_futura`, `aniversario_cliente`, e os
aprovados são `followup_orcamento_d1`, `posvenda20d`, `comprafutura`,
`aniversario`. Dez nomes corrigidos.

`src/lib/whatsapp/approved-templates.ts` passa a ser a fonte da verdade
sobre quais nomes o fluxo pode usar. Ele tem **só nomes**, de propósito: o
pacote lista os aprovados sem transcrever os corpos, e inventar um corpo
para poder validar contra ele seria trocar uma referência velha por uma
imaginada.

> **Aberto:** sincronizar `message_templates` com a Meta. A conta de
> desenvolvimento tem zero templates, então nada disso foi exercitado contra
> corpos reais. Enquanto isso, a contagem de variáveis não pode ser
> verificada em teste — ela é feita em tempo de envio, contra o corpo real.

### ✅ 4. Compra Futura move a oportunidade (item 5)

A ação rápida gravava a data e parava. O texto do diálogo dizia a verdade —
"a data fica na ficha do contato" — e a verdade era o problema.

Agora move para VENDAS → Compra Futura na mesma confirmação, sem duplicar:
procura uma oportunidade **aberta** do contato no funil e só cria quando não
há nenhuma. Falhar em mover **não desfaz a data**.

### ✅ 5. Toda conversa nova vira oportunidade em Novo Lead (itens 4 e 17)

**As dez automações do funil não incluíam essa.** Todas reagem a uma
oportunidade que já existe; nenhuma criava a primeira. O funil oficial
começava numa coluna que só enchia à mão. São onze agora.

Gatilho novo `conversation_created`, porque `first_inbound_message` só pega
o cliente escrevendo primeiro. O sinal já existia no webhook e nunca chegava
ao motor.

**Uma interpretação a registrar.** O item 4 pede "uma oportunidade por
conversa". Este produto tem **uma conversa por contato**, então a regra ao pé
da letra travaria a segunda venda ao mesmo cliente para sempre — o oposto do
que o funil de recompra existe para fazer. A trava implementada é sobre
oportunidade **aberta**: uma ganha ou perdida não bloqueia um novo ciclo.

### 🟡 6. Auditoria das automações (itens 16–31)

Comparar as onze automações instaladas contra as especificações item a item.
As correções de estrutura que já entraram, dos itens 20, 22 e 25:

- Follow-up passou de D1 → D3 → D10 → D30 (2, 7, 20 dias) para
  **D1 → D2 → D3 → D30** (1, 1, 27). O fluxo oficial não usa mais o D10.
- Saiu a espera de 24 h antes da Geladeira: o item 20 diz "mover
  imediatamente".
- A Geladeira 30D **não mandava mensagem nenhuma** — esperava trinta dias e
  movia a oportunidade de coluna em silêncio. Ganhou o
  `reativacao30dgeladeira30d`.
- O segundo `recompra_60d` (o de 120 dias) virou `recompra_120d`.

Dois itens que a auditoria pode riscar já, verificados em 8 de setembro:

- **Item 25 (pós-venda) está certo.** `templates.ts:541` monta 20 d →
  `posvenda20d` → mover para Pós-venda → 40 d → `recompra_60d` → 60 d →
  `recompra_120d` → fim, e `cancel_when_stage_in` lista **só** a Venda
  Perdida. A exigência do pacote — "mover para Pós-venda no D20 não pode
  cancelar os waits D60/D120" — é atendida por construção.
- **Item 29 (motivo obrigatório) está feito, inclusive no arrasto.**
  `pipelines/page.tsx:371` intercepta o movimento com
  `outcome.request(moved, target)` antes de escrever, e a caixa de entrada faz
  o mesmo em `message-thread.tsx:1010`. Cancelar não grava, e o refetch devolve
  o card à coluna anterior.

#### A auditoria, feita em 8 de setembro

As onze automações lidas contra os itens 17–31, uma a uma. Está tudo em
`templates-funnel.test.ts`, na suíte **"a auditoria do pacote — itens 16 a
31"**: uma auditoria em prosa apodrece na primeira edição do arquivo, e cada
asserção lá cita o item que a exige. Sete delas acusam o `HEAD` anterior.

**Cinco defeitos, e três deles eram a mesma ativação recusada do item 3.**

**A1 — `Ligação` faltava nas três listas de cancelamento (itens 19, 20, 22).**
Os três itens repetem a mesma lista de seis etapas; o código tinha cinco.
`FUNNEL.call` estava declarado e **não era referenciado por linha nenhuma** do
arquivo, que é a assinatura de uma omissão e não de uma escolha. O custo: o
vendedor combina de ligar, arrasta o cartão para Ligação, e o robô segue
mandando D1, D2, D3 e D30 para quem acabou de marcar uma conversa por
telefone.

**A2 — `Em Aberto` faltava em "Cliente respondeu" (item 21), e é o caso mais
comum do funil.** O item nomeia cinco etapas em que a resposta move a
oportunidade para Em Negociação, e `Em aberto` é a primeira. Sem ela: o
vendedor manda o orçamento com `/aberto`, o cliente responde — o melhor
desfecho que existe antes da venda — e nada acontece. Pior: o relógio de 24 h
via a resposta, encerrava com `customer_replied`, e o cartão ficava parado em
Em Aberto sem automação nenhuma pendurada.

**A3 — `/atendido` não cancelava a Compra Futura (item 24).** A lista da
Compra Futura era curta e escrita à mão (`negociação, em andamento,
perdida`), sem `Atendido` nem `Ligação`. Agora é a mesma lista das outras,
menos a própria etapa que a dispara — uma automação não pode se cancelar ao
entrar na etapa do próprio gatilho.

**A4 — a etiqueta `Lead` impedia a ativação da automação da VENDA.** O
`/andamento` tinha um passo `remove_tag` da etiqueta `Lead`. Os itens 23 e 35
proíbem mexer nessa etiqueta e **nada neste produto a cria** — então
`findTag` devolvia `null`, o passo instalava com `tag_id: ''`, e
`validate.ts:103` recusa isso com "tag is required". Numa conta limpa,
`/andamento → Em Andamento` **não conseguia ficar ativa**. É o
"Cannot keep automation active with invalid configuration" do item 3 por uma
terceira causa.

**A5 — o resolvedor era cego a hífen, e o pacote escreve tudo com hífen.**
`normalizeName` tirava acento, caixa e espaço sobrando, e deixava o traço.
O pacote escreve as etapas como elas aparecem na tela — `Compra-futura`,
`Geladeira-30D`, `Geladeira-60D` — e este arquivo as declara sem hífen:
`compra-futura` nunca casaria com `compra futura`. Um nome que não resolve
instala o passo com `stage_id: ''`, que é a **quarta** causa do mesmo erro de
ativação. Agora a família inteira do traço vira espaço, dos dois lados.

#### Verificado e correto, sem mexer

| Item | Automação                 |                                                                                             |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------- |
| 17   | Nova conversa → Novo Lead | `conversation_created`, `once_per_conversation`, sem etiqueta                               |
| 18   | `/aberto` → Em Aberto     | um passo, exato                                                                             |
| 22   | Geladeira 30D             | 30 d → `reativacao30dgeladeira30d` → 60D                                                    |
| 25   | Pós-venda e recompra      | D20/D60/D120 acumulados; só a Venda Perdida cancela                                         |
| 26   | Compra Futura             | espera até a data, 09:00, `comprafutura`                                                    |
| 27   | Aniversário               | sem mudar funil; `opted_out` filtrado na própria RPC; `trigger_key` garante uma vez por dia |
| 29   | Motivo obrigatório        | inclusive no arrasto do Kanban                                                              |
| 30   | Seletor de etapa          | corrigido no P0 §2                                                                          |

#### A6 — a décima segunda automação não deve ser criada

O item 28 pede um card "Venda Perdida" que cancele as quatro pendentes. As
cinco automações longas **já** cancelam ao entrar em Venda Perdida, por
`cancel_when_stage_in`. Uma automação cujo único trabalho é repetir uma regra
que já está em vigor é uma segunda fonte da verdade sobre cancelamento — e a
primeira coisa a divergir. **Recomendação: não criar**, e riscar o item 28 com
esta justificativa.

#### A7 — aberto, e é o que o cliente lê

`funnel_followup` manda `{{deal.title}}` como segunda variável do D1, D2 e D3.
O corpo do protótipo diz o que essa variável é:

> "Olá {{1}}! Passando para saber se conseguiu dar uma olhada no orçamento de
> **{{2}}** que enviamos." — `sample_values: ['Marcos', 'sacos de lixo 100L']`

`{{2}}` é o **produto orçado**. E desde o item 3, `resolveDealTitle` preenche
o título com o **nome do contato** — e desde o item 17 é assim que nasce toda
oportunidade. O cliente recebe, três vezes:

> "Olá Euclides! …uma olhada no orçamento de **Euclides Fernando Goncalves**
> que enviamos."

**Não consertei, de propósito.** O corpo real do `followup_orcamento_d1` não
existe neste repositório — o `plastfortsul-templates.ts` só tem o
`followup_d1` aposentado — e chutar a contagem de variáveis de um template da
Meta foi exatamente o que produziu o #132000. Isto se resolve junto com o
**item 39**: o campo que deveria nomear o orçamento é o "Pedido de venda", e
não o título gerado por automação (R6).

#### O que ainda depende da Meta

Cada automação declara `variables` por template — `posvenda20d` manda uma,
`recompra_60d` manda duas. Se esses corpos foram recriados sem variável, como
`comprafutura` e `aniversario` foram, é o **#132000 de novo**, um template de
cada vez. Não dá para verificar em teste (P0 §3): depende de sincronizar
`message_templates` com a Meta.

E uma verificação que só a conta real responde: **os nomes das etapas do
quadro do Gabriel.** A5 tirou o hífen do caminho, mas um nome genuinamente
diferente ("Orçamento" em vez de "Em Aberto") continua não resolvendo. O
`resolveTemplateReferences` já devolve `unresolved` com os nomes que ninguém
atendeu — vale olhar essa lista na instalação real antes de dar o item por
fechado.

---

## P1 — experiência de atendimento

| #   | Item                                                 | Estado                           |
| --- | ---------------------------------------------------- | -------------------------------- |
| 7   | Rascunho por conversa (item 13)                      | ✅ 8 de setembro                 |
| 8   | "Rascunho:" na lista (item 14)                       | ✅ 8 de setembro                 |
| 9   | Editor de contatos unificado (item 9)                | ✅ **já estava feito** — ver R4  |
| 10  | +55 automático (item 10)                             | ✅ 8 de setembro, medido na tela |
| 11  | Botão grande "Abrir conversa" (item 11)              | ✅ 8 de setembro                 |
| 12  | Nome em vez de UUID em Editar oportunidade (item 12) | ✅ 8 de setembro                 |

### ✅ 7 e 8. Os rascunhos (itens 13 e 14)

**Um item só, e sempre foram.** A causa do 13 é uma linha que não existia:
`message-thread.tsx` montava `<MessageComposer conversationId={…}>` **sem
`key`**, então trocar de conversa só trocava um prop — o React reaproveitava a
instância e o `useState('')` do texto atravessava a troca. Digitar na X, abrir
a Y, e o texto está lá.

A `key` conserta o vazamento e **cria** o segundo defeito, que o mesmo item 13
proíbe: desmontar joga o rascunho fora, e "voltar para X e o texto ainda estar
lá" é metade do pedido. Por isso a `key` veio acompanhada de
`src/lib/inbox/drafts.ts` — e esse mesmo armazenamento é o que o item 14 lê
para desenhar o selo. Os dois se resolvem uma vez ou não se resolvem.

**Onde mora.** `localStorage`, num mapa só, e não no banco. Um rascunho é um
pensamento pela metade: não precisa atravessar máquinas, ninguém mais na
equipe precisa vê-lo, e sincronizá-lo custaria uma tabela, uma migração — num
momento em que a numeração 070+ está disputada — e uma escrita por tecla. O
que ele precisa é sobreviver a trocar de conversa e a um F5.

Um mapa numa chave só, e não uma chave por conversa, porque a lista precisa
responder sobre TODAS as linhas de uma vez. Teto de 50, saída por
menos-recentemente-escrito: sem isso cada conversa em que alguém digitou e
desistiu deixa uma linha para sempre.

**O texto continua morando no `useState` do compositor.** O store é um
espelho, escrito com 400 ms de atraso — trocar a fonte da verdade poria
`localStorage` no caminho de cada tecla do componente que menos pode engasgar
do produto, e a lista de conversas assina esse mapa: uma escrita por tecla
re-renderizaria as cem linhas dela a cada letra. **Esvaziar não espera**: os
cinco caminhos que zeram o campo — enviar, `Escape` no painel `/`, atribuir
por `@` — limpam na hora, porque o item 14 pede que o selo suma no envio.

**O que a `key` corrigiu junto.** O texto era o sintoma reportado, mas o anexo
já subido e ainda não mandado, a gravação de áudio em curso e o cursor do
painel `@` viajavam entre conversas do mesmo jeito. Uma foto preparada para a
Ana aparecendo no compositor do João é pior do que o texto. A limpeza de
desmontagem do compositor já fazia GC do arquivo preparado e não enviado — e
`sendDraft` zera esse estado depois de mandar, então nada que foi enviado é
apagado do storage.

**O selo toma a linha inteira**, no lugar da prévia e não ao lado: a prévia
responde "o que foi dito por último" e o rascunho responde "o que falta você
mandar", e numa coluna de 320px as duas não cabem empilhadas. Em
`text-human-ink`, a mesma família do contador de não lidas no fim da linha —
os dois dizem "você". A ordem da lista não muda: é pintura dentro da linha, e
quem ordena são as consultas.

**O que ficou provado e o que não.** `drafts.test.ts` tem 25 asserções sobre
o armazenamento — isolamento por conversa, limpar ao esvaziar, referência
estável para não re-renderizar à toa, o teto, o mapa podre, a outra aba
escrevendo. O que **não** está provado é a tela: o `/inbox` exige sessão e o
`/chart-lab` não pode montar uma lista que consulta o Supabase. **Isto pede
um olhar na tela real** — digitar na Ana, abrir o João, voltar.

### ✅ 10. O `+55` sozinho (item 10)

`applyDefaultCountry`, em `phone-format.ts`. Dígitos entram, dígitos saem —
quem põe o `+` continua sendo o `toE164`, e é isso que deixa a regra testável
sem passar por formatação.

**A regra é estreita de propósito.** Só dez ou onze dígitos entram, então
nada que já traga código de país é tocado. E o comprimento não basta: as duas
formas brasileiras têm assinatura, e as duas são exigidas.

| dígitos | assinatura                    | vira    |
| ------- | ----------------------------- | ------- |
| 11      | DDD válido + **9** + oito     | celular |
| 10      | DDD válido + **2 a 5** + sete | fixo    |

Sem a lista fechada de DDDs, "onze dígitos viram brasileiros" atropelaria um
número americano com o código do país. Com ela, um celular alemão
(`+49 15…`) passa reto: 49 é DDD válido — Blumenau — e o dígito seguinte é 1,
não 9.

**O que estava acontecendo antes.** Não era um erro, era um silêncio:
`47999549247` sem o código virava `+47 999549247`, que é a **Noruega**, e o
CRM salvava isso como número válido. A primeira notícia vinha num envio que
falha longe de quem digitou.

**A saída pelo `+`.** Sobra uma colisão real, e ela está registrada no
código: um fixo norueguês tem dez dígitos, DDD 47 é Joinville, e o primeiro
dígito local cai na faixa dos fixos. O campo escuta o `+` no começo de um
número e desliga o padrão — em estado e não em `ref`, porque com o campo
vazio e a marca ligada ele **desenha o `+` sozinho**. Um modo invisível seria
pior do que o problema.

**Apagar não acrescenta.** O padrão só é aplicado quando o número está
crescendo. Sem essa guarda, quem apaga um número completo dígito a dígito
passa por dez no caminho, a assinatura de fixo casa, e o campo devolve dois
dígitos que a pessoa acabou de tirar.

**A planilha também.** `parse-contact-csv.ts` normaliza pela mesma função —
a importação é a outra porta por onde contato entra, e deixar só uma das duas
normalizando é a receita do defeito que o `PhoneInput` já teve. De quebra
conserta um segundo: a deduplicação compara a chave da planilha contra
`phone_normalized`, que é dígito puro, então `47999549247` não casava com o
`+5547999549247` que já existia — e a importação abria uma **segunda ficha do
mesmo cliente**.

**Medido no navegador**, no `PhoneInput` do `/chart-lab`, tecla a tecla:

| digitado                       | na tela                                |
| ------------------------------ | -------------------------------------- |
| `47999549247`                  | `+55 (47) 99954-9247`, caret no fim    |
| `4733334444`                   | `+55 (47) 3333-4444`                   |
| `+47999549247`                 | `+47 999549247` — a Noruega preservada |
| `5547999549247`                | `+55 (47) 99954-9247`, sem duplicar    |
| encolher de 11 para 10 dígitos | não cresceu                            |

### ✅ 11. Abrir conversa (item 11)

A ficha do contato não tinha saída nenhuma. Quem abria o contato pelo CRM,
lia o que precisava e queria responder tinha que fechar a gaveta, ir no
Atendimento e procurar a pessoa na lista. O menu de contexto do cartão do
funil já levava direto lá desde sempre; a ficha, que é **onde se decide
responder**, não.

**Duas perguntas do item que este produto já responde.** A primeira — "e se
houver mais de uma conversa?" — não existe aqui: a migração 036 põe uma
UNIQUE em `(account_id, contact_id)`. Por isso o botão é um link e não um
menu de escolha.

A segunda é "Iniciar conversa", e a resposta é o botão que já estava lá. A
janela de 24 h da Meta não deixa escrever primeiro para quem nunca escreveu,
então **iniciar conversa neste produto é mandar um template aprovado**. O
template não sumiu nem virou outra coisa: ele troca de peso. Sozinho é a ação
principal e se chama "Iniciar conversa"; ao lado do "Abrir conversa" ele é a
segunda, e volta a se chamar "Enviar template".

#### E aqui saiu um defeito que a auditoria do P0 §6 não pegou

O item 11 pede que iniciar uma conversa aplique também a regra de criar a
oportunidade em Novo Lead. **Não aplicava** — e o buraco é maior do que o
item 11:

`conversation_created` foi criado com o item 17 e **só o webhook o emitia**.
Uma conversa aberta pela equipe — mandando um template pela ficha do contato,
que é o único jeito de começar — criava a linha e não criava oportunidade
nenhuma. O item 4 é explícito ("vale para conversa iniciada pelo cliente,
**pela equipe**, ou criada manualmente"), o comentário que emite o gatilho no
webhook até repete isso, e o outro lado nunca foi ligado.

A auditoria do P0 §6 leu as **definições** das automações e não os
**emissores** dos gatilhos. É a lição a levar: um gatilho correto num arquivo
de modelos não diz nada sobre quem o dispara.

A rota de envio agora devolve se ELA abriu a conversa e dispara o gatilho
**antes** do envio — a ordem importa, porque o núcleo de envio dispara
`team_message_sent` no fim, que é o gatilho de `/aberto` e companhia, e esses
passos MOVEM uma oportunidade que precisa já existir.

Três asserções novas em `send/route.test.ts`; duas delas acusam o `HEAD`
anterior. **A tela não foi vista** — a ficha consulta o Supabase e o
`/chart-lab` não pode montá-la.

### ✅ 12. Nome e não UUID (item 12)

`OptionSelect` é o `Select` do base-ui: `Select.Value` resolve o rótulo entre
os `items` e, **quando não acha, desenha o valor**. Num campo cujo valor é um
UUID, é o UUID na cara do vendedor — enquanto a lista aberta mostra os nomes
certinhos, que foi exatamente o print do pacote.

O caminho é banal: `contactId` vem do registro no primeiro render e
`contacts` só chega no efeito, então **toda** edição desenhava um quadro sem
nenhuma opção que casasse. Mesmo defeito do item 30.

**O conserto é uma opção que sempre existe para o valor que existe.** E vale
para os dois selects que expõem id — contato e responsável —, porque o pacote
pede o mesmo padrão "em qualquer outro select que estiver expondo IDs
internos".

**O segundo flanco era o pior.** A consulta não tem `limit`, o que não quer
dizer "todos": quer dizer o teto do PostgREST. Numa base que passe dele, o
contato de uma oportunidade antiga não está entre as opções — e aí não é um
quadro de UUID, é UUID **para sempre**, naquela ficha, toda vez que alguém a
abrir. Agora há uma consulta a mais, só quando falta, e ela vem por id.

O mecanismo está provado em `option-select-optgroup.test.tsx`: uma asserção
mostra o UUID aparecendo sem a opção de espera, e a seguinte mostra o rótulo
com ela. **A tela em si não foi vista** — o `DealForm` consulta o Supabase e
não pode subir no `/chart-lab`.

---

## P2 — produtividade

| #   | Item                                                     | Estado              |
| --- | -------------------------------------------------------- | ------------------- |
| 13  | Botão rápido de Playbook no atendimento (item 15)        | ✅ 8 de setembro    |
| 14  | Remover descrição curta do alerta de ocorrência (item 2) | ✅ 8 de setembro    |
| 15  | **Chat Interno igual a "Minha equipe" (item 37)**        | ✅ — ver R1, R2, R3 |
| 16  | Revisão visual e testes de regressão                     | ⬜                  |

### ✅ 13. O Playbook por cima da conversa (item 15)

**O mesmo componente da página, e é o ponto.** O item abre com "não recriar o
módulo", e o que ele pede — pesquisar, visualizar, copiar script, copiar
resposta de objeção — é, item por item, o que `PlaybookArea` já faz. Uma
segunda tela de consulta seriam duas buscas para manter iguais, e duas que
divergem: exatamente o defeito que o item 9 relata sobre a ficha do contato,
de novo e por escolha.

Um booleano `embedded` tira o cabeçalho de página, que a gaveta já tem. Nada
mais mudou no módulo.

A busca é a parte que mais se ganha reaproveitando: ela atravessa os três
tipos de uma vez porque a base é **uma tabela com `type`** (o argumento está
no topo da migração 064), então quem digita "frete" no meio do atendimento
acha o script, a objeção e a regra sem escolher antes em qual das três a
empresa guardou. Produtos vêm junto — o item permite, e no meio de uma
conversa sobre preço é a seção mais consultada.

O botão fica no cabeçalho do thread, onde as outras consultas sobre esta
conversa já estão (a ficha, a ligação, o histórico), com `sm:inline-flex`
como os irmãos e um item no menu de excesso do celular — que é o combinado
deste cabeçalho para tudo que não cabe em 360px.

### ✅ 14. O alerta de ocorrência, em uma linha (item 2)

Sai `1 ocorrência no histórico — leia antes de prometer prazo.`, fica
`Atenção — cliente com histórico de ocorrência`. Nada do histórico é tocado,
e o card continua sendo o botão que o abre.

**O que se troca, porque o código defendia o contrário.** A nota que saiu
dizia que a CONTAGEM é a diferença entre um acidente e um padrão, e é a
coisa de que alguém prestes a prometer um prazo precisa. A troca é
deliberada: o aviso fica, e o número está a um clique — do outro lado deste
mesmo botão, que é onde as ocorrências de verdade estão.

`occurrenceCount` e `occurrenceHint` saíram dos três catálogos: eram as duas
metades da frase removida e nada mais as lia.

### ✅ 15. O card do trilho vira a linha da caixa de entrada (item 37)

Como R2 mapeou, não havia desenho a inventar — havia um a copiar. O card
agora é ícone, `Inbox.team.title` e `Inbox.team.rowHint`, que são as mesmas
duas chaves da linha da caixa de entrada e as mesmas duas frases que a
"referência desejada" do pacote transcreve.

Saíram: as três linhas de histórico, o rosto de quem escreveu por último, o
primeiro nome e o horário por turno. De quebra some um defeito que estava
documentado ali — quando quem tinha escrito por último era você, o trilho
terminava na mesma foto duas vezes, esta e a do bloco da conta poucos pixels
abaixo, e isso lia como falha de renderização.

**O contador ficou.** A lista de remoções do item 37 é específica — nome,
data, prévia de áudio, prévia de texto, mensagens empilhadas, histórico,
avatar — e o número não está nela. Ele também é a única coisa que ainda
diferencia este card de um item de menu comum, e é o que faz o trilho valer:
sem ele, uma sala que ninguém abre não chama ninguém.

A consulta encolheu junto: eram vinte mensagens em toda navegação para
desenhar três; agora é `limit(1)`, só para saber se a tabela existe.

**O que R3 avisou continua valendo**: sem prévia, este card é um item de
navegação, e o trilho já tem uma lista de navegação. Se um dia ele incomodar
por ser um terceiro padrão de card, a saída é virar uma linha do menu — não
voltar a prévia.

### ⬜ 16. Revisão visual

**Nada de P2 foi visto em tela.** O trilho, o alerta de ocorrência e o
cabeçalho do atendimento exigem sessão, e o `/chart-lab` não pode montar
nenhum dos três — todos consultam o Supabase. O que existe é `tsc`, `eslint`,
a suíte e a build de produção, que compila todas as rotas.

---

## ✅ Itens 38–59 — a oportunidade e o orçamento

**Feito em 8 de setembro**, em dois commits: a base (`a719da5`) e o
documento. A integração com o Bling continua fora, como o item 51 pede e o
59 proíbe.

### O formulário (39–50)

| Item         | O que virou                                                                               |
| ------------ | ----------------------------------------------------------------------------------------- |
| 39           | `Pedido de venda` → **coluna própria** `sales_order_number` (070), não o `title` — ver R6 |
| 40           | já estava: o inbox passa `defaultContactId`                                               |
| 41           | `Moeda` e `Previsão de fechamento` saem da tela; as colunas ficam e continuam gravadas    |
| 42           | Etapa fica, discreta, no fim da linha do Responsável                                      |
| 43 · 45 · 46 | a seção vira **Produto**; `deal_items` intacto — ver R5                                   |
| 44           | Pedido → Contato → Produto → Valor → Frete → Transportador → Responsável → Observações    |
| 47           | **Frete**, fora do valor; `NULL` não é zero                                               |
| 48           | **Transportador** em texto, com os dois estados do item como atalhos                      |
| 49 · 50      | mantidos                                                                                  |

**O título continua existindo e continua sendo preenchido**, pela mesma
regra do motor (`resolveDealTitle`): nome do contato, caindo no telefone.
Duas regras para a mesma coluna seriam duas listas de negócio com nomes
diferentes no mesmo Kanban.

**A moeda vira BRL em três lugares** (R7): o `DEFAULT` da coluna, as contas
que ainda carregavam `USD`, e o `DEFAULT_CURRENCY` do app. `deals.currency`
de oportunidades antigas não é tocado — o item 59 proíbe.

### O orçamento (51–55)

**Uma conta só, em `lib/quotes/quote.ts`.** O item 55 termina com a frase
que decide a arquitetura — "não manter dois cálculos independentes" —, então
a soma acontece longe de qualquer pixel e o desenho recebe números prontos.
`lineTotal` vem de `products/catalog`, que já é a cópia em TypeScript da
coluna `total` GENERATED da 054: uma terceira versão da mesma multiplicação
seria a mesma dívida com outro nome.

**O PDF é a impressão, e não uma biblioteca.** Gerar PDF no servidor custaria
um navegador headless para produzir, de um documento de uma página, o que o
próprio navegador já produz com "Salvar como PDF" — vetorial, com texto
selecionável. E viria com um segundo caminho de renderização, que é o segundo
cálculo do item 55 um andar acima. A folha de `globals.css` inverte a regra:
some tudo, volta só o ramo marcado.

**Um defeito achado ao ver o documento na tela.** `formatCurrency` arredonda
para a unidade de propósito — no cartão do Kanban `R$ 18.400` se lê mais
rápido. Num orçamento é errado: o bench imprimia `100 × R$ 4` para um preço
de R$ 4,25, e a conta não fechava na frente do cliente. Agora há
`formatCurrencyExact` ao lado, e as duas existem porque são duas decisões
sobre a mesma quantia: quem escaneia usa uma, quem confere usa a outra.

**Medido no `/chart-lab`**, que é a primeira peça deste bloco que dá para
olhar sem sessão — `DealQuote` recebe um objeto e não consulta nada:

|            |                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| completo   | `100 × R$ 4,25 → R$ 425,00`; `200 × R$ 1,00 · 10% → R$ 180,00`; Produtos R$ 605,00; Frete R$ 120,00; **Total R$ 725,00** |
| só o valor | sem pedido, sem produtos, sem frete, sem transportador, sem observações — Produtos e Total R$ 625,00                     |

### Documentos → Orçamentos (pedido de 8 de setembro)

Fora do bloco 38–59: o Gabriel pediu ao testar que **todo orçamento gerado
fique salvo**, numa seção que "pode ficar fora do menu principal". Migração
**071** e a rota `/documentos/orcamentos`, que não entra na barra lateral —
chega-se por um link no rodapé do próprio documento, onde a pergunta "cadê o
anterior?" nasce.

**O que fica guardado é o documento, não o arquivo PDF.** O PDF nasce no
navegador de quem imprime; o servidor nunca vê aqueles bytes, nem sabe se a
pessoa salvou ou cancelou. Guardar os dados é melhor do que guardar o
arquivo: a página redesenha pelo MESMO componente e pelo MESMO cálculo (um
PDF guardado seria uma segunda verdade sobre o total, que é o que o item 55
proíbe), dá para procurar por cliente, pedido ou produto, e ocupa bytes.

Uma linha por **geração**, sem UPDATE e sem DELETE na RLS: o negócio muda
depois que o orçamento sai, e o que o cliente recebeu foi a versão daquele
dia.

**Conferido contra o banco em 8 de setembro**, com a primeira linha real já
gravada pelo Gabriel:

|                                 |                                                                           |
| ------------------------------- | ------------------------------------------------------------------------- |
| `deal_quotes` com as 18 colunas | OK                                                                        |
| controle (coluna inexistente)   | reprovou com 400                                                          |
| `lines`                         | volta como array, com `name, total, quantity, unitPrice, discountPercent` |
| a conta, relida                 | produtos + frete = total gravado; soma das linhas = produtos              |
| RLS                             | service-role vê a linha, anônimo vê zero                                  |

O último só significa alguma coisa porque existe uma linha — com a tabela
vazia os dois veriam zero, e o teste não provaria nada.

**E um guard achou o que eu ia deixar passar:** a rota nova não estava em
`PROTECTED_PATHS`, e o arquivo de tudo que a empresa orçou ficaria de pé sem
sessão. Uma rota que nenhum menu aponta é uma rota que ninguém lembra de
proteger; quem lembrou foi o `proxy.test.ts`, varrendo `app/(dashboard)`.

### O que ficou de fora, e por quê

**A migração 070 está aplicada** (8 de setembro, pelo Gabriel). Conferido
contra o banco: as três colunas respondem em `deals`, `default_currency` da
conta é `BRL`, e uma consulta de controle a uma coluna inexistente reprova
com 400 — sem ela, o "OK" das outras duas não provaria nada.

O caminho normal falhou por dois motivos que vale registrar: o token do MCP
do Supabase tinha vencido, e **o servidor nem estava carregado** — o
`.mcp.json` que o declara existe só em `D:wacrmwacrm`, e a sessão passou o
dia oscilando para `D:wacrm`. É a armadilha que a memória
`raiz-do-projeto-e-wacrm-wacrm` descreve, e ela custou caro aqui porque não
dá erro: o MCP simplesmente não existe.

**O CRM não sabe quem é a empresa.** O item 54 pede logo, site, e-mail e
telefone no cabeçalho e no rodapé. `accounts` tem nome, dono, fuso, moeda e
horário comercial; `whatsapp_config` guarda o `phone_number_id` da Meta, que
é um id e não um telefone que se imprima. O documento é montado com o que
existe e não inventa o que não existe — **esta é a única parte do item 54 que
depende de uma coluna que ninguém escreveu ainda**, e ela vem com uma tela de
configuração junto, que é uma entrega por si.

**A imagem vertical do item 55 não é gerada.** O item pede o visual de
WhatsApp como "imagem vertical de boa resolução; **ou** PDF de uma página com
proporção amigável", e o que existe é o segundo — que também é o PDF que ele
pede em seguida, do mesmo desenho. A imagem exigiria uma dependência de
rasterização e um segundo caminho de renderização.

**O item 57 (preparar para o Bling) está atendido pela estrutura, não por
código.** Os campos que ele lista existem como colunas — pedido, contact_id,
conversation_id, responsável, produtos com product_id, quantidade, preço,
subtotal, frete, transportador, total, observações, status, stage_id — e o
`Quote` é o objeto que uma futura chamada ao Bling consumiria.

## O que o pacote proíbe (item 35)

Vale ler antes de qualquer decisão nesta área:

- criar um segundo pipeline de vendas;
- adicionar etiqueta `Lead` automaticamente;
- recriar Playbook ou Produtos;
- criar tarefas para Compra Futura;
- usar `followup_orcamento_d15`, `posvenda_10d_tudo_certo` ou
  `reativacao_geladeira_60d`;
- voltar ao follow-up diário D4–D10;
- enviar parâmetros fictícios para templates sem variáveis;
- **salvar UUID como texto visível ao usuário**;
- **compartilhar um único estado de draft entre conversas**;
- **criar oportunidade duplicada a cada mensagem**.

Os três últimos são exatamente os bugs dos itens 30, 13 e 4.

E o item 59, para o bloco do orçamento:

- não integrar com a API do Bling ainda;
- **não apagar campos históricos do banco só porque saíram da interface** —
  o que vale para `currency` e `expected_close_date` (item 41) e é o motivo
  de R5 não virar um `DROP TABLE`.

## A oportunidade no modelo do Bling — 8 de setembro de 2026

Pedido do Gabriel com quatro prints do Bling ao lado da gaveta, e ele fechou
a lista com **"nesta ordem"**:

> a oportunidade deve ficar no modelo do bling / pedido de venda puxando do
> ultimo que foi criado / abaixo cliente e do lado responsavel(que esta como
> vendedor) / botar o produto e ficar aparecendo a descrição, quantidade
> preço, preço total / condição de pagamento, com as opçoes do bling /
> transportadora, quantidade e peso bruto e o valor do frete / para ir tudo
> para o bling / isto estruturado para caber na aba de oportunidade / se
> estamos criando oportunidade ja vai automatico para em aberto, nao precisa
> escolher oportunidade / ao gerar orçamento aparece esta coisas principais
> que mandei / nesta ordem

**A integração continua fora** (item 59). Isto é a ESTRUTURA: o que a
operação preenche hoje no Bling passa a caber aqui, na mesma ordem, para um
dia ir para lá sem ninguém redigitar.

### O que mudou

| Onde | O quê |
| --- | --- |
| `deals` | `payment_terms`, `freight_mode`, `gross_weight`, `freight_volumes` (075) |
| `deal_items` | `sku` e `unit`, congelados como o `name` desde a 054 (075) |
| `deal_installments` | tabela nova: parcela, dias, data, valor, forma, observação (075) |
| `deal_quotes` | os mesmos campos, congelados no documento (076) — e `fingerprint` (074) |
| Gaveta | reordenada; a Etapa saiu da criação; o pedido vem sugerido |
| Documento | cliente e responsável lado a lado; produtos viraram tabela; dois blocos novos |

### Três decisões que valem estar escritas

**A forma de pagamento é texto livre**, como `carrier`. No print do Gabriel
ela é "AGRO sicredi" — um cadastro da conta dele no Bling, não um código de
um padrão. Não existe lista universal para copiar, e inventar uma aqui seria
criar um cadastro que diverge do de lá no primeiro uso. O **frete por conta**
é o oposto e por isso é um select fechado: seis códigos de um padrão fiscal,
iguais em toda empresa do país.

**As parcelas são linhas, e não um cálculo.** O Bling tem duas coisas com o
mesmo nome — a condição ("30/60/90", um atalho) e as parcelas que ela gera,
cada uma com dias, data, valor, forma e observação, e cada uma editável
depois. Guardar só o atalho e recalcular perderia as edições: a operação move
uma data para não cair no domingo e arredonda um valor para fechar o pedido.
Guardam-se os dois.

**Isto contradiz o item 42 do pacote, de propósito.** Ele pedia `Novo lead`
como padrão da criação; o Gabriel agora pede `Em Aberto` e que não se
escolha. Os dois estão certos sobre coisas diferentes: `Novo Lead` é onde a
AUTOMAÇÃO põe quem mandou o primeiro "oi" (§1 do fluxo oficial), e quem um
vendedor abre à mão já falou com alguém. `entryStage` acha a etapa pelo nome
e cai para a primeira do funil quando o quadro foi montado à mão; o `+` de
uma coluna do quadro continua ganhando de tudo, porque ali alguém já apontou.

### O que ficou de fora, e por quê

**O número do pedido é uma sugestão, não uma sequência.** Quem numera de
verdade é o Bling, e dois pedidos podem sair de lá enquanto ninguém abriu
esta gaveta. Uma coluna `SERIAL` daria um número autoritativo e ERRADO, e a
operação descobriria na hora de lançar. Por isso `nextOrderNumber` só
incrementa o último e falha em silêncio — campo vazio, nunca um palpite que
pareça confirmado.

### A regressão de 14 de setembro, e o guarda que ela deixou

Com a 074, a 075 e a 076 ainda por aplicar, **duas coisas centrais estavam
quebradas no main** — medido contra o banco de teste, com a chave anônima e
escritas que não tinham como alterar linha nenhuma:

- **nenhuma oportunidade salvava.** A gaveta mandava as quatro colunas da 075
  em todo `update`, e o PostgREST recusa o corpo inteiro quando uma coluna não
  existe (`PGRST204`). Com elas: 400. Sem elas: 204. Veio do `2dd02e3`.
- **nenhum orçamento era gerado.** O recuo da rota descia da camada da 076 para
  uma que ainda citava `fingerprint`, da 074, e morria igual. Veio do
  `9a06416`.

A gaveta agora pergunta ao banco se a 075 existe (`hasOrderShape`) e só então
junta as colunas dela — e esconde os campos que não teriam onde gravar. A rota
desce por três camadas, uma por migração. As duas linhas saem de funções puras
(`lib/deals/row.ts`, `lib/quotes/archive.ts`), e
`src/lib/supabase/unapplied-columns.test.ts` **lê as migrações** para conferir
que nenhuma coluna nova escorregou para a parte que vai sempre. Provado
reintroduzindo as duas formas antigas: ele acusa `payment_terms: da 75` e
`camada 71: fingerprint é da 74`.

### Enviar pelo WhatsApp — 14 de setembro

> envia no whatsapp ou envia como imagem e fica o PDF salvo na plataforma

O diálogo do orçamento ganhou **Enviar**, com as duas formas e a frase do que
cada uma faz do lado de lá: **como imagem** abre direto na conversa; **como
PDF** chega como cartão de arquivo, que é o que se guarda e imprime. O PDF
continua salvo em Documentos → Orçamentos nos dois casos.

**Pelo mesmo caminho de qualquer mensagem da equipe** (`/api/whatsapp/send`),
e não por uma rota nova: ele confere o papel, grava a mensagem na conversa com
o nome de quem mandou, e dispara `team_message_sent` — o gatilho que move
oportunidade. A legenda leva o número do pedido e o total, porque é ela que
aparece na prévia da lista de conversas. Gerar e enviar em seguida não custa
um segundo Chromium: a impressão digital da 074 devolve os mesmos arquivos.

**A janela de 24h manda.** Ela é medida quando o orçamento ABRE — pela mesma
`sessionWindow` da caixa de entrada — e, fechada, o menu diz por quê e oferece
a única saída: abrir a conversa e usar um template. Se ela vencer com o
diálogo aberto, a Meta recusa com 131047 e a tela diz isso em vez do erro cru.

Verificado no `/chart-lab`, com fixture, nos dois estados e nos dois temas:
o rodapé cabe numa linha no caso real da gaveta (medido: 412px, e antes o
botão principal quebrava sozinho para a linha de baixo), o clique mostra o
carregando e fecha o diálogo, e o estado bloqueado explica e oferece a
conversa. O envio de VERDADE para a Meta não foi exercitado — ele exige
sessão autenticada e um cliente com a janela aberta.

De passagem, um guarda novo: `button-link-native.test.ts`. Três `Button`
renderizados como link não diziam `nativeButton={false}`, e o Base UI acusava
no console a cada renderização — o link do arquivo e o "Abrir PDF" do
orçamento, e o "Abrir conversa" da ficha do contato.

## Minha equipe: prévia, `@menção` e o número real — 14 de setembro

O pedido, de 8 de setembro, com um print do card "Minha equipe":

> Já que não tem mais o mini chat de visualização, faz uma pré-visualização
> passando o mouse em cima pra ler rápido, e uma cor diferente com uma
> configuração nova para poder dar um @fulano e mencionar ela no chat interno,
> além do número de notificação contar real

### A prévia — sem migração, no ar

Passar o mouse no card abre as seis últimas mensagens: primeiro nome, hora, o
texto em duas linhas, anexo sem legenda pelo nome do tipo. Não busca nada até
alguém passar o mouse, e **não marca como lido** — quem leu por cima e vai
responder depois precisa que o número continue lá.

### `@fulano` — depende da 077

Digitar `@` na sala abre a lista da equipe (prefixo de palavra, sem acento);
Enter ou Tab escolhe. O nome entra no texto como palavra comum e o id vai
num array (`team_messages.mentions`), e um gatilho transforma cada menção numa
notificação no sino — que abre a sala **na** mensagem, com um anel âmbar.

**"Uma cor diferente"**: âmbar quando a menção é a quem está lendo — a
doutrina de cor da casa, âmbar é o único "venha cá" — e azul quando chama um
colega. O card do trilho e a linha da caixa de entrada também ficam âmbar
quando alguma não lida chama você.

**Uma interpretação que vale registrar**: "uma configuração nova" foi lida
como a funcionalidade nova, e não como um interruptor em Configurações. Se a
ideia era poder desligar as menções (ou o aviso delas), isso é um passo a mais
e pequeno.

O `@` do compositor do ATENDIMENTO continua atribuindo a conversa. São campos
diferentes, e o comentário de `assign-mention.ts` foi atualizado para dizer
isso — "uma tecla, um significado, por campo".

### O número real — depende da 077

O que estava errado, medido no código: o marcador era do navegador (ler no
celular não apagava no computador), um navegador que nunca abriu a sala
mostrava zero, as próprias mensagens contavam quando chegavam por outro
aparelho, e um marcador só para todas as salas marcava como lida uma
mensagem de "Operação" ao ler "Comercial".

`team_room_reads` guarda até onde cada pessoa leu cada sala, e
`team_unread_counts()` conta numa consulta. A migração marca tudo o que foi
escrito antes dela como lido — senão todo mundo veria "99+" no minuto em que
ela rodasse. O card, a linha da caixa de entrada e o seletor de salas leem o
mesmo store (`use-team-unread`), com uma assinatura só.

**Antes da 077 nada quebra**: o número volta ao marcador do navegador (já sem
as próprias mensagens), e mencionar alguém envia a mensagem e avisa que a
menção não notificou ninguém. Verificado contra o banco de teste: as duas
funções respondem `PGRST202` e a coluna responde ausente, que é o que o recuo
reconhece.

Conferido na bancada (`/chart-lab`), com fixture, nos dois temas: a prévia nos
três estados, as três respostas da menção (a você, a um colega, e um `@Nome`
digitado à mão que não avisou ninguém), e o painel. O contraste do âmbar e do
azul sobre as bolhas ficou entre 5,2:1 e 8,3:1. **O fluxo com o banco — o
gatilho, o sino, a leitura em dois aparelhos — só pode ser exercitado depois
da 077 e com sessão autenticada.**
