'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { CountBadge } from '@/components/ui/count-badge';

/**
 * A two-or-three way segmented control with counts.
 *
 * This is the one filter that stays on screen in the inbox, because it is the
 * only split that changes how you work in a shared mailbox: conversations
 * somebody owns, versus conversations nobody has picked up. Everything else —
 * owner, pipeline, stage, contact type, unread — lives behind the Filter menu
 * and only appears when asked for.
 *
 * That restraint is the point. The earlier five-tab row plus a wall of chips
 * stood 189px tall on a 326px column; this is 93px. Tabs are not free real
 * estate, they are the top of the list you actually came to read.
 *
 * The count on a segment is amber when it represents work waiting on a person
 * (`tone: "human"`), grey otherwise. Counts are computed by the caller, and
 * must be computed WITHIN the current filter — a number you can't act on by
 * clicking is worse than no number.
 */
export interface Segment<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Amber count — this segment is a queue of pending human work. */
  tone?: 'human' | 'neutral';
}

interface SegBarProps<T extends string> {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  /** Accessible name for the group, e.g. "Filtrar conversas". */
  label: string;
}

function SegBar<T extends string>({
  segments,
  value,
  onValueChange,
  className,
  label,
}: SegBarProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('bg-muted flex gap-0.5 rounded-lg p-[3px]', className)}
    >
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(segment.value)}
            className={cn(
              'flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-semibold transition-colors',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-secondary-foreground hover:text-foreground'
            )}
          >
            {segment.label}
            {segment.count !== undefined && (
              <CountBadge
                // A GEOMETRIA vem do `CountBadge`; a COR fica aqui.
                //
                // Os dois tons de baixo não são semântica de contagem, são
                // estado de segmento — ativo e inativo desta barra. Promovê-los
                // a variantes do componente inflaria o átomo com casos que só
                // esta tela tem. O que valia unificar era a medida, e é ela
                // que vem de lá.
                className={cn(
                  segment.tone === 'human'
                    ? 'bg-human-strong text-white'
                    : active
                      ? 'bg-secondary-foreground text-card'
                      : 'bg-muted-foreground text-card'
                )}
              >
                {segment.count}
              </CountBadge>
            )}
          </button>
        );
      })}
    </div>
  );
}

export { SegBar };
