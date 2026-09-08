'use client';

import type { AgendaItem } from '@/lib/dashboard/agenda';
import type { BusinessHours } from '@/lib/hours';

import { TimeGrid } from './time-grid';

/**
 * O dia: a mesma grade da semana com uma coluna.
 *
 * ------------------------------------------------------------------
 * SEM CABEÇALHO DE COLUNA, E ISSO MUDOU
 * ------------------------------------------------------------------
 *
 * Ele desenhava a data por extenso numa faixa própria, com o argumento de
 * que aqui há largura para isso — na semana o mesmo rótulo teria que caber
 * em um sétimo da tela e viraria "seg". O argumento é bom e continua
 * verdadeiro; o que mudou foi o outro lado.
 *
 * As duas telas que montam esta visão põem o período como TÍTULO da faixa
 * de navegação — `/agenda` num `<h1>` e `/tasks` no rótulo do calendário.
 * Com uma coluna só, o cabeçalho dela repetia essa data linha abaixo: duas
 * frases dizendo "8 de setembro" uma sobre a outra, cobrando uma banda do
 * eixo para não dizer nada novo.
 *
 * Quem tem a data é quem navega. A grade fica com as horas.
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
  return (
    <TimeGrid
      days={[iso]}
      items={items}
      hours={hours}
      onSelectTask={onSelectTask}
    />
  );
}
