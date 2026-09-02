# Passos da etapa — pipeline de Vendas (PlastfortSul)

O que fazer com uma oportunidade em cada etapa do pipeline de Vendas.

A área **Playbook** no menu (scripts, objeções, regras e ficha de produtos)
é outra coisa: `docs/spec-playbook-e-anexos.md`. Este arquivo é o
**checklist por etapa** — na interface, “Passos da etapa”.

Este documento tem dois usos:

1. **É o conteúdo desses passos no CRM.** Cada bloco abaixo é a lista de
   uma etapa. Um administrador abre uma oportunidade daquela etapa, clica em
   _Criar playbook para …_ e digita os passos. A partir daí toda
   oportunidade que chegar naquela etapa mostra a lista, e o card no
   quadro mostra quanto falta.
2. **É o combinado da equipe.** O CRM não obriga ninguém a nada — ele só
   lembra. O que está aqui é o que a PlastfortSul decidiu que é o mínimo.

> Estrutura do pipeline conforme a especificação: `Novo Lead → Em Aberto →
> Follow-up → Em Negociação → Em Andamento → Atendido`, com `Geladeira 30/60`,
> `Pós-venda` e `Perdido` fora do fluxo principal.

---

## A regra que vale para todas as etapas

**A máquina espera, calcula e envia. A pessoa conversa, negocia e decide.**

Se um passo do playbook pode ser feito por uma automação, ele não deveria estar
no playbook — deveria estar em Automações. O playbook é a lista do que só uma
pessoa consegue fazer.

E o contrário também: **no instante em que o cliente responde, a sequência
automática se cancela sozinha.** Ninguém precisa desligar nada à mão.

---

## Novo Lead

Contato comercial novo que ainda precisa ser atendido.

| Passo                                  | Dica                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| Responder em até 1 hora útil            | O primeiro a responder ganha a maior parte dos orçamentos          |
| Descobrir o que o cliente produz/embala | É o que decide qual linha ofertar                                  |
| Registrar cidade e estado na ficha      | Alimenta o filtro por região e o cálculo de frete                  |
| Definir responsável pela oportunidade   | Sem responsável, ninguém é cobrado                                 |

Ao terminar: mova para **Em Aberto**.

---

## Em Aberto

Oportunidade aberta — orçamento enviado ou atendimento que ainda não avançou.

| Passo                                        | Dica                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| Levantar quantidade, medida e prazo           | Sem os três, o orçamento volta                               |
| Enviar o orçamento pelo template `orcamento_enviado` | Fica registrado na conversa e no histórico do cliente  |
| Preencher o valor da oportunidade no CRM      | É o que faz o total do funil significar alguma coisa         |
| Preencher a previsão de fechamento            | É o que faz a oportunidade aparecer na hora certa            |

Ao terminar: mova para **Follow-up**. A partir daí a sequência
`followup_d1 → d3 → d15 → d30` roda sozinha.

---

## Follow-up

Cliente está dentro da rotina de acompanhamento comercial.

| Passo                                             | Dica                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| Conferir se a sequência automática está ativa      | O monitor de automações mostra; ele é informativo, não é tarefa        |
| Ligar depois do D3 se não houve resposta           | O WhatsApp já tentou duas vezes; a terceira tentativa é humana         |
| Registrar o motivo quando o cliente sumir          | "Sumiu" não é motivo. "Comprou do concorrente" é                       |

Se o cliente responder, o CRM cancela a sequência e a oportunidade vira
**Em Negociação** — o passo é seu, não da máquina.

---

## Em Negociação

Cliente respondeu e existe negociação ativa.

| Passo                                        | Dica                                                            |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Confirmar quantidade e prazo finais           | O que mudou desde o orçamento é o que costuma travar o pedido    |
| Registrar a condição de pagamento acordada    | Nas observações da oportunidade, não no WhatsApp                 |
| Atualizar o valor se a negociação mexeu nele  | Um funil com valores velhos é um funil que ninguém olha          |
| Confirmar quem assina/aprova do lado do cliente | Descobrir isso no fim é o que faz um pedido pronto parar         |

Ao fechar: mova para **Em Andamento** e marque a oportunidade como **ganha**.

---

## Em Andamento

O cliente comprou. O pedido está em produção, separação ou entrega.

| Passo                                              | Dica                                                     |
| -------------------------------------------------- | --------------------------------------------------------- |
| Enviar `pedido_confirmado` com a previsão de entrega | É o template que reduz "e o meu pedido?"                 |
| Preencher a data da última compra na ficha          | É o que liga a automação de recompra                      |
| Preencher o ciclo de recompra em dias               | Em branco, a automação não chuta — ela pula o cliente     |
| Avisar produção sobre qualquer combinado especial   | O que foi prometido no WhatsApp não chega sozinho ao chão de fábrica |

Ao entregar: mova para **Atendido**.

---

## Atendido / Pós-venda

| Passo                                     | Dica                                                          |
| ----------------------------------------- | -------------------------------------------------------------- |
| Confirmar que a entrega chegou certa       | Antes que o cliente precise reclamar                          |
| Registrar ocorrência se algo deu errado    | Ocorrência é problema que já aconteceu — não é etiqueta        |
| Perguntar quando ele pretende comprar de novo | Vira a data de "próxima compra" e a automação cuida do resto |

O pós-venda D10, a pesquisa de satisfação, o aniversário e a recompra em 60
dias são **automáticos**. Não estão no playbook porque ninguém precisa
lembrar deles.

---

## Geladeira 30 / 60 dias

Cliente que não avançou e deve ser retomado depois.

| Passo                                       | Dica                                                   |
| ------------------------------------------- | ------------------------------------------------------- |
| Registrar por que esfriou                    | Preço, prazo, não era o decisor, mudou de fornecedor    |
| Confirmar que a reativação está programada   | `reativacao_60d` roda sozinha; só confira se está ativa |

---

## Perdido

| Passo                                    | Dica                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Registrar o motivo real da perda          | É o único dado que melhora a próxima proposta                            |
| Confirmar se vale mandar para reativação  | Perdido por preço volta; perdido por qualidade precisa de conversa antes |

---

## Como manter isto vivo

Um playbook que ninguém edita vira decoração em dois meses. Duas regras:

- **Se um passo é ignorado por todo mundo, apague o passo.** Uma lista com um
  item morto ensina a equipe a ignorar a lista inteira.
- **Se um problema aconteceu duas vezes, vire um passo.** É o único critério —
  não "seria bom se".

Quem edita: qualquer administrador, direto na oportunidade, pelo lápis ao lado
do contador do playbook. A mudança vale imediatamente para todas as
oportunidades daquela etapa.
