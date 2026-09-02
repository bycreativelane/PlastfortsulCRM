'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { hasUnreadRelease, lastSeenRelease } from '@/lib/releases';
import { useCapabilityCheck } from '@/hooks/use-can';
import {
  RAIL_GROUPS,
  SECTION_META,
  visibleSections,
  type SettingsSection,
} from './settings-sections';

/**
 * The settings left rail — grouped, vertical on desktop and a
 * horizontal scroller on narrow screens (mirrors the mockup's ≤920px
 * behaviour). The active item auto-scrolls into view when the rail is
 * horizontal so a deep-linked section is never off-screen.
 */
export function SettingsRail({
  active,
  onSelect,
  hints,
  className,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
  /** The page uses this to stand the rail down on the phone's landing —
   *  see the note at its call site in `settings/page.tsx`. */
  className?: string;
}) {
  /**
   * The rows this person can actually use.
   *
   * This used to be an `area` prop — one component, two doors. There is
   * one door now and the filter is what they can do, so an agent's rail
   * is seven rows that all work rather than eighteen where eleven refuse.
   * The panels and the policies still refuse on their own; see the note
   * in `settings-sections.ts` about this being the courtesy.
   */
  const { can, ready } = useCapabilityCheck();
  // HELD UNTIL THE PROFILE LANDS. Every gate answers false while it is in
  // flight, so drawing now would paint an admin the seven ungated rows
  // and then pop the other eleven in a moment later — a rail that
  // changes length under the cursor. `ready` is on the hook for exactly
  // this; not using it here was the bug.
  const allowed = ready ? visibleSections(can) : [];
  /**
   * Whether this browser has seen the latest release notes.
   *
   * Read in an effect rather than during render: `localStorage` is not
   * available on the server, and a dot that exists in the client tree and
   * not the server one is a hydration mismatch. One frame without the dot
   * costs nothing.
   */
  const [unreadRelease, setUnreadRelease] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnreadRelease(hasUnreadRelease(lastSeenRelease()));
  }, [active]);

  const t = useTranslations('Settings');
  const activeRef = useRef<HTMLButtonElement>(null);

  /**
   * Keep the active row in view, on BOTH layouts.
   *
   * It used to skip desktop, on the grounds that the column was static
   * and everything in it was already on screen. That stopped being true
   * when the two destinations merged: eighteen rows do not fit an 800px
   * viewport, so the column scrolls now, and a deep link to a section
   * near the bottom — `?tab=whats-new`, the last one — would open with
   * its own row out of sight.
   *
   * `block: 'nearest'` does nothing when the row is already visible, so
   * the common case still costs no movement, and `inline: 'center'` only
   * bites on the horizontal layout.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    activeRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [active]);

  return (
    <nav
      aria-label={t('railAria')}
      className={cn(
        'flex snap-x gap-1 overflow-x-auto pb-2',
        // Chips sized to their content, no scrollbar in either engine:
        // the last visible one could end flush with the edge and read as
        // the end of the list. The edge fade says "there is more this
        // way" without spending a row on arrows. Both the hidden
        // scrollbar and the fade are scoped BELOW `lg` now — see the
        // height note under it, where the desktop column wants a real
        // scrollbar rather than a hidden one.
        'max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden',
        'max-lg:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]',
        'border-border border-b',
        // `top-0` parked the rail flush against the bottom edge of the
        // app bar the moment you scrolled — two stacked navigations
        // touching, with no seam between them. The offset matches the
        // page's own top gutter, so the rail comes to rest exactly where
        // it started rather than sliding under the bar.
        //
        // AND IT HAS TO BE ABLE TO SCROLL ON ITS OWN.
        //
        // Merging the two settings destinations back into one rail took
        // it from twelve rows to eighteen in four groups. Measured: 796px
        // at 36px a row plus three group headings — on an 800px viewport
        // that is four pixels of slack before the 24px top gutter, so on
        // any laptop it does not fit. A `sticky` element taller than the
        // viewport silently stops being sticky (it just scrolls with the
        // page), which means the rail's top disappears while you are deep
        // in a panel and there is no way back to it without scrolling the
        // whole page up.
        //
        // Capped and scrollable, it stays put and the scrollbar says
        // there is more. `overflow-x-hidden` alongside is deliberate:
        // `visible` on one axis with a non-visible other computes to
        // `auto`, which would put a phantom horizontal scrollbar on a
        // column that has nothing to scroll sideways.
        //
        // THE CAP IS MEASURED AGAINST THE SCROLLPORT, NOT THE VIEWPORT,
        // AND THAT IS THE WHOLE FIX.
        //
        // It was `calc(100vh - 4rem)`, and the sticky above it stopped
        // working the moment a panel grew tall enough to scroll — which
        // on Novidades is one click of "ver todos". The rail scrolled
        // away with the page, exactly the failure the note above warns
        // about, and the reason is arithmetic:
        //
        //   the sticky ancestor is <main>, not the document, and <main>
        //   is `100dvh` minus the app header — the header is `min-h-14`,
        //   so 3.5rem.
        //
        //   sticky holds only while  rail height + top offset ≤ scrollport
        //     old:  (100vh − 4rem) + 1.5rem  =  100vh − 2.5rem
        //     have:  100dvh − 3.5rem
        //
        //   That is 1rem too tall, on every viewport. It never worked; it
        //   only became visible when a panel finally overflowed.
        //
        //   new:  (100dvh − 5rem) + 1.5rem  =  100dvh − 3.5rem  ✓ exactly
        //
        // `dvh` and not `vh` for the reason spelled out on `h-vh-*` in
        // globals.css: nothing in this app scrolls the document, so the
        // URL bar never hides and the value never moves mid-gesture.
        'lg:sticky lg:top-6 lg:max-h-[calc(100dvh-5rem)] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:border-b-0 lg:pb-0',
        className
      )}
    >
      {RAIL_GROUPS.map(({ label, group }) => {
        const items = allowed.filter((s) => SECTION_META[s].group === group);
        // A group with nothing in it draws its own heading over empty
        // space. Reachable now that permissions decide the rows: an agent
        // has nothing under "Espaço de trabalho" except Novidades, and a
        // narrowing override can empty a group outright.
        if (items.length === 0) return null;
        return (
          <div
            key={group}
            className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5"
          >
            {label ? (
              <div className="text-muted-foreground eyebrow hidden px-3 pt-4 pb-1.5 lg:block">
                {t(`groups.${group}`)}
              </div>
            ) : null}
            {items.map((s) => {
              const meta = SECTION_META[s];
              const Icon = meta.icon;
              const isActive = s === active;
              return (
                <button
                  key={s}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    // `py-2.5` on touch, `lg:py-2` back on the pointer
                    // column: a raw <button> gets none of the coarse-pointer
                    // padding that `[data-slot="button"]` does, and 36px is
                    // under the 44px target. Same trade the main sidebar makes.
                    'flex shrink-0 snap-start items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors duration-(--dur-1) lg:py-2',
                    'lg:w-full',
                    isActive
                      ? 'bg-primary-soft text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{t(`sections.${s}`)}</span>
                  {/* The dot is the entire announcement mechanism for a
                      release. It is 6px and it is not amber: nothing here is
                      waiting on the operator, and borrowing the colour that
                      means "act on this" for "there is reading available"
                      is how that colour stops meaning anything. */}
                  {s === 'whats-new' && unreadRelease && (
                    <span
                      aria-hidden
                      className="bg-primary size-1.5 shrink-0 rounded-full"
                    />
                  )}
                  {hints?.[s] != null ? (
                    <span
                      className={cn(
                        'hidden items-center gap-1.5 text-xs lg:inline-flex',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {hints[s]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
