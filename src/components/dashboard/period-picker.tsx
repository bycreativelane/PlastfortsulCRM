'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarRange, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { localDayKey } from '@/lib/dashboard/date-utils';
import {
  MAX_PERIOD_DAYS,
  PRESETS,
  periodFromDates,
  periodFromPreset,
  periodInputValues,
  type Period,
} from '@/lib/dashboard/period';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

/**
 * The period the page is about — three presets and any window at all.
 *
 * ------------------------------------------------------------------
 * WHY THE FOURTH OPTION IS NOT A FOURTH CHIP
 * ------------------------------------------------------------------
 *
 * "falta uma opção para selecionar período específico para análise."
 *
 * The three presets answer "how are we doing lately" and cannot answer
 * "how was July" — every one of them counts backwards from today. A
 * fourth preset (180? 365?) would not have helped: the question is not
 * how far back, it is WHICH window.
 *
 * So the row keeps its three chips, and gains one that opens a pair of
 * dates. The chips stay because they are the common case and a date
 * picker is four interactions to say "last week"; the pair exists
 * because a report about a closed month is the whole reason somebody
 * opens this page at the start of the next one.
 *
 * ------------------------------------------------------------------
 * IT REFUSES OUT LOUD
 * ------------------------------------------------------------------
 *
 * A reversed pair, a start in the future, a window past the cap — each
 * gets its own sentence under the fields, and Aplicar stays disabled.
 * Silently swapping a reversed pair would show a window nobody asked
 * for, and give them no reason to look at the control again.
 */
export function PeriodPicker({
  value,
  onChange,
  className,
}: {
  value: Period;
  onChange: (next: Period) => void;
  className?: string;
}) {
  const t = useTranslations('Dashboard.conversationsChart');
  const tp = useTranslations('Reports.period');

  const [open, setOpen] = useState(false);

  // Seeded from whatever is on screen, so opening the panel on "30 dias"
  // starts from those dates rather than from empty fields.
  const seeded = periodInputValues(value);
  const [from, setFrom] = useState(seeded.from);
  const [to, setTo] = useState(seeded.to);

  const parsed = periodFromDates(from, to);
  const custom = value.preset === null;

  const apply = () => {
    if (!parsed.ok) return;
    onChange(parsed.period);
    setOpen(false);
  };

  return (
    <div
      role="group"
      aria-label={t('title')}
      className={cn('bg-muted flex gap-0.5 rounded-lg p-[3px]', className)}
    >
      {PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onChange(periodFromPreset(preset))}
          aria-pressed={value.preset === preset}
          className={cn(CHIP, value.preset === preset ? CHIP_ON : CHIP_OFF)}
        >
          {t('days', { count: preset })}
        </button>
      ))}

      {/* Re-seeded on OPEN, in the handler rather than in an effect.
          Opening the panel on "30 dias" should start from those dates,
          but a `useEffect` on `value` would also fire while the panel is
          open and undo what somebody was in the middle of typing — and
          `react-hooks/set-state-in-effect` refuses it besides. An event
          is what this is. */}
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            const seeded = periodInputValues(value);
            setFrom(seeded.from);
            setTo(seeded.to);
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger
          aria-pressed={custom}
          className={cn(
            CHIP,
            'inline-flex items-center gap-1.5',
            custom ? CHIP_ON : CHIP_OFF
          )}
        >
          <CalendarRange className="size-3.5" />
          {/* The chip says the window once it holds one. A control that
              still reads "Personalizado" after you have chosen a month
              makes you open it again to remember what you picked. */}
          {custom ? formatRange(value) : tp('custom')}
        </PopoverTrigger>

        <PopoverContent align="end" className="w-72 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-2xs font-semibold">
                {tp('from')}
              </span>
              <input
                type="date"
                value={from}
                max={localDayKey(new Date())}
                onChange={(e) => setFrom(e.target.value)}
                className="border-border bg-card text-foreground h-9 rounded-lg border px-2 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-2xs font-semibold">
                {tp('to')}
              </span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border-border bg-card text-foreground h-9 rounded-lg border px-2 text-xs"
              />
            </label>
          </div>

          {/* One sentence per reason. "Período inválido" three times for
              three different mistakes is how somebody keeps retrying the
              one thing that will never work. */}
          {!parsed.ok && (
            <p className="text-destructive mt-2 text-2xs">
              {parsed.reason === 'reversed'
                ? tp('errorReversed')
                : parsed.reason === 'future'
                  ? tp('errorFuture')
                  : parsed.reason === 'tooLong'
                    ? tp('errorTooLong', { days: MAX_PERIOD_DAYS })
                    : tp('errorInvalid')}
            </p>
          )}

          {parsed.ok && (
            <p className="text-muted-foreground mt-2 text-2xs">
              {tp('willCover', { days: parsed.period.days })}
            </p>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {tp('cancel')}
            </Button>
            <Button size="sm" disabled={!parsed.ok} onClick={apply}>
              <Check />
              {tp('apply')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * The geometry is the inbox's `SegBar` at a smaller size — same track,
 * same radius, same lifted active chip — so this is not a fourth kind of
 * segmented control in a product that already had three.
 *
 * Raw `<button>`: the shell's coarse-pointer rule only widens
 * `[data-slot="button"]`, and these sit ~26px tall on a phone. The
 * minimum applies under a coarse pointer only, so desktop keeps its size.
 */
const CHIP =
  'text-2xs h-6.5 rounded-md px-2.5 font-semibold whitespace-nowrap transition-colors [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';
const CHIP_ON = 'bg-card text-foreground shadow-sm';
const CHIP_OFF = 'text-secondary-foreground hover:text-foreground';

/** "1 – 31 jul", and "1 jul – 3 ago" when it straddles a month. */
function formatRange(period: Period): string {
  const { from, to } = periodInputValues(period);
  const day = (key: string, withMonth: boolean) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
    });
  };
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${day(from, !sameMonth)} – ${day(to, true)}`;
}
