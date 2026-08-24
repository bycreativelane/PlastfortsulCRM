'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';

// Width at/above which the rail is a vertical column (already in view, so
// no auto-scroll needed). Mirrors the Tailwind `lg:` breakpoint that
// drives the row→column switch in the markup below — keep the two in sync.
const RAIL_DESKTOP_MIN_PX = 1024;

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
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
}) {
  const t = useTranslations('Settings');
  const activeRef = useRef<HTMLButtonElement>(null);

  // When horizontal (mobile), keep the active chip in view. On desktop
  // the rail is a static column, so skip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia(`(min-width: ${RAIL_DESKTOP_MIN_PX}px)`).matches)
      return;
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
        'flex [scrollbar-width:none] snap-x gap-1 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden',
        // Twelve sections, no scrollbar in either engine, chips sized to
        // their content: the last visible one could end flush with the
        // edge and read as the end of the list. The edge fade says "there
        // is more this way" without spending a row on arrows. Dropped at
        // `lg`, where the rail is a full column and nothing is cut off.
        '[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] lg:[mask-image:none]',
        'border-border border-b',
        // `top-0` parked the rail flush against the bottom edge of the
        // app bar the moment you scrolled — two stacked navigations
        // touching, with no seam between them. The offset matches the
        // page's own top gutter, so the rail comes to rest exactly where
        // it started rather than sliding under the bar.
        'lg:sticky lg:top-6 lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0'
      )}
    >
      {RAIL_GROUPS.map(({ label, group }) => {
        const items = SETTINGS_SECTIONS.filter(
          (s) => SECTION_META[s].group === group
        );
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
