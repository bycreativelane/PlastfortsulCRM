'use client';

import * as React from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';

import { useBusinessHours } from '@/hooks/use-business-hours';
import { addDays, addMonths, fromISO, toISO } from '@/lib/calendar';
import { rangeFor, type AgendaView } from '@/lib/agenda/view';
import { tasksAsAgendaItems } from '@/lib/tasks/to-agenda';
import type { AgendaItem } from '@/lib/dashboard/agenda';
import type { Task } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DayView } from '@/components/agenda/day-view';
import { MonthView } from '@/components/agenda/month-view';
import { WeekView } from '@/components/agenda/week-view';

/**
 * As tarefas por data — a visão de calendário de `/tasks`.
 *
 * ------------------------------------------------------------------
 * A MESMA GRADE DA AGENDA, COM UMA FONTE SÓ
 * ------------------------------------------------------------------
 *
 * Reaproveita `MonthView`, `WeekView` e `DayView` inteiros. A diferença
 * está no que entra: aqui só tarefa, lá as sete fontes datadas do produto.
 *
 * Escrever uma segunda grade daria duas implementações do eixo de horas,
 * dois tratamentos da faixa de "dia todo" e duas chances de o sábado
 * fechado ser desenhado de dois jeitos. O que muda entre as duas telas é a
 * PERGUNTA, não o desenho.
 *
 * ------------------------------------------------------------------
 * E POR ISSO O LINK PARA A AGENDA COMPLETA
 * ------------------------------------------------------------------
 *
 * Quem está aqui vê a própria semana de trabalho. Quem precisa ver isso ao
 * lado dos fechamentos previstos, dos aniversários e do que está marcado na
 * Google vai para `/agenda` — que continua existindo, e saiu do menu
 * justamente porque este é o caminho natural até ela.
 */
export function TasksCalendar({
  tasks,
  onSelectTask,
}: {
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}) {
  const t = useTranslations('TasksPage');
  const format = useFormatter();
  const { hours } = useBusinessHours();

  const [view, setView] = React.useState<AgendaView>('week');
  const [cursor, setCursor] = React.useState(() => new Date());

  const range = React.useMemo(
    () => rangeFor(view, cursor, hours.weekStartsOn),
    [view, cursor, hours.weekStartsOn]
  );

  // Só as que caem na janela: a lista de cima carrega a conta inteira, e
  // desenhar mil tarefas numa semana de sete colunas custaria sem mostrar.
  const items = React.useMemo(() => {
    const days = new Set(range.days);
    return tasksAsAgendaItems(tasks, '/tasks').filter((item) =>
      days.has(item.day)
    );
  }, [tasks, range.days]);

  const byId = React.useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks]
  );

  const open = (item: AgendaItem) => {
    const task = byId.get(item.rowId);
    if (task) onSelectTask(task);
  };

  const go = (delta: number) => {
    setCursor((current) =>
      view === 'month'
        ? addMonths(current, delta)
        : addDays(current, delta * (view === 'week' ? 7 : 1))
    );
  };

  const todayIso = toISO(new Date());

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => go(-1)}
          aria-label={t('previous')}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => go(1)}
          aria-label={t('next')}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
          {t('today')}
        </Button>

        <span className="text-sm font-medium">
          {periodLabel(view, cursor, range.days, format)}
        </span>

        <div className="bg-muted ml-auto flex rounded-md p-0.5">
          {(['month', 'week', 'day'] as AgendaView[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-pressed={view === mode}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium',
                view === mode
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground'
              )}
            >
              {t(`range.${mode}`)}
            </button>
          ))}
        </div>

        <Link
          href="/agenda"
          className="text-muted-foreground hover:text-foreground text-2xs inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          <CalendarRange className="size-3.5" />
          {t('fullAgenda')}
        </Link>
      </header>

      {view === 'month' ? (
        <MonthView
          cursor={cursor}
          items={items}
          onPickDay={(date) => {
            setCursor(date);
            setView('day');
          }}
        />
      ) : view === 'week' ? (
        <WeekView
          days={range.days}
          items={items}
          hours={hours}
          todayIso={todayIso}
          onSelectTask={open}
        />
      ) : (
        <DayView
          iso={range.days[0]}
          items={items}
          hours={hours}
          onSelectTask={open}
        />
      )}
    </div>
  );
}

function periodLabel(
  view: AgendaView,
  cursor: Date,
  days: string[],
  format: ReturnType<typeof useFormatter>
): string {
  // Os objetos ficam embutidos em vez de numa variável tipada: o
  // `DateTimeFormatOptions` do next-intl é mais estreito que o do `Intl`, e
  // anotar com o segundo faz o compilador recusar o que a biblioteca aceita.
  if (view === 'month') {
    return format.dateTime(cursor, { month: 'long', year: 'numeric' });
  }
  if (view === 'day') {
    return format.dateTime(cursor, { day: 'numeric', month: 'short' });
  }

  const first = fromISO(days[0]);
  const last = fromISO(days[days.length - 1]);
  if (!first || !last) return '';
  const shape = { day: 'numeric', month: 'short' } as const;
  return `${format.dateTime(first, shape)} – ${format.dateTime(last, shape)}`;
}
