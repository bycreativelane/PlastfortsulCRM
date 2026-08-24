'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  fromISO,
  localeDateShape,
  startOfMonth,
  toISO,
  type DateOrder,
} from '@/lib/calendar';
import { MonthGrid, MonthNav } from '@/components/ui/month-grid';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * A date field with the app's own calendar.
 *
 * `<input type="date">` hands the panel to the browser, and the browser
 * paints its own: a black-on-grey grid that follows the OPERATING SYSTEM's
 * light/dark preference rather than the app's, so an account running the
 * light theme on a dark Windows opened a dark calendar out of a white form —
 * with a dark calendar glyph on a dark button, invisible until hovered. None
 * of that is reachable from CSS. The only fix is to stop asking for it.
 *
 * What is kept from the native field: you can still type the date. A picker
 * that can only be clicked is slower than the thing it replaced for anyone
 * entering a date they already know, so the text half stays primary and the
 * calendar is the second way in.
 *
 * Values are ISO `YYYY-MM-DD` in and out — the shape Postgres `date` columns
 * take — while the display follows the interface locale.
 *
 * The grid itself moved to `ui/month-grid.tsx` when the dashboard agenda
 * needed the same one. What is left here is the half that is about a FIELD:
 * parsing what somebody typed, and formatting what they picked.
 */

interface DateFieldProps {
  /** ISO `YYYY-MM-DD`, or an empty string for no date. */
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function DateField({
  value,
  onValueChange,
  id,
  disabled,
  className,
  'aria-label': ariaLabel,
}: DateFieldProps) {
  const locale = useLocale();
  const t = useTranslations('DateField');
  const { order, separator } = React.useMemo(
    () => localeDateShape(locale),
    [locale]
  );

  const selected = value ? fromISO(value) : null;

  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [typing, setTyping] = React.useState(false);

  const formatText = React.useCallback(
    (date: Date) =>
      order
        .map((part) =>
          part === 'year'
            ? String(date.getFullYear())
            : String(
                part === 'day' ? date.getDate() : date.getMonth() + 1
              ).padStart(2, '0')
        )
        .join(separator),
    [order, separator]
  );

  // The field mirrors the value except while it is being typed into, when the
  // half-written text has to survive re-renders.
  const shown = typing ? text : selected ? formatText(selected) : '';

  const [cursor, setCursor] = React.useState(() =>
    startOfMonth(selected ?? new Date())
  );

  // Re-open on the month the value is in, not on wherever it was left.
  React.useEffect(() => {
    if (open) setCursor(startOfMonth(selected ?? new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  function commitText(raw: string) {
    setTyping(false);
    const digits = raw.split(/\D+/).filter(Boolean);
    if (digits.length === 0) {
      onValueChange('');
      return;
    }
    if (digits.length < 3) return; // Incomplete — leave the value alone.

    const picked: Record<DateOrder, number> = { day: 1, month: 1, year: 1970 };
    order.forEach((part, i) => {
      picked[part] = Number(digits[i]);
    });
    // Two-digit years are read as this century, which is the only reading
    // that makes sense for a close date.
    if (picked.year < 100) picked.year += 2000;

    const date = new Date(picked.year, picked.month - 1, picked.day);
    const valid =
      date.getFullYear() === picked.year &&
      date.getMonth() === picked.month - 1 &&
      date.getDate() === picked.day;
    onValueChange(valid ? toISO(date) : value);
  }

  function pick(date: Date) {
    onValueChange(toISO(date));
    setTyping(false);
    setOpen(false);
  }

  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        data-slot="input"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={t('placeholder')}
        value={shown}
        onChange={(e) => {
          setTyping(true);
          setText(e.target.value);
        }}
        onBlur={(e) => commitText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitText((e.target as HTMLInputElement).value);
          }
        }}
        className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 w-full min-w-0 rounded-lg border bg-transparent py-1 pr-9 pl-2.5 text-base tabular-nums transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          aria-label={t('openCalendar')}
          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
        >
          <CalendarDays className="size-4" />
        </PopoverTrigger>

        <PopoverContent align="end" className="w-auto gap-2 p-2">
          <MonthNav month={cursor} onMonthChange={setCursor} />

          <MonthGrid month={cursor} selected={selected} onSelect={pick} />

          <div className="border-border/70 flex items-center justify-between border-t pt-1.5">
            <button
              type="button"
              onClick={() => {
                onValueChange('');
                setTyping(false);
                setOpen(false);
              }}
              className="text-muted-foreground hover:text-foreground text-2xs rounded-md px-1.5 py-0.5 font-medium transition-colors"
            >
              {t('clear')}
            </button>
            <button
              type="button"
              onClick={() => pick(new Date())}
              className="text-primary hover:bg-primary-soft text-2xs rounded-md px-1.5 py-0.5 font-semibold transition-colors"
            >
              {t('today')}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
