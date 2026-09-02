# Pendências

O que **não** foi feito, o que depende de você, e o que ficou em aberto.

---

## 1. O que só você pode fazer

Nesta ordem, porque cada item precisa do anterior:

1. **Aplicar a 065** pelo Cursor. Como conferir que aplicou:
   [04-verificacao.md §2](04-verificacao.md#2-conferir-a-065).
2. **Criar as doze etapas** em Configurações › Pipelines, no funil
   Vendas, com os nomes do fluxo: Novo Lead · Em Aberto · Follow-up · Em
   Negociação · Ligação · Em Andamento · Atendido · Pós-venda · Compra
   Futura · Geladeira 30D · Geladeira 60D · Venda Perdida. Os modelos
   também aceitam "Geladeira 30 dias", "Geladeira 60 dias" e "Perdido".
3. **Criar as três respostas rápidas** com os atalhos `aberto`,
   `andamento` e `atendido` (o conteúdo é o de vocês; o atalho é o que
   dispara).
4. **Instalar os dez modelos** em Automações › Funil de Vendas, um por
   um, e ativar. O que o modelo não encontrar na conta fica marcado; a
   ativação recusa até você escolher.
5. **Agendador a cada minuto** em `/api/automations/cron` e
   `/api/flows/cron`.
6. **Submeter os templates à Meta** — só depois do número de teste, e
   já com os nomes novos (`followup_d10`, `posvenda_d20`).

## 2. Ponta a ponta não rodado

Depende dos itens acima e do número de teste da Meta. O roteiro está em
[04-verificacao.md §3](04-verificacao.md#3-o-roteiro-ponta-a-ponta).
Tudo o que foi verificado é por tipo, teste e build.

## 3. Ficha da oportunidade sem "automação ativa"

A fase 7 do spec previa a ficha dizendo "automação ativa: X — próximo
passo em <data>", lida da fila. Não foi feita. O histórico por automação
mostra a oportunidade e o motivo de encerramento, e a agenda continua
mostrando as esperas; a ficha vem noutra passada.

## 4. Rota síncrona de mover etapa

Não feita, como a Parte G do spec previa. `/andamento` leva até um
minuto para virar Em Andamento na tela. Se incomodar, é uma rota que
grava e drena na hora, por cima do desenho atual.

## 5. Os scripts de seed continuam fora do repositório

`package.json` aponta `seed:crm`, `seed:automations`, `seed:inbox` e
`seed:notifications` para arquivos que não estão no repositório. Não foi
tocado: os dez modelos instaláveis substituem o seed de automações, e as
etapas são doze linhas em Configurações. Ou os scripts voltam, ou os
quatro comandos saem do `package.json`.

## 6. `POST /api/v1/deals` grava `status: 'active'`

A migração 002 só aceita `open`, `won` e `lost`, então toda criação de
oportunidade pela API pública falha hoje. Não é desta entrega; há um chip
aberto para corrigir à parte. Uma linha de correção e um teste.

## 7. Dois templates da Meta sem uso

`reativacao_60d` (o fluxo não manda mensagem da geladeira "por enquanto")
e `posvenda_avaliacao` (o D20 pede a avaliação na mesma mensagem). Ficam
no conjunto, não são submetidos, e o teste do arquivo continua a cobri-los.

## 8. Dois gatilhos sem produtor

`time_based` e `conversation_assigned` saíram do menu e continuam no
tipo. Ganham produtor noutra passada, se algum dia for preciso;
`webhook_received` continua funcionando e continua fora do menu.

## 9. Traduções em coreano sem revisão de falante

As 112 chaves novas e a Novidades em `ko.json` foram escritas nesta
passagem. `messages.test.ts` garante paridade, não qualidade.

## 10. Duas latências que são do desenho

- Um evento de etapa leva até um minuto para virar gatilho (§4 acima).
- A varredura de aniversário dispara no primeiro tique depois da hora
  configurada, não na hora exata.
