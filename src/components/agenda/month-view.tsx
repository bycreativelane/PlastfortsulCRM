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
/*
 * DOIS, E O "+N" NA LINHA DO NÚMERO.
 *
 * Eram três chips e o "+N" embaixo deles. Medido na tela de tarefas, que
 * divide a altura da janela entre seis semanas: a 760px de janela uma
 * célula tem ~80px, o número leva 24, e sobram lugar para DOIS chips. O
 * terceiro era cortado pelo fundo da célula — e o "+N", que viria depois
 * dele, também. O dia 14 tinha três tarefas e mostrava duas, sem nenhum
 * sinal de que havia outra. Um calendário que esconde uma tarefa em
 * silêncio é pior do que um feio.
 *
 * Então: dois chips, que cabem em qualquer altura razoável, e o contador
 * sobe para o canto de cima, ao lado do número, onde nenhum corte alcança.
 * A célula inteira continua levando ao dia, onde estão todas.
 */
const MAX_CHIPS = 2;

export function MonthView({
  cursor,
  items,
  onPickDay,
  fill = false,
}: {
  cursor: Date;
  items: AgendaItem[];
  onPickDay: (date: Date) => void;
  /** Divide a altura do pai entre as seis semanas — ver `MonthGrid`. */
  fill?: boolean;
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
      // `lg` e não `md`: o `md` é o tamanho do painel do dashboard, sem
      // régua entre as células. Ver a nota do `lg` em `month-grid.tsx`.
      size="lg"
      fill={fill}
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
          <div
            className={cn(
              'w-full min-w-0 space-y-0.5 overflow-hidden',
              day.outside && 'opacity-60'
            )}
          >
            {/*
              SEM `onSelect` AQUI, e não é esquecimento.

              A `MonthGrid` desenha cada dia como um `<button>`. Um chip
              clicável dentro dele é botão dentro de botão: HTML inválido,
              erro de hidratação, e — o que se vê — um clique na tarefa
              disparando também o clique do dia.

              A célula do mês já é o alvo, e leva para a tela do dia. É a
              divisão que o resto desta pasta assume: o mês responde EM QUE
              DIAS tem coisa, o dia responde o quê e a que horas.
            */}
            {shown.map((item) => (
              <AgendaChip
                key={item.id}
                item={item}
                density="tight"
                interactive={false}
              />
            ))}
            {rest > 0 ? (
              // No canto, na altura do número: ver a nota do `MAX_CHIPS`.
              // `span` e não `button` — a célula já é o botão que leva ao dia.
              <span className="bg-muted text-secondary-foreground text-3xs absolute top-2 right-1.5 rounded px-1 py-px font-semibold tabular-nums">
                {t('more', { count: rest })}
              </span>
            ) : null}
          </div>
        );
      }}
    />
  );
}
