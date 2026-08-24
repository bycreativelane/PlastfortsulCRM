'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  MessageSquare,
  UserPlus,
  Briefcase,
  Radio,
  Zap,
  Inbox,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';

import type { ActivityItem, ActivityKind } from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';
import { APP_LOCALE } from '@/lib/i18n/locale';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from '@/components/ui/panel';
import { StatePanel } from '@/components/ui/state-panel';
import { Skeleton } from './skeleton';

interface ActivityFeedProps {
  items: ActivityItem[] | null;
  loading: boolean;
}

const PAGE_SIZES = [5, 10, 20, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];

/**
 * One icon per kind, one badge for all of them.
 *
 * The badge used to be tinted per kind, and the tints did not survive
 * reading: `blue-500` and `blue-400` both re-point to --primary in
 * globals.css, so message, contact and deal already rendered identically
 * — three "distinct" colours that were one. What the hue did manage to
 * do was misfire twice. `broadcast` got amber, the system's single
 * "come here", for an event that already happened and asks nothing of
 * anybody. `automation` got rose, a family with no entry in the theme
 * at all, so it passed through raw at ~2.5:1 on its own tint in light
 * mode — and automation is precisely what the doctrine says must be
 * grey, because it is information rather than attention.
 *
 * The icon is the encoding. It always was.
 */
interface KindTheme {
  icon: ComponentType<{ className?: string }>;
}

const KIND_THEME: Record<ActivityKind, KindTheme> = {
  message: { icon: MessageSquare },
  contact: { icon: UserPlus },
  deal: { icon: Briefcase },
  broadcast: { icon: Radio },
  automation: { icon: Zap },
};

export function ActivityFeed({ items, loading }: ActivityFeedProps) {
  const t = useTranslations('Dashboard.activityFeed');
  // Start at 5 — a quick scan of the most recent events without
  // dominating vertical real estate. User expands explicitly via the
  // footer control when they want deeper history.
  const [pageSize, setPageSize] = useState<PageSize>(5);

  const totalLoaded = items?.length ?? 0;
  const visible = items?.slice(0, pageSize) ?? [];
  // A size option is "useful" if picking it would reveal rows the
  // smaller option doesn't already show. With PAGE_SIZES=[5,10,20,50]:
  // "10" is useful only once we've loaded ≥6 items, "20" once ≥11, etc.
  // The smallest option is always enabled.
  const isSizeUseful = (size: PageSize, i: number) =>
    i === 0 || totalLoaded > PAGE_SIZES[i - 1];

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('title')}</PanelTitle>
        <PanelActions>
          <Link
            href="/inbox"
            className="text-primary hover:text-primary/80 text-xs font-medium transition-colors"
          >
            {t('viewAll')}
          </Link>
        </PanelActions>
      </PanelHeader>

      {loading || !items ? (
        <PanelBody className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </PanelBody>
      ) : items.length === 0 ? (
        <StatePanel
          icon={Inbox}
          title={t('noActivity')}
          description={t('noActivityHint')}
        />
      ) : (
        <>
          <ul className="divide-border divide-y">
            {visible.map((it, i) => {
              const Icon = KIND_THEME[it.kind].icon;
              // Alternating row background for scanability. bg-muted/40
              // keeps the stripe visible in both light and dark modes
              // (bg-card/40 vanishes against a white card surface in light).
              const stripe = i % 2 === 0 ? 'bg-transparent' : 'bg-muted/40';
              const row = (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="bg-muted text-secondary-foreground flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                    {it.text}
                  </span>
                  <span className="text-muted-foreground flex-shrink-0 text-2xs tabular-nums">
                    {relativeTime(it.at, t)}
                  </span>
                </div>
              );
              return (
                <li key={it.id} className={cn(stripe, 'row-interactive')}>
                  {it.href ? (
                    <Link href={it.href} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
          <footer className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs">
            <span className="text-muted-foreground tabular-nums">
              {t('showingOf', {
                visible: visible.length,
                totalLoaded,
                plus: totalLoaded === 50 ? '+' : '',
              })}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground mr-1">{t('show')}</span>
              {PAGE_SIZES.map((size, i) => {
                const disabled = !isSizeUseful(size, i);
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setPageSize(size)}
                    disabled={disabled}
                    className={cn(
                      // Raw <button>, so the shell's coarse-pointer rule for
                      // [data-slot="button"] does not reach it: on a phone
                      // these four sit 26px tall and 24px wide, well under
                      // the 44px minimum. Widened only under a coarse
                      // pointer, so the desktop row does not move.
                      'rounded-md px-2 py-1 font-medium tabular-nums transition-colors [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
                      pageSize === size
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      disabled &&
                        'hover:text-muted-foreground cursor-not-allowed opacity-40 hover:bg-transparent'
                    )}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
          </footer>
        </>
      )}
    </Panel>
  );
}

function relativeTime(
  iso: string,
  t: ReturnType<typeof useTranslations>
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return t('timeS', { sec: Math.max(1, diffSec) });
  if (diffSec < 3600) return t('timeM', { min: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t('timeH', { hr: Math.floor(diffSec / 3600) });
  if (diffSec < 2_592_000)
    return t('timeD', { day: Math.floor(diffSec / 86400) });
  return new Date(iso).toLocaleDateString(APP_LOCALE);
}
