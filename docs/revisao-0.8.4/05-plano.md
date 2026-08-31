# Plano da passagem noturna

> Sete pedidos numa mensagem só, com a instrução de concluir tudo sem
> perguntar nada e sem aplicar migração. Este arquivo é o plano; o que
> foi feito está no [worklog](01-worklog.md), a partir da §18.

## Ordem, e por quê

A ordem não é a da mensagem. É por dependência e por ênfase — o pedido
diz *"realmente quero dar ênfase nisso pela importância"* sobre o Agente
IA, e o item 7 ("as mesmas melhorias para as outras seções") **depende**
de o item 4 existir primeiro, porque é ele que define o padrão a
espelhar.

| # | Item | Depende de | Migração |
| - | ---- | ---------- | -------- |
| 1 | Nome acima da mensagem no card | — | não |
| 2 | Agente IA robusto + configuração em passos | — | 053 |
| 3 | IA de apoio ao atendente, com RAG, sobre uma mensagem | 2 | 053 |
| 4 | Produtos | — | 054 |
| 5 | Relatórios com outro desenho | — | não |
| 6 | Mobile e tablet | — | não |
| 7 | Harmonia nas outras seções de configuração | 2 | não |
| 8 | Análise de lacuna no mercado brasileiro | tudo | não |

## O que "sem migrar banco" significa aqui

Escrevo os arquivos `053` e `054` e **não** aplico. Todo código que
depende deles cai no comportamento anterior quando as colunas não
existem — mesmo padrão das quatro migrações anteriores desta passagem, e
o motivo é o mesmo: um `SELECT` que nomeia uma coluna ausente é um 42703
na **linha inteira**, e várias dessas linhas são as que estabelecem
conta, cargo ou configuração de IA.

## Sobre o "plano de implementação de Produtos"

**Não encontrei um arquivo com esse nome.** Procurei por `*produt*`,
`*plano*` e por cabeçalhos em todo o repositório, incluindo
`_removido-do-repo/`. O que existe é a especificação original, e ela
trata produto como **campo**, em três lugares:

- §10 — cada oportunidade deve ter `produtos`
- §11 — o cadastro do cliente tem `produtos de interesse`
- §44 — "Campanha por produto", com o exemplo `saco_lixo` como etiqueta

Então implementei **contra a especificação**, e a leitura que fiz dela
está registrada na §21 do worklog junto com o que ela ainda não decide.
Se o plano que você tinha em mente é outro documento, o que está feito é
aditivo — uma tabela de catálogo, itens de negócio, e o filtro de
público — e nada dele impede um desenho diferente por cima.

## O que este plano NÃO tenta fazer

- **Não** toca no motor de fluxos nem no de automações. Os dois estão
  estáveis e nada nesta lista pede mudança neles.
- **Não** mexe nos achados de servidor herdados da 0.8.2 (a corrida da
  atribuição, a trava de rajada). Continuam em
  [02-pendencias.md](02-pendencias.md).
- **Não** aplica nenhuma migração, nem a 049–052 que já estavam
  pendentes.
