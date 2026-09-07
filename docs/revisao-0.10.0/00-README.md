# Revisão 0.10.0 — 7 de setembro de 2026

Uma frente só, em três dias: **tarefas, agenda e a ponte com a Google**.

O fio condutor cabe numa frase: **o CRM tinha um calendário, mas não tinha
nem um relógio nem um compromisso.** `lib/dashboard/agenda.ts` reunia seis
fontes datadas e as desenhava em dois lugares — mas cinco das seis eram
datas de OUTRA coisa: uma oportunidade que fecha, um aniversário, uma
campanha que saiu. Nenhuma era um compromisso que alguém marcou. E o produto
inteiro só conhecia o DIA: das seis fontes, apenas duas carregavam hora, e o
fuso da empresa estava escrito à mão numa constante.

Faltavam três coisas, nesta ordem de dependência: uma base de horários, a
entidade tarefa, e a ponte com a Google. As sete fases do plano
([spec-tarefas-e-agendas.md](../spec-tarefas-e-agendas.md)) são exatamente
isso, e todas foram entregues.

Isto **reverte a decisão 2** do
[spec-automacoes-fluxo.md](../spec-automacoes-fluxo.md) — "ligação é uma
etapa, sem entidade tarefa". O que aquela decisão não conseguia expressar:
mover a oportunidade para a etapa "Ligação" diz QUE alguém deve ligar, e não
diz quem, nem quando, nem se já ligou.

## Os documentos

| Arquivo | O que tem dentro |
| --- | --- |
| [01-worklog.md](01-worklog.md) | Cada mudança, por área, com os arquivos |
| [02-decisoes.md](02-decisoes.md) | As chamadas que precisaram de argumento, com a alternativa rejeitada |
| [03-pendencias.md](03-pendencias.md) | O que **não** foi feito e o que depende de você |
| [04-verificacao.md](04-verificacao.md) | O que foi verificado, o que **não** foi, e como conferir |
| [../spec-tarefas-e-agendas.md](../spec-tarefas-e-agendas.md) | O plano: o diagnóstico, o modelo de dados, as sete fases |
| [../estado-do-projeto.md](../estado-do-projeto.md) | O estado **vivo** do projeto — leia este se veio de fora |

Esta pasta é o registro histórico da 0.10.0. O `estado-do-projeto.md` é
outra coisa: ele descreve onde as coisas estão AGORA e é para ser
atualizado. Se os dois discordarem, o segundo tem razão.

## A sequência, dia por dia

| Dia | O que aconteceu |
| --- | --- |
| **3 set** | Fases 1 e 2: base de horários (`066`) e a entidade tarefa (`068`), com as migrações aplicadas. Junto, a `067` (realtime) e a página `/developers`, de outra frente. |
| **4 set** | Nenhum código. Três documentos de planejamento escritos — ações de agente, pesquisa de plataformas, transporte Baileys. Nenhum implementado. |
| **6 set** | Fase 3: a página `/agenda`, com mês, semana e dia. |
| **7 set** | Fases 4 a 7: a ponte com a Google (`069`), publicar tarefas lá, a tarefa no motor de automações, e a entrega. |

Entre o dia 3 e o dia 6 o trabalho ficou **parado na árvore de trabalho**,
não commitado: 35 arquivos modificados e 22 novos, quatro entregas
terminadas e testadas correndo risco de um `git checkout` distraído. A
primeira coisa que a sessão do dia 6 fez foi separá-las em commits que
compilam um a um.

## Os números

| | |
| --- | --- |
| Commits | 15, do realtime ao corte da versão |
| Testes | 1781, em 146 arquivos |
| Migrações | `066`, `067`, `068`, `069` |
| Rotas novas | `/agenda`, 7 de calendário, 2 da API pública, 1 de automação |
| Saída de produção | ~81 MB |
