'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { MonthGrid } from '@/components/ui/month-grid';
import type { AgendaItem } from '@/lib/dashboard/agenda';
import { cn } from '@/lib/utils';

import { AgendaChip } from './agenda-chip';

/**
 * O mês, sobre a mesma `MonthGrid` que o campo de data abre.
 *
 * Reaproveitar em vez de desenhar outra grade é o que mantém "23 de
 * setembro" no mesmo lugar em toda a aplicação — e a grade já resolve o
 * primeiro dia da semana, os dias vizinhos e o dia de hoje.
 *
 * O mês NÃO ganha eixo de horas, e isso não é uma limitação: uma célula de
 * mês tem 90px de altura para um dia inteiro, e um eixo ali daria uma linha
 * por hora de dois pixels. O mês responde "em que dias tem coisa"; quem
 * pergunta "a que horas" clica no dia e cai na tela que sabe responder.
 */
const MAX_CHIPS = 3;

export function MonthView({
  cursor,
  items,
  onPickDay,
  onSelectTask,
}: {
  cursor: Date;
  items: AgendaItem[];
  onPickDay: (date: Date) => void;
  onSelectTask: (item: AgendaItem) => void;
}) {
  const t = useTranslations('Agenda');

  const byDay = React.useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of items) {
      const list = map.get(item.day);
      if (list) list.push(item);
      else map.set(item.day, [item]);
    }
    return map;
  }, [items]);

  return (
    <MonthGrid
      month={cursor}
      onSelect={onPickDay}
      size="md"
      dayDescription={(day) => {
        const count = byDay.get(day.iso)?.length ?? 0;
        return count > 0 ? t('itemCount', { count }) : undefined;
      }}
      marker={(day) => {
        const list = byDay.get(day.iso);
        if (!list || list.length === 0) return null;
        const shown = list.slice(0, MAX_CHIPS);
        const rest = list.length - shown.length;
        return (
          <div className={cn('mt-0.5 space-y-0.5', day.outside && 'opacity-50')}>
            {shown.map((item) => (
              <AgendaChip
                key={item.id}
                item={item}
                density="tight"
                onSelect={item.kind === 'task' ? onSelectTask : undefined}
              />
            ))}
            {rest > 0 ? (
              <div className="text-muted-foreground px-1 text-3xs">
                {t('more', { count: rest })}
              </div>
            ) : null}
          </div>
        );
      }}
    />
  );
}
