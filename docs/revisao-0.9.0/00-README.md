# Revisão 0.9.0 — 2 de setembro de 2026

Uma frente só: o fluxo comercial oficial da PlastfortSul
(`PlastfortSul_CRM_Automacoes_Fluxo_Correto.md`, que não está no
repositório) dentro do motor de automações. Quatro pedidos, em sequência,
no mesmo dia.

O fio condutor: **o motor era escrito por contato e por mensagem; o fluxo
é escrito por oportunidade e por tempo na etapa.** Dos seis gatilhos que o
fluxo exigia, um existia. Das doze ações, seis. As três regras
transversais — cancelamento por resposta, duplicidade, histórico por
oportunidade — nenhuma. A resposta foi cinco acréscimos ao motor em vez
de um motor novo, e está toda em
[docs/spec-automacoes-fluxo.md](../spec-automacoes-fluxo.md).

## Os documentos

| Arquivo                                                    | O que tem dentro                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| [01-worklog.md](01-worklog.md)                             | Cada mudança, por área, com os arquivos                                 |
| [02-decisoes.md](02-decisoes.md)                           | As chamadas que precisaram de argumento, com a alternativa rejeitada    |
| [03-pendencias.md](03-pendencias.md)                       | O que **não** foi feito, o que depende de você, e o que ficou em aberto |
| [04-verificacao.md](04-verificacao.md)                     | O que foi verificado, como conferir a 065, e o roteiro ponta a ponta    |
| [../spec-automacoes-fluxo.md](../spec-automacoes-fluxo.md) | O spec: o fluxo contra o código, os princípios, o plano por fases       |

## O pedido, item por item

| #   | Pedido                                                                    | Onde foi parar                                                                                                      |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | "analisa o MD e o projeto"                                                | O parecer, que virou a Parte A e a Parte B do spec                                                                  |
| 2   | "pode fazer o doc em spec, e organiza a implementação disso aí tudo"      | [spec-automacoes-fluxo.md](../spec-automacoes-fluxo.md), com as oito decisões e nove fases                          |
| 3   | "só faz algo que funcione tudo solicitado sem prejudicar funcionalidades" | Fases 1 a 8 no código — [01-worklog.md](01-worklog.md); o que ficou de fora em [03-pendencias.md](03-pendencias.md) |
| 4   | "atualiza as docs e prepara para um novo release"                         | Esta pasta, [releases/v0.9.0.md](../releases/v0.9.0.md), a Novidades, a versão                                      |

## Banco

**Uma migração: 065**, **escrita e não aplicada**. Nada do fluxo roda
antes dela, e o código tolera a ausência: um insert que esbarra numa
coluna ausente é refeito sem ela, o cron reporta zero eventos em vez de
falhar. Ver [04-verificacao.md](04-verificacao.md) para conferir que
aplicou.

```bash
supabase db push
```

## O que depende de você depois do deploy

Três coisas que são dados da conta, não código, e por isso não vieram na
versão: as doze etapas com os nomes do fluxo, as três respostas rápidas
com atalho, e a instalação dos dez modelos. A ordem e o porquê estão em
[03-pendencias.md §1](03-pendencias.md#1-o-que-só-você-pode-fazer).
