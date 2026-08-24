# Verification

What was actually checked, how, and — the part that matters — what was not.

## The constraint

The app requires a Supabase session. The agent browser could reach
`http://localhost:3000` but could not sign in: entering a password is not
something an agent does, and no test account exists. So **almost none of this
was verified by looking at the logged-in product** — §6 is the exception, and
it got there by rendering the real dashboard on a public route with its data
stubbed, not by signing in. Gabriel was testing in his own
Chrome throughout and reported back; that is the only end-to-end check this
pass had, and it is how the popup-offset bug surfaced.

What stood in for it, in order of how much weight each carries.

---

## 1. Measurement in a real browser, on a public route

The strongest evidence here. A temporary route (`/ctx-lab`) was created outside
the `(dashboard)` group — so unauthenticated, and outside the reach of
`middleware.test.ts`, which walks that directory and requires every route in
`PROTECTED_PATHS`. It rendered real `Popover` and `DropdownMenu` instances, and
their geometry was read with `getBoundingClientRect()` through the browser
tool. Deleted afterwards.

That is where the numbers in [03-bugs.md §1](03-bugs.md#1-every-floating-panel-opened-5-away-from-its-trigger)
come from: `--anchor-width: 111px` for a 117-local-px trigger before, and
`translate(32px, 460px)` for a trigger at `left 32 / bottom 456` after.

Two traps in that harness, recorded because they cost time:

- The browser pane reported `innerWidth: 0` while hidden, which made every
  measurement zero and every conclusion drawn from it wrong. Always assert the
  viewport is non-zero before trusting a rect.
- `getAnimations()` showed `playState: "running", currentTime: 0` — the pane's
  timeline does not advance while it is not compositing, so the entry animation
  never finished and the popup's measured box was its `zoom-in-95` start state.
  Measure the **positioner**, not the animated popup.

The same harness was used a second time, as `/sheet-lab`, for the sheet-width
bug ([03-bugs.md §9](03-bugs.md#9-every-side-sheet-was-8rem-narrower-than-it-asked-for)).
Two things were read there that no amount of source reading settles: the stylesheet
the dev server was actually serving, `fetch()`ed and searched for both competing
`max-width` rules, and then the geometry after the fix — `sheetWidth: 672` at a
1280px viewport, two field columns of 313px; at 463px (the width in the report)
two of 209px; at 320px the tab strip wrapping to a second row with
`scrollWidth === clientWidth`. Deleted afterwards, like the first one.

The login page was also used directly to confirm the CSS compiles and resolves:
`backdrop-filter: blur(16px) saturate(1.8)` on `.glass`, `scrollbarWidth: thin`
on the body, `colorScheme: light` matching `data-mode`, `zoom: 1`.

## 2. The type checker

`npx tsc --noEmit`, clean, after every change. This catches more than it sounds
like in a codebase this typed: every prop threaded through the board, every new
translation key's call site, every icon import.

One false alarm worth knowing about: `tsc` run while the other session was
mid-write reported a syntax error in a file that was fine a second later. If an
error looks impossible, run it again before believing it.

## 3. Lint

`npx eslint src`, 0 errors. The React Compiler rules in this config are load
bearing — `react-hooks/preserve-manual-memoization` caught two real staleness
bugs where a `useCallback` started reading `t` without adding it to its
dependency array.

40 warnings remain, all pre-existing: mostly `t` missing from dependency arrays
(harmless while the app has one locale) and unused variables. It was 47 while
this was being written; the sweep that followed cleared seven of them.

## 4. Tests

The suite passes. It grew during the pass — both sessions added to it — so a
count is only meaningful against the moment it was taken; "green" is the claim.

Measured on the working tree exactly as it stands, 23 Aug at 18:22 — after the
seven prototype-comparison fixes:

```
tsc --noEmit   clean
vitest run     93 files, 1041 tests, 0 failures
eslint src     0 errors, 40 warnings
```

The suite grew by eleven: `conversation-filters.test.ts` was rewritten around
the curated menu, and one of the new cases is the regression guard — twenty
conversations with twenty companies and twenty tags must produce exactly the
same number of filter options as none.

Three of those suites are guards rather than tests: they read source files and
fail on a rule being broken, not on a behaviour changing. See
[01-worklog.md §11](01-worklog.md#11-three-guards-that-read-the-source). Their
weakness is the one below — a guard that reads the working tree is sensitive to
formatting, and `theme-contrast` proved it twice.

Two suites are worth knowing about because they are the ones that fail for
reasons unrelated to what they test:

- `theme-contrast.test.ts` reads `globals.css` from the working tree and
  matches selectors as literal strings. It broke twice on formatting, not on
  colour. Now normalises quotes and line endings first.
- `messages.test.ts` enforces exact key parity across `en` / `pt-BR` / `ko`.
  Every namespace added in this pass was added to all three.

Locale parity checked directly as well:

```
en missing in pt: 0   en missing in ko: 0   extra in pt: 0   extra in ko: 0
```

## 5. Reading the library source

For the popup-offset bug the mechanism was established by reading
`@floating-ui/dom`'s `getScale`, `getBoundingClientRect`,
`getRectRelativeToOffsetParent` and `getOffsetParent`, and Base UI's
`MenuPositioner` (which forces `positionMethod: 'fixed'` for context menus) and
`useAnchorPositioning`. The measurements above then confirmed the prediction.

This is worth stating because the first analysis was **wrong**: `getScale` was
read as `offsetWidth / rect.width` when it is `rect.width / cssWidth`, which
inverts the direction of the error. The measurement is what caught it. Reading
source predicts; only the browser decides.

---

## 6. The dashboard, on a stubbed harness

The agenda (worklog §21) and the reworked queue panel (§22) were measured
running, which is a first for anything on a logged-in page in this folder. The
method is §1's, one step further: a temporary route outside the `(dashboard)`
group — so unauthenticated and outside `middleware.test.ts`'s reach — importing
the **real** page component, with `window.fetch` patched at module scope to
answer every `/rest/v1/…` call from fixtures. Two of them, `/agenda-lab` and
`/dash-lab`; both deleted afterwards.

What that buys is the whole component under test rather than a re-typed copy of
it: the same loaders, the same effects, the same markup Gabriel opens. What it
does not buy is the database — every row is invented, so this proves layout,
wiring and behaviour, never a query's correctness against real data.

Three traps, all of which produced confident wrong readings first:

- **The pane reports `innerWidth: 0` while it is hidden**, so no `xl:` rule
  matches and every desktop measurement is really a 0px-viewport measurement.
  The first reading of the queue panel — 2450px tall, side column below it,
  19 rows — was the mobile stack. `resize_window` with explicit numbers
  (1440×900) is what made it a desktop.
- **A transition never finishes while the pane is not compositing.** Switching
  `data-mode` to dark left every element carrying `transition-colors` frozen at
  its light value, so a chip that had correctly resolved `bg-card` reported
  white. A clone of the same node, inserted fresh, reported the dark value —
  that is the check to run before believing a computed colour here.
- **`.range()` in this postgrest-js is `?offset=&limit=`, not a `Range`
  header.** The harness paged on the header, so it kept serving all 19 rows
  while the pager correctly said "1–8 de 19" over a list of 19. The app was
  right; the fixture was wrong.

Measured after those were sorted, at 1440×900:

| Claim                                | Reading                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| The queue fills its row              | panel 497px, side column 497px, bottom edges 0px apart           |
| It scrolls inside                    | viewport 393px over 519px of content                             |
| The space is fixed                   | 497px on pages 1, 2 and 3 — 8, 8 and 3 rows                      |
| The pager pages                      | `conv-1…8` → `conv-9…16` → `conv-17…19`, next disabled           |
| Agenda grid at desktop               | `320px 910px` at 1280px wide, 40×40 day cells                    |
| Agenda grid on a phone               | one column, 325px, no horizontal overflow at 375px               |
| Day markers carry a count            | "domingo, 23 de agosto de 2026 — 3 itens" as accessible name     |
| Filters filter                       | hiding Automações took the cell to "2 itens" and dropped the row |
| Reschedule writes                    | preset "Amanhã" → PATCH, popover closes, "Data atualizada"       |
| The field's own calendar still works | 42 cells at 28px, "Limpar" / "Hoje" footer intact                |

## What has NOT been verified

Be specific about this rather than reassuring.

| Not verified                     | Why it matters                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything behind the login        | Every screen in the product except the dashboard, which §6 measured on a stubbed harness. The rest is typed and linted, not seen                                    |
| `041_playbooks.sql`              | Never applied. Not run against a database, not even a local one. The RLS policies mirror `pipeline_stages` by inspection                                            |
| The playbook feature end to end  | It cannot run until the migration is applied; every query in it targets tables that do not exist yet                                                                |
| `DateField` inside a `Sheet`     | A portalled popover opening from inside a dialog is a supported Base UI combination and the floating tree should handle dismissal, but it was not exercised         |
| Touch behaviour                  | Long-press opens the context menu; dnd-kit's drag threshold is 5px and Base UI clears its long-press timer at 10px, so a real drag should win. Reasoned, not tested |
| The `glass` surface in dark mode | The tint sits above `--popover` for a reason, but nobody has looked at it on a dark screen                                                                          |
| Print, RTL, and reduced-motion   | Out of scope for this pass and untouched                                                                                                                            |

## The first thing to check after the migration is applied

1. Open a deal in a stage with no playbook as an **admin** — the dashed
   _Criar playbook para …_ line should be the only thing there.
2. Add two steps, save, reopen — order and hints should survive.
3. Tick one; the card on the board should show `1/2` in amber.
4. Move the deal to another stage from the right-click menu; the counter should
   change to that stage's playbook, or disappear if it has none.
5. Open the same deal as a **viewer** — the checklist should render, the
   checkboxes should not respond, and no pencil should appear.
