'use client';

import { useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { useReplayAnimation } from '@/hooks/use-replay-animation';

/**
 * The 240ms every route body fades up through.
 *
 * Route changes in this app are client-side and mostly instant, which
 * sounds good and is actually the problem: the whole screen is replaced
 * between two frames with nothing to say it happened. On a navigation
 * you triggered yourself that is merely abrupt; on one the app
 * triggered — a redirect, a deep link from the dashboard's recent list
 * — it reads as a glitch. Six pixels of rise and a fade is the smallest
 * thing that says "this is a new page" without making you wait for it.
 *
 * Keyed on the pathname and not on the search string: `/settings?tab=`
 * changes the query on every rail click, and re-animating the entire
 * page each time you move between settings sections would make the
 * title and the rail flicker for a panel swap that did not touch them.
 * Sections animate themselves — see SectionTransition.
 *
 * This div is also the page's layout box, which is why it takes a
 * `className`: the shell sizes it (centred column with gutters, or a
 * full-height flex column for the app-shaped routes) and the page
 * inside it inherits that. Before it did, a page that wanted the full
 * height had nothing to measure against — this element was 0px tall,
 * being nothing but a wrapper — and had to reach for `position: fixed`
 * or `100vh` arithmetic to escape. Both of those were wrong in ways
 * that took a screenshot to see; see globals.css `@keyframes page-in`.
 */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useReplayAnimation(ref, pathname, 'page-enter');

  return (
    <div ref={ref} className={cn('page-enter', className)}>
      {children}
    </div>
  );
}
