'use client';

import Link from 'next/link';
import { UserPlus, Briefcase, Radio, Zap } from 'lucide-react';
import type { ComponentType } from 'react';

import { useTranslations } from 'next-intl';

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
 * Four shortcuts, laid out on the dashboard's own grid.
 *
 * Two things were wrong and they were the same thing. The row used to be
 * `grid-cols-2 gap-3 sm:grid-cols-4` while the tile row directly below it
 * is `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4` — so between 640
 * and 1280px the top row had four columns over the bottom row's two, and
 * even at xl the 12px gap put every vertical edge 4px off the tiles'. Two
 * stacked rows of four whose borders never line up read as two widgets
 * that happen to be near each other. It now uses the house ladder, class
 * for class, and inherits the tile's geometry (`rounded-lg`, `p-4`) so the
 * two rows are one grid seen twice.
 *
 * Starting at one column also settles the 360px overflow: at two columns
 * the label had ~78px of room and "oportunidade" alone measures ~84px, so
 * it ran past the card's rounded corner. `min-w-0` + `leading-tight` are
 * the belt to that suspenders — a long label wraps rather than escapes.
 *
 * The icons carry no per-action hue. They used to: amber on "Nova
 * campanha", which is the one colour in the system that means a person
 * has to act. A shortcut nobody has to press cannot claim it.
 */
export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions');

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="surface-interactive group border-border bg-card flex items-center gap-3 rounded-lg border p-4"
          >
            <div className="bg-muted text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-foreground min-w-0 text-sm leading-tight font-medium">
              {t(a.labelKey as string)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
