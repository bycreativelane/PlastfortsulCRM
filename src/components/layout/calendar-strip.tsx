'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Briefcase,
  Cake,
  ChevronLeft,
  ChevronRight,
  Radio,
  RefreshCw,
  Zap,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import {
  addDays,
  firstDayOfWeek,
  isSameDay,
  toISO,
  weekdayLabels,
} from '@/lib/calendar';
import { formatMonthDay } from '@/lib/i18n/dates';
import {
  AGENDA_TONE,
  groupByDay,
  loadAgenda,
  tonesOf,
  type AgendaItem,
  type AgendaKind,
  type AgendaTone,
} from '@/lib/dashboard/agenda';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * The week, in the bar, beside the search.
 *
 * The agenda panel on the dashboard already knows every dated thing in this
 * product — a deal closing, a repurchase due, an open occurrence, a
 * scheduled automation, a campaign, a birthday. What it could not do is
 * answer "what is this week" from anywhere else, and anywhere else is where
 * people spend the day: the inbox, the board, a contact.
 *
 * SEVEN DAYS, NOT A CHIP. This started as a date chip that opened a week,
 * on the reasoning that the bar had no width to spare. It had: `GlobalSearch`
 * is capped at `max-w-sm` inside a `flex-1` column, so everything to the
 * right of the search field was empty at every width above `lg`. A row of
 * dates you can read without clicking is worth more than one you can only
 * reach through a control — the whole point is the glance.
 *
 * The dots are the same tones the dashboard's month grid uses, so a day
 * reads the same in both places. Clicking one opens what is on it.
 *
 * ONE WEEK PER FETCH, refetched when the cursor moves — proportional to
 * what is on screen, unlike the panel's month.
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

/** Same palette as the dashboard's calendar, deliberately — see its note. */
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

/** Start of the week `date` falls in, for this locale's first day. */
function startOfWeek(date: Date, weekStart: number): Date {
  const lead = (date.getDay() - weekStart + 7) % 7;
  const out = addDays(date, -lead);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function CalendarStrip({ className }: { className?: string }) {
  const t = useTranslations('Today.agenda');
  const tStrip = useTranslations('Header.calendar');
  const locale = useLocale();
  const { accountId, defaultCurrency } = useAuth();

  const weekStart = useMemo(() => firstDayOfWeek(locale), [locale]);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [cursor, setCursor] = useState<Date>(() =>
    startOfWeek(today, weekStart)
  );
  const [selected, setSelected] = useState<Date>(today);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AgendaItem[]>([]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(cursor, i)),
    [cursor]
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const from = days[0];
      const to = new Date(days[6]);
      to.setHours(23, 59, 59, 999);
      // `loadAgenda` swallows a failing source rather than throwing, so a
      // missing migration costs that source's rows and nothing else.
      const loaded = await loadAgenda(createClient(), from, to);
      if (!cancelled) setItems(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, days]);

  const byDay = useMemo(() => groupByDay(items), [items]);
  const selectedItems = byDay.get(toISO(selected)) ?? [];
  const headings = useMemo(
    () => weekdayLabels(locale, weekStart),
    [locale, weekStart]
  );
  const onThisWeek = isSameDay(cursor, startOfWeek(today, weekStart));

  /**
   * A day click SELECTS and opens — it never toggles.
   *
   * The strip is the popover's trigger, so a bare click would bubble and
   * flip it shut: pick Monday, then pick Tuesday, and the panel you were
   * reading closes on the second click. Stopping the event leaves `open`
   * entirely to us, and click-outside still closes it the normal way.
   */
  const pick = useCallback((day: Date, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelected(day);
    setOpen(true);
  }, []);

  const shiftWeek = useCallback((by: number, event: React.MouseEvent) => {
    event.stopPropagation();
    setCursor((c) => addDays(c, by));
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<div />}
        className={cn('flex items-center gap-0.5', className)}
      >
        <button
          type="button"
          onClick={(e) => shiftWeek(-7, e)}
          aria-label={tStrip('prevWeek')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md transition-colors"
        >
          <ChevronLeft className="size-3.5" />
        </button>

        {days.map((day, i) => {
          const dayItems = byDay.get(toISO(day)) ?? [];
          const isToday = isSameDay(day, today);
          const isSelected = open && isSameDay(day, selected);
          return (
            <button
              key={toISO(day)}
              type="button"
              onClick={(e) => pick(day, e)}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${formatMonthDay(day)} — ${
                dayItems.length > 0
                  ? t('itemCount', { count: dayItems.length })
                  : t('dayEmpty')
              }`}
              className={cn(
                'flex w-8 shrink-0 flex-col items-center gap-px rounded-md py-1 transition-colors',
                isSelected
                  ? 'bg-primary text-white'
                  : isToday
                    ? 'bg-primary-soft text-primary'
                    : 'text-secondary-foreground hover:bg-muted'
              )}
            >
              <span className="text-3xs leading-none uppercase opacity-70">
                {headings[i]}
              </span>
              <span
                className={cn(
                  'text-xs leading-tight tabular-nums',
                  isToday || isSelected ? 'font-bold' : 'font-medium'
                )}
              >
                {day.getDate()}
              </span>
              {/* A fixed-height row whether or not there are dots, so the
                  seven cells never change height between weeks. */}
              <span className="flex h-1 items-center gap-px">
                {tonesOf(dayItems)
                  .slice(0, 3)
                  .map((tone, j) => (
                    <span
                      key={j}
                      className={cn(
                        'size-1 rounded-full',
                        isSelected ? 'bg-white/90' : TONE_DOT[tone]
                      )}
                    />
                  ))}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={(e) => shiftWeek(7, e)}
          aria-label={tStrip('nextWeek')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md transition-colors"
        >
          <ChevronRight className="size-3.5" />
        </button>

        {/* Only when it would DO something. A "Hoje" on the week you are
            already looking at is a control that teaches you it does
            nothing. */}
        {!onThisWeek && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCursor(startOfWeek(today, weekStart));
              setSelected(today);
            }}
            className="text-primary hover:bg-primary-soft ml-0.5 shrink-0 rounded-md px-1.5 py-1 text-xs font-semibold transition-colors"
          >
            {t('today')}
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <span className="text-foreground flex-1 truncate text-sm font-semibold">
            {formatMonthDay(selected)}
          </span>
          {selectedItems.length > 0 && (
            <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
              {t('itemCount', { count: selectedItems.length })}
            </span>
          )}
        </div>

        <div className="max-h-vh-40 overflow-y-auto">
          {selectedItems.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-center text-xs">
              {t('dayEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {selectedItems.map((item) => {
                const tone = AGENDA_TONE[item.kind];
                const Icon = KIND_ICON[item.kind];
                const meta = [
                  t(`kind.${item.kind}`),
                  item.contact,
                  item.value
                    ? formatCurrency(
                        item.value,
                        item.currency || defaultCurrency
                      )
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ');

                const body = (
                  <>
                    <span
                      className={cn(
                        'grid size-6 shrink-0 place-items-center rounded-md',
                        TONE_CHIP[tone]
                      )}
                    >
                      <Icon className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-foreground truncate text-xs font-semibold">
                          {item.title || t(`kind.${item.kind}`)}
                        </span>
                        {item.time && (
                          <span className="text-muted-foreground text-3xs shrink-0 tabular-nums">
                            {item.time}
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-2xs mt-0.5 block truncate">
                        {meta}
                      </span>
                    </span>
                  </>
                );

                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="hover:bg-muted flex items-center gap-2 px-3 py-2 transition-colors"
                      >
                        {body}
                        <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-border border-t px-3 py-2">
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="text-primary text-xs font-semibold hover:underline"
          >
            {tStrip('openFull')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
