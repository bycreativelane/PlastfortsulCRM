# Revisão 0.8.5 — 1 de setembro de 2026

Uma passagem inteira sobre o topo de `/relatórios`, o topo de
`/dashboard` e os três gráficos entre eles. Começou com dois prints e a
instrução de não falar nada, e terminou com três gráficos que não são
versões melhores dos anteriores — são outros modelos.

O fio condutor: **quantidade de marcas é decisão de design, não
consequência do dado.** Trinta dias × duas séries são sessenta marcas
num painel de 690px, e todas estavam certas. O painel lia como ruído.

## Os documentos

| Arquivo                              | O que tem dentro                                                            |
| ------------------------------------ | --------------------------------------------------------------------------- |
| [01-worklog.md](01-worklog.md)       | Cada mudança, sob o pedido que a causou                                     |
| [02-decisoes.md](02-decisoes.md)     | As chamadas que precisaram de argumento, com a alternativa rejeitada        |
| [03-pendencias.md](03-pendencias.md) | O que **não** foi feito, o que é de outra passagem, e o que ficou em aberto |

## O pedido, item por item

| #   | Pedido                                                             | Onde foi parar                                                                                                                          |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Analisar os prints das telas atuais, sem responder ainda           | Sem código                                                                                                                              |
| 2   | Analisar cinco referências de dashboard                            | Sem código — virou a base de [02-decisoes.md](02-decisoes.md)                                                                           |
| 3   | "tá péssimo, quero um NOVO design dessas sessões"                  | Feito — [§1](01-worklog.md#1-o-topo-de-relatórios-ganhou-um-herói) e [§2](01-worklog.md#2-o-tile-que-pede-alguma-coisa-fica-preenchido) |
| 4   | "eu quero novos gráficos"                                          | Feito e **depois substituído** — [§3](01-worklog.md#3-a-primeira-passagem-nos-gráficos-e-por-que-ela-não-sobreviveu)                    |
| 5   | "quero NOVA VERSÃO E MODELO, não retrabalho"                       | Feito — [§4](01-worklog.md#4-três-modelos-novos)                                                                                        |
| 6   | "mais harmônico, não tão pesado nem poluído"                       | Feito — [§5](01-worklog.md#5-uma-cor-dois-pesos-e-menos-marcas)                                                                         |
| 7   | "verifica o que deixou as bordas dos inputs mais aparentes"        | Diagnóstico — [§6](01-worklog.md#6-o-diagnóstico-das-bordas)                                                                            |
| 8   | Ajustar para o padrão leve e revisar a simetria geral              | Feito — [§7](01-worklog.md#7-raio-de-volta-à-base-e-a-regra-de-superfície)                                                              |
| 9   | Revisar copy, revisar bugs, atualizar docs, preparar para o GitHub | Feito — [§8](01-worklog.md#8-copy) e [§9](01-worklog.md#9-bugs)                                                                         |
| 10  | Otimizar a linha dos quatro avisos e subir a agenda                | Feito — [§10](01-worklog.md#10-a-visão-geral-reorganizada)                                                                              |
| 11  | Reduzir os avisos e pôr a agenda ao lado, não embaixo              | Feito — [§10](01-worklog.md#10-a-visão-geral-reorganizada)                                                                              |
| 12  | "não usa background com outra cor, usas só o ícone e o número"     | Feito — [§11](01-worklog.md#11-superfície-neutra-em-todo-lugar)                                                                         |
| 13  | Bordas dos inputs todas leves                                      | Feito — [§12](01-worklog.md#12-a-borda-dos-inputs-decidida)                                                                             |
| 14  | O que pôr no espaço aberto ao lado da agenda                       | Feito — [§10](01-worklog.md#10-a-visão-geral-reorganizada)                                                                              |
| 21  | Bug na seção Novidades                                             | Feito — [§16](01-worklog.md#16-bugs-desta-rodada)                                                                                       |
| 15  | Anexos, arrastar, colar e áudio no chat da equipe                  | Feito — **migração 063** — [§14](01-worklog.md#14-anexos-na-sala-da-equipe)                                                             |
| 16  | Playbook no menu, com as quatro seções                             | Feito — **migração 064** — [§15](01-worklog.md#15-playbook)                                                                             |
| 17  | Playbook acima de Configurações                                    | Feito — [§15](01-worklog.md#15-playbook)                                                                                                |
| 18  | Produtos no Playbook é ficha, não a lista                          | Feito — [§15](01-worklog.md#15-playbook)                                                                                                |
| 19  | Foto no card do CRM                                                | Feito — [§16](01-worklog.md#16-bugs-desta-rodada)                                                                                       |
| 20  | Revisar o `.md` de Playbook e anexos                               | Feito — [docs/spec-playbook-e-anexos.md](../spec-playbook-e-anexos.md)                                                                  |

## Banco

**Três migrações: 062, 063 e 064** — as três aplicadas. A 062 é a base de
custo de envio (de outra frente), a 063 traz mídia à sala da equipe com um
balde **privado**, e a 064 cria a base de consulta do Playbook. Ver
[01-worklog.md §14](01-worklog.md#14-anexos-na-sala-da-equipe) e
[§15](01-worklog.md#15-playbook).

Em outro ambiente, aplique as três **antes** de abrir o app:

```bash
supabase db push
```

A única mudança de comportamento visível que não é pintura está no
gráfico de conversas, que passou a **agregar** dias em semanas ou meses
quando a janela é grande — e o subtítulo do painel diz em qual unidade
ele parou. Ver [02-decisoes.md §3](02-decisoes.md#3-agregar-e-dizer-que-agregou).

## O que veio de fora desta passagem

A árvore já tinha trabalho não commitado quando esta sessão começou, e
uma parte dele é visível nas mesmas telas. **A borda dos inputs ficou
2,2× mais contrastada e isso não é desta revisão** — é uma correção de
acessibilidade anterior, com teste próprio. O diagnóstico completo, com
os números, está em [01-worklog.md §6](01-worklog.md#6-o-diagnóstico-das-bordas),
e o que continua em aberto por causa dela em
[03-pendencias.md](03-pendencias.md).
