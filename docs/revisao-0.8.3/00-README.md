# Revisão 0.8.3 — 24 de agosto de 2026

O acabamento da [0.8.2](../revisao-0.8.2/00-README.md). Aquela revisão terminou
com uma auditoria de 79 agentes contra o código, que confirmou **68 defeitos** —
e a sessão acabou antes de corrigir a maior parte deles. Esta é a passagem que
fecha os de interface.

## Os documentos

| Arquivo                                  | O que tem dentro                                            |
| ---------------------------------------- | ----------------------------------------------------------- |
| [01-worklog.md](01-worklog.md)           | Cada mudança, agrupada pelo pedido ou pelo achado que a causou |
| [02-bugs.md](02-bugs.md)                 | Os defeitos: sintoma, causa, correção                        |
| [03-pendencias.md](03-pendencias.md)     | O que **não** foi feito, e o que falta aplicar               |
| [04-verificacao.md](04-verificacao.md)   | O que foi medido e o que ninguém viu rodando                 |

## De onde veio o trabalho

Três origens, e vale separá-las porque só uma é pedido novo:

1. **A auditoria da 0.8.2** — 68 achados confirmados. Os de interface foram
   corrigidos aqui; os de banco e de servidor estão em
   [03-pendencias.md](03-pendencias.md).
2. **Pedidos do Gabriel durante esta passagem** — usuários online na barra do
   topo, a semana ao lado da busca, o visual do online sem a palavra escrita,
   a personalização das cores de etiquetas e etapas, o painel do cliente que
   recolhe com animação em vez de sumir, e o selo de ocorrência ao lado do
   nome.
3. **Dois crashes encontrados ao subir o app** — `useTotalUnread`, mesma
   causa raiz do que derrubou o atendimento na 0.8.2; e o clique direito,
   que quebrava a rota inteira em dois menus diferentes.

## O que esta versão é

**Uma frase: o produto tinha controles que existiam e não funcionavam.**

O filtro "Encerradas" contava sempre zero e ficava desabilitado, então uma
conversa finalizada era inalcançável. O item "Atribuir a…" estava escrito em
três idiomas e nunca renderizava. A lista de usuários online se escondia
sozinha. O seletor de cor oferecia seis de um campo que sempre aceitou
qualquer uma. Nos quatro casos o código estava lá, a tradução estava lá, e a
coisa não acontecia — que é a classe de defeito que ninguém reporta como
defeito, reporta como "isso aqui não faz nada".

O resto é o que a 0.8.2 fez pela metade: dois dos caminhos que gravam o nome
do cliente não reivindicavam autoria, então o nome continuava voltando; a
máscara de telefone cobria um dos dois campos; a miniatura de mídia chegou
pelo webhook e não pelos envios de bot.

## O que ficou de fora, e por quê

- **Nada de banco ficou de fora.** As duas correções que bloqueavam o deploy
  — o `GRANT` da 047 e a escrita entre contas da 046 — foram feitas depois,
  no fim da passagem, e vão nesta versão como a 047 corrigida e a **048**.
  Ver [03-pendencias.md](03-pendencias.md).
- **Os achados de servidor da auditoria** — a corrida da atribuição
  automática, a trava de rajada das notificações, o fan-out à frente do
  motor de fluxos. Mesmo motivo, mesma lista.
- **Waveform ao vivo na gravação de áudio** e **bandeira no seletor de
  moeda** — continuam na fila desde a 0.8.2.
- **Cal.com no celular** — é um projeto, não um ajuste.
- **Opções de estilo para o BETA** — foi pedido "vê opções" e só uma foi
  apresentada, na 0.8.2. Segue em aberto.
