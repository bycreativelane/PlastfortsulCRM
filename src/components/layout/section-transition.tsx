'use client';

import { useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useReplayAnimation } from '@/hooks/use-replay-animation';

/**
 * PageTransition's smaller sibling: for a region that changes while the
 * page around it stays put.
 *
 * Settings is the case that demanded it. Eleven panels share one route,
 * and picking a different one in the rail replaced the entire right-hand
 * column between two frames — the single most jarring transition in the
 * app, and the one the route-level animation deliberately does not
 * cover, because re-animating the page title for a panel swap would be
 * worse than not animating at all.
 *
 * `token` is whatever identifies the current content: a settings
 * section, a tab value, a selected record id.
 */
export function SectionTransition({
  token,
  className,
  children,
}: {
  token: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useReplayAnimation(ref, token, 'section-enter');

  return (
    <div ref={ref} className={cn('section-enter', className)}>
      {children}
    </div>
  );
}
