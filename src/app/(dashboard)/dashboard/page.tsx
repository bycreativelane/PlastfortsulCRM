'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  UserPlus,
  Zap,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { loadPipelineDonut } from '@/lib/dashboard/queries';
import type { PipelineDonutData } from '@/lib/dashboard/types';
import {
  ACTION_QUEUE_PAGE_SIZE,
  STALE_DEAL_DAYS,
  loadActionQueue,
  loadHumanQueue,
  loadMachineLog,
  type ActionRow,
  type HumanQueue,
  type MachineLogRow,
} from '@/lib/dashboard/today';

import { AgendaCalendar } from '@/components/dashboard/agenda-calendar';
import { AttentionRow } from '@/components/dashboard/attention-row';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { Skeleton } from '@/components/dashboard/skeleton';
import { PageActions } from '@/components/layout/page-actions';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { PipelineFunnel } from '@/components/dashboard/pipeline-funnel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { dateLocale } from '@/lib/i18n/dates';

/**
 * The landing page: what has to happen today, and what already happened
 * without anybody.
 *
 * Not a metrics dashboard — those moved to /reports, behind an admin check.
 * The two were fighting for the same screen and the wrong one was winning: an
 * agent opening the app at 8am does not need last month's conversion rate, and
 * an owner reading conversion does not want it wedged between unread counts.
 *
 * The page is one argument, made twice:
 *
 *   PRECISA DE VOCÊ (amber)  — states a person has to resolve. Never a task
 *                              the CRM could have done itself. If a follow-up
 *                              is due, the CRM sends it; it does not ask you
 *                              to.
 *   O CRM FEZ HOJE (grey)    — what the automations produced. Informational,
 *                              deliberately quiet, and never actionable.
 *
 * If the top half is empty, the day is genuinely clear. That is the promise,
 * and it only holds because nothing decorative is allowed into it.
 *
 * ------------------------------------------------------------------
 * THE ORDER, AND WHY THE AGENDA MOVED UP
 * ------------------------------------------------------------------
 *
 *   Atalhos
 *   Precisa de você + O CRM fez hoje  ·  O que vem por aí
 *   Fila de ações humanas             ·  Valor no funil
 *
 * The agenda used to be last, under a ~420px queue, which put it off the
 * first screen on every desktop and most of the way down a second one on
 * a phone. "O que vem por aí" is a summary — a month at a glance and the
 * day's markers — and summaries belong with summaries. It now sits with
 * the tile row, and the two together answer "what does today look like"
 * before the page hands you the list you actually work through.
 *
 * The queue keeps the bottom on purpose. It is the only block here you
 * SCROLL INSIDE, and a block with its own scroller is the wrong thing to
 * put above one the page scrolls past.
 *
 * And the two halves of the argument are in one column again. "O CRM
 * fez hoje" had drifted into the side column of the queue, where it was
 * a widget rather than the counterpart to anything — the reader had to
 * hold "what needs me" in mind across two sections to notice that the
 * grey list was the answer to it.
 */
export default function DashboardPage() {
  const t = useTranslations('Today');
  const { profile, accountRole, defaultCurrency } = useAuth();

  const [queue, setQueue] = useState<HumanQueue | null>(null);
  const [rows, setRows] = useState<ActionRow[] | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queuePage, setQueuePage] = useState(0);
  const [machine, setMachine] = useState<MachineLogRow[] | null>(null);
  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null);

  const untitled = t('untitledAutomation');

  useEffect(() => {
    const db = createClient();
    let cancelled = false;

    loadHumanQueue(db).then((d) => !cancelled && setQueue(d));
    loadMachineLog(db, untitled).then((d) => !cancelled && setMachine(d));
    loadPipelineDonut(db).then((d) => !cancelled && setPipeline(d));

    return () => {
      cancelled = true;
    };
  }, [untitled]);

  const queuePages = Math.max(
    1,
    Math.ceil(queueTotal / ACTION_QUEUE_PAGE_SIZE)
  );

  /**
   * The page actually shown, clamped during render rather than corrected in
   * an effect. Somebody answering the last conversation on page three leaves
   * the pager pointing past the end of a queue that just got shorter; deriving
   * it means the fetch below re-runs with the right page instead of asking for
   * an empty one and then asking again.
   */
  const page = Math.min(queuePage, queuePages - 1);

  // Its own effect: the queue is the one panel here that reloads without the
  // page doing so, and re-running the other three on every page turn would
  // refetch the funnel to show conversations nine to sixteen.
  useEffect(() => {
    const db = createClient();
    let cancelled = false;

    loadActionQueue(db, page).then((result) => {
      if (cancelled) return;
      setRows(result.rows);
      setQueueTotal(result.total);
    });

    return () => {
      cancelled = true;
    };
  }, [page]);

  const firstName = profile?.full_name?.split(/\s+/)[0];
  const machineTotal = (machine ?? []).reduce((n, r) => n + r.count, 0);

  return (
    <div className="space-y-6">
      {/* The bar takes ONE compact, page-relevant control. The dashboard is
          the operational read; the analytical one is a click away, and that
          is the only thing this page has to offer a toolbar. */}
      <PageActions>
        {canEditSettings(accountRole ?? 'viewer') && (
          <Link
            href="/reports"
            className="border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors [@media(pointer:coarse)]:min-h-11"
          >
            <BarChart3 className="size-3.5" />
            {t('viewReports')}
          </Link>
        )}
      </PageActions>

      <PageHeader
        title={
          firstName ? t('greetingNamed', { name: firstName }) : t('greeting')
        }
        description={t('subtitle')}
      />

      <QuickActions />

      {/* ----------------------------- Precisa de você · O que vem por aí */}
      {/* SIDE BY SIDE, on the same four columns as the queue below.

          These were two full-width bands stacked, and between them they
          spent about 320px of the first screen on four numbers and a
          calendar — before the page got to the list you actually work
          through. Beside each other they cost one band, and the seam
          between them lands on the same vertical as the seam in the
          queue row underneath.

          The split is 1/3 and not 2/2 because the agenda cannot take
          less: it lays out as `[20rem calendar | 1fr day]` and a half
          page would leave the day pane narrower than the calendar
          beside it. A quarter is also all the states need — they are
          four short rows now, not four cards. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        {/* A COLUMN, so the two halves can end level with the agenda.
            The grid stretches this cell to the row height — the agenda's
            460px — but the content inside it summed 426, so the machine
            panel's bottom edge floated 34px above the agenda's and the
            row ended on two different lines.
            As a flex column with the last panel growing, the bottom
            edges meet. The slack goes inside that panel, under its rows,
            which is where empty space in a list belongs. */}
        <section className="flex min-w-0 flex-col xl:col-span-1">
          <SectionTitle tone="human">
            <UserPlus />
            {t('needsYou')}
          </SectionTitle>

          {/* ONE PANEL, FOUR ROWS — not four cards in a grid.
              Four bordered cards is what you build when each one is a
              subject. These are four readings of one question ("is
              anything waiting on me?"), read down rather than across,
              and in a quarter-width column a card each would give the
              caption about 160px and wrap every one of them to three
              lines.

              AMBER ONLY WHEN THE NUMBER IS NOT ZERO. Three of these
              were `tone="human"` unconditionally, so on a morning
              reading 0 · 5 · 0 · 0 three rows wore the one colour this
              system reserves for "a person must act" while asking for
              nothing — and the row that DID need somebody looked
              exactly like the three that did not.

              The tint is on the ROW now, not on a 154px card, which is
              the whole "menos aparente": same signal, a fifth of the
              area carrying it. */}
          <Panel className="divide-border divide-y overflow-hidden">
            <AttentionRow
              href="/inbox"
              icon={<Inbox />}
              tone={queue?.unread ? 'human' : 'auto'}
              value={queue?.unread}
              label={t('tileUnread')}
            />
            <AttentionRow
              href="/inbox"
              icon={<UserPlus />}
              tone={queue?.unassigned ? 'human' : 'auto'}
              value={queue?.unassigned}
              label={t('tileUnassigned')}
            />
            <AttentionRow
              href="/pipelines"
              icon={<Clock />}
              tone={queue?.stalled ? 'human' : 'auto'}
              value={queue?.stalled}
              label={t('tileStalled', { days: STALE_DEAL_DAYS })}
            />
            <AttentionRow
              href="/automations"
              icon={<AlertTriangle />}
              // Red, not amber: this one did not merely need a person,
              // it broke. The distinction is the difference between
              // "your turn" and "something is wrong".
              tone={queue?.failed ? 'danger' : 'auto'}
              value={queue?.failed}
              label={t('tileFailed')}
            />
          </Panel>

          {/* ----------------------------------- O CRM fez hoje */}
          {/* THE OTHER HALF OF THE PAGE'S ARGUMENT, BACK BESIDE THE
              FIRST ONE.

              The doctrine at the top of this file says the page is one
              argument made twice — what needs a person, and what the
              machine did without one — and then the second half was
              living in the side column of the queue, two sections down,
              where nobody read it as the counterpart to anything.

              It also happens to be the right size for the hole. Measured:
              the attention panel is 199px and the agenda beside it is
              460px, so the quarter-width column had ~260px of nothing
              under it. This block is 177px with three rows in it, and
              taller when it is empty. The two halves are together and
              the row no longer has a hole in it, and those are the same
              fix. */}
          {/* `mt-6` — the gap the page puts between two sections, applied
              inside a column that holds two of them. Without it the
              heading sat flush against the bottom edge of the panel
              above and read as that panel's footer. */}
          <SectionTitle tone="auto" className="mt-6 shrink-0">
            <Zap />
            {t('machineTitle')}
          </SectionTitle>

          <Panel className="flex min-h-0 flex-1 flex-col">
            {/* NO TINT, NO ICON, NO TITLE.
                This header used to carry all three, and once the section
                heading above it existed they were said twice within
                40px of each other — the bolt, the words "O CRM fez
                hoje", and an `bg-auto-soft` wash that was the last
                tinted surface left on the page after the hero, the
                tiles and the attention rows gave theirs up.
                What is left is the only sentence that is NOT in the
                heading, and it is the one that matters: this is a
                report, not a list of things to do. */}
            <PanelHeader>
              <PanelSub>{t('machineSub')}</PanelSub>
            </PanelHeader>
            <PanelBody flush className="min-h-0 flex-1">
              {machine === null ? (
                <MachineSkeleton />
              ) : machine.length === 0 ? (
                <StatePanel icon={Zap} title={t('machineEmpty')} />
              ) : (
                machine.map((row) => (
                  <div
                    key={row.label}
                    className="border-border flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
                  >
                    <span className="min-w-5 text-base font-bold tabular-nums">
                      {row.count}
                    </span>
                    <span className="text-secondary-foreground min-w-0 flex-1 truncate text-sm">
                      {row.label}
                    </span>
                  </div>
                ))
              )}
            </PanelBody>
          </Panel>
        </section>

        <section className="min-w-0 xl:col-span-3">
          <SectionTitle>
            <CalendarDays />
            {t('agendaSection')}
          </SectionTitle>

          <AgendaCalendar />
        </section>
      </div>

      {/* Four columns, same `gap-4`, same breakpoint as the tile row —
          so the seam between the queue and the side column lands exactly on
          the seam between the third and fourth tile. The agenda sits between
          the two now and the alignment survives it: both grids are four
          columns at the same gap on the same page width, so the vertical
          runs straight through the block in the middle.

          It used to be `minmax(0,1fr) 340px`. Solve for the width where that
          seam coincides with the tiles': 3·(W−48)/4 + 48 = W − 356 gives
          W = 1408px, and nowhere else. At every other width the panel ended
          somewhere inside the fourth tile — a vertical line that almost
          aligns, which reads worse than one that plainly does not. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        {/* --------------------------------- Fila de ações humanas */}
        {/* It FILLS the row, and scrolls inside.

            `self-start` meant a queue with two rows in it ended some 300px
            above the bottom of the side column beside it — a hole three tiles
            wide in the middle of the page, and a page whose height moved with
            however many conversations happened to be waiting.

            Stretching alone does not fix that, because a grid row is as tall
            as its tallest item's CONTENT: a panel that grows with its list
            grows the row with it, and then fills it, and never scrolls. So the
            wrapper is the grid item — it takes the span and the floor, and its
            height comes from the side column — while the panel is taken out of
            flow inside it (`absolute inset-0`) and contributes nothing to the
            row's size. What is left over inside goes to the scroller.

            Both halves are `xl:` only. Stacked on a phone there is no side
            column to match, and a tall empty box is just a tall empty box. */}
        <div className="xl:relative xl:col-span-3 xl:min-h-104">
          <Panel className="flex flex-col xl:absolute xl:inset-0">
            <PanelHeader>
              <div className="min-w-0">
                <PanelTitle>{t('queueTitle')}</PanelTitle>
                <PanelSub>{t('queueSub')}</PanelSub>
              </div>
              <PanelActions>
                <Link
                  href="/inbox"
                  className="border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition-colors [@media(pointer:coarse)]:min-h-11"
                >
                  {t('openInbox')}
                  <ChevronRight className="size-3" />
                </Link>
              </PanelActions>
            </PanelHeader>

            <ScrollArea className="min-h-0 flex-1">
              {rows === null ? (
                <QueueSkeleton />
              ) : rows.length === 0 ? (
                // h-full so "nothing waiting" sits in the middle of the panel
                // rather than clinging to the top of a tall empty one.
                <StatePanel
                  icon={CheckCheck}
                  title={t('queueEmpty')}
                  className="h-full"
                />
              ) : (
                rows.map((row) => (
                  <Link
                    key={row.conversationId}
                    href={`/inbox?c=${row.conversationId}`}
                    className="border-border hover:bg-card-2 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground truncate text-sm font-semibold">
                          {row.name}
                        </span>
                        {row.company && (
                          <span className="text-muted-foreground truncate text-xs">
                            · {row.company}
                          </span>
                        )}
                        {row.unassigned ? (
                          <StatusBadge variant="human">
                            {t('badgeUnassigned')}
                          </StatusBadge>
                        ) : (
                          <StatusBadge variant="neutral">
                            {t('badgeUnread', { count: row.unread })}
                          </StatusBadge>
                        )}
                      </div>
                      <p className="text-secondary-foreground mt-1 truncate text-xs">
                        {row.lastMessage || t('noMessage')}
                      </p>
                    </div>
                    <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
                      {row.lastMessageAt
                        ? formatDistanceToNow(new Date(row.lastMessageAt), {
                            addSuffix: false,
                            locale: dateLocale,
                          })
                        : ''}
                    </span>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                ))
              )}
            </ScrollArea>

            {queuePages > 1 && (
              <QueuePager
                page={page}
                pages={queuePages}
                total={queueTotal}
                onPage={setQueuePage}
              />
            )}
          </Panel>
        </div>

        {/* The side column holds ONE panel now — "O CRM fez hoje" moved
            up to sit beside the states it is the counterpart to. The
            flex wrapper stayed anyway: `self-start` is what keeps the
            funnel its own height instead of stretching to the queue's,
            and a second panel landing here later needs the gap. */}
        <div className="flex flex-col gap-4 self-start xl:col-span-1">
          {/* ------------------------------------------ Mini funil */}
          {/* THE SAME COMPONENT /relatórios USES, at a smaller density.
              It was forty lines of its own funnel here, and the two
              disagreed about scale, colour, bar height, money format and
              field order — five decisions, five different answers, on
              one click's distance. The one that mattered was scale: this
              copy divided each stage by the pipeline TOTAL, which is
              precisely what the note at the top of `PipelineFunnel`
              argues against, and it drew Novo Lead at 6% of the width
              while the report next door drew it at 17%. */}
          <PipelineFunnel
            data={pipeline}
            loading={pipeline === null}
            currency={defaultCurrency}
            density="compact"
            showTotal
          />
        </div>
      </div>

      {machineTotal > 0 && (
        <p className="text-muted-foreground text-2xs text-center">
          {t('machineFootnote', { count: machineTotal })}
        </p>
      )}
    </div>
  );
}

/**
 * The three loading states below replace a centred "Carregando…" line.
 *
 * That line was 64px, 56px and 34px tall in three panels whose resolved
 * content is 4×64px, 3×44px and 3×36px — so the landing page drew three
 * short boxes and then, on resolve, grew each of them by a different
 * amount and pushed everything under them down. Three separate shifts on
 * the first screen of a workday.
 *
 * Every measurement here is copied from the row it stands in for, in the
 * same order. Change one there, change it here — a skeleton cannot
 * measure itself, and the only defence is that the arithmetic is written
 * down next to it.
 */

/** Queue row: px-4 py-3 + (20 title + 4 + 16 subtitle) = 64px. */
function QueueSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="border-border flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-40 max-w-full" />
            <Skeleton className="mt-1 h-4 w-3/5" />
          </div>
          <Skeleton className="h-4 w-8 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Machine row: px-4 py-2.5 + a 24px line box = 44px. */
function MachineSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="border-border flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-6 w-5 shrink-0" />
          <Skeleton className="h-4 w-32 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/** Funnel stage: 16px label + 4 + a 6px track, 10px apart. */

/**
 * Page N of M, and the range it covers.
 *
 * Deliberately a pager and not a "load more". The queue is a list of STATES,
 * and the number of them is information: with a button, somebody reads eight
 * rows and never learns whether the ninth exists — the panel looks the same
 * with nine waiting and with ninety. The range and the total say how much is
 * behind the panel; the arrows are how you get there.
 *
 * It only renders when there is a second page, so a quiet queue keeps its
 * clean bottom edge.
 */
function QueuePager({
  page,
  pages,
  total,
  onPage,
}: {
  /** Zero-based. */
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('Today');
  const first = page * ACTION_QUEUE_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * ACTION_QUEUE_PAGE_SIZE);

  const arrow =
    'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 grid size-6 place-items-center rounded-md transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:size-11';

  return (
    <div className="border-border flex items-center justify-between gap-2 border-t px-4 py-2">
      <span className="text-muted-foreground text-2xs tabular-nums">
        {t('queueRange', { from: first, to: last, total })}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t('queuePrev')}
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className={arrow}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-secondary-foreground text-2xs px-1 font-semibold tabular-nums">
          {t('queuePage', { page: page + 1, pages })}
        </span>
        <button
          type="button"
          aria-label={t('queueNext')}
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          className={arrow}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
