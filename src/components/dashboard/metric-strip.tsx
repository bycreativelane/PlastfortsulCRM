'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The period's headline numbers.
 *
 * ------------------------------------------------------------------
 * WHY THERE IS A HERO NOW
 * ------------------------------------------------------------------
 *
 * The first version of this was four equal cells in one divided panel,
 * and the argument for it still holds against what it replaced: four
 * bordered cards for four readings of one period is four frames drawn
 * around one idea.
 *
 * What it got wrong is the next question. Four EQUAL cells say the four
 * numbers matter equally, and on a 1300px page that reads as a wide
 * band with four small figures floating in it — the top of the page is
 * the biggest thing on screen and the quietest thing on it. Every
 * dashboard worth borrowing from answers this the same way: ONE number
 * is the reason you opened the page, it is drawn at three or four times
 * the weight of everything around it, and the rest step down behind it.
 *
 * So: a hero, and a strip. The hero carries the number the page is
 * actually about — on Relatórios, the money sitting in the pipeline —
 * at 32px in the accent. The other three keep the divided strip they
 * already had, at 24px in the foreground. Two tiers instead of one, and
 * the reader is told where to start.
 *
 * The hero is OPTIONAL, and the strip alone is still a supported shape:
 * Custo de envio passes four readings that genuinely rank equally
 * (disparados · faturáveis · gratuitos · aguardando), and promoting one
 * of them would be a hierarchy the data does not have.
 *
 * ------------------------------------------------------------------
 * EVERY READING NAMES ITS OWN WINDOW
 * ------------------------------------------------------------------
 *
 * `window` is the small word at the top right of each cell — "agora",
 * "hoje", "vs. ontem".
 *
 * It is there because this strip sits under a period picker that does
 * NOT control it. "Conversas ativas" is a count of right now and
 * "Mensagens enviadas hoje" is a count of today, on a page whose header
 * says 30 dias, and nothing on screen admitted that. A reader who
 * switches to 90 dias and watches these numbers not move learns that
 * the control is broken — which is worse than the truth, and the truth
 * is only that these readings are not about the period at all.
 *
 * Every reference dashboard prints the window on the card ("Last 28
 * days", "Last 7 days") even when the whole screen shares one. Here it
 * is not decoration; it is the thing that makes the top of the page
 * honest.
 *
 * ------------------------------------------------------------------
 * ONE MATERIAL, AND THE ACCENT ONLY AS INK
 * ------------------------------------------------------------------
 *
 * Hero and strip are the same card on the same border. The hero was a
 * solid `--primary` block for a while and it did its job too well: two
 * fifths of the widest row on the page, in the most saturated colour
 * the theme owns, is a slab — a lit panel in dark mode with everything
 * calmer built underneath it.
 *
 * `--primary` stayed, as INK on the figure and as the fill of a 24px
 * icon square. It is a pair `theme-contrast.test` asserts at 4.5:1 on a
 * card, it resolves per accent and per mode, and the doctrine has a
 * place for it: primary is emphasis, not a signal. Amber would have
 * been a signal, and this reading is not asking anybody to do anything.
 *
 * The hierarchy never came from the fill. It comes from 32px against
 * 24, accent against foreground, and two fifths of the row against one
 * fifth — all of which survived the fill being removed.
 */

export interface MetricReading {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /**
   * The window this number covers — "agora", "hoje", "vs. ontem".
   * Omit only when the reading genuinely has no time frame.
   */
  window?: ReactNode;
  /** Percent change against the previous period. Omit when there is no basis. */
  delta?: number | null;
  /**
   * What the delta is measured AGAINST — "vs. ontem", "vs. o período
   * anterior".
   *
   * A bare "↓ 40%" is a number whose denominator the reader has to
   * guess, and on this strip they would guess wrong: the window says
   * "hoje" and the comparison is yesterday, which is a different span.
   * Every reference dashboard spells the basis out on the card
   * ("+10% from yesterday", "41% VS last year") and this is why.
   *
   * Only rendered when there is a delta to attach it to.
   */
  deltaLabel?: ReactNode;
  /** Which direction counts as improvement. Defaults to up. */
  betterWhen?: 'up' | 'down';
  /** Shown instead of a delta. */
  note?: ReactNode;
  icon?: ReactNode;
}

export function MetricStrip({
  hero,
  readings,
  loading,
  className,
}: {
  /** The one number the page is about. Rendered at display size. */
  hero?: MetricReading;
  readings: MetricReading[];
  loading?: boolean;
  className?: string;
}) {
  if (!hero) {
    return (
      <Strip readings={readings} loading={loading} className={className} />
    );
  }

  return (
    // 2/5 and 3/5. Half and half would give the hero the same weight as
    // three readings put together, which is the flat hierarchy this was
    // built to get away from; at 2/5 it is plainly the largest single
    // cell and plainly not the whole row.
    <div className={cn('grid gap-4 xl:grid-cols-5', className)}>
      <MetricHero reading={hero} loading={loading} className="xl:col-span-2" />
      <Strip readings={readings} loading={loading} className="xl:col-span-3" />
    </div>
  );
}

/**
 * One reading, at display size. THE SAME CARD AS THE STRIP BESIDE IT.
 *
 * It was a solid `--primary` block, and it worked in the sense that
 * nobody could miss it — which turned out to be the problem. Two fifths
 * of the widest row on the page, filled with the most saturated colour
 * the theme owns, is a slab: on the dark card it read as a lit panel,
 * and every calm thing built underneath it was competing with a
 * headlight.
 *
 * The accent moved to where it moved everywhere else on this pass — the
 * ICON SQUARE AND THE FIGURE. `--primary` on `--card` is a pair
 * `theme-contrast.test` already asserts at 4.5:1, so the number can be
 * read at full accent on the same surface as everything else.
 *
 * The hierarchy survives without the fill, because the fill was never
 * what carried it: 32px against 24px, accent ink against foreground,
 * and two fifths of the row against one fifth. What is gone is only the
 * shouting.
 */
function MetricHero({
  reading,
  loading,
  className,
}: {
  reading: MetricReading;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border bg-card flex flex-col justify-between gap-6 rounded-xl border p-5',
        className
      )}
    >
      <div className="flex items-start gap-2">
        {reading.icon ? (
          <span
            aria-hidden
            // The solid, like every other tone-bearing icon square in
            // the product. It is one of the two places the accent is
            // allowed on this card, so it has to be unambiguous at
            // 24px — a tint would read as a smudge in the corner.
            className="bg-primary text-primary-foreground grid size-6 shrink-0 place-items-center rounded-md [&>svg]:size-3.5"
          >
            {reading.icon}
          </span>
        ) : null}
        <span className="text-secondary-foreground text-3xs mt-1.5 min-w-0 flex-1 font-bold tracking-wider uppercase">
          {reading.label}
        </span>
        {reading.window ? (
          <span className="text-muted-foreground text-3xs mt-1.5 shrink-0 tracking-wide whitespace-nowrap">
            {reading.window}
          </span>
        ) : null}
      </div>

      <div>
        {loading ? (
          <div className="bg-muted h-8 w-40 max-w-full animate-pulse rounded" />
        ) : (
          // The accent, and the only other place it appears here.
          <div className="text-primary text-display font-bold tracking-tight tabular-nums">
            {reading.value}
          </div>
        )}

        {/* THE SAME MOVEMENT LINE THE STRIP USES. There was a second
            copy of this for the hero, and the only reason it existed
            was the accent fill: `--ok-700` and `--danger-700` are inks
            tuned to sit on a NEUTRAL card and neither was ever measured
            against a saturated one, so the hero's copy had to drop the
            green and the red. On the card they are the verified pair
            again, and the duplicate had nothing left to do. */}
        <MetricMovement
          size="md"
          delta={reading.delta}
          deltaLabel={reading.deltaLabel}
          betterWhen={reading.betterWhen}
          note={reading.note}
          loading={loading}
        />
      </div>
    </div>
  );
}

/**
 * The divided strip — the same anatomy it always had, restyled.
 *
 * IT STACKS BY DIVIDER, NOT BY CARD. Below the first breakpoint the
 * strip becomes rows separated by horizontal rules rather than N
 * stacked cards with gaps between them — which on a phone is the
 * difference between one screen and one and a half. `divide-y
 * sm:divide-y-0 sm:divide-x` is the whole mechanism, and it needs no
 * second layout.
 */
function Strip({
  readings,
  loading,
  className,
}: {
  readings: MetricReading[];
  loading?: boolean;
  className?: string;
}) {
  // Three beside a hero, four on their own. The four-up case keeps the
  // 2×2 intermediate step it always had — including the top rule the
  // second row needs, which `divide-x` alone does not supply. Three go
  // straight to a row, because three at `sm` leave no orphan to place.
  const columns =
    readings.length >= 4
      ? 'sm:grid-cols-2 xl:grid-cols-4 sm:[&>*]:border-border sm:[&>*:nth-child(n+3)]:border-t'
      : 'sm:grid-cols-3';

  return (
    <div
      className={cn(
        'border-border bg-card divide-border grid divide-y overflow-hidden rounded-xl border sm:divide-x sm:divide-y-0',
        columns,
        className
      )}
    >
      {readings.map((reading) => (
        <div key={reading.key} className="flex min-w-0 flex-col gap-2 p-4">
          <div className="flex items-start gap-1.5">
            {reading.icon ? (
              <span
                aria-hidden
                className="text-muted-foreground mt-px shrink-0 [&>svg]:size-3.5"
              >
                {reading.icon}
              </span>
            ) : null}
            <span className="text-secondary-foreground min-w-0 flex-1 text-xs font-semibold">
              {reading.label}
            </span>
            {reading.window ? (
              <span className="text-muted-foreground text-3xs shrink-0 tracking-wide whitespace-nowrap">
                {reading.window}
              </span>
            ) : null}
          </div>

          {/* `mt-auto` pins the figure to the bottom of the cell, so a
              label that wraps to two lines in one cell does not push its
              number a line below the others. One row, one baseline —
              the alignment the reserved movement line below was already
              protecting at the other end. */}
          <div className="mt-auto">
            {loading ? (
              <div className="bg-muted h-7 w-24 animate-pulse rounded" />
            ) : (
              <div className="text-2xl leading-none font-bold tracking-tight tabular-nums">
                {reading.value}
              </div>
            )}

            <MetricMovement
              delta={reading.delta}
              deltaLabel={reading.deltaLabel}
              betterWhen={reading.betterWhen}
              note={reading.note}
              loading={loading}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The movement line, or the note that replaces it, or nothing.
 *
 * Always occupies its line even when there is nothing to say — readings
 * where one has a delta and the others do not would otherwise sit at
 * different heights, which is the kind of misalignment that reads as
 * "assembled" without anybody being able to name it.
 */
function MetricMovement({
  delta,
  deltaLabel,
  betterWhen = 'up',
  note,
  loading,
  size = 'sm',
}: {
  delta?: number | null;
  deltaLabel?: ReactNode;
  betterWhen?: 'up' | 'down';
  note?: ReactNode;
  loading?: boolean;
  /**
   * `md` under the hero's 32px figure, `sm` under the strip's 24px.
   *
   * The strip can whisper its second line because the number above it
   * is 24px in a 280px cell. Under a display figure, 11px reads as a
   * footnote somebody forgot to delete.
   */
  size?: 'sm' | 'md';
}) {
  const text = size === 'md' ? 'text-xs' : 'text-2xs';

  if (loading) {
    return <div className="bg-muted mt-2 h-3 w-16 animate-pulse rounded" />;
  }

  if (note) {
    return <div className={cn('text-muted-foreground mt-2', text)}>{note}</div>;
  }

  if (delta === undefined || delta === null) {
    // The reserved line — a cell with nothing to report still holds the
    // space, so readings that DO have a delta do not sit one line lower
    // than the ones that do not. `&nbsp;` rather than a fixed height, so
    // it tracks the type scale if the scale ever moves.
    //
    // `hidden sm:block`, because the alignment it is protecting only
    // exists in a ROW. Stacked on a phone the strip is a list of
    // dividers, there is nothing beside a cell to line up with, and the
    // blank line reads as a row that failed to load — which is what it
    // looked like: "Conversas ativas · 1" followed by 20px of nothing,
    // above two rows that filled theirs.
    return (
      <div className={cn('mt-2 hidden opacity-0 sm:block', text)}>&nbsp;</div>
    );
  }

  const moved = delta !== 0;
  const improving = moved && (betterWhen === 'up' ? delta > 0 : delta < 0);

  return (
    <div
      className={cn(
        'mt-2 flex items-center gap-1 font-semibold',
        text,
        !moved
          ? 'text-muted-foreground'
          : improving
            ? 'text-ok-ink'
            : 'text-danger-ink'
      )}
    >
      {moved ? (
        <>
          {delta > 0 ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )}
          <span className="tabular-nums">
            {delta > 0 ? '+' : ''}
            {delta}%
          </span>
        </>
      ) : (
        '—'
      )}
      {/* The basis, in the neutral ink whatever the arrow did. Green on
          "vs. ontem" would colour the words as well as the number, and
          the words are not the news. */}
      {deltaLabel ? (
        <span className="text-muted-foreground font-normal">{deltaLabel}</span>
      ) : null}
    </div>
  );
}
