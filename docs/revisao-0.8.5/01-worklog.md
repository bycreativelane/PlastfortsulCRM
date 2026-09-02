# Worklog — 0.8.5

Cada mudança, sob o pedido que a causou. Índice em
[00-README.md](00-README.md).

---

## 1. O topo de `/relatórios` ganhou um herói

> _"os primeiros que enviei são os atuais, eu não gosto deles, ta péssimo,
> te mandei referencias para que faça um NOVO design dessas sessões"_

**`src/components/dashboard/metric-strip.tsx`** — reescrito.

Eram quatro células iguais num painel dividido. O argumento original
continua valendo contra o que ele substituiu — quatro cards com quatro
bordas em volta de quatro leituras do mesmo período são quatro molduras
em volta de uma ideia. O que ele errava era a pergunta seguinte: quatro
células **iguais** dizem que os quatro números importam igual, e numa
página de 1300px isso lê como uma faixa larga com quatro figuras
pequenas boiando dentro.

Agora são dois níveis: um bloco preenchido em `--primary` com o número a
32px, e a faixa dividida com os outros três a 24px.

> O **preenchimento** do herói saiu depois — ver
> [§11](#11-superfície-neutra-em-todo-lugar). Os dois níveis ficaram; o
> que mudou é que o acento virou tinta em vez de superfície.

| Novo em `MetricReading` | Para quê                                                 |
| ----------------------- | -------------------------------------------------------- |
| `hero`                  | O número que é o motivo de abrir a página. Opcional      |
| `window`                | "agora" / "hoje" — a janela que **aquela** leitura cobre |
| `deltaLabel`            | A base da variação: `↓ 18% vs. ontem`, não `↓ 18%` solto |

`window` não é enfeite. As quatro leituras ficam embaixo de um seletor de
período que **não controla nenhuma delas** — duas são estado de agora,
duas são contagem de hoje, e o cabeçalho da página diz 30 dias. Quem
trocava para 90 dias e via os números parados aprendia que o controle
está quebrado, o que é pior que a verdade.

`activeConversations` continua **sem delta**, de propósito:
`previous` ali não é o aberto de ontem — nada tira snapshot disso — é a
diferença entre conversas abertas hoje e ontem, que é outra grandeza com
o mesmo nome de campo.

**`src/app/globals.css`** — nono degrau na escala: `--text-display`
(32px / 1), reservado para a figura de um bloco de métrica. É degrau e
não `text-[32px]` pelo motivo de sempre nesse arquivo: a entrelinha. O
`type-scale.test.ts` foi estendido para exigir que ele declare
`--line-height` como os outros dois.

---

## 2. O tile que pede alguma coisa fica preenchido

**`src/components/ui/stat-tile.tsx`** — reescrito.

Todo tile era a mesma moldura de 1px no mesmo card, e a diferença entre
"cinco conversas sem ninguém" e "zero automações falharam" era o
preenchimento de um quadrado de ícone de 36px no canto. Numa fileira de
quatro isso é um sinal que você tem que ir procurar, na seção do produto
cuja promessa inteira é que você **não** precisa procurar.

Agora o tom pinta o tile inteiro. `human` e `danger` levam tinta, borda e
fundo; `auto` e `neutral` seguem o card branco de sempre.

Não precisou de prop nova: as chamadas já decidiam isso
(`tone={queue?.unread ? 'human' : 'auto'}` no dashboard, `danger` só com
`failed > 0` na campanha). O tom sempre foi a resposta para "isso
importa?" — estava sussurrado.

Layout virou vertical (ícone, número, legenda) e o número foi para
`text-display`. Quatro tiles de 24px numa página de 1400px gastavam a
maior parte da largura em ar à direita de uma legenda de duas palavras.

**`--danger-100`** foi criado nos dois modos, espelhando o passo
`--human-50` → `--human-100`, para a borda do tile vermelho. Exposto como
`--color-danger-border`. Em nenhum par de contraste de propósito: é
aresta, não tinta, e `--human-100` também não está.

> **Isto não é o estado final.** O preenchimento do tile e o
> `--danger-100` foram removidos depois, no mesmo dia — ver
> [§11](#11-superfície-neutra-em-todo-lugar). Este worklog é cronológico
> por pedido, então a seção fica como foi escrita e o ponteiro é a
> correção.

---

## 3. A primeira passagem nos gráficos, e por que ela não sobreviveu

> _"eu quero novos gráficos"_

Três mudanças que foram feitas, verificadas, e **substituídas no mesmo
dia** pelo pedido seguinte. Ficam registradas porque duas delas deixaram
código morto que precisou ser removido, e porque a terceira sobreviveu.

| O que foi feito                              | O que aconteceu com ela                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `TARGET_ZONE` — a meta como faixa preenchida | Removida. O gráfico de tempo de resposta deixou de ter eixo |
| `ChartRail` — trilho de composição empilhado | Removido. O funil passou a ter barras substanciais          |
| `ChartSurface fill` / `CHART_FILL_MAX`       | **Sobreviveu** — está em produção                           |

`ChartSurface fill` resolve dado real: na linha `lg:grid-cols-2` de
`/relatórios` os dois painéis são `h-full`, então a linha tem a altura do
funil — uns 500px com oito etapas — e o plot era 260 fixos. Sobravam
~240px de card vazio em todo carregamento, a maior mancha branca da
página. Com teto em `CHART_FILL_MAX` (380), porque sem teto o plot saía
690×500 e proporção não é enfeite num gráfico temporal: é a inclinação de
cada trecho.

---

## 4. Três modelos novos

> _"Eu quero NOVA VERSÃO E MODELO, DESIGN, desses gráficos do print, nao
> quero retrabalho ou otimização das telas"_

### Conversas ao longo do tempo

Duas áreas sobrepostas → **barras**. O argumento pela área era sólido no
abstrato e falhava no dado real: uma equipe que responde suas mensagens
envia mais ou menos o que recebe, então as duas séries corriam a poucos
pontos uma da outra a janela inteira, e dois preenchimentos translúcidos
na mesma altura são uma mancha com borda. A única coisa que o painel tem
no nome — direção — era a que não dava para ler.

Também saiu a interpolação. `type="monotone"` desenha rampa entre terça e
quarta, e não existe meio-dia-e-meia numa contagem diária.

### Valor no funil

Lista de trilhos de 8px → **três colunas com silhueta**. Nome numa calha
fixa à esquerda alinhado à direita contra a origem comum das barras,
barras no meio, dinheiro e fatia numa calha fixa à direita. Nada escrito
em cima de cor escolhida no Kanban, toda barra começando no mesmo x, e a
única coisa que varia na coluna do meio é comprimento.

As até sete linhas de "N% não avançaram" viraram **uma**, no subtítulo,
com as duas etapas nomeadas: `biggestDrop`. Sete números que você passa o
olho viram um que você lê. Medido em **contagem**, não em valor — uma
oportunidade grande numa etapa tardia empurra dinheiro para cima num
funil que está perdendo todo mundo.

### Tempo médio de primeira resposta

Colunas verticais → **linhas horizontais, medidas em múltiplos da meta**.

Esse era o único cuja forma não tinha conserto. A meta é cinco minutos e
uma semana real bate três horas: a meta fica em 2,5% da altura do plot.
Como fio tracejado virava o eixo x; como faixa preenchida — a tentativa
do §3 — ficava legível e continuava sendo uma lasca no chão embaixo de
sete colunas de altura parecida. E elas **são** de altura parecida na
resolução daquele gráfico: 72 e 180 minutos são ambos "muito acima", e um
eixo linear gasta toda a amplitude separando duas respostas que são a
mesma resposta.

Então mudou a **medida**, que é a parte que marca nova nenhuma resolve.
Cada dia diz quantas vezes a meta levou — `36× a meta` — como texto. A
barra atrás é escalada pelo dia mais lento, então comprimento responde a
única pergunta que figura resolve aqui: se eu arrumar um dia essa semana,
qual? A meta saiu do plot e é nomeada uma vez no cabeçalho.

Sem eixo e sem área de plot não sobrou nada para o Recharts fazer: o
painel são sete linhas flex. `peakPercent` continua sendo o primitivo
compartilhado, então esse painel e o funil concordam sobre o que é
"fatia da maior".

---

## 5. Uma cor, dois pesos — e menos marcas

> _"eu quero algo mais harmonico, não tão pesado e esteticamente bonito e
> não tão poluido de ver"_

A referência tem duas cores e dez marcas. A entrega do §4 tinha sessenta
barras, oito cores saturadas encostadas e sete pílulas coloridas.

**A regra que passou a valer nos três painéis:** o acento cheio para o
que importa, o mesmo acento a um terço para o resto. Antes cada painel
tinha paleta própria.

| Painel         | Antes                                        | Agora                                          |
| -------------- | -------------------------------------------- | ---------------------------------------------- |
| Conversas      | 30 dias × 2 séries, duas matizes, divergente | ~5 grupos × 2, uma matiz, lado a lado          |
| Funil          | 8 cores de banco em faixas encostadas        | Uma matiz; a cor da etapa vira um ponto de 6px |
| Tempo resposta | 7 pílulas preenchidas                        | Texto cinza; cor só no dia que bate a meta     |

**A agregação** é a mudança de comportamento desta passagem: até 14
pontos desenha por dia, até 70 por semana, acima disso por mês. Os baldes
são cortados do fim mais recente para trás — cortar do início deixa o
balde parcial na direita, que é a barra que todo mundo lê primeiro.

A cor da etapa no funil não foi tirada: foi movida para onde custa seis
pixels em vez de uma faixa inteira. O card compacto do dashboard foi
alinhado à mesma gramática, porque os dois funis ficam a um clique um do
outro e da última vez que discordaram de cor e escala ninguém percebeu
por um release.

---

## 6. O diagnóstico das bordas

> _"verifica o que deixou as bordas dos inputs mais aparentes"_

**Não foi desta passagem.** Os oito componentes de formulário e o
`theme-contrast.test.ts` têm mtime anterior ao primeiro commit desta
sessão.

O token `--input` foi escurecido:

|                | `--card` | `--background` | `--muted` |
| -------------- | -------- | -------------- | --------- |
| claro, antes   | 1,56:1   | 1,47:1         | 1,37:1    |
| claro, depois  | 3,43:1   | 3,22:1         | 3,00:1    |
| escuro, antes  | 1,29:1   | 1,38:1         | 1,19:1    |
| escuro, depois | 3,27:1   | 3,50:1         | 3,01:1    |

Foi correção de acessibilidade, não estética: WCAG 1.4.11 pede 3:1 do
limite de um componente, e o comentário que veio junto diz o sintoma em
campo — os checkboxes de seleção em massa na tabela de contatos não
estavam visíveis. Junto veio a divisão do token: `--input` passou a ser
só a borda e `--field` ficou com o preenchimento, que é o motivo dos oito
arquivos com uma linha alterada cada.

**A contribuição desta passagem foi o raio**, e ela amplificava: canto
mais arredondado faz o contorno virar forma fechada, que o olho lê como
objeto. Ver §7.

---

## 7. Raio de volta à base, e a regra de superfície

> _"identifica tudo que tiver assim e ajusta para manter o padrão leve de
> todo o restante, depois revisa o front end para manter a simetria"_

`--radius` tinha subido de `0.5rem` para `0.75rem` no §5, para dar aos
cards a geometria macia das referências. **Deu — e mexeu nos controles na
mesma proporção**, porque `rounded-lg` é `var(--radius)` e tanto `Panel`
quanto `Input` pedem o mesmo token. 12px num painel de 400px é superfície
macia; 12px num campo de 32px é 38% da altura, ou seja, cápsula.

`--radius` voltou para `0.5rem` nos dois modos. A suavidade foi para
`rounded-xl` (1,4× a base = 11,2px) nas superfícies, que é derivado — uma
mudança futura na base ainda move o painel junto em vez de deixá-lo
órfão.

**A regra:** superfície que encosta no fundo da página acompanha o
`Panel`; o que renderiza **dentro** de um painel fica na base, para que um
quadro aninhado nunca seja mais redondo que o card que o segura.

| Alinhado para `rounded-xl`    | Por quê                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `Panel`, `StatTile`           | As superfícies-base                                         |
| `MetricStrip` — herói e faixa | Ficam lado a lado com painéis                               |
| `QuickActions`                | Os quatro atalhos, direto na página                         |
| `TileLink` no dashboard       | Envolve um `StatTile`; o anel de foco tinha canto diferente |
| `SkeletonCard`                | **Era bug**: substitui um `Panel` no carregamento           |

Mantidos na base: as linhas do `TeamPerformance`, o `StatePanel`
tracejado, os controles do `PeriodPicker`.

---

## 8. Copy

Seis chaves ficaram órfãs e quatro delas por causa desta passagem.
Removidas de `en`, `pt-BR` e `ko`:

| Chave removida                   | Substituída por                           |
| -------------------------------- | ----------------------------------------- |
| `conversationsChart.description` | `conversationsChart.per.{day,week,month}` |
| `responseTimeChart.average`      | — (o tooltip do Recharts saiu)            |
| `pipelineDonut.funnelSub`        | `pipelineDonut.biggestDrop`               |
| `pipelineDonut.dropOff`          | idem                                      |

**Duas chaves mentiam.** `newContactsToday` passou a guardar "Novos
contatos" e `messagesSentToday`, "Mensagens enviadas" — o "hoje" foi para
o campo `window`. Renomeadas para `newContacts` e `messagesSent`, porque
um nome de chave que promete uma coisa e entrega outra é uma armadilha
para quem for traduzir depois.

**`responseTimeChart.description` estava velha:** dizia "Minutos até
responder…" num painel que agora imprime `2h58` e `36× a meta`. Reescrita
para dizer o que mede do lado do cliente — _"Quanto o cliente esperou
pela primeira resposta, por dia da semana"_.

Casing dos títulos em `en` foi conferido contra a convenção existente
(Title Case em `Dashboard.*.title`) e está consistente. `tooltipIncoming`
e `tooltipOutgoing` também estão órfãs e **não** foram removidas: já
estavam assim antes desta passagem.

---

## 9. Bugs

**`bucketSeries` virou módulo próprio, com teste.**
`src/components/dashboard/bucket-series.ts` + 15 casos em
`bucket-series.test.ts`.

É a única coisa nesses painéis que pode estar **errada sem parecer
errada**. Toda outra decisão é visível — uma cor, um vão, um raio — e essa
decide silenciosamente quais dias caem em qual barra. Um erro de
fatiamento renderiza um gráfico perfeitamente plausível dos números
errados, e o total da legenda continuaria certo porque é somado dos
pontos crus. O teste fixa a invariante que importa: qualquer que seja a
unidade, os baldes somam os pontos.

**Esqueleto de `/relatórios` não tinha a forma que resolve.** Eram quatro
`SkeletonCard` em `xl:grid-cols-4` — a forma da faixa antiga. O que
resolve é um herói 2/5 ao lado de uma faixa 3/5. A página desenhava
quatro caixas e trocava por duas de larguras diferentes, que é exatamente
o salto de layout que o `SkeletonCard` existe para evitar, reintroduzido
uma grade acima dele. Agora o carregamento é o próprio `MetricStrip` com
`loading`, na geometria em que vai resolver.

**Contagem de amostras tinha sumido.** O gráfico antigo mostrava
"N amostras" num tooltip do Recharts; a reescrita em linhas HTML não tem
tooltip, e a informação caiu. `36× a meta` a partir de duas conversas não
é um fato sobre quartas-feiras, e a linha que diz isso ficava idêntica à
construída sobre quarenta. Voltou como sublinha embaixo do dia, na mesma
forma que o funil usa para "4 oportunidades".

**Truncamento no funil compacto.** O rótulo virou um flex para caber o
ponto da etapa, e um filho de flex tem `min-width: auto` — `truncate`
sozinho não encurta. Faltava `min-w-0` no nome.

Verificação: `npm run build` passa, `tsc --noEmit` limpo, eslint sem
erros nos arquivos tocados (resta um aviso pré-existente de
`exhaustive-deps` em `reports/page.tsx`), console do navegador sem erro
nem aviso, **124 arquivos de teste e 1508 casos passando**.

---

## 10. A Visão geral reorganizada

> _"da pra otimizar aquela linha que tem os 4 avisos e tentar subir a parte
> de agenda pra cima?"_ · _"reduza isso para um espaço menor não tão
> aparente e do lado coloque a parte de agenda"_

Três passagens sobre o mesmo bloco, e a última é a que ficou:

```
Atalhos
Precisa de você + O CRM fez hoje   ·   O que vem por aí
Fila de ações humanas              ·   Valor no funil
```

**Os quatro avisos deixaram de ser cards.** Numa coluna de um quarto da
página um card por aviso daria ~160px de legenda e quebraria toda em três
linhas. Viraram quatro linhas num painel só — que é o que sempre foram:
quatro leituras de uma pergunta, lidas de cima para baixo.

|                     | antes         | agora                          |
| ------------------- | ------------- | ------------------------------ |
| superfície do aviso | 1400 × 138 px | 334 × 199 px                   |
| área com tom        | card inteiro  | ícone de 28px + figura de 20px |

`AttentionRow` (`components/dashboard/attention-row.tsx`) é componente
próprio e não local da página, para a bancada conseguir montá-lo na
largura real.

**A agenda subiu e foi para o lado.** Estava por último, embaixo de uma
fila de ~420px, fora da primeira tela em qualquer desktop. Divisão de 1/3
e não meio a meio porque ela é `[20rem calendário | 1fr dia]` e em meia
página o painel do dia ficaria mais estreito que o calendário ao lado.

**"O CRM fez hoje" subiu junto**, e não por caber: o bloco de doutrina da
página diz que ela é _um argumento feito duas vezes_, e a segunda metade
morava na coluna lateral da fila, duas seções abaixo, onde ninguém a lia
como contraparte de nada. Juntar as metades e tapar o buraco de 260px
eram a mesma correção.

A coluna é `flex flex-col` com o último painel crescendo, então as duas
colunas terminam na mesma linha — medido, diferença 0.

**A fila continua embaixo de propósito.** É o único bloco com scroll
próprio, e bloco com scroller interno acima de um que a página rola por
fora são duas rolagens disputando a mesma roda.

---

## 11. Superfície neutra em todo lugar

> _"nao usa background com outra cor, usas só o icone e o numero"_ ·
> _"ajusta essse q ta mt aparente"_

A regra passou a valer nos quatro lugares que tinham fundo tonalizado:

| Onde             | O que saiu                                  |
| ---------------- | ------------------------------------------- |
| `AttentionRow`   | `bg-human-soft` / `bg-danger-soft` na linha |
| `StatTile`       | a variante `tone` inteira do `tileVariants` |
| `MetricHero`     | o bloco sólido em `--primary`               |
| `O CRM fez hoje` | o `bg-auto-soft` do cabeçalho do painel     |

O tom vive em **dois lugares**: o quadrado do ícone e a figura. Legenda,
borda e superfície são iguais em todas as tonalidades — a legenda é a
mesma frase quer o número seja 0 ou 7.

Quatro linhas numa coluna com duas lavadas lia como bloco listrado, e o
olho ordena as listras antes de ler um dígito. No herói era pior: dois
quintos da linha mais larga da página na cor mais saturada do tema, que
no modo escuro lia como painel aceso.

**Duas coisas caíram junto por ficarem sem função:**

- `--danger-100` / `--color-danger-border`, criados nesta mesma passagem
  para a borda do tile vermelho. Zero call sites depois que a borda saiu.
- `HeroMovement`, uma cópia do `MetricMovement` que só existia porque
  `--ok-700` e `--danger-700` nunca foram medidos contra fundo saturado.
  No card voltam a ser o par verificado; virou um `size` no original.

---

## 12. A borda dos inputs, decidida

> _"no primeiro print to mostrando como ta a borda dos inputs, ta bem
> forte e marcada... eu quero TODAS leves"_

Resolvido **separando o token**, não afrouxando a exigência:

| Token       | Claro      | Escuro     | Quem usa                             |
| ----------- | ---------- | ---------- | ------------------------------------ |
| `--field`   | wash a 30% | wash a 30% | o preenchimento                      |
| `--input`   | 1,56:1     | 1,29:1     | input, select, textarea, botão, tabs |
| `--control` | **3,43:1** | **3,27:1** | checkbox e radio (16px)              |

Os quatro pares do `theme-contrast.test.ts` foram **re-apontados** de
`--input` para `--control`, com o argumento ao lado deles. O bug original
— checkboxes de seleção em massa invisíveis — continua coberto por teste.

A distinção é a palavra "identificar" na WCAG 1.4.11: um quadrado de 16px
vazio **é** a sua borda; um campo de 32px sob rótulo visível, com
placeholder e preenchimento próprio, tem quatro canais antes do traço.

O raio voltou para `0.5rem` na base e a suavidade foi para `rounded-xl`
(11,2px) nas superfícies — `rounded-lg` é `var(--radius)` e tanto `Panel`
quanto `Input` pediam o mesmo token, então subir a base entregava dois
efeitos e só um era desejado.

---

## 13. Print, vídeo e áudio na sala da equipe — migração 063

> _"e na minha equipe nao da pra por print, vídeo e audio"_

`supabase/migrations/063_team_message_media.sql`, **escrita e não
aplicada** — Gabriel aplica do Cursor.

Colunas de mídia em `team_messages` (`content_type`, `media_path`,
`media_mime`, `media_name`, `media_size`) e o `CHECK` do corpo relaxado
só até onde precisa: texto continua exigindo texto, mídia exige caminho.
Largar o CHECK deixaria entrar linha sem corpo e sem anexo.

**Bucket novo e privado, e essa é a decisão da migração.** O `chat-media`
resolveria sem SQL nenhum — já aceita os quatro tipos, já tem política
por membro. Ele é **público**, e tem que ser: a Meta busca a URL. Para a
sala interna isso desfaz o argumento da 046, que se recusou a guardar
mensagem interna em `conversations` porque estaria "a um `IF` de ser
entregue a um cliente". Balde público é a mesma frouxidão sem precisar do
`IF` — basta o link vazar.

A coluna guarda o **caminho**, não a URL: URL assinada expira, e um campo
que fica errado sozinho depois de uma hora é o próximo bug.

A lista de MIME é **maior** que a do `chat-media` de propósito — aquela é
a que a Meta aceita, e aqui não tem Meta. Vídeo de tela gravado no
navegador é WebM e áudio gravado no navegador é WebM/Opus; os dois seriam
recusados pela lista de saída e os dois são o que se manda para um colega.

Sem `UPDATE` e sem `DELETE` nas políticas de storage: a mensagem pode ser
editada ou apagada, o arquivo que ela citou não.

`supabase/ci/verify-schema.sql` passou a afirmar que o bucket existe **e
que `public = false`** — ali é vazamento, não estilo.

**O cliente não foi escrito.** Ele não é testável antes da 063 estar
aplicada: as colunas não existem e a sala fica atrás do login. O plano
está no topo da migração.

---

## 14. Anexos na sala da equipe

> _"e na minha equipe nao da pra por print, vídeo e audio"_ ·
> _"área de anexo ter padrão para arrastar e carregar arquivo ou imagem,
> aceitar comando colar no chat, integrar audio"_

**Migração 063** (aplicada) e o cliente inteiro.

**O balde é privado, e essa é a decisão.** O `chat-media` resolveria sem
SQL nenhum — já aceita os quatro tipos, já tem política por membro. Ele é
**público**, e tem que ser: a Meta busca a URL na hora de enviar. Para a
sala interna isso desfaz o argumento da 046, que recusou guardar mensagem
interna em `conversations` por estar "a um `IF` de ser entregue a um
cliente". Balde público é a mesma frouxidão sem precisar do `IF`.

A coluna guarda o **caminho**, não a URL: assinada expira, e um campo que
fica errado sozinho depois de uma hora é o próximo bug.

| Peça                           | Nota                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `lib/team/media.ts`            | `createSignedUrls` **no plural** — um lote por página |
| `team-media-bubble.tsx`        | Imagem, vídeo, áudio e documento                      |
| Clipe, arrastar, colar, gravar | No compositor da sala                                 |

**Um lote e não uma assinatura por balão:** numa sala com duzentas
mensagens seriam duzentas requisições disparadas juntas, cada uma com seu
carregamento — a sala abriria como cortina de retângulos cinzas.

**O arquivo sobe antes do envio.** Upload é a parte lenta e a que falha;
descobrir isso depois de clicar deixa a mensagem pela metade.

**Não reusei o `message-media.tsx`.** É bom e faz quase o mesmo, mas é
tipado contra o `Message` da inbox e lê `media_url` — a sala tem caminho,
não URL. Generalizá-lo é certo quando o download dele parar de depender do
id da mensagem da inbox; hoje seria refatorar o componente da tela mais
usada para acomodar uma nova.

**A degradação sem a 063 não é silenciosa.** O padrão `isUnknownColumn`
reinsere só o corpo quando falta `room_id` — certo ali. Com anexo seria
errado: entregaria a legenda como se fosse a mensagem e o arquivo sumiria.
Retorna `TEAM_MEDIA_UNAVAILABLE` com frase própria.

Três detalhes do arrastar/colar/gravar que decidem se funciona:

- **Contador de profundidade no drag.** `dragleave` dispara ao cruzar
  qualquer filho — e a lista é feita de balões. Sem contar entradas e
  saídas, o overlay pisca a cada mensagem que o cursor atravessa.
- **O overlay é `pointer-events-none`.** Capturando ponteiro, ele
  dispararia `dragleave` no container debaixo e se apagaria sozinho.
- **Cancelar a gravação não é parar.** O `opus-recorder` entrega os bytes
  _depois_ do `stop()`; sem a marca `cancelledRef`, descartar subiria o
  áudio assim mesmo.

O card da sala na barra lateral mostrava `body`, e mensagem só-imagem
grava `body` nulo — a linha aparecia **em branco** num card cujo trabalho
é dizer que há mensagem nova. `teamMessagePreview` resolve: com legenda,
a legenda; sem, o tipo em palavra, em itálico.

---

## 15. Playbook

> _"faltou a aba de playbook no menu esquerdo lateral, e la dentro sim
> aparecer script de vendas, produtos, objeçoes e regras de operação"_

**Migração 064** — `playbook_entries`, uma tabela com `type` e não três.
Quem decide não é a forma, é a **busca**: procurar "frete" varre objeção,
regra e script, e com três tabelas isso é um `UNION` onde o quarto tipo
será esquecido — num lugar que não dá erro, só devolve menos resultado.

**A colisão de nome, resolvida por rótulo.** `playbook_steps` (041) já
era o checklist por etapa e aparecia escrito "Playbook" na tela. A área
nova ficou com a palavra e o checklist virou **"Passos da etapa"** —
custou strings nos três idiomas, zero schema.

**Produtos não é o catálogo, é a ficha.** A primeira versão montava o
`ProductCatalog` inteiro na aba, e estava errada por dois motivos:
Produtos já tem linha própria no menu, e o catálogo é tela de **gestão** —
ninguém edita catálogo com o cliente esperando. O que a conversa pede é
uma ficha: código, medida, micragem, material, cor, unidade, preço e
descrição, só leitura, densa. Mesma tabela `products`, zero duplicação; o
que muda é a pergunta.

Campo vazio não desenha rótulo — uma ficha cheia de "—" se lê mais
devagar, e quem lê tem alguém esperando. Com busca ativa os produtos
entram no mesmo resultado dos outros três, **depois** deles: o que alguém
escreveu pensando nesta conversa ganha do que serve para todas.

---

## 16. Bugs desta rodada

**O Playbook não aparecia no menu, e o teste não pegou.** O `sidebar.tsx`
monta o mapa de capabilities **à mão** — uma chamada `useCapability` por
linha, porque hook não roda em laço. Adicionei o item com
`capability: 'playbook.view'` e esqueci a chamada. `can['playbook.view']`
ficava `undefined`, o filtro exige `=== true`, e a linha sumia:
**compilou, passou no lint, passou nos 1508 testes**, porque `can` é um
`Partial` e a chave faltando é legal.

Corrigido, e com guarda: um item cuja capability não esteja no mapa agora
dispara `console.error` em dev nomeando qual falta. Não dá para resolver
no tipo — o produto tem mais capabilities do que linhas de menu.

**`/playbook` estava acessível sem sessão.** O `proxy.test.ts` pegou: a
rota nova não estava em `PROTECTED_PATHS`. É exatamente para isso que
aquele teste existe.

**O avatar do CRM mostrava iniciais, não a foto.** O card montava o disco
à mão com `avatarClass` + `avatarInitials` e nunca lia `avatar_url`.
Passou a usar `MemberAvatar`, com um tamanho `2xs` novo (20px) para não
mexer na densidade do rodapé.

E **o mesmo defeito num segundo lugar**: varrendo todo arquivo que usa
`avatarInitials` contra quem lê `avatar_url`, o cabeçalho da conversa
também mostrava só iniciais — e o comentário em cima dele dizia "o mesmo
disco que a lista desenha para este contato". A lista desenha a foto.
Os dois discos do mesmo contato, na mesma tela ao mesmo tempo,
discordavam.

**A trilha de Configurações rolava junto com a página.** Ela já era
`sticky`, e o comentário do próprio arquivo avisa que "um elemento sticky
mais alto que a viewport silenciosamente deixa de ser sticky". A conta
estava errada por 1rem:

```
o ancestral de rolagem é o <main>, não o documento
<main> = 100dvh − 3.5rem   (o header é min-h-14)

sticky segura enquanto  altura + top ≤ área de rolagem
  tinha:  (100vh − 4rem) + 1.5rem  =  100vh − 2.5rem
  cabia:   100dvh − 3.5rem          ← 1rem alto demais
  agora:  (100dvh − 5rem) + 1.5rem  =  100dvh − 3.5rem  ✓
```

Nunca funcionou; só ficou visível quando um painel passou a rolar, e
"ver todos" na Novidades é o clique que faz isso.
