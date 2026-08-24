# Playbooks

A playbook is the checklist a deal inherits from the stage it is sitting in.

The board answers _where is this deal_. Nothing in the product answered _and
therefore what_, and that gap is where deals go quiet — a lead sits in Follow-up
for eleven days not because anyone decided to wait, but because the next move
lived in one person's head and they were busy on Thursday.

The operational content — the actual steps for the Vendas pipeline — is in
[../playbook-comercial.md](../playbook-comercial.md), in Portuguese, because
that document is read by the sales team and not by this repository.

---

## The one design decision everything follows from

**Steps belong to a stage, not to a deal.**

The work is a property of where a deal has got to. A deal picks its list up by
arriving in a stage and drops it by moving on. Nothing is copied per deal, and
editing a stage's playbook changes what every deal in that stage is asked to do
— which is the point of writing one down.

The only thing stored per deal is which steps are ticked
(`deal_playbook_progress`), and a row exists **iff** the step is done. There is
no `done BOOLEAN`, because a three-state column (missing / false / true) has two
spellings for "not done" and every query has to remember both.

### Why it is not an automation

Automations are the machine acting on its own. A playbook is a person being
told what to do. The colour doctrine this whole product rests on turns on that
distinction — amber means _a human must act_, grey means _a machine did this_ —
so collapsing the two would produce a checklist item you cannot tell apart from
something already handled.

**Playbooks are amber.** The card's counter is amber while work is left, and
goes _quiet_ when the list is finished rather than turning green: "done" is the
absence of a demand, not a second announcement.

---

## Schema — migration `041_playbooks.sql`

```
playbook_steps            (id, account_id, stage_id, position, title, hint, …)
deal_playbook_progress    (deal_id, step_id, account_id, done_at, done_by)
```

| Decision                                       | Reason                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `account_id` denormalised onto both tables     | RLS can scope a row without a two-table join on every read — the same trade migration 017 made across the schema                  |
| `stage_id … ON DELETE CASCADE`                 | A stage that no longer exists cannot have work attached; orphans would show a deal a checklist for a column it is not in          |
| `done_by … ON DELETE SET NULL`                 | An agent leaving the company must not silently un-tick the work they did. History outlives employment                             |
| Composite PK `(deal_id, step_id)`              | Two agents ticking the same box at the same moment produce one row, and the loser's insert is a no-op rather than an error        |
| No `UPDATE` policy on progress                 | A tick is created or removed, never edited. Re-ticking is a fresh row with a fresh `done_at` — the honest record of what happened |
| Steps are admin-write, progress is agent-write | A playbook is a rule about how the team works; a tick is the work. They are different permissions because they are different acts |

`deal_playbook_progress` is added to the `supabase_realtime` publication: two
agents on the same pipeline should see each other's ticks without a refresh,
which is the entire point of a shared checklist.

**This migration has not been applied.** Per the project's workflow, it is
handed over and Gabriel applies it from Cursor.

---

## Where it appears

| Surface                  | What it shows                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Deal sheet (`deal-form`) | The full checklist for the deal's stage — tick, untick, and for admins an inline editor         |
| Deal card (`deal-card`)  | `2/4` with a checklist icon; amber while incomplete, quiet when done; absent when there is none |
| Board (`pipeline-board`) | Loads counts for every visible deal in two queries, not one per card                            |

### The checklist is keyed to the deal's persisted stage

Not to the stage select in the form. Changing the select is an _intention_, not
a move; ticking a step for a stage the deal has not reached would record work
against the wrong column.

### Editing has no home of its own

No settings section, no dialog off the pipeline manager. An admin opens a deal,
sees the checklist that deal is being asked to work through, and edits **that**.
A separate editor would have been a third place to go, and the request that
started this whole pass was for fewer places, not more.

The one thing that needed care: a stage with no playbook renders **nothing** for
an agent — a section header over an empty list teaches you that this part of the
form is usually empty, and then you stop looking at it on the stages where it is
not. But a feature reachable only from a stage that already uses it can never be
started, so an admin sees a single dashed line: _Criar playbook para {stage}_.

### Saving diffs rather than replacing

Deleting a step cascades to every tick of it. A delete-all-then-insert-all save
would quietly erase the completion history of every deal in the stage each time
somebody fixed a typo in a step title.

---

## What a deal's counter means

`done` counts only the steps of the stage the deal is in **now**. Progress rows
survive a stage move — they are per step, and a step belongs to the stage it was
written for — so a deal that finished all four steps of _Em Aberto_ and moved to
_Follow-up_ shows `0/3`.

That is the truth about what is left to do, which is the only question a board
is asking. The history is still in the table for anyone who wants to report on
it later.
