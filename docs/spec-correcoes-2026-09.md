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

|        |                                       | Estado                       |
| ------ | ------------------------------------- | ---------------------------- |
| **P0** | bugs que bloqueiam operação           | 5 de 6                       |
| **P1** | experiência de atendimento            | 1 de 6 (o 9 já estava feito) |
| **P2** | produtividade                         | não começou                  |
| —      | itens 38–59: oportunidade e orçamento | não começou                  |

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

### ⬜ 6. Auditoria das automações (itens 16–31)

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

**O que sobra da auditoria é o mais chato e o mais provável de doer:** cada
automação declara `variables` por template — `posvenda20d` manda uma,
`recompra_60d` manda duas. Se esses corpos foram recriados sem variável, como
`comprafutura` e `aniversario` foram, é o **#132000 de novo**, um template de
cada vez. Isso não dá para verificar em teste (P0 §3): depende de sincronizar
`message_templates` com a Meta.

---

## P1 — experiência de atendimento

| #   | Item                                                 | Estado                                   |
| --- | ---------------------------------------------------- | ---------------------------------------- |
| 7   | Rascunho por conversa (item 13)                      | ⬜ **bug confirmado, causa localizada**  |
| 8   | "Rascunho:" na lista (item 14)                       | ⬜                                       |
| 9   | Editor de contatos unificado (item 9)                | ✅ **já estava feito** — ver R4          |
| 10  | +55 automático (item 10)                             | ⬜ **decisão fechada, é só implementar** |
| 11  | Botão grande "Abrir conversa" (item 11)              | ⬜                                       |
| 12  | Nome em vez de UUID em Editar oportunidade (item 12) | ⬜ **causa localizada**                  |

**Item 13 — a causa.** `message-thread.tsx:1679` monta
`<MessageComposer conversationId={conversation.id} …>` **sem `key`**. O React
reaproveita a instância entre conversas e o `useState('')` do texto atravessa
a troca. Digitar na X, abrir a Y, e o texto está lá.

Uma `key` conserta o vazamento e **cria** o segundo defeito: desmontar
descarta o rascunho, e o item 13 exige que voltar para X ainda mostre o texto.
Então são as duas metades — isolar por `conversation_id` **e** persistir fora
do componente. A persistência é também o que o item 14 vai ler para desenhar
"Rascunho:" na lista, o que faz do 7 e do 8 um item só.

**Item 12 — a causa, e ela já tem remédio no repositório.** `OptionSelect` é o
`Select` do base-ui: `Select.Value` resolve o rótulo a partir de `items`, e
**quando o valor não casa com nenhum item ele desenha o valor cru** — o UUID.
Em `deal-form.tsx` os contatos chegam por efeito, então o primeiro quadro de
toda edição tem `contactId` preenchido e `contacts` vazio. É o mesmo defeito
do item 30, e a correção é a mesma flag `loading` (P0 §2). Há um segundo
flanco: `supabase.from('contacts').select('*')` sem `limit` fica preso ao teto
do PostgREST — um contato fora dessa página mostra UUID **para sempre**, não
só no primeiro quadro.

**Item 10 — o escopo real.** `toE164` é uma função de três linhas
(`phone-format.ts:187`) e o pacote define a regra inteira (R8). O cuidado é
que ela é chamada pelo campo mascarado a cada tecla: prefixar `+55` cedo
demais faz o número aparecer completo enquanto ainda está pela metade, e
`isCompletePhone` passa a mentir. A normalização é **na gravação**, não na
digitação.

---

## P2 — produtividade

| #   | Item                                                     | Estado              |
| --- | -------------------------------------------------------- | ------------------- |
| 13  | Botão rápido de Playbook no atendimento (item 15)        | ⬜                  |
| 14  | Remover descrição curta do alerta de ocorrência (item 2) | ⬜                  |
| 15  | **Chat Interno igual a "Minha equipe" (item 37)**        | ⬜ — ver R1, R2, R3 |
| 16  | Revisão visual e testes de regressão                     | ⬜                  |

**Item 2 — a frase exata.** `Contacts.detailView.occurrenceCount` =
`"{count} {count, plural, …} no histórico — leia antes de prometer prazo."`
É só o card de alerta; `occurrenceHint` (a frase longa, dentro do histórico)
fica. Existe também `hasOccurrence` na lista, que não é o alvo.

**Item 15 (Playbook)** — nada em `components/inbox/` referencia playbook hoje.
O módulo existe e não deve ser recriado (item 35): é um painel que lê o que já
está lá.

---

## Itens 38–59 — a oportunidade e o orçamento

**Fora da ordem de execução do pacote, e é o maior bloco.** Redesenho do
formulário de oportunidade (campos, ordem, "Pedido de venda" no lugar de
"Título", produto, valor, frete, transportador) e, a partir do item 51, a
**geração de orçamento dentro do CRM** — com o modelo atual da PlastfortSul
transcrito como referência, a estrutura desejada, os formatos, e preparação
para integração futura com o **Bling**.

É uma release por si, e misturá-la com correções de bug atrasaria as duas.

### O que já existe, e é mais do que o pacote supõe

| Pedido                                                     | No produto hoje                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 45 — campo Produto com SKU, qtd., valor unitário, subtotal | `deal_items` (054): `product_id`, `name` congelado, `quantity`, `unit_price`, `discount_percent`, `total` GENERATED |
| 45 — "não criar uma segunda base de produtos"              | `products` (054), com `sku`, `unit`, `price`, `category`                                                            |
| 46 — Valor somado a partir dos itens                       | já soma; `valueFromItems` é o texto                                                                                 |
| 49 — Responsável usando a equipe cadastrada                | `assigned_to` → `profiles`                                                                                          |
| 50 — Observações multilinha                                | `notes`                                                                                                             |

### O que falta de verdade

Três colunas que não existem em lugar nenhum — **`grep` por `shipping`,
`freight`, `carrier`, `order_number` no diretório de migrações não devolve
nada** fora do motivo de perda:

1. **Pedido de venda** (item 39) — número/texto, e **não** a coluna `title`
   (R6);
2. **Frete** (item 47) — valor separado dos produtos, para o orçamento poder
   mostrar subtotal / frete / total;
3. **Transportador** (item 48) — o pacote sugere reaproveitar contatos
   classificados como transportadora, mais os estados "Cliente retira" e "A
   definir". **Essa classificação não existe** hoje; decidir antes de
   escrever a coluna.

Mais os dois defaults de moeda (R7) e o orçamento inteiro (51–55), que é
renderização e não tem nada no repositório.

### A numeração da migração está disputada

A última aplicada é a **069**. Três specs de 4 de setembro já reservam a
070 em diante (`spec-acoes-de-agente.md` toma 070–072;
`spec-transporte-secundario.md` registra a colisão). Quem escrever a migração
deste bloco tem que renumerar alguém — e a decisão é de quem entregar
primeiro, não de quem escreveu primeiro.

---

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
