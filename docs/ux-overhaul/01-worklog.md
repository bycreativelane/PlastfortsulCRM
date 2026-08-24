# Worklog

Every change from this session, grouped by the request that caused it. Index and
the other documents: [00-README.md](00-README.md).

---

## 1. Right-click menus

> _"eu gosto da ideia de mesmo na web o botão direito ter interação no sistema,
> encontra alguma ação que faça sentido e implementa de forma útil."_

**New:** `src/components/ui/context-menu.tsx` — a Base UI `ContextMenu` wrapper
with the same part names as the existing `dropdown-menu.tsx`, so a menu written
for one reads the same in the other.

**New:** `src/components/pipelines/deal-context-menu.tsx` — the first and, for
now, only place it is used: right-click on a deal card.

| Item                        | Why it earns a place                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Abrir oportunidade          | Same as left-click; present so the menu is never a dead end                                              |
| Mover para → _(stages)_     | The board scrolls sideways; the target column is usually off-screen, and dragging to it is the slow path |
| Marcar como ganho / perdido | Was three clicks and a sheet away, and it is a decision you make looking at the board                    |
| Reabrir                     | Same, for a closed deal                                                                                  |
| Abrir conversa              | Jumps to `/inbox?c=…` — the deal's own thread, or the newest one with that contact                       |
| Copiar telefone             | A WhatsApp CRM; the number is the thing people copy                                                      |
| Excluir                     | Two-step, confirms in place rather than opening a dialog                                                 |

**The rule applied:** nothing in the menu can be done _only_ from the menu. A
hidden affordance that hides a capability is a trap; one that hides a shortcut
is a gift. Someone who never right-clicks loses time, never a feature.

**Wiring.** `PipelineBoard` gained `onDealChanged` (the page passes
`refreshDeals`) because the menu writes status and delete straight to Supabase.
Moves reuse the board's existing optimistic `onDealMoved` — the same path the
drag uses. The menu sits _inside_ the draggable wrapper: dnd-kit's
`PointerSensor` ignores button 2 outright, so the two never contend and the
drag node's geometry is untouched.

Delete confirms in place because a confirm dialog for a row you are pointing at
is a second window to read and dismiss. A second click on an item that has
visibly changed its own label is the same safeguard with none of the travel,
and Escape still cancels it.

---

## 2. Glass surfaces

> _"efeitos com desfoque, glass é bacana também."_

`@utility glass` in `globals.css`, plus four tokens per mode: `--glass`,
`--glass-ring`, `--glass-highlight`, `--glass-shadow`.

Applied to context menus, dropdown menus, submenus and popovers. **Not** to
dialogs, sheets, cards or tooltips — the reasoning is in
[02-decisions.md §2](02-decisions.md#2-glass-goes-on-menus-not-on-dialogs).

`background-color` is declared twice on purpose: once opaque, and again inside
`@supports (backdrop-filter: …)`. Without the split, a browser that ignores the
filter renders a 72%-transparent panel with the page showing through the text.

Dialog and sheet backdrops moved from `bg-background/10 + backdrop-blur-xs` to a
dedicated `--overlay` token and `backdrop-blur-sm` — _"quando abrir um popup,
escurece bem pouquinho o fundo desfocado."_ Dark mode needs a far stronger scrim
than light (45% vs 16%): a 16% black over a near-black page is invisible, so the
layer would read as blur with no dimming at all.

---

## 3. Type size, and then the zoom itself

> _"acho interessante trabalhar em aumentar um pouco fonte."_

First `--zoom: 0.9 → 0.95`, because the app hard-codes 154 pixel font sizes and
`zoom` is the only lever that moves both those and the rem-based utilities.

Then `--zoom: 1`, once the same property turned out to be why every floating
panel opened away from its trigger. That is [03-bugs.md §1](03-bugs.md#1-every-floating-panel-opened-5-away-from-its-trigger)
and [02-decisions.md §1](02-decisions.md#1-body-zoom-had-to-go-not-be-worked-around).

Net effect: everything is 11% larger than where this pass started, which also
serves _"sem tanta informação"_ — the density the zoom bought was density that
had been asked to be reduced.

The other session then replaced all 154 arbitrary sizes with an eight-step
scale, which is the durable version of the same fix.

---

## 4. Native controls, retired

| Was                                           | Now                                                          |
| --------------------------------------------- | ------------------------------------------------------------ |
| Windows scrollbars — 17px, with arrow buttons | `* { scrollbar-width: thin }` + a themed thumb per mode      |
| `type="number"` stepper arrows                | `appearance: textfield`                                      |
| 21 raw `<select>` with the OS triangle        | `NativeSelect` — `appearance: none` + our chevron            |
| `type="date"` and the browser's calendar      | `DateField` — the app's own popover calendar, typing kept    |
| A bare number field for money                 | `CurrencyInput` — grouped, symbol-prefixed, caret-preserving |

`color-scheme` is now pinned per `data-mode`, so native chrome that remains
follows the app rather than the operating system.

`DateField` reads the date order and separator from the locale
(`Intl.DateTimeFormat.formatToParts`) rather than hard-coding `dd/mm/yyyy`, and
parses ISO as a **local** date — `new Date('2026-06-23')` is UTC midnight, which
is the previous day everywhere west of Greenwich.

`CurrencyInput` repositions the caret by hand after every keystroke: inserting a
thousands separator shifts every character after it, so leaving the browser to
restore the caret walks it backwards through the number as you type.

---

## 5. Notifications

> _"as notificações não precisa abrir uma sessão, pode ser um popup ou extensão
> hover ao lado do ícone e só abrir se ir na opção de ver tudo"_

**New:** `src/components/layout/notifications-menu.tsx`. The bell was a `<Link>`
to `/notifications`, so "did anything happen?" cost a navigation away and a
navigation back. For a list that is empty most of the time and three rows long
the rest of it, that is the wrong shape — the question is a glance, not a visit.

The page still exists unchanged, one click away under _Ver todas_.

Rows are fetched when the panel opens, not on mount: the unread **count** is
already live on every page through `useUnreadNotifications`, and loading eight
full rows on every navigation would be a query per page for something nobody
looked at. They are re-fetched on every open rather than cached — a panel you
check to find out what changed cannot show a stale list.

---

## 6. Layout fixes

- **`main` no longer scrolls sideways** — [03-bugs.md §2](03-bugs.md#2-the-whole-app-could-scroll-sideways).
- **The deal sheet's horizontal scrollbar** — same rule, plus a real overflow
  behind it: [03-bugs.md §3](03-bugs.md#3-two-buttons-that-could-not-fit-and-would-not-shrink).
- **The settings rail** stuck at `top-0`, flush against the bottom edge of the
  app bar — two navigations touching with no seam. Now `lg:top-6`.
- **The import dialog's dead band** — `empty:hidden` on a preview region that
  keeps its padding when React renders its branches as nothing.
- **Excluir pipeline** is a ghost destructive, not a filled red button in the
  same row as Salvar.
- **The sidebar account menu** aligns to the start of its row and takes
  `w-(--anchor-width)`, so it is exactly the row it belongs to.

---

## 7. Portuguese, all of it

> _"E revisa 100% se tudo ficou em português"_

- **31 hard-coded English `toast.*` strings** moved into the catalogues across
  seven files: `whatsapp-config` (13), `members-tab` (4), `message-composer`
  (6), `message-thread` (2), `invite-member-dialog`, `node-config-form`,
  `notifications/page`.
- **Every browser-locale formatter** routed through `APP_LOCALE` — sixteen
  files. See [03-bugs.md §5](03-bugs.md#5-one-number-two-spellings-one-screen).
- **New namespaces** `Pipelines.menu`, `Pipelines.playbook`, `DateField`, plus
  additions to `Notifications` — all three locales, parity exact.

The other session covered the template catalogues, the flow and automation
editors, the AI playground, quick replies and the `date-fns` locale.

---

## 8. Playbooks

Both halves of _"implementa playbook na estrutura de uso"_: the feature and the
operating document.

- `supabase/migrations/041_playbooks.sql` — **not applied**
- `PlaybookChecklist` on the deal sheet, `PlaybookEditor` inline for admins
- A `2/4` chip on the deal card, amber while there is work left
- `usePlaybookProgress` — the whole board in two queries, chunked at 100 ids
- [../playbook-comercial.md](../playbook-comercial.md) — the steps themselves,
  in Portuguese, for the Vendas pipeline

Design reasoning: [04-playbooks.md](04-playbooks.md).

---

## 9. From the audit

Found while reviewing rather than while building:

- A viewer role was shown a live Save button and an armed Delete on the deal
  sheet. RLS refused the write; the interface had not. Now gated on
  `useCan('send-messages')`, matching the right-click menu.
- Day buttons in the calendar announced as bare numbers. `aria-label` with the
  full localised date, plus `aria-pressed`.
- `usePlaybookProgress` built one `IN (…)` over every deal on the board — 200
  UUIDs is about 7.5KB of URL. Chunked.
- The playbook editor opened an empty playbook with an empty list and an "add"
  button. It now opens with one row, because the first thing you have to do is
  always the same.

---

## 10. The easter egg

> _"E deixa um easter egg: a CL passou por aqui"_

An inline script beside the theme boot in `layout.tsx`: a styled console banner
and `data-cl` on `<html>`. It costs nothing to render, cannot shift a pixel, and
is found only by someone who opened DevTools — which is exactly the audience.

---

## 11. Three guards that read the source

Added after the documents above were written — `type-scale.test.ts` at 08:50,
`color-doctrine.test.ts` and the `theme-contrast.test.ts` rework at 12:51. They
are tests, but none of them tests behaviour: each one reads the working tree and
fails when a rule the design system rests on is broken by a call site that looks
perfectly normal.

| Guard                            | What it forbids                                                                                                                                        | Why it exists                                                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/color-doctrine.test.ts` | A colour class in a family `globals.css` never re-points (teal, cyan, purple, rose, sky, slate, …), and the 800/900/950 shades of the families it does | The automation trigger pills measured 1.3–1.6:1 on a white card, the flow node menu was an indistinguishable pale smear, the response-time target chip was a red-pink at 1.66:1 that read as a failure on a chart that was fine, and `bg-amber-950` put the WhatsApp setup banners at 2.73:1 |
| `src/app/type-scale.test.ts`     | `text-[13px]` and every other arbitrary size outside the eight-step scale                                                                              | The app had reached twenty distinct sizes without anybody deciding to have twenty, fourteen of them typed one component at a time. An arbitrary size also silently drops its line-height                                                                                                     |
| `src/app/theme-contrast.test.ts` | A documented token pair falling under 4.5:1 — 3:1 for meaningful non-text — in either mode                                                             | A token nudged half a step for aesthetic reasons, or an accent swapped during a rebrand, is otherwise found by a user squinting at an amber badge                                                                                                                                            |

`color-doctrine` and `theme-contrast` are deliberately a pair. The second reads
`--token: oklch(…)` declarations out of `globals.css`, which makes it
structurally blind to a component that writes `text-teal-300` and never passes
through a token at all; the first is that other half. Between them they cover
both ways colour goes wrong here — a token drifting, and a call site escaping
the tokens entirely.

Comments are exempt from the colour scan on purpose. Every raw shade left in
this codebase sits inside a note explaining what was removed and why, and a
regex that failed on those notes would delete the only record of the reasoning.

**What the mapping does**, and why the scan can be this narrow: `globals.css`
re-points red, amber, yellow, emerald, green, orange and blue up to the 700
shade onto the doctrine tokens, so `text-red-400` compiles to
`var(--danger-700)` and resolves per mode. That was the alternative to rewriting
~140 call sites across 49 files — and to re-breaking them on the next upstream
merge that adds another `text-red-400`. The scan then guards exactly what the
mapping does not reach.

**The vocabulary itself** is at the top of `globals.css`: `human` (a person must
act — the only "come here" in the system), `auto` (a machine did this;
deliberately grey, because painting machine work makes it compete with human
work), `ok` (confirmed, used sparingly), `danger`, and the `wa-*` set that exists
only inside the thread. `StatusBadge` and `StatusDot` are the components that
speak it, and `StatusDot` carries the rule that a dot never says anything on its
own — hue is its only channel, and roughly 8% of men cannot separate its green
from its red.

The type scale is the other session's work; the two colour guards and the
`status-badge` pass are documented here because they landed in this tree.

---

## 12. The contact sheet, and the width under it

> _"pode melhorar mais a ficha do cliente principalmente onde criou barra de
> rolagem, ta mal intuitivo … se for vantajoso, aumentar a largura dessas abas
> para concentrar melhor os elementos"_

The scrollbar in the tab strip was a symptom. The cause was that the sheet had
never been the width it asked for — [03-bugs.md §9](03-bugs.md#9-every-side-sheet-was-8rem-narrower-than-it-asked-for).
With that fixed, three things followed.

**One record, one tab, one Save.** _Campos personalizados_ was a fifth tab with
a Save button of its own, which asked an operator to know that "Empresa" and a
custom "CNPJ" live in different tables. They do — the second is a
delete-and-reinsert into `contact_custom_values` — but that is this schema's
problem, not theirs. Both now sit in _Dados_ under one Save that writes the
contact row first and the custom values only if it landed; the section hides
itself entirely when the account has no custom fields.

Four tabs where there were five, in a strip that is now 42rem wide: 303px of
content in 640px of strip. The `overflow-x-auto` band-aid is gone, and
`flex-wrap` is the floor rather than the plan — below ~340px the last tab drops
to a second row, which costs a row and hides nothing.

**Two columns, decided by the panel and not the window.** The fields are
`@container` + `@sm:grid-cols-2`, not `sm:`. The difference is not academic: the
sheet in the report was 463px wide inside a 463px window, where a viewport query
gives one column to a panel with room for two. Measured at that exact width:
two columns of 209px. At 1280px: two of 313px.

**The deal form, same treatment.** Seven stacked rows in a 24rem sheet is what
put a scrollbar under a form of eight fields. The short ones are now paired by
meaning — money with the date it is expected, stage with the person who owns it
— each pair at the container width its content actually needs: `@lg` for the
money row, because its half already carries a 110px currency select, and `@sm`
for the two plain selects. In a narrow sheet both stay stacked, which is the
honest answer there.

**Left alone on purpose:** the won/lost buttons stay stacked full-width. That
was a deliberate call recorded in the code — two decisions this consequential
read better one under the other — and a wider sheet is not a reason to revisit
it.

---

## 13. The last English in the product, and why the sweep missed it

The deal sheet in the report showed _Etapa: **Qualified**_ and _**New Lead**_,
on a board whose every visible string had already been swept into the
catalogues.

They were not visible strings. `SPEC_DEFAULT_STAGES` in `pipelines/page.tsx`
was a hard-coded English array — `New Lead`, `Qualified`, `Proposal Sent`,
`Negotiation`, `Won` — and `'Sales Pipeline'` was the name given to the funnel
the app seeds for a new account. **UI copy that lands as data**: five
`pipeline_stages` rows are written the moment a pipeline is created, so an
English literal there does not render in English, it WRITES English column
headers onto a Portuguese board and leaves them. A locale sweep that reads
`t()` calls cannot see it, and neither can `keys-exist.test.ts`.

Both now resolve through `Pipelines.page` — `defaultPipelineName` and
`defaultStages.*`, all three locales. Checked first that nothing keys off a
stage's name: nothing does, the seed has exactly two call sites, and `won` /
`lost` are a `status` column, not a stage called "Won".

**Not touched:** the stages and the empty _Sales Pipeline_ that already exist in
the database. Renaming rows is a data decision, and it is one Gabriel parked
deliberately.

---

## 14. The taxonomy, and putting it on the record

> _"acrescente a etiqueta e a situação da pipeline diretamente no contato já
> com as cores no modelo que estava no front, e também já deixe a pipeline como
> estava no front"_

**The model, seeded.** `scripts/seed-plastfortsul.mjs` writes the two pipelines
and the seventeen tags the prototype specifies, with the prototype's colours —
Vendas in ten stages from _Novo Lead_ to _Perdido_, Operacional in five for the
traffic that is not a sale. The stage hexes come from `DATA.pipelines`; the tag
colours are each `t-*` class resolved to its `--dot` value in the prototype's
CSS, because this app renders a tag as a grey chip with a coloured dot and the
dot is where the identity lives.

Seventeen and not thirty-one: the Segmento, Relacionamento and Situação groups
are `oculto: true` in the prototype, a decision its own status document
records, and importing what the design deliberately hides would quietly undo
it.

It is configuration, not test data, so it has no `--clean` — deleting a
pipeline that holds deals destroys work. It matches by name, corrects colour
and order in place, and leaves a stage somebody renamed alone.

**The strip on the contact.** Both facts already existed in the contact sheet,
one tab away each: the tags under _Etiquetas_, the stage under
_Oportunidades_. A fact you have to go looking for is a fact you decide
without, so they moved into the header — the open deal's stage first, then the
tags. The stage answers "where is this going", the tags answer "who is this",
and the first is the one that changes week to week. Editing stays in the tabs:
the strip states, it does not offer.

The stage chip is **filled** and the tags are not, which is the colour doctrine
holding rather than a style choice. A filled chip is earned by a colour that
has been computed to be legible on its own fill — `stageChip()` washes the hue
86% toward the surface and walks the ink away until it clears 4.5:1 — while a
tag's colour is whatever an operator picked, so it stays a dot on grey.

The query grew a nested embed for the pipeline name
(`stage:pipeline_stages(*, pipeline:pipelines(name))`), because _Em andamento_
exists in **both** funnels and the stage name alone does not say which.

Measured in the browser on the seeded data, light mode: the stage chips come
out at 5.03:1, 4.97:1 and 4.55:1, every chip 20px tall, and the worst case —
a contact carrying three tags plus a stage — occupies 439px of a 608px strip,
so it stays on one row.

---

## 15. Seven reports from the prototype, and what each one was

> _"etiqueta ficou muito poluido dessa forma … tem que abrir um popup de edição
> e não levar até a rota … o icone sinalizando notificação altera o layout … o
> botao pra recolher ta praticamente solto/atirado … aquele elemento de texto
> com fundo cinza que descaracterizou demais com o verde do bubble"_

Every one of these turned out to have a mechanism rather than a taste, and in
four cases the prototype already had the answer written down.

### The menu grew with the data

`buildFilterOptions` generated one option per tag in the database and one per
company with a live conversation. Eight seeded conversations carrying eight
companies made EMPRESA **one filter per row in the list**, and ETIQUETA ten
rows that move whenever somebody adds a tag in Settings: twenty-three options
in a 240px scroller, most matching exactly one conversation.

The prototype's filter is a hard-coded array of nineteen options in five
groups that never reads the data at all. What replaced the two generated
groups is what it offers and what spec §9 lists: four fixed contact-type
buckets, the funnel, and the stage. The company is gone entirely — it is a
search term, not an axis, and `matchesSearch` already covers it. A test now
asserts the shape holds: twenty conversations with twenty companies and twenty
tags must produce **exactly the same number of options** as none.

### The row was missing the tag, not carrying too many

The complaint said "polluted"; the row was in fact short. `contact.tags` was
fetched, flattened, and never rendered — the only chip was the stage.

The reason it could not be rendered is the interesting part: the prototype's
data model has **two** fields, a single-valued `tipo` from a controlled
vocabulary and a free `etiquetas` array, and only `tipo` reaches the row. This
app has one flat `tags` table with no group column, so "which of these three
tags is the type" had no answer. `CONTACT_TYPE_NAMES` is that answer as a
constant — the twelve names of spec §5 — matched case-insensitively, because
tag ids are per account and this is a fork.

So the row now carries what the prototype's carries: one type chip, the stage,
and the occurrence triangle. Measured: 45px + 86px + 16px = 147px of chips in
a 320px column, all three above 4.5:1.

The owner slot changed for the opposite reason. It printed the word
`Atribuída` — a constant, on every row of a tab whose entire definition is
"assigned" — where the prototype prints the person's **name**. The amber
`Sem responsável` chip stayed exactly as it was: it is in the prototype too,
and the app's extra rule (drop to grey when the unread badge is already amber)
is a documented decision worth keeping.

### The grey box in the green bubble

`bg-muted/50` inside an outbound bubble. Light `--muted` is
`oklch(0.954 0.003 228.8)` and light `--wa-out` is `oklch(0.957 0.067 141.1)`:
**0.3% apart in lightness and 88° apart in hue**. So the attachment box was a
shape whose entire visible boundary was a colour change — precisely what the
note above the neutrals in `globals.css` forbids between a page and a card.
That doctrine was written for the page and nobody extended it inward.

Measured in the browser, light mode, compositing on canvas:

|                     | colour    | vs the bubble |
| ------------------- | --------- | ------------- |
| bubble              | `#d9fdd3` | —             |
| was — `bg-muted/50` | `#e3f6e2` | **1.02:1**    |
| now — `bg-wa-inset` | `#cdefc8` | 1.13:1        |

`--wa-inset` is `--foreground` at 6%: a wash of the bubble's own ink, which
darkens the green into a deeper green and white into a grey with one rule.
The prototype does the same job with `rgba(0,0,0,.045)`, which computes to
`#cff1c9` — two units per channel from where this lands.

Five surfaces used the neutral, not one: the document row, the image
placeholder, the media-unavailable state, the reply quote (which was
`bg-background/20`, _lighter_ than the bubble, so a quote lifted instead of
receding), and `InteractivePreview`, whose `bg-card` is literally white.
The action button keeps its opaque surface on images and video — there it
floats over pixels it cannot predict — and takes the inset on audio and
documents, where it sits on the bubble and nothing else.

`theme-contrast.test.ts` gained a pair, and a note about why it measures a
pre-composited token: the parser stops before the `/ alpha`, so a translucent
token would be read as the opaque ink it derives from and the assertion would
pass on a colour nobody renders.

### The collapsed rail

The dot beside the inbox icon is a normal flex item in a row whose collapsed
state is `justify-content: center`. So the row's content went from one 16px
icon to `16 + 12 + 8 = 36px` inside a 37px box: **the icon slid 10px left and
the row went flush to both edges** while every other row stayed inset. The
label vanishes cleanly because `display: none` removes the box entirely; the
dot never carried the attribute that does the same for a badge.

The fix is one attribute. `[data-nav-badge]` — position absolute, top right —
was already in `globals.css` **with no consumer in the codebase**. The dot now
carries it, plus a 2px ring in the sidebar colour, which is the prototype's
`box-shadow: 0 0 0 2px var(--surface)` on the same element.

### The panel handle

The contact panel's toggle was a bare glyph in the thread header: the same
weight as the refresh icon beside it, roughly 700px from the 288px panel it
hid, with nothing connecting the two. The nav rail's is a 24px bordered circle
straddling the edge it moves.

It is now the nav's handle, on the thread column's right edge — which IS the
seam between thread and panel. It cannot live inside the panel, the way the
prototype's `×` does, because this panel **unmounts** when closed and would
take the only way of getting it back with it. Two differences from the nav's,
both forced: the `xl` breakpoint, matching the panel's own, and a conditional
transform — the row is `overflow-hidden`, so the overhang can only exist when
there is a panel to overhang into.

### Editing without leaving the conversation

`window.open('/pipelines', '_self')` and `window.open('/contacts', '_self')`.
Not a route change — a full document navigation out of a Next app, which threw
away the realtime subscription and the open thread to show a form, and dropped
the contact's id on the way (`/contacts?id=` has been supported all along).

Both editors were already dialogs. `ContactForm` is a `Dialog`, `DealForm` is
a `Sheet`, both fully controlled. They are now mounted by the inbox page — not
by the panel, because the panel is rendered **twice**, as the xl column and
inside the mobile sheet, so state held there would be two independent copies
of the same dialog. `DealForm` gained one prop, `defaultContactId`, so
"Nova oportunidade" from a thread opens with the customer already chosen.

The save callback patches `conversation.contact` explicitly rather than
reusing `hydrateConversation`, whose merge is `c.contact ?? fetched.contact` —
it only backfills a MISSING contact, deliberately, to protect fresher realtime
fields. A renamed contact would otherwise keep the old name in the list and
the thread header until a reload, which reads as "the save did not work".

### The occurrence warning

Kept from the prototype and made a little louder, in two halves.

Shipping now, tag-driven: the red triangle on the conversation row — a 16px
icon square, not a chip with words, because the row has no width for
"Possui Ocorrência" — and a `Histórico do cliente` block on the contact panel,
above the commercial detail because it changes how you read everything under
it. Both read the one automatic tag §16 allows.

Written and waiting: `supabase/migrations/042_contact_occurrences.sql`. A tag
is one bit, and one bit cannot say **2 ocorrências · 1 em aberto · já teve
problema com Solda, Atraso** — §16 forbids solving that with more tags, and
§17 ("a ocorrência deve permanecer no histórico") is the argument for a table
outright: a resolved problem is not a problem that never happened. The
migration carries the fourteen types as free text rather than an enum, a
`contacts.occurrence_count` maintained by trigger, and DELETE gated to admin
because §17 in policy form is "an agent closes it, never removes it".

---

## 16. The handle, moved off the content

The panel handle from §15 landed in the wrong place, and the report was
immediate: _"não gostei ali, parece q ta atrapalhando"_.

It was right about the seam and wrong about the height. The nav rail can sit
at its own vertical midpoint because what faces it there is the conversation
list's padding. The contact panel's midpoint is its densest run of key/value
rows — so a 24px disc straddling the border landed on top of _Última compra_
and read as debris dropped on the panel.

`top-[30px]` instead of `top-1/2`. That is the thread header's own centre —
`py-3` plus a 36px avatar is 60px — which puts the handle in **chrome on both
sides**: level with the header bar on the thread side, and in the empty left
padding of the panel's centred identity block on the other.

Measured at 1440px, on the rendered layout: handle centre at y=30 against a
header centre at y=30.5, and a collision test over every text-bearing element
in both columns returns **an empty list**. Closed, it is fully visible and
unclipped; open, it overhangs 12px into the panel's padding and the row's
`overflow-hidden` does not touch it.

**And then it collided in the other state.** Header height solved the open
case and created the closed one: with the panel gone the handle is pulled
fully inside the thread, and the thread's right edge at header height is where
the action cluster ends — so it landed on the assign chip.

`xl:pr-10` on the header reserves the lane. The handle occupies 8–32px in from
the edge; 40px of padding clears it and leaves 8px of air, which is the gap the
cluster already uses between its own items. Measured in both states again:
zero collisions, 8px clearance closed, 28px open. Only at `xl` — below it there
is no handle, and that header cannot spare a pixel at 360px.

The general lesson, since it took two passes: a control anchored to a shared
edge has **two** neighbours, and satisfying one of them is not the job.

---

## 17. Four migrations, reviewed before they were handed over

`041`–`044` were all written and none applied, which is the one window where
a schema decision is still free to change. So before handing them over they
were read adversarially — four reviewers over the files and the code that
uses them, then a refute pass over everything they called a blocker. Five of
eight claims were refuted with evidence; three survived and were fixed.

**The one that would have failed on the first click.** `041`'s
`deal_playbook_progress.done_by` was `REFERENCES profiles(id)`, and
`playbook-checklist.tsx` writes `session.user.id`. Those are different UUIDs:
`profiles.id` defaults to `uuid_generate_v4()` and only `profiles.user_id`
holds the auth id (`001:13-23`). Every tick would have died on the foreign
key. Fixed to `auth.users(id)`, which is what the rest of the schema means by
"who" — `conversations.assigned_agent_id` holds it and `027` compares it to
`auth.uid()`. `042`'s `handled_by` had the same shape and the same fix.

**A comment that described a feature nobody built.** `043` documented eight
loss reasons including `buyingLater`, in the COMMENT that ships to the
production catalogue, plus a closing paragraph about a dialog branch that
offers Compra futura when it is picked. There is no such branch and no such
reason — `LOSS_REASONS` is seven, because _"tire a opção de vai comprar
depois"_. A COMMENT is DDL: the next person to write the loss report reads it
and excludes a value that can never appear. Rewritten, along with the two TS
comments that still said "eight" and were the SQL's own source.

**A comment that claimed a guarantee.** `041` said a concurrent double-tick
resolves as "an ON CONFLICT DO NOTHING rather than an error". There was no
such clause anywhere — the second write would have taken a 23505 on the
composite key. Rather than delete the sentence, the client now really does
upsert with `ignoreDuplicates`: a duplicate tick is somebody agreeing with
what is already on screen.

Also folded in from the same pass, all in files that have never run: `042`'s
counter trigger now skips a write when the count did not move (`contacts`
carries `set_updated_at`, and `updated_at` is a public field of the v1 API —
resolving an occurrence was bumping it twice), its backfill became correlated
so it can correct a counter **downward**, the table got the `set_updated_at`
trigger its sibling in `041` has, and a resolved occurrence must now carry
`resolved_at`.

## 18. `/frete`, and a snippet that carries a file

Two asks, one shape: _"tambem de / para respostas rapidas, e na criação de
respostas rapidas pode enviar mensagem + arquivo de foto ou video"_.

**The shortcut is not the title.** The `/` panel could already find "Prazo de
entrega" from `/pra` by word prefix, and that is a different thing — a
shortcut is a short name somebody decides once and then types without
reading, and it survives the title being reworded. The prototype lists them
that way, `/orcamento` as the label with the title beside it. So: a
`shortcut` column, normalised on the way in (lower-case, no spaces — the
panel closes on the first space, so a shortcut with one in it is unreachable
by construction), unique per account, and **ranked above title matches** in
the panel. That last part is the one that matters: somebody typing `/frete`
in full has already decided, and Enter must not send a snippet that merely
happens to contain the word.

**The file is the library's, not the message's.** A media snippet stores a
`chat-media` URL — the same bucket, the same public URL an outbound media
message stores. Choosing one stages an ordinary draft, so the send path is
the one that already exists and the caption arrives editable. What that costs
is one invariant, threaded through four places: `MediaDraft.path` and
`SendMediaPayload.path` are now nullable, and null means _do not delete this_.
Discarding the draft, replacing it, or a failed send would otherwise GC an
object that every message ever sent from that snippet points at — using
`/catalogo` once would blank the picture in every conversation that already
used it.

The editor gained the third kind, the shortcut field (with the slash drawn
rather than typed, so `//frete` is never a question the field has to answer),
and an uploader that only ever deletes files it uploaded in the same dialog
and did not end up using.

**Pending the migration.** `044` is not applied, so the listing sorts in the
route rather than in SQL — `.order('shortcut')` would 500 until it runs, and
an ordering is not worth taking the feature down for. Writes that need the
new columns come back as a 503 naming the migration instead of a PostgREST
schema-cache sentence.

---

## 19. Five reports from the inbox

**The 24-hour notice, moved into the conversation.** It was a full-width pink
strip above the composer — permanent chrome repeating a fact that does not
change, for as long as a dead thread stays dead. _"pode deixar um aviso no
centro do chat que consiga fechar para visualizar o que já foi conversado"_.

It is now a centred chip at the end of the message stream, wearing the day
separator's geometry and shadow because that is the shape this thread already
uses for something the system says rather than a person. Inside the scroll
container, so it scrolls away instead of standing on the conversation.

Dismissal stores the WINDOW, not `true`: the key is the timestamp of the
customer's last inbound message, so when they reply the stored value stops
matching and the notice returns the next time that new window closes. No
expiry logic, no cleanup pass, no way to silence tomorrow's notice by
dismissing today's.

Two things had to change for dismissal to be safe. The header pill is no
longer `hidden sm:` once the window has actually closed — below 640px it
would otherwise have been the only survivor, and it was hidden. And the plus
menu's trigger was gated on `inputsDisabled`, which locked the whole menu
whenever the window closed — including **Enviar template**, the one action
that still works out there. The gate moved down onto the items that need it.
Before this change, dismissing the strip would have removed the only route to
a template from the thread.

**Avatars that were not there.** _"os avatares que nao tem foto puxado tem um
padrão de cor que não contrasta legal nos fundos"_ — and it was worse than
that. Every disc in the app was `bg-muted`: 1.14:1 against a card, and
**exactly 1.00:1 against a selected conversation row**, whose fill is also
`--muted`. The disc did not have poor contrast on the row you were looking
at. It had none.

The prototype had already solved it, with its reasoning in a comment —
_"Dessaturados e de luminosidade parecida: ajudam a reconhecer pessoas sem
virar sinal. Avatar é textura, não alerta."_ Eight fills, one lightness band,
seeded from the name. Ported as `--avatar-1…8` plus an ink token, with only
L moving between modes: the light hexes shipped into dark would have put five
of the eight below 3:1.

Measured in the browser on the rendered page, worst case across all eight
discs and all four grounds: **5.01:1 light, 5.39:1 dark** (was 1.00:1), ink
5.73:1 and 5.86:1. Five call sites also stopped spending the accent on
decoration — `bg-primary/10` is 1.15:1, and blue marks where you are and what
you can press, not who someone is.

The guard could not have caught this: all twenty assertions in
`theme-contrast.test.ts` were ink-on-ground, and there was no surface-vs-
surface pair anywhere. `--muted` on `--muted` at 1.00:1 passed the whole
suite green. There is now a SURFACES table — eight discs × four grounds ×
two modes.

**Notifications without the fill.** _"essas notificações que aparecem assim
fica muito forçado, padroniza sem o fundo colorido"_. The amber row was the
only filled thing in a panel where every other row is neutral — and it is not
even a notification, it is the pinned "WhatsApp não conectado" link. Same
answer the quick actions got: one box for every row, the tone in the ink and
the glyph, the fill kept for the pointer. The unread tint went with it, in
both the panel and the page, which had disagreed about it anyway
(`bg-primary-soft/40` against `bg-primary/5`); unread still reads through
bold ink, the accented tile and the dot.

**The composer, 4px in.** It was `p-3` while the header above it is
`px-3 sm:px-4` and the message list is `px-4` — the one edge in that column
sitting outside the line everything else holds. Now `px-3 py-3 sm:px-4`:
unchanged on a phone, 8px narrower from 640px up, with its left edge landing
on the same vertical as every incoming bubble.

**And the notifications that "did not work".** They work. `027`'s trigger
skips self-assignment on purpose — _"nothing to notify the agent about"_ —
and this account has exactly one member, so every target the assign chip can
offer is Gabriel himself. Worse, even with a colleague the row is addressed
to the ASSIGNEE and RLS scopes reads to the recipient, so the assigner's own
bell stays empty by design. The one notification he could see came from the
service-role seed script, where `auth.uid()` is NULL and the skip does not
apply — which is exactly why it says "O sistema".

Nothing to fix in SQL, so nothing was written. What was missing is a way to
SEE it: `scripts/seed-notifications.mjs` writes the rows the trigger would
have written if a colleague had done the assigning — real rows, real table,
real type, pointed at real threads, spread across read/unread and minutes to
days old. And the assign menu now says so when you are the only member,
rather than letting a deliberate silence read as a broken feature.

---

## 20. The charts on /relatórios

> _"na sessão de relatório eu queria uma melhoria visual nos gráficos, achei
> muito feio para o restante do que já foi feito e aplicado."_

The page drew three charts with three unrelated implementations:

| Chart             | How it was drawn                          |
| ----------------- | ----------------------------------------- |
| Conversas         | hand-rolled SVG, fixed viewBox 760×240    |
| Valor no funil    | hand-rolled SVG, fixed viewBox 200×200    |
| Tempo de resposta | the vendored Tremor `BarChart` (Recharts) |

Three tooltips (`text-2xs`/`px-2.5`, `text-sm`/`px-4`, and one that did not
exist), three ideas of what a gridline is, two legends in different markup —
and three sizes for the same 10px axis label. All three now speak one
vocabulary, `src/components/charts/chart-primitives.tsx`: one body height, one
gridline, one axis, one readout, one legend.

**The axis was never 10px.** An SVG with a fixed viewBox and the default
`preserveAspectRatio` scales its coordinate system to the container, text
included. `text-3xs` inside a 760-unit viewBox is 10px only when the container
happens to be 760px wide — in the `lg:grid-cols-2` row on a capped 1440px page
each column is ~690px, so the axis rendered at 9.1px, and on a 375px phone at
about 4px. Recharts lays out 1:1 in real pixels. Measured after: 10px at 1270px
wide and 10px at 375px.

**And it was 16px black in the Recharts one.** The recipe everybody uses —
`className="text-xs fill-muted-foreground"` on `<XAxis>`, relying on SVG
inheritance down to the tick — worked in Recharts 2, where ticks are children
of the axis group. In Recharts 3 they are hoisted into a sibling
`recharts-zIndex-layer_2000` group and inherit nothing. Measured on the page:
the axis `<g>` computed to 10px carrying the class, the tick `<text>` inside it
to **16px, `fill: rgb(0, 0, 0)`** — browser-default black body copy where the
smallest type in the product should be. The class has to go on `tick`. Same
one-line fix applied to the vendored Tremor `BarChart` (adaptation 3 in its
header), which had the same bug in the AI usage panel; verified at 12px muted
afterwards.

**`--chart-2..5` in dark mode were four greys.** `oklch(L 0 0)`, chroma zero,
inherited from shadcn's neutral base — so the light-mode design of the ramp
stopped existing the moment you switched modes, and "Enviadas" rendered in the
grey this product reserves for what a MACHINE did. Two of them were not even
visible: `--chart-4` at L 0.371 and `--chart-5` at L 0.269 against a `--card`
of L 0.18. Dark now recedes downward (0.70 → 0.43) as light recedes upward, and
the light tail was pulled in from 0.87 (a near-white on a white card) to 0.83.

**What each chart gained.**

- **Conversas** — areas with gradients that reach zero at the baseline,
  instead of two bare polylines. ~120 lines of `getScreenCTM()` hover math, a
  manual label stride, and a tooltip that positioned itself against a
  letterboxed viewBox went with them. The range switcher now uses the inbox
  `SegBar`'s geometry rather than being a third kind of segmented control.
- **Valor no funil** — the segments have gaps. The old code's own comment
  promised them ("implied by a thin slate-900 stroke between them") and no such
  stroke was ever drawn: five butted arcs in five shades of one ramp is a
  single ring with faint colour changes in it. The ring also answers now —
  hovering a slice or its row dims the rest and swaps the centre to that stage
  — and the breakdown list has a hierarchy instead of three muted columns. The
  skeleton was `h-56` over an `h-48` chart, so every load dropped the page 32px;
  both are `CHART_HEIGHT` now.
- **Tempo de resposta** — the target is a `ReferenceLine` again, which is what
  the file's own comment asked for when Tremor forced it into a header chip. No
  colour on the bars that miss it: the line already says which days those are,
  and amber means a person has something to do, not that a Tuesday three weeks
  ago went badly. Days with no samples draw no bar rather than a zero —
  `avgMinutes ?? 0` was rendering "answered instantly" for a day nobody wrote
  in — and the tooltip says "Sem amostras" for them, recovered from the label
  because Recharts hands back an empty payload for a null bar.
- **The weekday axis was in English.** "Mon Tue Wed…" on a Portuguese install.
  `DOW_SHORT_MON_FIRST` is a hard-coded English array — correct as the internal
  ordering key it is elsewhere, wrong the moment it is painted. The label now
  comes from `APP_LOCALE`: seg · ter · qua · qui · sex · sáb · dom.

**One `Metric`, two densities.** The page drew its top four with
`components/ui/metric.tsx` and its next six with a private `Metric` declared
inside `pipeline-analytics.tsx` — different frame, different weight, two
sections apart on one page. The shared one gained `size="sm"` (six across has
no room for a 24px currency value), `icon` and `hint`, and the private copy and
its box-inside-a-box wrapper are gone. Four of those six icons were
`text-primary`, which marks where you are and what you can press; they are grey
now, except "Perdidas", which keeps its red.

**Checked.** `tsc`, `eslint`, `prettier`, `next build`, and 1204 tests green.
The rest was measured in the browser against a throwaway route, since
/relatórios is behind a login: tick sizes and fills in both modes, the dark
ramp resolving to five separated blues above the card, panel heights matching
at 528px in the two-column row, no horizontal overflow at 375px, the x-axis
thinning from 7 labels to 3 at 277px wide, the donut's four other slices
dimming to 0.28 on hover, and every tooltip read through the keyboard path the
`accessibilityLayer` provides.

## 21. Um calendário na visão geral

> _"implementa um calendário na visão geral que possa visualizar e controlar
> ações diárias e ações agendadas no sistema geral, já tem inclusive um sendo
> usado pra marcar data como padrao de design"_

The last clause is the design brief, and it was taken literally: the calendar
the date field opens IS the calendar the dashboard now draws. `MonthGrid` and
`MonthNav` came out of `ui/date-field.tsx` into `ui/month-grid.tsx`, the
arithmetic under them into `lib/calendar.ts`, and the field consumes them at
`size="sm"` while the agenda uses `size="md"`. Two calendars that agree about
which day the week starts on, because there is only one of them.

**What has a date in this product.** Six things, and every one of them was
visible only from inside the record that carried it — which is to say, only to
whoever already remembered to look.

| Lane          | Source                                          | Tone    | Movable from here |
| ------------- | ----------------------------------------------- | ------- | ----------------- |
| Automação     | `automation_pending_executions.run_at`, pending | grey    | no                |
| Campanha      | `broadcasts`, `scheduled_at ?? created_at`      | grey    | no                |
| Fechamento    | `deals.expected_close_date`, open deals         | amber   | **yes**           |
| Compra futura | `contacts.next_purchase_expected_at`            | amber   | **yes**           |
| Ocorrência    | `contact_occurrences`, still open               | red     | no                |
| Aniversário   | `contacts.birthday`, recurring                  | neutral | no                |

**And two that were kept out.** `automation_logs` is what ran, by the hundred,
every day — a calendar full of log lines is a log with worse navigation, and
"O CRM fez hoje" already owns it. Scheduled campaigns are the more interesting
refusal: `broadcasts.scheduled_at` exists, the status enum has `'scheduled'`,
and **nothing in the app writes either** — the wizard offers "enviar agora" and
"salvar rascunho", full stop. A lane that can never fill, with a reschedule
control writing a column no sender reads, would be the calendar performing a
feature the product does not have. Campaigns appear on the day they actually
went out; if scheduling ever lands, `scheduled_at` already takes precedence in
the loader and the lane fills itself.

**The queue the browser is not allowed to read.** "Follow-up D+3" lives in
`automation_pending_executions`, and `006` enabled RLS on it with no policy for
authenticated users at all — every reader until now was the engine holding the
service-role key, and the row carries the rendered message bodies in `context`.
A policy is a permanent grant, so rather than widen the table the read goes
through `GET /api/agenda/scheduled`: server-side, filtered to the caller's own
`account_id`, five columns out, `context` never crossing. An instance with no
service-role key has no engine either, so it gets an empty lane and a 200
rather than a 500 that would take the whole calendar down with it.

**What "controlar" was allowed to mean.** Two dates can be moved from the
panel, and they are exactly the two a PERSON owns: a deal's expected close and
a customer's next purchase. Both writes already existed elsewhere (the deal
form, the Compra futura dialog), so this is the same update from a second
surface rather than a new capability, and both are gated on `useCan`. The
automation queue belongs to the engine, a campaign has already gone out, a
birthday is a fact — a control that pretended to move those would be the
interface lying about who is in charge of what. It is the line the rest of the
product draws, applied to a calendar.

**The 29th of February.** Birthdays are the only recurring row here, and
`contacts.birthday` carries a year nobody entered on purpose, so the day and
month are re-hung on whichever year the window is looking at. `new Date(2027,
1, 29)` is the 1st of March — a leap-day customer congratulated late in three
years out of four — so the anniversary falls back to the last day of the
intended month. That, the year-crossing window and the bucketing are the unit
tests in `lib/dashboard/agenda.test.ts`.

**Two things only the browser could say.** `capitalize` on the month label is
per-WORD, which in Portuguese reads "Agosto De 2026" — `first-letter:uppercase`
on both the label and the day heading instead. And the tone dots collided:
`--auto-500` and `--muted-foreground` resolve to the identical lab value in
this palette, so a birthday and a scheduled automation drew two
indistinguishable greys on the same cell. Neutral is now that grey at 40% —
weight is the only channel left once the hue is spent, and a birthday is the
quietest thing on the calendar anyway.

**Pending `042`.** The occurrence lane stays empty until the migration is
applied. Every source resolves on its own and an unusable one contributes
nothing, so a missing table costs that lane and nothing else.

## 22. A fila que preenche a coluna

> _"o card de filas ele pode preencher o espaço até o final e ter um hover
> interno e fixar espaço dessas configurações e se necessário adicionar páginas
> quando bater o limite"_

The queue panel was `self-start` beside a side column carrying two panels, so a
quiet morning drew a two-row card with some 300px of nothing under it — a hole
three tiles wide in the middle of the page — and a page whose total height
moved with however many conversations happened to be waiting.

**Stretching alone does not fix that**, and this is the part worth writing
down: a grid row is as tall as its tallest item's CONTENT. A panel that grows
with its list grows the row with it, then fills it, and never scrolls —
measured at 2410px against a 19-row stub. So the grid item is now a wrapper
carrying the span and the floor (`xl:relative xl:col-span-3 xl:min-h-104`), its
height coming from the side column, with the panel taken out of flow inside it
(`xl:absolute xl:inset-0`) so it contributes nothing to the row's size. What is
left over inside goes to a `ScrollArea` at `min-h-0 flex-1` — the `min-h-0`
that component's own header warns about, without which the viewport matches its
content and silently clips instead of scrolling.

Both halves are `xl:` only. Stacked on a phone there is no side column to
match, and a tall empty box is just a tall empty box.

**Pages, not "load more".** `loadActionQueue` takes a page instead of a limit
and asks for `count: 'exact'`, so the panel knows the size of the queue rather
than the size of its own list — with a button, somebody reads eight rows and
never learns whether the ninth exists, and nine waiting looks identical to
ninety. The pager renders only when there is a second page, says "1–8 de 19"
next to "1/3", and the page shown is clamped **during render** rather than
corrected in an effect: answering the last conversation on page three shortens
the queue under the reader, and deriving `Math.min(queuePage, pages - 1)` means
the fetch re-runs with the right page instead of asking for an empty one and
then asking again.

Measured on the stubbed harness at 1440×900 with 19 waiting conversations:
panel and side column both 497px with their bottom edges on the same line, the
scroller 393px of viewport over 519px of content, and the panel still exactly
497px on page three where only three rows are left.
