'use client';

import { useFormatter } from 'next-intl';

import type { AgendaItem } from '@/lib/dashboard/agenda';
import { fromISO } from '@/lib/calendar';
import type { BusinessHours } from '@/lib/hours';
import { cn } from '@/lib/utils';

import { TimeGrid } from './time-grid';

/** A semana: sete colunas sobre o eixo de horas do §B. */
export function WeekView({
  days,
  items,
  hours,
  todayIso,
  onSelectTask,
}: {
  days: string[];
  items: AgendaItem[];
  hours: BusinessHours;
  todayIso: string;
  onSelectTask: (item: AgendaItem) => void;
}) {
  const format = useFormatter();

  return (
    <TimeGrid
      days={days}
      items={items}
      hours={hours}
      onSelectTask={onSelectTask}
      renderHeader={(iso) => {
        const date = fromISO(iso);
        if (!date) return null;
        const today = iso === todayIso;
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-muted-foreground text-2xs uppercase">
              {format.dateTime(date, { weekday: 'short' })}
            </span>
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                today && 'bg-primary text-primary-foreground'
              )}
            >
              {date.getDate()}
            </span>
          </div>
        );
      }}
    />
  );
}
