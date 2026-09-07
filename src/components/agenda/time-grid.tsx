'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { fromISO } from '@/lib/calendar';
import type { AgendaItem } from '@/lib/dashboard/agenda';
import { dayBounds, type BusinessHours } from '@/lib/hours';
import {
  allDayItems,
  hourSlots,
  positionOf,
  timedItems,
} from '@/lib/agenda/view';
import { cn } from '@/lib/utils';

import { AgendaChip } from './agenda-chip';

/**
 * O eixo de horas — a peça que faltava no produto inteiro.
 *
 * A semana e o dia são a MESMA grade com um número de colunas diferente, e
 * escrevê-las duas vezes seria manter dois eixos em sincronia para ganhar
 * zero: as duas leem os mesmos limites, posicionam com a mesma conta e
 * desenham a mesma faixa de "o dia todo". Sete colunas ou uma é um
 * argumento, não um componente.
 *
 * ------------------------------------------------------------------
 * ONDE O EIXO COMEÇA E TERMINA
 * ------------------------------------------------------------------
 *
 * Nos limites do expediente da conta (§B), mais uma hora de folga de cada
 * lado — não em 00:00–24:00. Um dia inteiro desenhado por igual gasta dois
 * terços da altura em horas que a empresa está fechada, e espreme as oito
 * em que ela trabalha na faixa do meio.
 *
 * E `dayBounds` recebe os dias EM TELA, não a semana inteira: uma exceção
 * de sábado não deve esticar a grade de uma semana que não mostra sábado.
 *
 * ------------------------------------------------------------------
 * A FAIXA DE CIMA NÃO É UM DETALHE
 * ------------------------------------------------------------------
 *
 * Metade da agenda não tem hora — aniversário, campanha, fechamento
 * previsto, e toda tarefa marcada só para o dia. Um eixo de horas não tem
 * onde pôr isso, e a tentação é jogar tudo às 00:00, que inventa uma
 * precisão que o dado não tem e ainda empilha sete itens num canto.
 * A faixa acima do eixo é onde essas coisas são verdadeiras.
 */
export function TimeGrid({
  days,
  items,
  hours,
  onSelectTask,
  renderHeader,
}: {
  days: string[];
  /** Já filtrados. A grade não decide o que aparece. */
  items: AgendaItem[];
  hours: BusinessHours;
  onSelectTask: (item: AgendaItem) => void;
  renderHeader: (iso: string) => React.ReactNode;
}) {
  const t = useTranslations('Agenda');
  const { startHour, endHour } = React.useMemo(
    () => dayBounds(hours, days),
    [hours, days]
  );
  const slots = React.useMemo(
    () => hourSlots(startHour, endHour, hours.slotMinutes),
    [startHour, endHour, hours.slotMinutes]
  );

  const byDay = React.useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const iso of days) map.set(iso, []);
    for (const item of items) map.get(item.day)?.push(item);
    return map;
  }, [days, items]);

  const anyAllDay = days.some(
    (iso) => allDayItems(byDay.get(iso) ?? []).length > 0
  );

  // A altura de uma linha vezes o número de linhas. Fixa em px e não em
  // fração da viewport: a grade rola dentro da página, e uma hora que muda
  // de altura conforme a janela torna impossível comparar dois dias.
  const slotHeight = hours.slotMinutes >= 60 ? 56 : 40;
  const bodyHeight = slots.length * slotHeight;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border">
      {/* Cabeçalho: o rótulo de cada dia, alinhado às colunas de baixo. */}
      <div
        className="bg-muted/30 grid border-b"
        style={{ gridTemplateColumns: `4rem repeat(${days.length}, 1fr)` }}
      >
        <div aria-hidden />
        {days.map((iso) => (
          <div key={iso} className="border-l px-2 py-2 text-center">
            {renderHeader(iso)}
          </div>
        ))}
      </div>

      {/* A faixa do dia todo, só quando há o que pôr nela. */}
      {anyAllDay ? (
        <div
          className="bg-muted/10 grid border-b"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, 1fr)` }}
        >
          <div className="text-muted-foreground px-2 py-1.5 text-2xs">
            {t('allDay')}
          </div>
          {days.map((iso) => (
            <div key={iso} className="space-y-0.5 border-l p-1">
              {allDayItems(byDay.get(iso) ?? []).map((item) => (
                <AgendaChip
                  key={item.id}
                  item={item}
                  density="tight"
                  onSelect={item.kind === 'task' ? onSelectTask : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {/* O eixo. */}
      <div className="overflow-y-auto">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `4rem repeat(${days.length}, 1fr)`,
            height: bodyHeight,
          }}
        >
          {/* A régua de horas. */}
          <div className="relative">
            {slots.map((slot, i) => (
              <div
                key={slot}
                className="text-muted-foreground absolute right-2 -translate-y-1/2 text-2xs tabular-nums"
                style={{ top: (i / slots.length) * 100 + '%' }}
              >
                {slot}
              </div>
            ))}
          </div>

          {days.map((iso) => {
            const timed = timedItems(byDay.get(iso) ?? []);
            const closed = !isOpenDay(hours, iso);
            return (
              <div
                key={iso}
                className={cn(
                  'relative border-l',
                  // Um dia fechado não some da grade — fica visivelmente
                  // fechado. Sumir responderia "não existe sábado", que é
                  // falso e esconde a tarefa que alguém marcou nele.
                  closed && 'bg-muted/20'
                )}
              >
                {slots.map((slot, i) => (
                  <div
                    key={slot}
                    className="border-border/60 absolute inset-x-0 border-t"
                    style={{ top: (i / slots.length) * 100 + '%' }}
                    aria-hidden
                  />
                ))}
                {timed.map((item) => {
                  const pos = positionOf(item, startHour, endHour);
                  if (!pos) return null;
                  return (
                    <AgendaChip
                      key={item.id}
                      item={item}
                      density="tight"
                      onSelect={item.kind === 'task' ? onSelectTask : undefined}
                      className="absolute inset-x-1 z-10 overflow-hidden"
                      style={{
                        top: `${pos.top}%`,
                        minHeight: `${pos.height}%`,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function isOpenDay(hours: BusinessHours, iso: string): boolean {
  const date = fromISO(iso);
  if (!date) return true;
  const exception = hours.exceptions.find((e) => e.date === iso);
  if (exception) return !exception.closed;
  return hours.weekly.some((row) => row.weekday === date.getDay());
}
