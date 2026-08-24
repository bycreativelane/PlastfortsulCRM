'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  addMonths,
  firstDayOfWeek,
  isSameDay,
  monthMatrix,
  toISO,
  weekdayLabels,
} from '@/lib/calendar';

/**
 * The month grid, once.
 *
 * `DateField` drew this to pick a date; the dashboard agenda draws it to show
 * what is happening on each of those dates. Same object either way — same
 * first day of the week, same six rows, same treatment of today and of the
 * days that spill in from the neighbouring months — so the two calendars in
 * the product are recognisably one calendar, and a change to the geometry is
 * a change to both.
 *
 * What the two do NOT share is what goes inside a cell, which is why `marker`
 * is a render prop rather than a prop bag: the field puts nothing under the
 * number, the agenda puts a row of dots. Anything a caller needs to decide
 * that with — whether the day is selected, whether it belongs to the month
 * being shown — arrives in `MonthGridDay`.
 *
 * Two sizes. `sm` is the popover's: 28px, a comfortable mouse target that is
 * an unusable thumb one, so it grows to 40 under a coarse pointer. `md` fills
 * its column and is tall enough to carry markers under the number.
 */

export interface MonthGridDay {
  date: Date;
  /** `YYYY-MM-DD`, local. The key a caller buckets its own data on. */
  iso: string;
  /** Belongs to the previous or next month — drawn, but visibly not here. */
  outside: boolean;
  today: boolean;
  selected: boolean;
}

interface MonthGridProps {
  /** Any date inside the month to draw. */
  month: Date;
  selected?: Date | null;
  onSelect: (date: Date) => void;
  size?: 'sm' | 'md';
  /** Drawn under the day number. */
  marker?: (day: MonthGridDay) => React.ReactNode;
  /**
   * Appended to the cell's accessible name, after the date. The visible label
   * is a bare number — a screen reader announces "23" with no month, no
   * weekday, and no way to hear that the day has four things on it.
   */
  dayDescription?: (day: MonthGridDay) => string | undefined;
  className?: string;
}

export function MonthGrid({
  month,
  selected = null,
  onSelect,
  size = 'sm',
  marker,
  dayDescription,
  className,
}: MonthGridProps) {
  const locale = useLocale();
  const weekStart = React.useMemo(() => firstDayOfWeek(locale), [locale]);

  const weekdays = React.useMemo(
    () => weekdayLabels(locale, weekStart),
    [locale, weekStart]
  );

  const longDate = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [locale]
  );

  const grid = React.useMemo(
    () => monthMatrix(month, weekStart),
    [month, weekStart]
  );

  const today = new Date();
  const md = size === 'md';

  return (
    <div className={cn('grid grid-cols-7 gap-0.5', className)}>
      {weekdays.map((day, i) => (
        <span
          key={i}
          className={cn(
            'text-muted-foreground text-3xs grid place-items-center font-semibold uppercase',
            md ? 'h-6' : 'h-6 pointer-coarse:h-8'
          )}
        >
          {day}
        </span>
      ))}

      {grid.map((date) => {
        const day: MonthGridDay = {
          date,
          iso: toISO(date),
          outside: date.getMonth() !== month.getMonth(),
          today: isSameDay(date, today),
          selected: selected ? isSameDay(date, selected) : false,
        };
        const description = dayDescription?.(day);

        return (
          <button
            key={day.iso}
            type="button"
            onClick={() => onSelect(date)}
            aria-label={
              description
                ? `${longDate.format(date)} — ${description}`
                : longDate.format(date)
            }
            aria-pressed={day.selected}
            aria-current={day.today ? 'date' : undefined}
            className={cn(
              'grid place-items-center rounded-md tabular-nums transition-colors',
              md
                ? 'h-10 w-full content-center gap-0.5 text-xs'
                : 'size-7 text-xs pointer-coarse:size-10',
              // Plain muted, not 45% of it. These days are LIVE — clicking one
              // selects that date — and WCAG's contrast exemption is for
              // disabled controls. At 45% they measured 1.88:1 in light mode.
              // The missing hover background is already enough to say they
              // belong to another month.
              day.outside
                ? 'text-muted-foreground'
                : 'text-foreground hover:bg-muted',
              day.today && !day.selected && 'text-primary font-bold',
              day.selected &&
                'bg-primary text-primary-foreground hover:bg-primary font-semibold'
            )}
          >
            <span className="leading-none">{date.getDate()}</span>
            {marker?.(day)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Month label and the two arrows, for the header above a grid.
 *
 * Borrows the `DateField` message namespace rather than opening a second one:
 * "Mês anterior" is the same sentence wherever a month grid is steered, and
 * two keys with the same value in two namespaces is how they drift apart.
 */
export function MonthNav({
  month,
  onMonthChange,
  className,
  children,
}: {
  month: Date;
  onMonthChange: (month: Date) => void;
  className?: string;
  /** Extra controls, drawn after the arrows. */
  children?: React.ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations('DateField');

  const label = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
      }).format(month),
    [locale, month]
  );

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <span className="flex-1 px-1 text-sm font-semibold first-letter:uppercase">
        {label}
      </span>
      <button
        type="button"
        aria-label={t('previousMonth')}
        onClick={() => onMonthChange(addMonths(month, -1))}
        className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-6 place-items-center rounded-md transition-colors"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        aria-label={t('nextMonth')}
        onClick={() => onMonthChange(addMonths(month, 1))}
        className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-6 place-items-center rounded-md transition-colors"
      >
        <ChevronRight className="size-4" />
      </button>
      {children}
    </div>
  );
}
