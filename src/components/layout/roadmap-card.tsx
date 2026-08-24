'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Boxes, Plug, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "O que vem por aí", in the one corner of the app that is always on
 * screen and never carries work.
 *
 * The sidebar footer is the right home for an announcement precisely
 * because it is the only surface here that isn't a queue: nothing in it
 * is waiting on the operator, so a card can sit there without competing
 * with a conversation, a deal or a campaign for the same glance.
 *
 * TWO ANNOUNCEMENTS, ONE CARD. Stacking them would have cost the
 * account tile a third of the footer, and a rail that gives 120px of
 * permanent height to news is a rail that gets collapsed. The carousel
 * is what buys the second announcement its space back.
 *
 * WHAT THIS CARD IS NOT: a component with a border, a filled icon tile
 * and a coloured chip. That was the first draft and it had four
 * separate devices — outline, badge, tinted square, rule — all saying
 * "this is a box" in 184px of width. What replaces them is one flat
 * light fill, one hierarchy step held by weight and colour rather than
 * by size, and an illustration that bleeds off the corner instead of
 * sitting in a frame. Everything left is either the message or the way
 * out of it.
 */

/** The announcements, newest intent first. */
const SLIDES = [
  { id: 'vysen', icon: Plug, titleKey: 'vysenTitle', bodyKey: 'vysenBody' },
  { id: 'bling', icon: Boxes, titleKey: 'blingTitle', bodyKey: 'blingBody' },
] as const;

/**
 * How long the card takes to leave, in milliseconds, matching the
 * `--dur-2` the exit animation itself runs at.
 *
 * It is a `setTimeout` and not an `animationend` listener on purpose:
 * the reduced-motion block in globals.css collapses every animation to
 * 0.01ms, and a listener would fire at a moment the user asked not to
 * have. The timer fires either way; the only difference is whether
 * anything moved while it ran.
 */
const EXIT_MS = 180;

export function RoadmapCard() {
  const t = useTranslations('Roadmap');
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const exitTimer = useRef<number | null>(null);
  /**
   * DISMISSAL IS NOT PERSISTED, and that is the decision, not an
   * omission.
   *
   * The first version wrote the closed state to `localStorage` keyed by
   * the announcement, so closing it once closed it for good. That is the
   * right shape for a warning you have read and understood — it is the
   * wrong shape for a roadmap, which is the same two items until they
   * ship and is worth seeing again next time you sit down. Closing it
   * means "not now", not "never".
   *
   * So it lives in React state and nothing else: the card is gone for
   * the rest of this page's life — including every client-side
   * navigation, since the sidebar belongs to the dashboard layout and
   * does not remount between routes — and it is back on the next reload.
   *
   * Not persisting also removes a whole class of problem the storage
   * version had: no read on mount, so no hydration-safe `null` state, no
   * frame where the footer is one height and then another.
   */
  const [dismissed, setDismissed] = useState(false);

  // The only thing left to clean up is the exit timer, if the rail
  // unmounts mid-animation.
  useEffect(
    () => () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    },
    []
  );

  const dismiss = useCallback(() => {
    setLeaving(true);
    exitTimer.current = window.setTimeout(() => setDismissed(true), EXIT_MS);
  }, []);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % SLIDES.length);
  }, []);

  if (dismissed) return null;

  return (
    /**
     * `data-nav-label` and not a `collapsed` prop: collapsing is done in
     * CSS from an attribute on <html> that is stamped before first paint
     * (see `use-nav-collapsed`), so anything that reads it through React
     * arrives a frame late. The card is prose in a 62px rail — there is
     * nothing here that survives the way an icon does, so it leaves
     * whole, with the labels.
     *
     * `overflow-hidden` is load-bearing rather than defensive: the
     * illustration is deliberately larger than the card and positioned
     * past two of its edges, and this is what crops it into a corner
     * motif instead of a floating icon.
     */
    <div
      data-nav-label
      role="region"
      aria-roledescription={t('carousel')}
      aria-label={t('regionLabel')}
      className={cn(
        'bg-muted relative mb-3 overflow-hidden rounded-xl p-3.5',
        // Arrives with the rail rather than appearing in it — 8px of
        // rise and a fade, once, on mount — and leaves the same way,
        // which is the whole reason `leaving` exists: an element that
        // vanishes between two frames reads as a bug, and this one sits
        // directly above the account tile, so its disappearance moves
        // something the eye was resting on.
        //
        // A ternary and not two `cn` entries: `animate-in` and
        // `animate-out` both write `animation`, so having both on the
        // element at once would leave the winner to CSS source order.
        leaving
          ? 'animate-out fade-out-0 slide-out-to-bottom-1 fill-mode-forwards duration-(--dur-2)'
          : 'animate-in fade-in-50 slide-in-from-bottom-2 duration-(--dur-3)'
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss')}
        title={t('dismiss')}
        // The glyph is 12px and the target is 24: what reads as small is
        // the mark, not the button under it. Shrinking the hit area to
        // match the icon would have put a 12px target in a drawer people
        // close with a thumb.
        className="text-muted-foreground/70 hover:bg-card hover:text-foreground focus-visible:ring-ring/50 absolute top-1.5 right-1.5 z-10 grid size-6 place-items-center rounded-md transition-colors outline-none focus-visible:ring-3"
      >
        <X className="size-3" />
      </button>

      {/*
        Both slides are laid on the SAME grid cell, so the card is as
        tall as the longest one in every state and switching moves
        nothing. Rendering only the active slide was a footer that
        changed height under the pointer — and the account tile is the
        thing directly below it.

        `invisible` alongside `opacity-0` because opacity alone leaves a
        clickable, focusable, screen-readable slide sitting on top of the
        visible one.
      */}
      <div className="grid">
        {SLIDES.map((slide, i) => {
          const Icon = slide.icon;
          const active = i === index;
          return (
            <div
              key={slide.id}
              aria-hidden={!active}
              className={cn(
                'ease-out-soft col-start-1 row-start-1 transition-all duration-(--dur-3)',
                active
                  ? 'translate-x-0 opacity-100'
                  : 'invisible translate-x-2 opacity-0'
              )}
            >
              {/*
                The illustration, in the reference's own idiom: line art,
                one weight, cropped by the corner it sits in, faint
                enough to be texture rather than content.

                It moves further and slower than the words do — 12px
                against 8px, on the same duration — so the switch has a
                bit of depth instead of being two flat things crossfading.
                And it is deliberately the same glyph as the small icon
                on the eyebrow: the card gets a motif, not a second
                subject.

                Painted BEFORE the copy and left un-positioned there:
                the text below is wrapped in `relative`, so it stacks on
                top and stays fully opaque over the artwork. Reading has
                to win over decoration when the two overlap.
              */}
              <Icon
                aria-hidden
                strokeWidth={1}
                className={cn(
                  'text-primary ease-out-soft pointer-events-none absolute -right-5 -bottom-6 size-24 opacity-10 transition-transform duration-(--dur-3)',
                  active ? 'translate-x-0 rotate-0' : 'translate-x-3 rotate-6'
                )}
              />

              <div className="relative">
                <div className="text-muted-foreground flex items-center gap-1.5">
                  <Icon className="text-primary size-3 shrink-0" />
                  <span className="text-3xs font-semibold tracking-wider uppercase">
                    {t('soon')}
                  </span>
                </div>
                <p className="text-foreground mt-2 pr-4 text-xs leading-snug font-semibold">
                  {t(slide.titleKey)}
                </p>
                {/*
                  The hierarchy here is one point of size and two of
                  everything else — semibold against regular, foreground
                  against muted. Buying it with size instead would mean a
                  16px headline in a 184px column, which is where the
                  first draft's three-line titles came from.
                */}
                <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
                  {t(slide.bodyKey)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/*
        Manual only — no autoplay.

        A sidebar is peripheral vision for eight hours a day, and this
        app has already had that argument once, with an `animate-ping`
        on the unread dot: motion is the strongest pre-attentive trigger
        there is and it does not habituate, so a card that turns itself
        over every few seconds takes a slice of attention off whatever
        the operator is actually reading, every cycle, forever. Movement
        here answers a gesture — mount, dismiss, click — and never
        starts on its own. The dots say there is a second one; the arrow
        is how you get to it.
      */}
      <div className="relative mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t('goTo', { index: i + 1, total: SLIDES.length })}
              aria-current={i === index}
              className="focus-visible:ring-ring/50 grid h-4 place-items-center rounded-full px-0.5 outline-none focus-visible:ring-3"
            >
              {/* The active dot stretches instead of only recolouring,
                  so position in the set survives without colour. */}
              <span
                className={cn(
                  'ease-out-soft h-1 rounded-full transition-all duration-(--dur-2)',
                  i === index ? 'bg-primary w-3' : 'bg-border w-1'
                )}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={next}
          className="text-primary hover:text-primary-hover focus-visible:ring-ring/50 text-2xs group/next inline-flex items-center gap-1 rounded-md font-medium outline-none focus-visible:ring-3"
        >
          {t('next')}
          {/* The arrow leans into the direction it is about to go. Two
              pixels, on hover only — the reference's "Update →" made
              the same point statically; this one just answers back. */}
          <ArrowRight className="ease-out-soft size-3 transition-transform duration-(--dur-1) group-hover/next:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
