# UX/UI overhaul — 23 Aug 2026

What changed, why, and what is still open. Written during the work rather than
reconstructed after it.

## The documents

| File                                                 | What is in it                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| [01-worklog.md](01-worklog.md)                       | Every change, grouped by the request that caused it                   |
| [02-decisions.md](02-decisions.md)                   | The five calls that needed an argument, and the argument              |
| [03-bugs.md](03-bugs.md)                             | Defects found: symptom, cause, fix, and how the cause was established |
| [04-playbooks.md](04-playbooks.md)                   | The playbook feature — schema, surfaces, design rules                 |
| [05-verification.md](05-verification.md)             | What was actually checked, what was measured, and what was not        |
| [../playbook-comercial.md](../playbook-comercial.md) | The operational playbook itself, in Portuguese, for the sales team    |

## The requests this pass came from

In the order they arrived, all from Gabriel:

1. Right-click should do something useful in the web app
2. Blur / glass effects
3. Slightly larger type
4. Native scrollbars must follow the design
5. Scrolling drops the title and jams against the menu; too much movement
6. Notifications should be a panel off the bell, not a page you navigate to
7. Notifications were in English
8. The calendar must follow the design; its icon was invisible
9. Broken spacing and a scrollbar inside the deal sheet
10. Money values had no mask
11. A black arrow breaking the design
12. Dim the blurred background a little when a popup opens
13. Spacing bugs in popups and specific layouts
14. The sidebar account menu opens detached
15. Make the CRM's UX easier, with less on screen at once
16. Implement playbooks — both the feature and the usage document
17. Review the icon set and move to something less generic
18. Verify 100% of the interface is in Portuguese
19. Leave an easter egg
20. A general UX review, a bug audit, and this folder
21. A calendar on the overview, for the daily and scheduled actions of the
    whole system
22. The queue card should fill its column, scroll inside, and page when it
    hits its limit

## Two sessions, one repository

This work was done by two Claude Code sessions running at the same time against
the same working tree, coordinating over messages. The split settled as:

- **This session** — right-click menus, the glass surface, the zoom removal,
  the native-control replacements (select / date / money), notifications,
  playbooks, the locale sweep, and this folder.
- **The other session(s)** — the page-shape and layout system (`APP_SHAPED`,
  `PageTransition` as the layout box), the type scale, page actions moving into
  `PageHeader`, template i18n, the spacing and rhythm sweep across the reading
  pages, error boundaries and `not-found`, and a 104-finding symmetry audit.

Where this folder describes something from the other session, it says so and
does not claim to have verified it beyond `tsc` / lint / tests passing on the
shared tree. Their findings are described from their own reports.

## Still open

| Item                                                   | Why                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `supabase/migrations/041_playbooks.sql` is not applied | Migrations are applied by Gabriel from Cursor, never by an agent                    |
| The `lucide-react` → Phosphor codemod has not run      | 128 icons across 95 files; held until the other session's sweep is finished         |
| No end-to-end visual verification of the logged-in app | See [05-verification.md](05-verification.md) — the reason and what stands in for it |
