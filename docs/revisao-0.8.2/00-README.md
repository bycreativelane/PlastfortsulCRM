# Revisão 0.8.2 — 24 de agosto de 2026

O que mudou, por quê, e o que ficou de fora. Escrito durante o trabalho, não
reconstruído depois.

## Os documentos

| Arquivo                                      | O que tem dentro                                                    |
| -------------------------------------------- | ------------------------------------------------------------------- |
| [01-worklog.md](01-worklog.md)               | Cada mudança, agrupada pelo pedido que a causou                      |
| [02-bugs.md](02-bugs.md)                     | Defeitos: sintoma, causa real, correção, e como a causa foi provada |
| [03-decisoes.md](03-decisoes.md)             | As sete decisões que precisaram de argumento, e o argumento          |
| [04-verificacao.md](04-verificacao.md)       | O que foi medido, o que foi só compilado, e o que não foi visto      |

## De onde vieram os pedidos

Todos do Gabriel, na ordem em que chegaram. A lista começou com 17 itens e
terminou em 23 — os últimos seis chegaram com o trabalho já em execução, o que
é a razão de duas coisas neste documento terem sido feitas duas vezes.

1. Uma lista de 17 bugs e pedidos, com o pedido de um plano antes de executar
2. Foto de perfil do cliente, manual
3. Criptografar o frontend contra cópia da estrutura
4. Executar o plano
5. Aba da equipe, notificações que não chegam, e conversa que não volta para
   Esperando
6. Analisar a resolução dessas três
7. Ajustar a fila de notificações para não travar tudo
8. "O projeto tá rodando?"
9. Padronizar a máscara do telefone
10. Remover a aba Finalizados — não foi solicitada
11. Centralizar a mensagem de erro
12. Ícone de notificação ofuscado
13. Elemento com bug na barra lateral
14. Novidades: descer, trocar o ícone, reestruturar, encurtar
15. Fluxos e automações sobre a mesma grade
16. Pacote de traduções
17. Remover os títulos de separação do menu e alinhar
18. Espaçamento do menu
19. BETA menor, outro estilo
20. Zoom e topo do editor de fluxos
21. Fazer o chat da equipe funcionar
22. Prévia e notificações da equipe na barra, e usuários online no topo
23. Botão de recolher: centralizar, mais à direita, e escondido nas mensagens

## O que esta versão é

Duas migrações — [045](../../supabase/migrations/045_inbox_state_and_contact_identity.sql)
e [046](../../supabase/migrations/046_team_channel_and_message_notifications.sql) —
e um pacote de correções que se resume a uma frase: **o produto tinha três
lugares onde uma coisa era escrita e outra era lida.**

O status da conversa era escrito pelo cabeçalho e lido pela lista com outro
significado. A ocorrência era gravada numa tabela e lida de uma etiqueta que
nada escrevia. A notificação existia para atribuição e não para mensagem. Nos
três casos o produto parecia funcionar e não funcionava, que é a única classe
de defeito que ninguém reporta como defeito — reporta como "isso aqui está
estranho".

## O que ficou de fora

- **Filtro "não respondidas"** (última mensagem é do cliente). Precisa de uma
  coluna nova e de escrita em quatro caminhos de envio. Não estava na lista;
  foi ideia minha e ficou fora.
- **Notificação de desktop / push.** O sino agora funciona; permissão do
  navegador e service worker são uma decisão de produto separada.
- **Texto do card do Hermes.** Escrito por mim de cabeça, esperando a frase do
  Gabriel. Chaves: `Roadmap.hermesTitle` e `Roadmap.hermesBody`.
- **Fluxo "Welcome menu" em inglês.** Não é bug de código — é uma linha de
  23/08, criada antes da localização existir. Ver 01-worklog §16.
- **Miniatura da mídia na linha da conversa.** Ficou de fora desta versão e
  **foi entregue na [0.8.3](../revisao-0.8.3/00-README.md)**: a migração 047
  acrescentou `last_message_kind` e `last_message_media_url`, o webhook passou
  a escrevê-las aqui, e os quatro caminhos de envio de bot na versão seguinte.
- **Opções de estilo para o BETA.** Foi pedido "ve opções" e eu escolhi uma
  sem mostrar alternativas.

---

## Depois desta revisão

Ela terminou com uma auditoria de 79 agentes contra o código, que confirmou
**68 defeitos** — e a sessão acabou antes de corrigir a maior parte. Os de
interface foram fechados na
[revisão 0.8.3](../revisao-0.8.3/00-README.md); os de banco e de servidor
estão listados em
[03-pendencias.md](../revisao-0.8.3/03-pendencias.md), e **dois deles
bloqueiam o deploy**.
