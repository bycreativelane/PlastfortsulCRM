# Decisions

Five calls in this pass needed an argument rather than a preference. Each is
recorded with the option that was rejected, because a decision without its
alternative is just an assertion.

---

## 1. `body { zoom }` had to go, not be worked around

**Chosen:** `--zoom: 1`. The property stays declared, the variable stays, and a
comment in `globals.css` says it is a load-bearing 1.

**Rejected:** keep the zoom and teach the popups to live with it.

Three ways to do that were considered and each leaves a residue:

| Workaround                                                   | What it still gets wrong                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Divide the anchor rect by the zoom, per component            | Position becomes exact, but the collision boundary is still in viewport pixels — near the right edge panels flip and shift early, by up to 5% of the screen width  |
| Portal into an unzoomed container and scale the popup itself | Position is exact for `side=bottom align=start` only; `align=end` and `side=top` are short by 5% of the popup's own size, because Floating UI measured it unzoomed |
| Both corrections, plus a live collision rect with getters    | Correct, and roughly 80 lines of coordinate arithmetic spread across five components that must be maintained forever                                               |

All three keep a property that no popup library on the platform accounts for.
And the zoom was buying density that had been explicitly asked to be reduced —
the same conversation asked for larger type and less on screen at once. It was
paying rent in the wrong currency.

The full mechanism, with the measurements, is in
[03-bugs.md §1](03-bugs.md#1-every-floating-panel-opened-5-away-from-its-trigger).

---

## 2. Glass goes on menus, not on dialogs

**Chosen:** `@utility glass` applied to context menus, dropdown menus,
submenus and popovers.

**Rejected:** the same surface on dialogs, sheets, cards and tooltips.

The rule that decides it: **does something meaningful sit behind this, and is
it temporary?**

A menu opens on top of the row you are deciding about, and an opaque panel
hides it at exactly the moment you need it — that is the whole argument for
translucency, and it only applies to menus. A dialog is a place you go to read
and type; text on a moving translucent ground is harder to read for no gain. A
card is part of the page, and blurring the page against itself buys nothing.

The dark tint sits **above** `--popover` rather than at it. Blurring a
near-black panel over a near-black page produces a rectangle you can only find
by its shadow.

Nine call sites were passing `bg-popover` / `border-border` / `ring-border`
into `DropdownMenuContent` or `PopoverContent`. Those fight the utility for the
same property and which one wins depends on stylesheet order, so they were
removed and the component owns its surface.

---

## 3. Native controls: replace the panel, not the colour

**Chosen:** `NativeSelect`, `DateField` and `CurrencyInput`, plus
`color-scheme` bound to `data-mode`.

**Rejected:** pinning `color-scheme` and stopping there.

Pinning it does fix the reported symptom — the dark calendar panel and the
invisible calendar glyph in light mode — and it was necessary regardless,
because the root layout's `colorScheme: 'light dark'` tells the browser to
follow the _operating system_ rather than the app.

But it leaves the browser's own panel design in the middle of the product, and
that panel is not reachable from CSS at all. For a field people fill in a dozen
times a day, "the same design as everything else" is worth a component.

The three replacements are deliberately different in kind:

- **`NativeSelect` keeps the native control** and only removes its chrome. A
  plain list of names does not need a portal, positioning or keyboard handling
  of ours, and the platform picker on a phone is better than anything we would
  build. `appearance: none` plus our own chevron is the whole change.
- **`DateField` replaces the panel and keeps typing.** A picker you can only
  click is slower than what it replaced for anyone entering a date they already
  know, so the text half stays primary.
- **`CurrencyInput` is new behaviour, not a re-skin.** Nine digits with no
  grouping is not a number a person can read.

---

## 4. Playbook steps belong to the stage

**Chosen:** steps hang off `pipeline_stages`; only the ticks are per deal.

**Rejected:** copying a template of steps onto each deal when it is created.

Per-deal copies mean editing the playbook changes nothing for work already in
flight — which is the opposite of what writing a process down is for. It also
turns "what does this stage ask for" into a query over every deal that ever
passed through it.

The cost of the chosen shape is that a deal's counter resets when it moves
stage. That is not a bug: `0/3` in Follow-up after finishing all four steps of
Em Aberto is the truth about what is left, which is the only question a board
asks. The history is still in the table.

Full reasoning in [04-playbooks.md](04-playbooks.md).

---

## 5. The app's locale, not the viewer's

**Chosen:** every `Intl` / `toLocale*` call goes through `APP_LOCALE`, read
from `NEXT_PUBLIC_APP_LOCALE`.

**Rejected:** `Intl.NumberFormat(undefined, …)`, which follows the browser —
and which `formatCurrency` was doing deliberately, with a test comment
defending it.

The defence was reasonable in the abstract and wrong in this product. A
self-hosted CRM configured for pt-BR showed an operator with an en-US Chrome a
deal card reading **143,123,421** next to the field they had typed it into
reading **143.123.421**. Two spellings of one number, on one screen, because
half the interface asked the catalogue and half asked the browser.

The language of the interface is a property of the installation, not of the
machine looking at it. `src/lib/i18n/locale.ts` holds the tag alone — no
`date-fns` import — so `currency.ts` can use it without pulling a locale bundle
into the board, the cards, the charts and the reports.
