'use client';

import Link from 'next/link';
import { UserPlus, Briefcase, Radio, Zap } from 'lucide-react';
import type { ComponentType } from 'react';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  labelKey: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

const ACTIONS: Action[] = [
  { labelKey: 'newContact', href: '/contacts', icon: UserPlus },
  { labelKey: 'newDeal', href: '/pipelines', icon: Briefcase },
  { labelKey: 'newBroadcast', href: '/broadcasts/new', icon: Radio },
  { labelKey: 'newAutomation', href: '/automations/new', icon: Zap },
];

/**
 * Four shortcuts — a ROW on a phone, the dashboard's grid from `sm` up.
 *
 * ------------------------------------------------------------------
 * WHY THE PHONE GETS A DIFFERENT SHAPE, NOT A NARROWER ONE
 * ------------------------------------------------------------------
 *
 * `grid-cols-1` was the honest answer to a real problem — at two columns
 * the label had ~78px and "oportunidade" alone measures ~84px, so it ran
 * past the card's rounded corner — and it cost more than the overflow
 * did. Four 68px cards plus three 16px gaps is 320px of "create
 * something" stacked at the top of a screen whose own subtitle promises
 * to say WHAT DEPENDS ON A PERSON TODAY. Measured at 375×812, the first
 * number on this page landed about three quarters of the way down the
 * first screen. Somebody opening the CRM at 8am on the warehouse floor
 * is not starting a broadcast; they are finding out who is waiting.
 *
 * So the shortcuts stop being cards and become a TOOLBAR: icon over
 * label, one line, about 80px tall. That is the shape every banking and
 * messaging app on the same phone uses for the same job, and it gives
 * ~240px back to the queue below.
 *
 * `flex-1 basis-0` with a floor, rather than a fixed width: at 375px the
 * four share the row exactly and nothing scrolls; at 320px they overflow
 * their floor and the row scrolls, with `snap-x` landing each one. The
 * alternative — a 2×2 grid — saves half as much height and still has to
 * solve the label width.
 *
 * From `sm` the old geometry returns unchanged, class for class, so the
 * two stacked rows on a desktop are still one grid seen twice.
 *
 * The icons carry no per-action hue. They used to: amber on "Nova
 * campanha", which is the one colour in the system that means a person
 * has to act. A shortcut nobody has to press cannot claim it.
 */
export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions');

  return (
    <div
      className={cn(
        // Phone: one scrollable, snapping row.
        'flex snap-x snap-mandatory gap-2 overflow-x-auto',
        // No scrollbar under the row — it would sit between the
        // shortcuts and the queue and read as a divider. The row is
        // short enough that a partly-visible fourth tile is the
        // affordance, on the rare width where one is cut.
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Desktop: the house grid, exactly as before.
        'sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible xl:grid-cols-4'
      )}
    >
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className={cn(
              'surface-interactive group border-border bg-card flex snap-start rounded-xl border',
              // Phone: a column, centred, sized to share the row.
              // `basis-0` is what makes `flex-1` divide the space evenly
              // instead of proportionally to four different label widths.
              'min-w-19 flex-1 basis-0 flex-col items-center justify-center gap-1.5 px-1.5 py-3',
              // Desktop: back to a row with the icon tile on the left.
              // `py-2.5` and not `p-4` on the desktop row. At p-4 with a
              // 36px icon tile these were ~76px tall — as tall as a
              // StatTile below, which carries a number AND a caption.
              // One word of shortcut was buying as much vertical space
              // as a reading, directly above the section this page
              // exists for. ~56px keeps the row legible and hands the
              // difference to "Precisa de você" — which now stacks its
              // icon, figure and caption and is taller still, so the gap
              // between a shortcut and a reading is wider than when this
              // was written.
              'sm:min-w-0 sm:flex-none sm:flex-row sm:items-center sm:justify-start sm:gap-3 sm:px-3.5 sm:py-2.5'
            )}
          >
            <div className="bg-muted text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Icon className="size-4" />
            </div>
            <span className="text-foreground text-2xs w-full min-w-0 text-center leading-tight font-medium text-balance sm:w-auto sm:text-left sm:text-sm">
              {t(a.labelKey as string)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
