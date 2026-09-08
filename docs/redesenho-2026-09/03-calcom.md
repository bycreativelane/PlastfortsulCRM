# UX do cal.com: calendário, semana e hora

Levantamento feito direto no código-fonte de `calcom/cal.com` (via API do GitHub, branch `main`) mais o DeepWiki do repo. Os caminhos citados são reais e verificáveis.

---

## 0. A arquitetura que explica todo o resto

Antes das respostas: o Booker não é uma tela por layout. É **um único container CSS Grid cujas `grid-template-areas` mudam**, definido em `packages/features/bookings/Booker/config.ts` no objeto `resizeAnimationConfig`, indexado por `[layout][bookerState]`:

```
month_view.default            →  "meta main main"
month_view.selecting_time     →  "meta main timeslots"
week_view.default             →  "meta header header" / "meta main main"
column_view.default            →  "meta header header" / "meta main main"
mobile.default                →  "meta" / "header" / "main" / "timeslots"
```

As larguras são variáveis CSS, não valores fixos: `--booker-meta-width`, `--booker-main-width`, `--booker-timeslots-width` (240px, `lg:280px`). Em `month_view` o meta encolhe para 240–280px quando você está escolhendo e cresce para 340px no estado `booking` — o comentário no código diz o porquê: caber a data completa de um evento multi-ocorrência em uma linha só, e de quebra estreitar o formulário.

O `BookerState` tem quatro valores: `loading`, `selecting_date`, `selecting_time`, `booking` (`Booker/types.ts`). **Layout e estado são eixos independentes**, e só o `month_view` tem override por estado. Esse é o primeiro padrão a roubar: a navegação não é um roteador, é uma máquina de estados que reconfigura um grid.

O hook `useBookerResizeAnimation` anima **só a `height`** via framer-motion (`duration: 0.5`, `cubicBezier(0.4, 0, 0.2, 1)`). `width`, `gridTemplateAreas`, `gridTemplateColumns` e `minHeight` são gravados imperativamente no `style` do elemento, com este comentário literal no fonte:

> "Width is animated by the css class instead of via framer motion, because css is better at animating the calcs, framer motion might make some mistakes in that."

E desliga tudo em três casos: `prefersReducedMotion`, `layout === "mobile"`, e embed — neste último trocando `100vh` por `100%` porque "100vh in iframe will behave weird, because the iframe will constantly grow".

---

## 1. Navegação de data

**Em month view não existe navegação de data no header.** `packages/features/bookings/components/Header.tsx` tem um early return explícito — se `isMonthView`, o header renderiza apenas o toggle de layout (e o botão "need help" quando é o seu próprio link). Sem setas, sem "hoje". O grid do mês *é* o controle. Toda seta que você adiciona ao lado de um calendário mensal é redundância que compete com o alvo real de clique.

**As setas só aparecem em week/column view**, e o passo delas é dependente de layout:

```js
onClick={() => addToSelectedDate(layout === BookerLayouts.COLUMN_VIEW ? -nextSlots : -extraDays)}
```

Ou seja: a seta anda **exatamente uma tela**, nunca um dia. `extraDaysConfig` em `config.ts` define quantos dias cada layout mostra — `week_view`: 7 no desktop, 4 no tablet; `column_view`: 6 no desktop, 2 no tablet. Isso é *paginação*, não scroll: o que sai pela esquerda foi inteiramente substituído, então você nunca precisa procurar onde estava.

**O botão "Hoje" é condicional.** Ele só existe quando você está longe:

```js
const selectedDateMin3DaysDifference = useMemo(() => {
  const diff = today.diff(selectedDate, "days");
  return diff > 3 || diff < -3;
}, [today, selectedDate]);
```

Motivo: um "Hoje" permanentemente visível é, na maior parte do tempo, um controle morto que não faz nada perceptível. Aparecendo só quando tem efeito, ele vira sinal — a presença dele já te informa que você se afastou. E quando é uma grade de semana, `Hoje` leva a `today.startOf("week")`, não a `today`: em uma grade semanal, "hoje" significa "a semana que contém hoje".

**O rótulo do intervalo suprime repetição e reserva largura:**

```jsx
<h3 className="min-w-[150px] text-base font-semibold leading-4">
```

`isSameMonth()` e `isSameYear()` decidem se o mês final e o ano aparecem, e o ano vai em `text-subtle`. Resultado: "Set 8 - 14, **2026**" com o ano apagado, virando "Set 28 - Out 4" quando cruza o mês. O `min-w-[150px]` existe porque o rótulo muda de comprimento a cada clique na seta — sem largura mínima, o `ButtonGroup` ao lado dança horizontalmente e você erra o alvo no segundo clique.

**O mini-calendário lateral é o mesmo componente do calendário grande.** Em `apps/web/modules/bookings/components/DatePicker.tsx`:

```js
const isCompact = layout !== "month_view" && layout !== "mobile";
```

Uma flag, passada para `packages/features/calendars/components/DatePicker.tsx`, e o mesmo componente serve como grade principal e como picker compacto no rail esquerdo do week view. Não há dois calendários para manter em sincronia.

**Detalhes de desenho do dia** (mesmo arquivo, componente `Day`):

- A célula é `relative w-full pt-[100%]` com o `<button>` em `absolute inset-0`. O truque de `padding-top: 100%` garante quadrado perfeito em qualquer largura, independente de font-size. É por isso que a grade nunca quebra.
- **Hoje é um ponto de 5px abaixo do número**, não um anel: `h-[5px] w-[5px] ... translate-y-[8px] sm:translate-y-[12px]`. E quando hoje também está selecionado, o ponto vira `bg-brand-accent`. Motivo: anel e preenchimento competem pelo mesmo canal visual; ponto e preenchimento coexistem, então "hoje" e "selecionado" nunca se anulam.
- **A inversão figura/fundo**: dia disponível tem fundo preenchido (`bg-emphasis` + `hover:border-brand-default`); indisponível fica `text-mute`, `disabled:font-light`, borda transparente. A disponibilidade é a figura. A maioria dos calendários faz o oposto — pinta o que está bloqueado — e o usuário acaba tendo que ler o negativo.

**Dois comportamentos automáticos** que só fazem sentido num booker (volto neles no item 5):

- `useMoveToNextMonthOnNoAvailability`: se você está no mês corrente e ele tem zero dias reserváveis, pula sozinho para o próximo. A guarda `currentMonth != browsingMonth` é deliberada — só o mês corrente, para não avançar em cascata para sempre.
- `useHandleInitialDateSelection`: ao trocar de mês, se a data selecionada não existe/não está livre naquele mês, seleciona a primeira disponível. A coluna de horários nunca fica vazia.

**O "mês rolante"** — o detalhe mais esperto do DatePicker:

```js
const isSecondWeekOver = today.isAfter(firstDayOfMonth.add(2, "week"));
const showNextMonthDays = isSecondWeekOver && !isCompact;
```

Passada a segunda semana do mês, a grade **para de renderizar os dias 1–7**, começa no dia 8 e derrama para o mês seguinte (`extraDays = (7 - remainingInRow) + 7`). O dia 1 do mês seguinte ganha um chip inline minúsculo (`fontSize: "10px", lineHeight: "13px"`) com `date.format("MMM")`, e os dias fora do mês ganham `<Tooltip content={date.format("MMMM")}>`. Isso resolve o problema clássico do calendário morto: dia 25, a grade padrão mostra 24 células no passado e 6 clicáveis. Aqui a grade sempre carrega ~4 semanas de futuro. Note que é desligado em `isCompact` — no rail estreito o mês precisa ser um mês reconhecível.

---

## 2. A grade de horas

Tudo em `apps/web/modules/calendars/weeklyview/`.

**Geometria: uma variável só.** Em `components/Calendar.tsx`:

```js
const hourSize = 58;
// ...
"--one-minute-height": `calc(${hourSize}px/60)`,
"--gridDefaultSize": `${hourSize}px`,
```

58px por hora ≈ 0,967px por minuto. **Nenhum componente calcula pixel em JS.** Tudo posiciona com `calc(N * var(--one-minute-height))`: a linha do agora, cada célula disponível, a altura do bloco de hover. Mudar a densidade da grade inteira é mudar um número.

**Densidade de snap derivada da duração do objeto.** `LargeCalendar.tsx` passa:

```js
gridCellsPerHour={60 / eventDuration}
hoverEventDuration={eventDuration}
```

A resolução da grade **não é fixa em 15 ou 30 minutos** — é a duração do próprio evento. Evento de 45 min gera grade de 45 min. Consequência: toda célula clicável é um início legítimo. Você não pode clicar em algo que depois será recusado.

**Rótulos: só na hora cheia, no gutter, opticamente centrados na linha.** Em `components/horizontalLines/index.tsx`:

```jsx
<div className="text-muted sticky left-0 z-20 -ml-14 -mt-2.5 w-14 pr-2 text-right text-xs leading-5 rtl:-mr-14">
  {hour.minute(0).format(timeFormat)}
</div>
```

`-ml-14 w-14 pr-2 text-right` puxa o rótulo para fora da área de conteúdo, e o `-mt-2.5` sobe ~10px para o texto ficar **centrado na régua, não pendurado abaixo dela**. As divisórias são `divide-y` por hora — as subdivisões de 15/30 min existem no grid de posicionamento mas **não têm régua**. Menos ruído; a estrutura fina você percebe pelo snap, não por linhas. E há um rótulo extra para `hours[last].add(1,"hour")`, fechando a última faixa (senão a última hora fica visualmente aberta).

O `.minute(0)` aparece duas vezes, com o mesmo comentário:

> "We need to force the minute to zero, because otherwise in ex GMT+5.5, it would show :30 minute times (but at the position of :00)"

Esse é o bug de fuso de meia-hora (Índia, Nepal, Chatham) que quase toda grade de horas tem. `getHoursToDisplay` gera as horas com `dayjs("1970-01-01").tz(timezone).hour(startHour)` — geradas *no fuso alvo* — e o `.minute(0)` no render impede que um offset de :30 propague para o rótulo.

**Intervalos indisponíveis: hachura como fundo, disponibilidade pintada por cima.** O container do grid tem, permanentemente:

```js
background: "repeating-linear-gradient(-45deg, var(--disabled-gradient-background), var(--disabled-gradient-background) 2.5px, var(--disabled-gradient-foreground) 2.5px, var(--disabled-gradient-foreground) 5px)"
// light: #F8F9FB / #E6E7EB   dark: #262626 / #393939
```

Depois, `AvailableCellsForDay` (`components/event/Empty.tsx`) pinta **apenas** as células disponíveis, absolutamente posicionadas:

```js
const topOffsetMinutes = (startTime.hour() - startHour) * 60 + startTime.minute();
// style: top: `calc(${topOffsetMinutes}*var(--one-minute-height))`
```

Isso é o oposto do padrão comum "renderiza 96 células e desabilita 80". Aqui você renderiza N células reais sobre um fundo hachurado. Ganhos: DOM proporcional à disponibilidade real (não ao tamanho do dia), zero ambiguidade entre "vazio porque indisponível" e "vazio porque não carregou", e o estado de loading é distinguível porque a hachura sozinha nunca parece um dia livre. `BlockedTimeCell.tsx` usa a mesma hachura com passo 2.5/6.5px e `hover:cursor-not-allowed`.

**Hover mostra o retângulo real do compromisso**, não um destaque de linha:

```jsx
style={{ height: `calc(${hoverEventDuration}*var(--one-minute-height) - 2px)`, width: "calc(100% - 2px)" }}
className={... hoverEventDuration > 15 && "items-start pt-3", hoverEventDuration < 15 && "items-center"}
```

Bloco `bg-brand-default` com a hora de início dentro, exatamente da altura que o evento vai ter. E o alinhamento vertical do texto inverte abaixo de 15 minutos — bloco curto demais não comporta texto alinhado ao topo. É preview literal, não feedback simbólico.

**O "agora"** (`components/currentTime/index.tsx`) é composto de três peças, não de uma linha vermelha:

```jsx
<div className="w-16 pr-2 text-right">{dayjs().tz(timezone).format(timeFormat)}</div>  // rótulo no gutter
<div className="bg-inverted h-3 w-px" />                                                // tique de 12px
<div className="bg-inverted h-px w-screen" />                                           // fio de 1px
```

Posicionado em `top: calc(${currentTimePos}*var(--one-minute-height) + var(--calendar-offset-top))`, com `zIndex: 70` inline (o `z-40` da classe é sobrescrito). Três decisões relevantes:

1. **Usa `bg-inverted`, não vermelho.** Vermelho já significa "conflito/lotado" no resto do produto (`bg-rose-600` nos slots). O agora é preto/branco invertido — alto contraste, semântica neutra.
2. **Se agora está fora da janela exibida, a linha não é desenhada:** `if (currentHour > endHour || currentHour < startHour) { setCurrentTimePos(null); return; }`. Não desenha no topo nem no rodapé "por aproximação" — mentira pior que ausência.
3. **Auto-scroll uma vez, e revalidação no foco:** `scrollIntoView({ block: "center" })` num `setTimeout(100)` com trava `scrolledIntoView` (nunca sequestra o scroll uma segunda vez), mais um listener opcional de `visibilitychange` (`updateOnFocus`) para recalcular a posição quando você volta à aba — uma aba deixada aberta a noite toda não continua mentindo.

**O fuso mora na origem do sistema de coordenadas.** Em `components/DateValues/index.tsx`, a célula do cabeçalho que fica sobre o gutter de horas (`w-16`, a interseção entre a régua de horas e a linha de dias) contém o chip de fuso:

```js
if (utcOffsetInMinutes === 0) return "GMT";
const offsetInHours = Math.abs(utcOffsetInMinutes / 60);
return `GMT ${sign}${offsetInHours}`;   // decimal: +5.5, não +5:30
```

Com fallback para o último segmento do nome IANA com underscores trocados por espaço. Colocar o rótulo do fuso ali — e não num rodapé — é correto porque é literalmente a legenda do eixo Y.

O cabeçalho de dias é `sticky top-(--calendar-dates-sticky-offset,0px) z-80`, e o `LargeCalendar` define `[--calendar-dates-sticky-offset:66px]` para ele encostar embaixo da faixa de 70px do header. O gutter de horas é `sticky left-0 z-10 w-16 ring-1 ring-muted`. Duas stickies ortogonais, o canto compartilhado carregando o fuso.

Detalhe de engenharia: o offset do topo do grid **é medido do DOM**, não hardcodado. `HorizontalLines` renderiza `<div className="row-end-1 h-(--calendar-offset-top)" ref={containerOffsetRef} />` e o `SchedulerColumns` recebe `marginTop: offsetHeight || "var(--gridDefaultSize)"`.

---

## 3. A transição mês → semana → dia

**Não é navegação. É redimensionamento do mesmo grid.** Mesmo DOM, mesma store, mesmas `grid-template-areas` trocadas, `height` animada em 0.5s. Nada desmonta.

O caso mais elegante é o *dentro* do month view. Quando `bookerState` vira `selecting_time`, o `resizeAnimationConfig` acrescenta uma **terceira coluna**:

```
"meta main main"       →   "meta main timeslots"
gridTemplateColumns: var(--booker-meta-width) 1fr var(--booker-timeslots-width)
```

O cartão **cresce lateralmente** para acomodar a lista de horários. O calendário do mês não sai da tela, não encolhe, não é substituído. Você continua vendo de onde veio, o que torna corrigir o dia um clique em vez de um "voltar". Essa é a alternativa ao drill-down destrutivo que quase todo calendário faz.

Na troca de layout propriamente, a store (`Booker/store.ts`) faz três coisas:

```js
setLayout: (layout) => {
  if (["week_view","column_view"].includes(layout) && !get().selectedDate) {
    set({ selectedDate: dayjs().format("YYYY-MM-DD") });   // comentário: "so week title is rendered properly"
  }
  updateQueryParam("layout", layout);
  return set({ layout });
}
```

1. **Garante uma data antes de entrar num layout que exige data.** Você nunca chega numa semana sem âncora.
2. **Grava `layout`, `date` e `month` na URL.** `selectedDate: getQueryParam("date") || null` é o valor inicial da store. O estado de visualização inteiro é um link compartilhável e um F5 sobrevivente. Isso é o que permite "layout" ser um estado de UI sem virar estado de sessão escondido.
3. `setSelectedDate` carrega uma flag `preventMonthSwitching`, e o `DatePicker` a passa como `!isCompact`: **em month view, clicar num dia não pode arrastar a grade do mês** (você já está olhando esse mês); em week view, escolher um dia *deve* rolar o mini-calendário para o mês certo. Mesma ação, semântica dependente de contexto.

`addToSelectedDate(days)` trava no passado (`if (newSelection.isBefore(dayjs(),"day")) newSelection = dayjs()`) e sincroniza `month` quando vira o mês.

Sobre o "dia": **não existe um layout de dia.** O papel dele é do `column_view` — colunas de horários lado a lado, 6 no desktop e 2 no tablet, avançando `nextSlots` por vez. É um day view escalonável em vez de um day view singular, porque um dia isolado num booker é quase sempre pouca informação.

E o hack honesto, que está comentado no `Header.tsx`: em week/column view o `LayoutToggle` é renderizado **duas vezes** — uma `fixed top-4 right-4`, outra `pointer-events-none opacity-0 aria-hidden`. A segunda existe só para reservar o espaço no flex, senão o toggle animaria do centro para o canto durante a troca de layout, apesar de já estar no lugar certo. O comentário no fonte explica exatamente isso.

---

## 4. Fuso horário e 12h/24h

Aqui está a parte que a maioria erra, e o cal.com acerta por uma decisão de arquitetura, não de UI.

**O fuso do visitante é propriedade da sessão de visualização, não da conta.** `packages/features/bookings/lib/timePreferences.ts`, com docstring literal:

> "This hook is NOT inside the user feature, since these settings only apply to the booker component. They will not reflect any changes made in the user settings."

```js
timezone: localStorage.getItem("timeOption.preferredTimeZone") || CURRENT_TIMEZONE,
setTimezone: (timezone) => { localStorage.setItem("timeOption.preferredTimeZone", timezone); set({ timezone }); }
```

Uma store Zustand separada, persistida em localStorage, default vindo de `Intl.DateTimeFormat().resolvedOptions().timeZone`. Um viajante muda o fuso na página de reserva sem contaminar as configurações da conta, e a escolha sobrevive à próxima visita.

**Nenhum horário é armazenado em hora local.** O slot chega como instante absoluto e o fuso é aplicado *só no render*:

```js
const computedDateWithUsersTimezone = dayjs.utc(slot.time).tz(timezone);
// ...
{computedDateWithUsersTimezone.format(timeFormat)}
```

`data-slot={timeSlot.toISOString()}` nas células. Store guarda `selectedTimeslot` como ISO. Nada no estado é ambíguo.

**O formato 12/24h é detectado da locale do SO, e a partir do primeiro override o override manda para sempre.** `packages/lib/timeFormat.ts`:

```js
if (!!new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(0).match(/M/i)) {
  setIs24hClockInLocalStorage(false); return false;
} else {
  setIs24hClockInLocalStorage(true); return true;
}
```

Formata a hora 0 com a locale do navegador e procura um "M" (de AM/PM). É um sniff pragmático, e — detalhe importante — **grava o resultado no localStorage**, então a partir daí a leitura é determinística e o toggle do usuário vence permanentemente. `getIs24hClockFromLocalStorage()` é consultado antes de qualquer detecção.

**O enum é a própria string de formato do dayjs:**

```js
export enum TimeFormat {
  TWELVE_HOUR = "h:mma",
  TWENTY_FOUR_HOUR = "HH:mm",
}
```

Isso elimina toda ramificação `if (is24h) ... else ...` do código de render. Todo lugar que mostra hora — `AvailableTimes`, `HorizontalLines`, `CurrentTime`, `Empty.Cell` — faz literalmente `.format(timeFormat)`. Uma única fonte de verdade e zero chance de um componente divergir dos outros. É o padrão que eu mais recomendaria copiar do arquivo inteiro.

**O `TimeFormatToggle` fica encostado nos números que ele muda**, nunca em configurações: um `ToggleGroup` de duas opções, posicionado `ml-auto` dentro do `AvailableTimesHeader` em month view, e no header em week/column view.

**O `TimezoneSelect` busca por cidade, não por zona IANA.** `apps/web/modules/timezone/components/TimezoneSelect.tsx` combina `trpc.viewer.timezones.cityTimezones` (cacheado por `CALCOM_VERSION`) com uma lista escrita à mão de aliases:

```js
{ label: "San Francisco", timezone: "America/Los_Angeles" },
{ label: "Sao Francisco do Sul", timezone: "America/Sao_Paulo" },
{ label: "Brazil Time", timezone: "America/Sao_Paulo" },
{ label: "Eastern Time - US & Canada", timezone: "America/New_York" },
```

Note as três primeiras: existem porque alguém digitando "San Francisco" precisa achar Los Angeles, e a desambiguação com a cidade catarinense foi resolvida à mão. Ninguém procura por `America/Sao_Paulo`.

**A reconciliação de dois fusos ao mesmo tempo**, no overlay de calendário (`AvailableTimes.tsx`):

```js
const offset = (usersTimezoneDate.utcOffset() - nowDate.utcOffset()) / 60;
```

Quando o visitante sobrepõe o próprio calendário, existem *dois* fusos em jogo: o da máquina dele e o que ele escolheu no seletor. O `offset` corrige a diferença antes de calcular sobreposição. Cada slot ganha um ponto de 8px — `bg-rose-600` se conflita, `bg-emerald-400` se está livre — e o hover abre um Radix `HoverCard` com "Busy" e o intervalo exato, dimensionado em `w-(--booker-timeslots-width)` para casar com a coluna.

---

## 5. Três coisas para copiar, uma para não copiar

### Copiar 1 — Inversão figura/fundo: hachura como base, disponibilidade pintada por cima

Não renderize a grade cheia de células e desabilite as impossíveis. Pinte o fundo inteiro com `repeating-linear-gradient(-45deg, ...)` a 2,5px/5px significando "aqui não acontece nada", e posicione absolutamente apenas os objetos reais e as faixas realmente utilizáveis por cima, com `top: calc(minutos * var(--one-minute-height))`.

Num CRM com tarefas por data, a tradução direta: hachurar fora do expediente do responsável, fora de dias úteis, e depois desenhar as tarefas. O ganho não é estético — é semântico e de performance. O DOM passa a ser proporcional ao conteúdo real, e "célula vazia porque nada foi agendado" deixa de ser visualmente igual a "célula vazia porque essa hora não existe para essa pessoa". Vale também no mês: o `Day` do `DatePicker` dá fundo preenchido ao dia com disponibilidade e deixa o indisponível quase sem tinta — leia-se, no CRM, dias com tarefa como figura.

### Copiar 2 — `--one-minute-height` como contrato único de geometria, e snap derivado da duração do objeto

`const hourSize = 58` → `--one-minute-height: calc(58px/60)`, e **todo** posicionamento vertical no produto inteiro vira `calc(N * var(--one-minute-height))`. Linha do agora, blocos, hover, offsets. Zero aritmética de pixel em JS, zero drift entre componentes, e mudar a densidade da grade (para uma versão compacta, ou para acomodar um zoom) é trocar um número.

O par disso é `gridCellsPerHour = 60 / eventDuration`: **a resolução de snap é a duração do objeto**, não um 15/30 arbitrário. Num CRM, snap = duração padrão da tarefa (ou o slot mínimo daquele tipo de tarefa). Assim toda posição clicável é uma posição válida, e você nunca precisa recusar um clique depois de aceitá-lo.

### Copiar 3 — O tripé de navegação de data: "Hoje" condicional, seta = uma tela, rótulo que suprime repetição

Três micro-decisões que juntas fazem a navegação parar de tremer:

- **"Hoje" só existe quando `|diff| > 3` dias.** Um controle permanentemente presente que na maior parte do tempo não faz nada é ruído; aparecendo condicionalmente, a *presença* dele já comunica "você se afastou". E em vista semanal ele leva a `startOf("week")`, não a `today`.
- **A seta avança exatamente uma tela** (`extraDays`/`nextSlots`, não 1 dia). Paginação, não scroll — nada permanece parcialmente visível para você reprocurar.
- **O rótulo omite mês/ano repetidos**, apaga o ano em `text-subtle`, e tem `min-w-[150px]`. A largura mínima é o detalhe que ninguém lembra: sem ela, o rótulo muda de tamanho a cada clique, empurra o `ButtonGroup` e você erra o alvo no clique seguinte.

Bônus barato do mesmo pacote: `TimeFormat` como o próprio format string do dayjs, e a preferência de fuso/formato em localStorage como *preferência de visualização*, não como campo de conta.

### **Não** copiar — a seleção automática de data

`useHandleInitialDateSelection` + `useMoveToNextMonthOnNoAvailability`: se o dia selecionado não tem disponibilidade, o cal.com seleciona outro por você; se o mês inteiro está vazio, ele pula para o mês seguinte. E ambos mexem na URL.

**Num booker isso está certo.** A página existe para produzir exatamente um agendamento; uma coluna de horários vazia é um beco sem saída, e o usuário não tem apego a *qual* dia — só quer um que funcione.

**Num CRM com tarefas por data isso é ativamente danoso.** Ali o usuário perguntou uma coisa específica: "o que tem no dia 12?". "Nada no dia 12" é a resposta, e é informação valiosa — pode significar folga, pode significar que alguém esqueceu de agendar o follow-up. Se o sistema silenciosamente te move para o dia 14 e reescreve a URL, você perde a distinção entre *não há nada* e *você não está mais olhando onde pensava*. Pior: com o `updateQueryParam` junto, o link que você mandou pro colega aponta para um dia que você nunca escolheu. Num booker o dia vazio é uma falha a contornar; num CRM o dia vazio é um dado a exibir. Mantenha o estado vazio, com um empty state explícito ("nenhuma tarefa em 12/set") e, no máximo, um atalho *opcional* — "próximo dia com tarefas →" — que o usuário clica.

Secundariamente, também não copie o `MobileNotSupported` de `weeklyview/components/Calendar.tsx`, que abaixo do breakpoint `sm` renderiza literalmente "Mobile not supported yet — Please use a desktop browser". É uma admissão honesta de que 7 colunas de horas não cabem num celular, e o cal.com pode se dar a esse luxo porque tem `column_view` e `mobile` como saídas. Um CRM não tem esse luxo: o telefone é justamente onde se confere a agenda do dia. Se a grade semanal não couber, degrade para lista agrupada por dia — não para um aviso.

---

**Fontes:** [calcom/cal.com no GitHub](https://github.com/calcom/cal.com) (arquivos lidos via API: `packages/features/bookings/Booker/config.ts`, `store.ts`, `packages/features/bookings/components/Header.tsx`, `TimeFormatToggle.tsx`, `packages/features/bookings/lib/timePreferences.ts`, `packages/features/calendars/components/DatePicker.tsx`, `packages/features/calendars/lib/getAvailableDatesInMonth.ts`, `packages/features/calendars/weeklyview/utils/index.ts`, `packages/lib/timeFormat.ts`, `apps/web/modules/bookings/components/AvailableTimes.tsx`, `AvailableTimesHeader.tsx`, `DatePicker.tsx`, `LargeCalendar.tsx`, `apps/web/modules/calendars/weeklyview/components/{Calendar,grid,horizontalLines,currentTime,DateValues,event/Empty,blocking/BlockedTimeCell}`, `apps/web/modules/timezone/components/TimezoneSelect.tsx`) · [DeepWiki: Booker Component](https://deepwiki.com/calcom/cal.com/3.1-booker-component) · [DeepWiki: Scheduling and Availability](https://deepwiki.com/calcom/cal.com/4-booking-management-interface) · [cal.com/pt](https://cal.com/pt/) · [Cal.com vs Calendly](https://cal.com/blog/cal-com-vs-calendly-the-ultimate-guide)