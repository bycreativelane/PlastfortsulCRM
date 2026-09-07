'use client';

import * as React from 'react';
import Link from 'next/link';

import {
  AGENDA_TONE,
  type AgendaItem,
} from '@/lib/dashboard/agenda';
import { cn } from '@/lib/utils';

import { KIND_ICON, TONE_CHIP } from './tokens';

/**
 * Um item da agenda, do tamanho que a tela couber.
 *
 * As três telas desenham a MESMA linha em três larguras: no mês ela é uma
 * tira de 18px dentro de uma célula, na semana uma caixa numa coluna de um
 * sétimo, no dia uma faixa larga. O que muda é o espaço, não o conteúdo —
 * então o componente é um só e a densidade é um parâmetro.
 *
 * Uma tarefa ABRE em vez de navegar: `onSelect` recebe o item e a página
 * põe `?task=<id>` na URL, que é o que o diálogo escuta. Os outros seis
 * tipos continuam sendo links de verdade (`href`), porque o destino deles é
 * outra tela e não uma gaveta.
 */
export function AgendaChip({
  item,
  density = 'comfortable',
  onSelect,
  className,
  style,
}: {
  item: AgendaItem;
  density?: 'tight' | 'comfortable';
  onSelect?: (item: AgendaItem) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = KIND_ICON[item.kind];
  const tone = TONE_CHIP[AGENDA_TONE[item.kind]];
  const tight = density === 'tight';

  const inner = (
    <>
      <Icon className={cn('shrink-0', tight ? 'size-3' : 'size-3.5')} />
      {item.time ? (
        <span className="shrink-0 font-medium tabular-nums opacity-80">
          {item.time}
        </span>
      ) : null}
      <span className="truncate">{item.title}</span>
    </>
  );

  const classes = cn(
    'flex w-full items-center gap-1.5 rounded-md text-left',
    tight ? 'px-1 py-0.5 text-2xs' : 'px-2 py-1 text-xs',
    tone,
    'hover:brightness-95 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
    className
  );

  // O clique que abre a gaveta ganha do link. Uma tarefa TEM href — aponta
  // para `/agenda?task=<id>`, que é exatamente esta tela — então seguir o
  // link recarregaria a página inteira para chegar onde já se está.
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(item)}
        className={classes}
        style={style}
        title={item.title}
      >
        {inner}
      </button>
    );
  }

  if (item.href) {
    return (
      <Link href={item.href} className={classes} style={style} title={item.title}>
        {inner}
      </Link>
    );
  }

  return (
    <div className={classes} style={style} title={item.title}>
      {inner}
    </div>
  );
}
