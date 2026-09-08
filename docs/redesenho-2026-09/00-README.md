# Redesenho das telas de trabalho — setembro de 2026

O que mudou, o que foi auditado, e o que continua aberto. Escrito durante o
trabalho, não reconstruído depois.

Sucessor de [`../ux-overhaul/`](../ux-overhaul/00-README.md), que documenta a
passada de agosto. As duas ficam separadas de propósito: aquela foi uma
revisão geral de UX; esta começou num quadro específico que o Gabriel
reprovou e cresceu a partir dali.

## Os documentos

| Arquivo                                                          | O que tem nele                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [01-worklog.md](01-worklog.md)                                   | O que entrou, na ordem, com o pedido que causou cada coisa                  |
| [02-auditoria-nove-superficies.md](02-auditoria-nove-superficies.md) | A auditoria de 8 superfícies contra o código real — **ver a ressalva abaixo** |
| [03-calcom.md](03-calcom.md)                                     | O UX do cal.com lido no código-fonte dele: navegação de data, grade de horas, fuso |
| [04-referencias-mobile.md](04-referencias-mobile.md)             | O que os três apps de tarefa do celular dão, e o que não transfere para um CRM desktop |

## Como isto começou

7 de setembro. O Gabriel abriu o quadro de tarefas entregue naquele dia e
disse: *"esse kanban tá mt feio, analisa o padrão de clickup, notion, e etc,
affine."* Depois mandou nove capturas de referência e o pedido que enquadra
tudo:

> Quero uma análise do UX de cada uma dessas imagens, para analisar o padrão,
> ideias, modelos, e fazer um plano de melhorias consistentes e reais, **não
> ajustar e sim melhorar de fato**, partes do front atual, quero algo 100%
> focado na usabilidade, simplicidade e extremamente bonito, elegante e limpo.

O plano que saiu disso tinha cinco fases. Elas foram entregues — e então:

> do design dos prints de referência que mandei não vi nada aplicado de forma
> prática visual, ainda vejo mesmo padrão de design

Ele estava certo, e essa é a lição central desta passada. Está registrada em
[01-worklog.md](01-worklog.md#a-crítica-que-mudou-o-rumo).

Depois vieram os prints da própria plataforma, e o pedido desta rodada:

> Te mandei 3 prints iniciais de referências interessantes e com ux amigável,
> e o restante são tudo print da plataforma que eu quero que tu analise
> imagem por imagem. Mas ta no caminho, faz mais essa revisão adicional
> dentro do plano e documenta também.

## A ressalva sobre a auditoria — leia antes de usar o 02

O documento 02 saiu de um workflow de **19 agentes**: duas estudando as
referências, oito auditando uma superfície cada contra o código real, oito
céticas tentando derrubar os achados da sua superfície, e uma sintetizando.

**A camada cética falhou.** Ela descartou **1 de 117** achados. Uma taxa
dessas não é sinal de que os achados são bons; é sinal de que a verificação
não mordeu. O documento 02 é, portanto, **uma lista de hipóteses com
citação de arquivo e linha — não uma lista de defeitos confirmados**.

O que foi confirmado à mão até agora está no worklog, com a prova. O primeiro
foi o off-by-one de data, e ele valeu o workflow inteiro sozinho: sete telas
imprimindo o dia anterior, num fuso a oeste de Greenwich, com a regra já
escrita em dois lugares do repositório e violada em sete.

**A regra para quem for usar o 02:** abrir o arquivo citado antes de agir.
Se a evidência não estiver na linha, o achado morreu ali.

## O método, e por que ele foi assim

Três coisas apareceram nesta passada e valem para a próxima:

**Todo inventário por texto sai inflado.** "45 ladrilhos" eram 15. "64
painéis" eram 6 na receita exata. "~61 pílulas" eram 10 que de fato eram
estado. Contar antes de prometer.

**Um guarda que passa verde pode não estar procurando nada.** Aconteceu três
vezes nesta passada. A prática que ficou: rodar o guarda novo contra
`git show HEAD:<arquivo>` dos arquivos que ele acabou de corrigir e **exigir
que ele os acuse**. Todo commit de guarda desta passada tem esse número.

**A tela autenticada não é revisável por quem escreve o código.** O
`/chart-lab` existia para os gráficos; ganhou o funil, o quadro de tarefas, a
linha da lista e o calendário. É a única forma de olhar essas peças sem
sessão, e foi onde os dois últimos defeitos apareceram.
