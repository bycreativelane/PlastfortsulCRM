'use client';

import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Briefcase,
  Cake,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Loader2,
  Radio,
  RefreshCw,
  Zap,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { formatCurrency } from '@/lib/currency';
import { cn } from '@/lib/utils';
import {
  firstDayOfWeek,
  fromISO,
  isSameDay,
  monthMatrix,
  startOfMonth,
  toISO,
} from '@/lib/calendar';
import {
  AGENDA_KINDS,
  AGENDA_TONE,
  countByKind,
  groupByDay,
  isoInDays,
  loadAgenda,
  rescheduleItem,
  tonesOf,
  type AgendaItem,
  type AgendaKind,
  type AgendaTone,
} from '@/lib/dashboard/agenda';
import { MonthGrid, MonthNav } from '@/components/ui/month-grid';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Panel,
  PanelActions,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * The month, and what is on it.
 *
 * The dashboard's two existing panels are both about NOW — the queue is what
 * is waiting, the machine log is what already ran. This is the third tense,
 * and the only place in the product where the follow-up the engine will send
 * on Thursday, the deal somebody promised to close on the 30th, and the
 * customer who asked to be called back in September appear side by side.
 * Every one of those dates existed already; none of them was visible from
 * anywhere but inside the record that carried it.
 *
 * TWO HALVES, ONE PANEL. A grid that says WHICH days have something, and a
 * list that says WHAT. They are one box rather than two panels because the
 * page's own comment is emphatic about seams that almost line up: two
 * separate panels would have to agree with the tile grid above them at every
 * breakpoint, and a single box with an internal divider is under no such
 * obligation.
 *
 * The grid is the same `MonthGrid` the date field opens, at the larger size —
 * one calendar in the product, drawn twice, so somebody who has picked a
 * close date already knows how to read this.
 *
 * WHAT "CONTROL" MEANS HERE. A day's item can be opened where it lives, and
 * the two dates a person owns — a deal's expected close and a customer's next
 * purchase — can be moved to another day without leaving the page. Nothing
 * else can, and that is the doctrine rather than a gap: the automation queue
 * belongs to the engine, a campaign has gone out, a birthday is a fact. A
 * control that pretended to move those would be the interface lying about who
 * is in charge of what.
 */

const KIND_ICON: Record<
  AgendaKind,
  React.ComponentType<{ className?: string }>
> = {
  deal: Briefcase,
  repurchase: RefreshCw,
  occurrence: AlertTriangle,
  automation: Zap,
  broadcast: Radio,
  birthday: Cake,
};

/**
 * The dot on a day cell, and the ink of an active filter chip.
 *
 * Neutral is the same grey as auto at 40%, and that is measured rather than
 * chosen: `--auto-500` and `--muted-foreground` resolve to the identical
 * lab value in this palette, so a birthday and a scheduled automation were
 * drawing two indistinguishable dots on the same cell. Weight is the only
 * channel left once the hue is spent, and it is the right one — a birthday
 * is the quietest thing on this calendar.
 */
const TONE_DOT: Record<AgendaTone, string> = {
  human: 'bg-human',
  auto: 'bg-auto',
  danger: 'bg-danger',
  neutral: 'bg-muted-foreground/40',
};

const TONE_CHIP: Record<AgendaTone, string> = {
  human: 'bg-human-soft text-human-ink',
  auto: 'bg-auto-soft text-auto-ink',
  danger: 'bg-danger-soft text-danger-ink',
  neutral: 'bg-muted text-muted-foreground',
};

export function AgendaCalendar() {
  const t = useTranslations('Today.agenda');
  const locale = useLocale();
  const { defaultCurrency } = useAuth();
  const canEdit = useCan('send-messages');

  const [month, setMonth] = React.useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = React.useState(() => new Date());
  const [items, setItems] = React.useState<AgendaItem[] | null>(null);
  const [hidden, setHidden] = React.useState<Set<AgendaKind>>(
    () => new Set<AgendaKind>()
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  // Bumped after a write, to re-run the load without re-deriving the range.
  const [reloads, setReloads] = React.useState(0);

  const weekStart = React.useMemo(() => firstDayOfWeek(locale), [locale]);

  // The window is exactly what the grid draws — six weeks, including the days
  // that spill in from the neighbouring months. Loading only the month itself
  // would leave those cells blank while showing them as ordinary days.
  const range = React.useMemo(() => {
    const grid = monthMatrix(month, weekStart);
    return { from: grid[0], to: grid[grid.length - 1] };
  }, [month, weekStart]);

  React.useEffect(() => {
    const db = createClient();
    let cancelled = false;

    setItems(null);
    loadAgenda(db, range.from, range.to).then((data) => {
      if (!cancelled) setItems(data);
    });

    return () => {
      cancelled = true;
    };
  }, [range, reloads]);

  const visible = React.useMemo(
    () => (items ?? []).filter((item) => !hidden.has(item.kind)),
    [items, hidden]
  );
  const byDay = React.useMemo(() => groupByDay(visible), [visible]);
  const counts = React.useMemo(() => countByKind(items ?? []), [items]);

  const selectedKey = toISO(selected);
  const dayItems = byDay.get(selectedKey) ?? [];

  const longDate = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(selected),
    [locale, selected]
  );

  const today = new Date();
  const onToday =
    isSameDay(selected, today) &&
    month.getMonth() === today.getMonth() &&
    month.getFullYear() === today.getFullYear();

  function goToday() {
    setMonth(startOfMonth(today));
    setSelected(new Date());
  }

  /**
   * Keep the selection inside the month being looked at. Steering to
   * September and reading August's list is the calendar disagreeing with
   * itself; landing on the 1st (or on today, when today is in view) is what
   * every other calendar does.
   */
  function changeMonth(next: Date) {
    setMonth(next);
    setSelected((current) => {
      if (
        current.getMonth() === next.getMonth() &&
        current.getFullYear() === next.getFullYear()
      ) {
        return current;
      }
      const now = new Date();
      if (
        now.getMonth() === next.getMonth() &&
        now.getFullYear() === next.getFullYear()
      ) {
        return now;
      }
      return new Date(next.getFullYear(), next.getMonth(), 1);
    });
  }

  function toggleKind(kind: AgendaKind) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  async function reschedule(item: AgendaItem, iso: string | null) {
    setBusy(item.id);
    const ok = await rescheduleItem(createClient(), item, iso);
    setBusy(null);

    if (!ok) {
      toast.error(t('rescheduleFailed'));
      return;
    }
    toast.success(iso ? t('rescheduled') : t('rescheduleCleared'));
    setReloads((n) => n + 1);
  }

  return (
    <Panel>
      <PanelHeader>
        <span className="bg-muted text-primary grid size-7 shrink-0 place-items-center rounded-md">
          <CalendarDays className="size-3.5" />
        </span>
        <div className="min-w-0">
          <PanelTitle>{t('title')}</PanelTitle>
          <PanelSub>{t('subtitle')}</PanelSub>
        </div>
        <PanelActions>
          <button
            type="button"
            onClick={goToday}
            disabled={onToday}
            className="border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
          >
            {t('today')}
          </button>
        </PanelActions>
      </PanelHeader>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* ------------------------------------------------ The month */}
        <div className="border-border border-b p-3 xl:border-r xl:border-b-0">
          <MonthNav
            month={month}
            onMonthChange={changeMonth}
            className="mb-2"
          />

          <MonthGrid
            size="md"
            month={month}
            selected={selected}
            onSelect={setSelected}
            dayDescription={(day) => {
              const count = byDay.get(day.iso)?.length ?? 0;
              return count ? t('itemCount', { count }) : undefined;
            }}
            marker={(day) => {
              const list = byDay.get(day.iso);
              if (!list?.length) return null;
              return (
                <span className="flex items-center gap-0.5" aria-hidden>
                  {tonesOf(list).map((tone) => (
                    <span
                      key={tone}
                      className={cn(
                        'size-1 rounded-full',
                        // On the selected cell the tones would sit on the
                        // primary fill, where amber-on-blue is the one
                        // combination in the palette that disappears.
                        day.selected
                          ? 'bg-primary-foreground/80'
                          : TONE_DOT[tone]
                      )}
                    />
                  ))}
                </span>
              );
            }}
          />

          <KindFilters
            counts={counts}
            hidden={hidden}
            onToggle={toggleKind}
            loading={items === null}
          />
        </div>

        {/* --------------------------------------------- The day's list */}
        {/* `flex flex-col` so the empty state below can take the leftover
            height. The calendar beside this column is ~300px tall and this
            one was only as tall as its own content, so "Nada marcado neste
            dia" sat pinned under the date while the grid ran on for another
            200px — a centred panel that was not centred in anything. */}
        <div className="flex min-w-0 flex-col">
          <div className="border-border flex items-center gap-2 border-b px-4 py-2.5">
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold first-letter:uppercase">
              {longDate}
            </span>
            {items !== null && dayItems.length > 0 && (
              <StatusBadge variant="neutral">
                {t('itemCount', { count: dayItems.length })}
              </StatusBadge>
            )}
          </div>

          {items === null ? (
            <DaySkeleton />
          ) : dayItems.length === 0 ? (
            // `flex-1` is the other half: StatePanel already centres itself
            // on both axes, it just had no height to centre within.
            <StatePanel
              className="flex-1"
              icon={CalendarDays}
              title={t('dayEmpty')}
              description={t('dayEmptyHint')}
            />
          ) : (
            <ul>
              {dayItems.map((item) => (
                <li key={item.id}>
                  <AgendaRow
                    item={item}
                    currency={defaultCurrency}
                    canEdit={canEdit}
                    busy={busy === item.id}
                    onReschedule={(iso) => reschedule(item, iso)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * One dated thing.
 *
 * The row is a link with a control beside it rather than a link CONTAINING
 * one: an anchor may not wrap a button, and the reschedule popover is a
 * button. So the two are siblings, and the anchor takes the remaining width.
 */
function AgendaRow({
  item,
  currency,
  canEdit,
  busy,
  onReschedule,
}: {
  item: AgendaItem;
  currency: string;
  canEdit: boolean;
  busy: boolean;
  onReschedule: (iso: string | null) => void;
}) {
  const t = useTranslations('Today.agenda');
  const tone = AGENDA_TONE[item.kind];
  const Icon = KIND_ICON[item.kind];

  const meta = [
    t(`kind.${item.kind}`),
    item.contact,
    item.value ? formatCurrency(item.value, item.currency || currency) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <>
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md',
          TONE_CHIP[tone]
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-foreground truncate text-sm font-semibold">
            {item.title || t(`kind.${item.kind}`)}
          </span>
          {item.time && (
            <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
              {item.time}
            </span>
          )}
        </span>
        <span className="text-secondary-foreground mt-0.5 block truncate text-xs">
          {meta}
        </span>
      </span>
    </>
  );

  return (
    <div className="border-border hover:bg-card-2 flex items-center gap-2 border-b px-4 py-2.5 last:border-b-0">
      {item.href ? (
        <Link
          href={item.href}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          {body}
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}

      {item.reschedule && canEdit && (
        <ReschedulePopover item={item} busy={busy} onPick={onReschedule} />
      )}
    </div>
  );
}

/**
 * Move this one to another day.
 *
 * Three presets and a calendar, in that order, copying the shape the Compra
 * futura dialog already established — most reschedules are "not this week",
 * and making somebody count days on a grid to say that is the slow way round.
 * The grid underneath is there for the ones that are a real date.
 */
function ReschedulePopover({
  item,
  busy,
  onPick,
}: {
  item: AgendaItem;
  busy: boolean;
  onPick: (iso: string | null) => void;
}) {
  const t = useTranslations('Today.agenda');
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(() =>
    startOfMonth(fromISO(item.day) ?? new Date())
  );

  const presets: Array<{ label: string; iso: string }> = [
    { label: t('presetToday'), iso: isoInDays(0) },
    { label: t('presetTomorrow'), iso: isoInDays(1) },
    { label: t('presetWeek'), iso: isoInDays(7) },
  ];

  function pick(iso: string | null) {
    setOpen(false);
    onPick(iso);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={busy}
        aria-label={t('reschedule')}
        title={t('reschedule')}
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 grid size-7 shrink-0 place-items-center rounded-md transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:size-11"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CalendarClock className="size-3.5" />
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-auto gap-2 p-2">
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => pick(preset.iso)}
              className={cn(
                'h-7 rounded-md border px-2.5 text-xs font-semibold transition-colors',
                item.day === preset.iso
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <MonthNav month={month} onMonthChange={setMonth} />
        <MonthGrid
          month={month}
          selected={fromISO(item.day)}
          onSelect={(date) => pick(toISO(date))}
        />

        <div className="border-border/70 flex items-center justify-between border-t pt-1.5">
          <button
            type="button"
            onClick={() => pick(null)}
            className="text-muted-foreground hover:text-foreground text-2xs rounded-md px-1.5 py-0.5 font-medium transition-colors"
          >
            {t('clearDate')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * What is on this month, and what to stop drawing.
 *
 * A kind with nothing in the window has no chip: there is nothing to filter,
 * and six permanent chips under a 320px grid is three rows of controls for a
 * calendar that might be empty. The count is the second job — it reads as a
 * summary of the month before anybody clicks anything.
 */
function KindFilters({
  counts,
  hidden,
  onToggle,
  loading,
}: {
  counts: Record<AgendaKind, number>;
  hidden: Set<AgendaKind>;
  onToggle: (kind: AgendaKind) => void;
  loading: boolean;
}) {
  const t = useTranslations('Today.agenda');
  const present = AGENDA_KINDS.filter((kind) => counts[kind] > 0);

  if (loading) {
    return (
      <div className="border-border mt-3 flex flex-wrap gap-1.5 border-t pt-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-24 rounded-md" />
        ))}
      </div>
    );
  }

  if (present.length === 0) return null;

  return (
    <div className="border-border mt-3 flex flex-wrap gap-1.5 border-t pt-3">
      {present.map((kind) => {
        const on = !hidden.has(kind);
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onToggle(kind)}
            aria-pressed={on}
            className={cn(
              'text-2xs inline-flex h-6 items-center gap-1.5 rounded-md border px-1.5 font-semibold transition-colors',
              on
                ? 'border-border bg-card text-secondary-foreground hover:bg-muted'
                : // Off is a state, not a disabled control: it stays legible
                  // and clickable, it just stops claiming the day cells.
                  'border-border text-muted-foreground hover:bg-muted border-dashed bg-transparent'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-1.5 rounded-full',
                on ? TONE_DOT[AGENDA_TONE[kind]] : 'bg-muted-foreground/40'
              )}
            />
            {t(`kindShort.${kind}`)}
            <span className="tabular-nums">{counts[kind]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Row: px-4 py-2.5 + (20 title + 2 + 16 subtitle) = 66px. */
function DaySkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="border-border flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
        >
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-44 max-w-full" />
            <Skeleton className="mt-0.5 h-4 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
