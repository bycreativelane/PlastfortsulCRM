# Bugs found and fixed

Each entry: what you saw, what actually caused it, what fixed it, and how the
cause was established. Ordered by how long it took to understand, not by
severity.

---

## 1. Every floating panel opened 5% away from its trigger

**Reported as:** _"sempre abre com uma distância muito grande, seja calendário,
notificação, ou o menu da barra lateral"_ — with three screenshots, each of a
panel detached from the thing that opened it.

It was not those three components. It was every menu, dropdown, select, tooltip
and popover in the product, and it had been there since the day the global zoom
was added — just smaller, and blamed on whatever was newest.

### Cause

The app rendered inside `body { zoom: var(--zoom) }`.

A zoomed subtree is laid out in its **own** pixels and painted at
`local × zoom`. `getBoundingClientRect()` reports the **painted** box. Floating
UI — which positions every popup here, through Base UI — reads the trigger with
`getBoundingClientRect` and writes the answer as a `transform` on the
positioner, which lives inside the zoomed subtree.

It converts between the two spaces in exactly one situation: when the floating
element's offset parent is an `Element`, in which case
`getBoundingClientRect(el, includeScale, …)` divides by `getScale(offsetParent)`.
For a portalled popup the offset parent is not an Element —
`getOffsetParent()` returns `window` for a `position: fixed` floating element,
and also for an absolutely positioned one whose nearest positioned ancestor is
a static `<body>`. No conversion happens, and painted coordinates are used
verbatim as local ones.

Every panel therefore landed at `position × zoom`: pulled toward the top-left
corner by 5% of its distance from it. Perfect in the corner, ~22px adrift
halfway down the page, ~75px adrift for the notification bell in the top right.

### How that was established

Measured in the running app, not reasoned about:

```js
// The two coordinate spaces, at zoom 0.9
document.body.offsetWidth; // 1422  (local)
document.body.getBoundingClientRect().width; // 1280  (painted)

// A fixed element inside the zoomed body
div.style.left = '100px';
div.getBoundingClientRect().left; // 90 — paints at left × zoom
```

Then, on a harness page with a real dropdown, before and after:

|                | trigger                     | positioner               | expected                     |
| -------------- | --------------------------- | ------------------------ | ---------------------------- |
| `--zoom: 0.95` | `left 30.4`, `bottom 433.3` | popup top **407.4**      | `437.3`                      |
| `--zoom: 0.95` | trigger width `117` local   | `--anchor-width: 111px`  | `117px`                      |
| `--zoom: 1`    | `left 32`, `bottom 456`     | `translate(32px, 460px)` | exact, with `sideOffset={4}` |

### Fix

`--zoom: 1`. The alternatives, and why each leaves a residue, are in
[02-decisions.md §1](02-decisions.md#1-body-zoom-had-to-go-not-be-worked-around).

The variable and the `zoom: var(--zoom)` declaration stay, with a comment in
`globals.css` saying it is a load-bearing 1 and what breaks if it is not.
`h-vh-*` and friends still divide by it, which is now a divide by one.

A second consequence, noted by the other session: standardised `zoom` also
makes an element a containing block for `position: fixed` descendants — a
different route to the same class of "portalled thing moved" bug.

---

## 2. The whole app could scroll sideways

**Symptom.** On Settings the page could be dragged left: the sidebar and the
top bar slid off-screen with the content, as if the layout had come loose.

**Cause.** `<main class="overflow-y-auto">`. Per CSS overflow, when one axis is
`visible` and the other is not, the `visible` one computes to `auto` — asking
for a vertical scrollbar silently asks for a horizontal one too. Any single
element a few pixels too wide, anywhere on any page, made the entire app shell
scrollable.

**Fix.** `overflow-x-hidden` alongside it. Nothing at page level should scroll
horizontally; the things that legitimately do — tables via `table-container`,
the pipeline board, the settings rail — each own their own scroll container.

The same rule removed the horizontal scrollbar under the deal sheet, which had
a real overflow behind it as well: see §3.

---

## 3. Two buttons that could not fit, and would not shrink

**Symptom.** In the deal sheet, "Marcar como perdido" was cut off at the right
edge and a horizontal scrollbar ran under the whole form.

**Cause.** `Button` sets `whitespace-nowrap`. Two of them at `flex-1` in a row
cannot shrink below their own labels — `min-width: auto` on a flex item floors
at min-content — so the pair pushed the form wider than the sheet instead of
wrapping.

**Fix.** Stacked, one per row. `min-w-0` plus a grid was tried first and is
still wrong for a different reason: it lets the box shrink but the label is
still `nowrap`, so the text overflows the button instead of the form. Two
decisions this consequential read better one under the other anyway.

---

## 4. Native pickers followed Windows, not the app

**Symptom.** In light mode the date field opened a black calendar panel, and
the calendar glyph inside the field was a dark icon on a dark button — visible
only on hover.

**Cause.** `src/app/layout.tsx` declares `colorScheme: 'light dark'` in its
viewport export, which renders `<meta name="color-scheme" content="light dark">`
— an instruction to paint form controls in whichever scheme the _operating
system_ prefers. The app's own light/dark choice lives in `data-mode` on
`<html>`, which the browser knows nothing about.

**Fix.** `color-scheme: light` / `dark` bound to `html[data-mode="…"]` in
`globals.css`; CSS wins over the meta tag. The field itself was then replaced —
see [02-decisions.md §3](02-decisions.md#3-native-controls-replace-the-panel-not-the-colour).

---

## 5. One number, two spellings, one screen

**Symptom.** A deal worth 143123421 showed as `R$ 143,123,421` on the card and
`143.123.421` in the field it was typed into.

**Cause.** `formatCurrency` called `Intl.NumberFormat(undefined, …)`, which
follows the browser's language, while `CurrencyInput` reads the locale from the
message catalogue. An operator running an en-US Chrome against a pt-BR
installation got both answers at once.

**Fix.** `APP_LOCALE` everywhere, split into `src/lib/i18n/locale.ts` so a
module needing only the BCP-47 tag does not pull `date-fns/locale` with it.
Sixteen files, and `grep` for `toLocaleDateString()` / `toLocaleString(undefined`
/ `NumberFormat(undefined` now returns only doc comments.

The rationale comment in `currency.test.ts` defended the old behaviour, so it
was rewritten. A stale comment in a test is worse than no comment: it is a
reason not to change something, and the reason had stopped being true.

---

## 6. A viewer was shown buttons that could not work

**Symptom.** A read-only role could open a deal, edit every field, press Save,
and find out from an error toast that they could not.

**Cause.** `deal-form.tsx` had no capability check at all. RLS was doing the
work — `deals_insert` / `_update` / `_delete` all require `agent` — so nothing
was ever written, but the interface said yes and the database said no.

**Fix.** `useCan('send-messages')` gates Save, the won/lost/reopen buttons and
the delete row, matching the gate the board's right-click menu already used.

---

## 7. `theme-contrast.test.ts` failed twice, for two formatting reasons

**Symptom.** `block not found: :root,` — an error pointing at the CSS, caused
by something that was not the CSS. Twice, from two different sessions.

**Cause.** The test locates a CSS block by searching for its selector as a
literal string. That makes it sensitive to two things that have nothing to do
with colour:

1. **Quote style.** Prettier's `singleQuote: true` applies to CSS attribute
   selectors, so `npm run format` rewrites `[data-mode="dark"]` and the search
   stops matching. `globals.css` had never been formatted, so the test had
   never noticed.
2. **Line endings.** `core.autocrlf=true` is set on this machine, so the
   working tree is CRLF while the committed blob is LF. A Python edit written
   in text mode rewrote the file's endings, and the LF selectors in the test
   stopped matching.

**Fix.** Both normalised before matching — quotes to double, `\r\n` to `\n`.
Both swaps preserve every character position, so the offsets used to slice out
a block stay valid.

**Worth knowing:** any other test that reads a source file and matches literal
strings has the same latent failure on a Windows clone.

---

## 8. Smaller things

| Symptom                                                             | Cause                                                                                                          | Fix                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows scrollbars, arrow buttons and all, on every scrolling panel | Nothing ever styled them; three components had each hidden their own                                           | `* { scrollbar-width: thin; scrollbar-color: … }`. The standard properties and not `::-webkit-scrollbar`, because Chrome 121+ ignores the pseudo-elements once either standard property is set on the same element |
| A black stepper inside the money field                              | `type="number"`                                                                                                | `appearance: textfield` + the `::-webkit-*-spin-button` reset. `type="number"` stays for the numeric keypad                                                                                                        |
| A black triangle on 21 selects                                      | Raw `<select>`, each with its own copy of the border and padding classes, none matching `Input`'s height       | `NativeSelect` — `appearance: none` and one chevron in the app's own icon set                                                                                                                                      |
| A 32px band of dead space in the import dialog                      | The preview region keeps `py-4` when React renders its two false branches as nothing                           | `empty:hidden` — the element genuinely has no child nodes, so `:empty` matches                                                                                                                                     |
| Delete competing with Save in the pipeline dialog                   | A filled red button in the same row as the primary action                                                      | Ghost destructive; the red belongs on the confirmation step behind it                                                                                                                                              |
| The sidebar account menu looked unattached                          | `align="end"` made it narrower than its trigger and offset from it                                             | `align="start"` and the default `w-(--anchor-width)`, so the panel is exactly the row it belongs to                                                                                                                |
| The settings rail jammed against the top bar                        | `lg:sticky lg:top-0` inside the page scroller                                                                  | `lg:top-6`, matching the page's own top gutter                                                                                                                                                                     |
| A day button read as "23" to a screen reader                        | The visible label is a bare number                                                                             | `aria-label` with the full localised date, plus `aria-pressed`                                                                                                                                                     |
| `usePlaybookProgress` could build a 7.5KB URL                       | One `IN (…)` over every deal on the board                                                                      | Chunked at 100 ids                                                                                                                                                                                                 |
| Calendar cells were a 28px touch target                             | `size-7` sized for a mouse; the popover had ~100px of spare width at 360px                                     | `pointer-coarse:size-10`, with the weekday header grown to match so the columns stay aligned                                                                                                                       |
| Outside-month days measured 1.88:1                                  | `text-muted-foreground/45` — but the days are **live**, and WCAG's contrast exemption is for disabled controls | Plain `text-muted-foreground`. The missing hover background already says they belong to another month                                                                                                              |

The last two were found by the other session's accessibility audit, in this
session's file, and fixed here. Worth recording as a pattern: the person who
writes a component is the worst-placed person to notice its touch targets.

---

## 9. Every side sheet was 8rem narrower than it asked for

**Symptom.** The contact sheet could not fit its own five tabs. The fix at the
time was to cap the strip and let it scroll sideways — which is how a scrollbar
ended up inside a tab strip, and a whole tab behind a gesture nobody is told
about. Reported as _"onde criou barra de rolagem, ta mal intuitivo"_.

**Cause.** Not the tabs. `SheetContent`'s base string carried
`data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm`, and all three call
sites passed `sm:max-w-lg` on top of it. The base won every time:

```css
.sm\:max-w-lg {
  max-width: 32rem;
} /* (0,1,0) */
.data-\[side\=right\]\:sm\:max-w-sm[data-side='right'] {
  max-width: 24rem;
} /* (0,2,0) */
```

Same layer, same media query, and the second selector carries an attribute.
`cn()` cannot collapse them either — tailwind-merge treats two classes as
conflicting only when their modifiers match, and `data-[side=right]:sm:` is not
`sm:`. So three sheets asked for 32rem and all three rendered at 24rem.

**How the cause was established.** By reading the CSS the dev server was
actually serving, not the source: `fetch()` on the stylesheet, both rules
present, printed side by side. The source reads as though the call site decides.

**Fix.** The width is a cva variant on `SheetContent` — `panel` 24rem, `form`
32rem, `record` 42rem — so exactly one max-width class reaches the element and
the name at the call site is what renders. The `data-[side=…]` prefix stays
inside each variant: a bottom sheet must not inherit a side sheet's cap.

Measured after, on a real browser: `sheetWidth: 672`, computed `max-width:
672px`, at a 1280px viewport. The four remaining tabs occupy 303px of a 640px
strip and `scrollWidth === clientWidth` — no scroller at any width down to
360px, and at 320px the last tab wraps to a second row instead of hiding.

**Worth knowing:** any base class with a `data-*` or `group-data-*` prefix
silently outranks the plain utility a call site passes for the same property.
Where the call site is meant to decide, the base must not hold an
attribute-qualified opinion — make it a variant. `src/components/ui` was swept
for other instances; this was the only one.

---

## 10. The grey box in the green bubble, and the four beside it

**Symptom.** An attachment inside an outbound message rendered on a pale box
that clashed with the bubble — _"aquele elemento de texto com fundo cinza que
descaracterizou demais com o verde do bubble"_.

**Cause.** `bg-muted/50`, and the numbers are the whole explanation. Light
`--muted` is `oklch(0.954 0.003 228.8)`; light `--wa-out` is
`oklch(0.957 0.067 141.1)`. **0.3% apart in lightness, 88° apart in hue.** So
the box had no lightness step at all — its entire visible boundary was a
desaturation, which is exactly what `globals.css` rules out in its own words
for the page/card relationship: "a difference in lightness only, small enough
that you feel the card lift rather than see a colour change". Nobody extended
that rule to the inside of a bubble, so nothing stopped a neutral being used
there.

Dark mode failed the same way for the mirror reason: `bg-muted/50` over the
dark `--wa-out` lands darker AND desaturated AND rotated 12° toward cyan.

The second-order cause is worth recording: `MediaActionButton`'s comment said
its opaque surface "reads on the muted inbound fill, the **primary outbound
fill**, and on top of an arbitrary photo". That was true when outbound was
`bg-primary`. `message-bubble.tsx` records the change to `bg-wa-out`; the
media renderers were never revisited, and their defensive opacity — correct
over a photo — became a near-white pill on light green.

**How the cause was established.** Composited on a canvas in a real browser,
which resolves any CSS colour syntax to sRGB and applies the same source-over
the compositor does. `getComputedStyle` returns `lab()` here, so reading the
numbers straight out of it gives nonsense — that cost a round trip.

|        | colour    | contrast vs the bubble |
| ------ | --------- | ---------------------- |
| bubble | `#d9fdd3` | —                      |
| was    | `#e3f6e2` | 1.02:1                 |
| now    | `#cdefc8` | 1.13:1                 |

**Fix.** A token, `--wa-inset` = `--foreground` at 6%, applied to every
surface that sits inside a bubble. It is a wash of the bubble's own ink, so it
darkens the green into a deeper green and white into a grey with the same
rule — the prototype's `rgba(0,0,0,.045)`, which computes to `#cff1c9`, two
units per channel from where this lands.

**It was five surfaces, not one.** The document row, the image placeholder
(fully opaque `--muted`, and the largest neutral rectangle in the thread while
an image loads), the media-unavailable state, the reply quote — which was
`bg-background/20`, _lighter_ than the bubble, so a quoted message lifted off
the thread instead of receding into it — and `InteractivePreview`, whose
`bg-card` is literally `oklch(1 0 0)`: a white card with a cool grey ring
inside a green bubble.

**Worth knowing:** the fix is invisible to `color-doctrine.test.ts`, whose
regexes match unmapped Tailwind families and dark shades — every one of these
was a legitimate theme token used in the wrong place. The guard that would
catch a repeat is the contrast pair, because it fails on a measurement rather
than on a spelling.

---

## 11. The collapsed rail moved its own icon

**Symptom.** In the collapsed navigation rail, the row carrying the unread dot
sat visibly wider and further left than every other row.

**Cause.** The dot is a normal flex item, and the collapsed row is
`justify-content: center`. Every other row centres one 16px icon in a 37px
box — 10.5px of free space each side. The inbox row centres `16 + 12(gap) +
8(dot) = 36px` in the same 37px box. **The icon moves 10px left**, more than
half its own width, and the row goes flush to both edges while its neighbours
stay inset. One cause, both halves of the symptom.

It is not a gap surviving a hidden label: `[data-nav-label]` is
`display: none`, which removes the box entirely, so those children stop being
flex items cleanly. The dot simply never carried an attribute that does the
same.

**Fix.** `data-nav-badge` on the dot — a rule that already existed in
`globals.css` with **zero consumers**, doing exactly this job — plus
`ring-2 ring-sidebar`, the port of the prototype's
`box-shadow: 0 0 0 2px var(--surface)` on the same element.

**Worth knowing:** the collapsed block in `globals.css` is unlayered, and that
is load-bearing — it is what lets `position: absolute` beat Tailwind's
`size-2` without `!important`. Wrapping that section in `@layer` later would
silently restore the bug.

---

## 12. The catalogue had two keys with a dot in them, and next-intl refuses those

**Symptom.** Nothing visible on most screens — and on the pipelines page, two
filter labels rendering as their own keypath. In `next-development.log`,
**1209 errors** from one server session.

```
Error: INVALID_KEY: Namespace keys cannot contain the character "."
as this is used to express nesting.
Invalid keys: Automations.list, Pipelines.page
```

**Cause.** Somebody adding strings wrote them at the top level of the
catalogue as `"Pipelines.page": { … }` instead of nesting them under
`Pipelines` → `page`. In next-intl the dot IS the nesting operator, so a key
containing one is rejected outright and the whole catalogue is reported as
invalid on every render.

`useTranslations('Pipelines.page')` at the call site was always correct — that
dot means "walk into the nested namespace". The components were right; the
JSON was wrong.

The two were not the same kind of wrong:

| flat key           | contents                                                            | verdict        |
| ------------------ | ------------------------------------------------------------------- | -------------- |
| `Automations.list` | 5 keys, byte-identical to the nested ones                           | pure duplicate |
| `Pipelines.page`   | `filters`, `filtersTitle`, `ownerLabel` — **in no other namespace** | stranded       |

So the pipelines page had been asking for three strings that existed in the
file but at an address nothing could reach, which is the second error in the
log: `MISSING_MESSAGE: Could not resolve 'Pipelines.page.filtersTitle'`.

**Fix.** Merge each flat namespace into its nested home — keeping the three
stranded strings, discarding the five duplicates — and delete the dotted keys.
All three locales.

**Worth knowing:** `messages.test.ts` could not catch this. It asserts key
PARITY across locales, and the mistake was made identically in all three, so
the three files agreed with each other perfectly while all three were invalid.
`messages.test.ts` now carries the guard: no key in any locale may contain a
`.`, asserted against `en` as well as the translations, because this is the
one class of catalogue bug that parity is structurally unable to see.

---

## 13. Twelve route errors that said `{}`

**Symptom.** `[dashboard] route error {}` in the dev log, twelve times, with
no message, no stack and no digest.

**Cause.** `console.error('[dashboard] route error', error)` in the dashboard's
error boundary. An `Error`'s `message` and `stack` are **non-enumerable**, and
so are the `code` / `details` / `hint` of a Supabase `PostgrestError`. The dev
server serialises the object it is handed, and what it is handed enumerates to
nothing.

The identical trap is already documented forty lines away, in the inbox page's
conversation fetch: _"Supabase errors have non-enumerable properties — log
fields explicitly so the console message isn't just `{}`"_. The boundary was
written later and did not inherit the lesson.

**Fix.** Log the fields — `name`, `message`, `digest`, `stack` — and spread the
object after them for the Supabase shape.

The twelve occurrences themselves stay unexplained, and that is the point: the
log is why they cannot be explained. The next one will say what it was.

---

## 14. The contact panel never scrolled

**Symptom.** Reported as _"tem dados muito no final da sessão"_ — the panel's
last rows sat jammed against the bottom edge. What was actually happening is
worse than crowding: **`Cadastrado` was not on screen at all**, and nothing
could bring it there.

**Cause.** `<ScrollArea className="flex-1">` inside
`<div className="flex h-full w-72 flex-col">`.

A flex item's `min-height` is `auto`, which means it will not shrink below its
own content. `flex-1` alone therefore let the scroll area grow to the height of
everything inside it rather than to the space available. The Viewport is
`size-full`, so it matched — and a viewport as tall as its content has nothing
to scroll.

The overflow then went somewhere invisible: the inbox row is
`flex flex-1 overflow-hidden`, so it clipped the excess without a scrollbar,
without an error, and without any indication that a panel which looks finished
is missing its last four rows.

**How the cause was established.** A harness rendering the exact nesting twice,
once with each class, measured in the browser:

|                  | ScrollArea height           | viewport client / scroll | scrolls?                |
| ---------------- | --------------------------- | ------------------------ | ----------------------- |
| `flex-1`         | **1680px** in a 500px panel | 1680 / 1680              | **no** — 1180px clipped |
| `min-h-0 flex-1` | 500px                       | 500 / 1680               | yes                     |

Then on the fixed panel: scrolling to the end reaches the bottom, and the last
row is fully visible with 17px of clearance under it.

**Fix.** `min-h-0 flex-1`. `conversation-list.tsx` already carried both classes
for the same reason — the sidebar was the one that missed it — and the note now
lives on the `ScrollArea` component itself, because the failure is silent and
the next person to reach for it deserves the warning rather than the bug.
