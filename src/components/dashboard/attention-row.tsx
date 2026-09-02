'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * One state that might be waiting on a person.
 *
 * A row, not a card. The four of them stack in a quarter-width column
 * beside the agenda, and everything about the anatomy follows from that
 * width: the icon drops to 28px, the figure to `text-xl`, and the
 * caption sits beside the figure rather than under it, because a
 * caption under a number in a 300px column is two lines of text with a
 * number floating over them.
 *
 * `tone` paints the ROW when the number is not zero. On a card the same
 * signal was 154px of tinted surface; here it is a 48px band, which is
 * the point — the row still reads amber from across the desk without
 * being the loudest thing on the page.
 *
 * The whole row is the hit target, and it is a real `<Link>`: these
 * four are the shortest path into the work, and a number you cannot
 * click is a number you have to go find.
 */
export function AttentionRow({
  href,
  icon,
  tone,
  value,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  tone: 'human' | 'danger' | 'auto';
  /** `undefined` while the queue loads — renders an em dash, never a 0. */
  value: number | undefined;
  label: React.ReactNode;
}) {
  const quiet = tone === 'auto';
  return (
    <Link
      href={href}
      className="focus-visible:outline-ring hover:bg-muted flex items-center gap-3 px-3.5 py-2.5 -outline-offset-2 transition-colors focus-visible:outline-2"
    >
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-lg [&>svg]:size-3.5',
          tone === 'human' && 'bg-human-strong text-white',
          tone === 'danger' && 'bg-danger-solid text-white',
          quiet && 'bg-muted text-secondary-foreground'
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          'w-7 shrink-0 text-xl leading-none font-bold tabular-nums',
          tone === 'human' && 'text-human-ink',
          tone === 'danger' && 'text-danger-ink',
          // A zero is not news. It keeps the muted ink so a quiet
          // morning reads as four grey rows rather than four
          // announcements.
          quiet && 'text-muted-foreground'
        )}
      >
        {value ?? '—'}
      </span>
      {/* The caption stays neutral on every tone. It is the same
          sentence whether the number is 0 or 7 — colouring it would be
          the tone saying a third time what the square and the figure
          have already said. */}
      <span className="text-secondary-foreground min-w-0 flex-1 text-xs leading-tight font-medium">
        {label}
      </span>
    </Link>
  );
}
