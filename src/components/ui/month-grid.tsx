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
  /**
   * Estica as seis semanas para dividir a altura do pai, em vez de fixar
   * 40px por célula.
   *
   * A tela de tarefas é de altura contida — o `<main>` não rola, a visão é
   * dona da própria altura — e o mês desenhava 240px de grade seguidos de
   * meia tela branca. Uma grade de mês que não chega ao pé da área parece
   * carregada pela metade, e as células ficam pequenas demais para caber os
   * chips que elas existem para carregar.
   *
   * Fora de um pai com altura, isto não faz nada: `1fr` de uma linha sem
   * altura definida colapsa para o conteúdo, que é o comportamento antigo.
   */
  fill?: boolean;
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
  selected,
  onSelect,
  size = 'sm',
  fill = false,
  marker,
  dayDescription,
  className,
}: MonthGridProps) {
  const locale = useLocale();
  const weekStart = React.useMemo(() => firstDayOfWeek(locale), [locale]);

  // O mês grande tem 200px por coluna e cabe o nome abreviado; o do
  // campo de data tem 34px e só cabe a letra. Ver a nota em
  // `weekdayLabels` sobre o D S T Q Q S S do português.
  const weekdays = React.useMemo(
    () => weekdayLabels(locale, weekStart, size === 'md' ? 'short' : 'narrow'),
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
    <div
      className={cn(
        'grid grid-cols-7 gap-0.5',
        fill && 'h-full grid-rows-[auto_repeat(6,minmax(0,1fr))]',
        className
      )}
    >
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
            /*
              `undefined` quando o chamador não tem o conceito de seleção.

              O `MonthView` da agenda não seleciona nada — e anunciava 42
              células dizendo "não pressionado" a cada dia do mês. `null` é
              diferente de ausente: o `DateField` TEM seleção e às vezes
              está vazio, e ali o "não pressionado" é a resposta certa.
            */
            aria-pressed={selected === undefined ? undefined : day.selected}
            aria-current={day.today ? 'date' : undefined}
            className={cn(
              // `min-w-0` e nao decoracao: numa `grid-cols-7` a coluna nao
              // encolhe abaixo do conteudo dela, entao um chip com titulo
              // longo empurrava a celula e as sete colunas deixavam de ter
              // a mesma largura — os numeros dos dias saiam de ordem e os
              // chips atravessavam a coluna vizinha.
              'grid min-w-0 place-items-center rounded-md tabular-nums transition-colors',
              md
                ? cn(
                    'w-full content-start gap-0.5 py-1 text-xs',
                    // Preenchendo, a linha da grade manda na altura; fixo,
                    // ela vem daqui. `min-h` e não `h` para que uma célula
                    // com três chips cresça em vez de recortá-los.
                    fill ? 'min-h-10' : 'h-10 content-center'
                  )
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
