'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { loadTeamPerformance, type AgentPerformance } from '@/lib/team/performance';
import { periodInputValues, type Period } from '@/lib/dashboard/period';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { MemberAvatar } from '@/components/presence/member-avatar';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { cn } from '@/lib/utils';

/**
 * How each attendant is doing — and the audit trail for the router.
 *
 * ------------------------------------------------------------------
 * THE SCORE IS SHOWN WITH ITS PARTS, ALWAYS
 * ------------------------------------------------------------------
 *
 * This number can decide who gets the next conversation, so it will be
 * argued with — by the person it ranked last, on the day it ranked them
 * last. A bare 72 is unarguable in the worst way: nobody can check it,
 * so nobody can trust it, so the first complaint kills the feature.
 *
 * Beside every score sit the two things it is made of — the median
 * reply time and the share resolved — and the panel says the weighting
 * out loud. Somebody who disagrees can point at which half is wrong,
 * which is a conversation worth having.
 *
 * ------------------------------------------------------------------
 * AND IT IS A LIST, NOT A LEAGUE TABLE
 * ------------------------------------------------------------------
 *
 * Sorted by score, because that is the question being asked. But no
 * medals, no podium, no colour on the bottom row — the difference
 * between a team looking at its numbers and a team being ranked against
 * each other is entirely in how the screen presents it, and the second
 * one makes people optimise for the metric instead of the customer.
 */
export function TeamPerformance({ period }: { period: Period }) {
  const t = useTranslations('Reports.performance');
  const { accountId } = useAuth();
  const [rows, setRows] = useState<AgentPerformance[] | null>(null);
  const [names, setNames] = useState<Map<string, { name: string; avatar: string | null }>>(
    new Map()
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    void (async () => {
      const db = createClient();
      const [perf, profiles] = await Promise.all([
        loadTeamPerformance(db, accountId, period).catch(() => []),
        db.from('profiles').select('user_id, full_name, avatar_url'),
      ]);
      if (cancelled) return;

      setNames(
        new Map(
          ((profiles.data ?? []) as {
            user_id: string;
            full_name: string | null;
            avatar_url: string | null;
          }[]).map((p) => [
            p.user_id,
            { name: p.full_name ?? '', avatar: p.avatar_url },
          ])
        )
      );
      // Highest first — but see the note above about what this is not.
      setRows([...perf].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)));
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on the period's identity, not the object: two renders of
    // the same window must not re-fetch it.
  }, [accountId, period.key]);

  if (rows === null) return <Skeleton className="h-64 w-full" />;

  if (rows.length === 0) {
    return (
      <Panel>
        <PanelHeader>
          <PanelTitle>{t('title')}</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <StatePanel icon={Users} title={t('empty')} description={t('emptyHint')} />
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('title')}</PanelTitle>
        {/* The window, then the method. A hand-picked period is named
            by its dates — "Últimos 31 dias" for a report about July
            would be a sentence that is simply untrue, and it is the
            sentence somebody reads to know what they are looking at. */}
        <PanelSub>
          {period.preset === null
            ? t('windowRange', formatWindow(period))
            : t('windowDays', { days: period.days })}{' '}
          {t('description')}
        </PanelSub>
      </PanelHeader>
      <PanelBody className="space-y-2">
        {rows.map((row) => {
          const person = names.get(row.userId);
          return (
            <div
              key={row.userId}
              className="border-border flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <MemberAvatar
                name={person?.name ?? ''}
                avatarUrl={person?.avatar ?? null}
              />

              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {person?.name || t('unnamed')}
                </p>
                {/* THE PARTS, right under the name and before the score.
                    Read left to right, the sentence is "answered in 4
                    min, closed 8 of 12" — and only then the number that
                    summarises it. */}
                <p className="text-muted-foreground text-2xs tabular-nums">
                  {row.medianResponseMinutes === null
                    ? t('noReplies')
                    : t('medianReply', {
                        minutes: Math.round(row.medianResponseMinutes),
                      })}
                  {' · '}
                  {t('resolvedOf', {
                    resolved: row.resolved,
                    handled: row.handled,
                  })}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    'text-lg leading-none font-semibold tabular-nums',
                    // Grey, never green-to-red. A colour scale on people
                    // turns a working number into a verdict, and the
                    // bottom row would read as a warning about a person
                    // rather than about a month.
                    'text-foreground'
                  )}
                >
                  {row.score ?? '—'}
                </p>
                <p className="text-muted-foreground text-3xs">
                  {row.replies > 0
                    ? t('fromReplies', { count: row.replies })
                    : t('noSample')}
                </p>
              </div>
            </div>
          );
        })}

        {/* The weighting, stated. Somebody who disagrees with their
            score deserves to know what it is made of without reading
            the source. */}
        <p className="text-muted-foreground pt-1 text-xs">{t('howItWorks')}</p>
      </PanelBody>
    </Panel>
  );
}

/** The two ends of a hand-picked window, as the operator reads them. */
function formatWindow(period: Period): { from: string; to: string } {
  const raw = periodInputValues(period);
  const pretty = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      month: 'short',
    });
  };
  return { from: pretty(raw.from), to: pretty(raw.to) };
}
