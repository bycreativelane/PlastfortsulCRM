import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Small role / status pill used across the settings surfaces (the
 * Overview identity chip, the Members roster, the invite rows).
 *
 * It used to carry raw `amber-500`/`emerald-500` washes with `dark:`
 * ink overrides, on the argument that "semantic accents are
 * intentionally not tokenized". Two things were wrong with that. The
 * `dark:` variant matches `.dark *` and this app switches modes with a
 * `data-mode` attribute, so every one of those overrides was dead — the
 * light-mode pairing was the only pairing. And amber is the one colour
 * in this system that means "a person must act right now"; spending it
 * on the word "owner", which is true forever and asks for nothing,
 * empties it of that meaning on the exact screen where the WhatsApp
 * banner needs it.
 *
 * So role is now a single-hue privilege ladder in the accent (filled →
 * outline → neutral), and only `ok`/`warn` keep a semantic colour.
 *
 * Height is 20px, the same 20px as `Badge`, `Tag` and `StatusBadge`.
 * See the note in status-badge.tsx: the app has exactly two chip
 * heights and this used to be a third (`py-0.5` + `text-xs` ≈ 21).
 */
export type ChipVariant = 'owner' | 'admin' | 'ok' | 'warn' | 'muted';

const VARIANTS: Record<ChipVariant, string> = {
  owner: 'border-primary-soft-2 bg-primary-soft text-primary',
  admin: 'border-primary-soft-2 bg-transparent text-primary',
  ok: 'border-ok/25 bg-ok-soft text-ok-ink',
  warn: 'border-human-border bg-human-soft text-human-ink',
  muted: 'border-border bg-muted text-muted-foreground',
};

export function SettingsChip({
  variant = 'muted',
  className,
  children,
}: {
  variant?: ChipVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 text-2xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
