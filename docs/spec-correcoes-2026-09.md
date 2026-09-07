# Pacote de correções — 7 de setembro de 2026

> **A origem.** `PlastfortSul_CRM_Pacote_Completo_Correcoes_Claude_Code_v2.md`,
> 59 itens em 2138 linhas, escrito a partir de **testes reais de uso** e com
> imagens dos erros. O arquivo não está no repositório; este documento é o
> registro do que ele pede, do que já foi feito e do que não foi.
>
> **Mantenha a tabela de status em dia.** Ela é a resposta para "isto já foi
> revisado?", e uma tabela desatualizada responde errado com confiança.

O pacote é diferente dos anteriores: `spec-automacoes-fluxo.md` desenhava um
fluxo a partir de um modelo comercial, e este corrige o que quebrou quando
esse fluxo encontrou a operação. Quase todo item nasce de uma tela que não
fez o que devia.

---

## Ordem de execução

A do próprio pacote (item 34), e é a que está sendo seguida.

| | | Estado |
| --- | --- | --- |
| **P0** | bugs que bloqueiam operação | 5 de 6 |
| **P1** | experiência de atendimento | não começou |
| **P2** | produtividade | não começou |
| — | itens 37–59: oportunidade e orçamento | não começou |

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

### ✅ 2. Seletor de etapa mostrando UUID (item 30)

Ele já escolhia por nome — exceto quando `pipelines.length === 0`, que caía
em dois campos de texto cru. E a lista começa vazia: **vazia e ainda-não-
carregada davam a mesma resposta**, então o instante inicial de toda edição
desenhava UUIDs. O contexto ganhou uma flag `loading`.

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

---

## P1 — experiência de atendimento

| # | Item | Estado |
| --- | --- | --- |
| 7 | Rascunho por conversa (item 13) | ⬜ **bug confirmado** |
| 8 | "Rascunho:" na lista (item 14) | ⬜ |
| 9 | Editor de contatos unificado (item 9) | ⬜ |
| 10 | +55 automático (item 10) | ⬜ |
| 11 | Botão grande "Abrir conversa" (item 11) | ⬜ |
| 12 | Nome em vez de UUID em Editar oportunidade (item 12) | ⬜ |

**O item 13 está confirmado no código:** `<MessageComposer>` é renderizado
sem `key={conversation.id}`, então o React reaproveita a instância e o
`useState('')` do texto atravessa a troca de conversa. Você digita na X,
abre a Y, e o texto está lá.

---

## P2 — produtividade

| # | Item | Estado |
| --- | --- | --- |
| 13 | Botão rápido de Playbook no atendimento (item 15) | ⬜ |
| 14 | Remover descrição curta do alerta de ocorrência (item 2) | ⬜ |
| 15 | Revisão visual e testes de regressão | ⬜ |

---

## Itens 37–59 — a oportunidade e o orçamento

**Fora da ordem de execução do pacote, e é o maior bloco.** Redesenho do
formulário de oportunidade (campos, ordem, "Pedido de venda" no lugar de
"Título", produto, valor, frete, transportador) e, a partir do item 51, a
**geração de orçamento dentro do CRM** — com o modelo atual da PlastfortSul
transcrito como referência, a estrutura desejada, os formatos, e preparação
para integração futura com o **Bling**.

Isso não existe no produto e não está em nenhum spec. É uma release por si,
e misturá-la com correções de bug atrasaria as duas.

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
