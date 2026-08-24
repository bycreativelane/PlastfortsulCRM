'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { ArrowRight, ChevronDown, Sparkle, Wrench, Zap } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import { dateLocale } from '@/lib/i18n/dates';
import {
  RELEASES,
  countByKind,
  markReleasesSeen,
  type Release,
  type ReleaseChangeKind,
} from '@/lib/releases';
import { Panel, PanelBody } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * "O que mudou aqui dentro."
 *
 * A CRM that a small team lives in all day changes under them without
 * warning, and the change they notice is never the one that was announced —
 * it is the tab that moved. This page exists so that somebody who opens the
 * inbox on Monday and finds it behaving differently has one place to go.
 *
 * NOT A LIST, which is what it was.
 *
 * Nineteen rows of identical weight is a page nobody reads: "Esperando means
 * something different now" sat at exactly the same size as "a button stopped
 * overflowing", so a skim taught you nothing and you closed it. What matters
 * about a release is two or three things; everything else is reassurance
 * that the rest was looked after.
 *
 * So the shape is: the two or three that change how the day works, as
 * cards with a sentence each — then one line saying how much else there was
 * — then the full list, behind a click, for whoever wants it. The older
 * versions collapse entirely, because a release from last week is history
 * rather than news.
 */

const KIND_META: Record<
  ReleaseChangeKind,
  { variant: 'ok' | 'auto' | 'neutral'; icon: typeof Zap }
> = {
  // Green for what you can now do, blue for what got better, grey for what
  // stopped being broken. Grey on purpose: a fixed bug is the absence of a
  // problem, not an arrival, and a page of red "CORRIGIDO" badges reads as
  // a product falling apart rather than one being maintained.
  new: { variant: 'ok', icon: Sparkle },
  improved: { variant: 'auto', icon: Zap },
  fixed: { variant: 'neutral', icon: Wrench },
};

export function WhatsNewPanel() {
  const t = useTranslations('WhatsNew');
  const [latest, ...older] = RELEASES;

  // Opening the page IS reading it — the dot's whole job was to bring
  // somebody here, and it has done that.
  useEffect(() => {
    markReleasesSeen();
  }, []);

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-(--dur-3)">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {latest ? <LatestRelease release={latest} t={t} /> : null}

      {older.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground eyebrow">{t('earlier')}</p>
          {older.map((release) => (
            <PastRelease key={release.version} release={release} t={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function LatestRelease({
  release,
  t,
}: {
  release: Release;
  t: ReturnType<typeof useTranslations>;
}) {
  const [showAll, setShowAll] = useState(false);
  const counts = countByKind(release);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-foreground text-lg font-semibold tracking-tight">
          {t('versionLabel', { version: release.version })}
        </h3>
        <time
          dateTime={release.date}
          className="text-muted-foreground text-xs tabular-nums"
        >
          {format(new Date(`${release.date}T12:00:00`), 'PPP', {
            locale: dateLocale,
          })}
        </time>
        <StatusBadge variant="human" size="sm">
          {t('latest')}
        </StatusBadge>
      </div>

      {/* The cards. Two columns from the container's own mid width — this
          panel sits beside a 236px rail, so a viewport query would call it
          wide at exactly the breakpoint where it is not. */}
      <div className="grid gap-3 @2xl:grid-cols-2">
        {release.highlights.map((highlight) => (
          <Panel key={highlight.key}>
            <PanelBody className="flex h-full flex-col gap-1.5">
              <p className="text-foreground text-sm font-semibold">
                {t(`highlights.${highlight.key}.title`)}
              </p>
              <p className="text-secondary-foreground text-xs leading-relaxed">
                {t(`highlights.${highlight.key}.body`)}
              </p>
              {/* The way in, pushed to the bottom so cards of different
                  text lengths still line their actions up.
                  
                  A release note that only says something changed leaves you
                  to go find it — and the moment you most want to look at a
                  feature is the moment you have just read about it. */}
              {highlight.href && (
                <Link
                  href={highlight.href}
                  className="text-primary hover:text-primary-hover focus-visible:ring-ring/50 mt-auto inline-flex w-fit items-center gap-1 rounded-md pt-2 text-xs font-semibold outline-none focus-visible:ring-3"
                >
                  {t('seeIt')}
                  <ArrowRight className="size-3.5" />
                </Link>
              )}
            </PanelBody>
          </Panel>
        ))}
      </div>

      {/* One line for the size of the rest, and the way into it. The count
          is the point: "and eleven other things" is what tells somebody
          whether the click is worth it. */}
      <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
        <p className="text-muted-foreground text-xs">
          {t('summary', {
            total: release.changes.length,
            new: counts.new,
            improved: counts.improved,
            fixed: counts.fixed,
          })}
        </p>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="text-primary hover:text-primary-hover focus-visible:ring-ring/50 ml-auto inline-flex items-center gap-1 rounded-md text-xs font-semibold outline-none focus-visible:ring-3"
        >
          {showAll
            ? t('hideAll')
            : t('showAll', { count: release.changes.length })}
          <ChevronDown
            className={cn(
              'ease-out-soft size-3.5 transition-transform duration-(--dur-2)',
              showAll && 'rotate-180'
            )}
          />
        </button>
      </div>

      {showAll && <ChangeList release={release} t={t} />}
    </div>
  );
}

function PastRelease({
  release,
  t,
}: {
  release: Release;
  t: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Panel>
      <PanelBody className="py-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 py-3 text-left"
        >
          <span className="text-foreground text-sm font-semibold">
            {t('versionLabel', { version: release.version })}
          </span>
          <time
            dateTime={release.date}
            className="text-muted-foreground text-xs tabular-nums"
          >
            {format(new Date(`${release.date}T12:00:00`), 'PPP', {
              locale: dateLocale,
            })}
          </time>
          <span className="text-muted-foreground ml-auto text-xs">
            {t('changeCount', { count: release.changes.length })}
          </span>
          <ChevronDown
            className={cn(
              'text-muted-foreground ease-out-soft size-4 shrink-0 transition-transform duration-(--dur-2)',
              open && 'rotate-180'
            )}
          />
        </button>
        {open && (
          <div className="border-border border-t py-1">
            <ChangeList release={release} t={t} />
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * The full list, when asked for.
 *
 * An icon rather than a word for the kind. The badge was a fixed-width
 * pill carrying "CORRIGIDO" nineteen times down the left edge — a column of
 * repeated text that has to be read to be skipped. A 12px glyph says the
 * same thing at a glance and gives the sentences their left edge back.
 */
function ChangeList({
  release,
  t,
}: {
  release: Release;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <ul className="divide-border/70 divide-y">
      {release.changes.map((change) => {
        const meta = KIND_META[change.kind];
        const Icon = meta.icon;
        return (
          <li key={change.key} className="flex items-start gap-2.5 py-2.5">
            <StatusBadge
              variant={meta.variant}
              size="sm"
              title={t(`kind.${change.kind}`)}
              className="mt-0.5 size-4.5 shrink-0 justify-center px-0"
            >
              <Icon className="size-2.5" aria-hidden />
              <span className="sr-only">{t(`kind.${change.kind}`)}</span>
            </StatusBadge>
            <span className="text-secondary-foreground min-w-0 text-sm leading-relaxed">
              {t(`items.${change.key}`)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
