'use client';

import { useFormatter } from 'next-intl';

import type { AgendaItem } from '@/lib/dashboard/agenda';
import { fromISO } from '@/lib/calendar';
import type { BusinessHours } from '@/lib/hours';

import { TimeGrid } from './time-grid';

/**
 * O dia: a mesma grade da semana com uma coluna.
 *
 * Ganha o cabeçalho por extenso porque tem largura para isso — na semana o
 * mesmo rótulo teria que caber em um sétimo da tela e viraria "seg".
 */
export function DayView({
  iso,
  items,
  hours,
  onSelectTask,
}: {
  iso: string;
  items: AgendaItem[];
  hours: BusinessHours;
  onSelectTask: (item: AgendaItem) => void;
}) {
  const format = useFormatter();

  return (
    <TimeGrid
      days={[iso]}
      items={items}
      hours={hours}
      onSelectTask={onSelectTask}
      renderHeader={(day) => {
        const date = fromISO(day);
        if (!date) return null;
        return (
          <span className="text-sm font-semibold">
            {format.dateTime(date, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
        );
      }}
    />
  );
}
