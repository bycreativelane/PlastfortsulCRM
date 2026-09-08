import {
  Crown,
  Shield,
  UserCog,
  UserIcon,
  type LucideIcon,
} from 'lucide-react';

import type { AccountRole } from '@/lib/auth/roles';
import type { ChipVariant } from './settings-chip';

/**
 * Single source of truth for per-role chip metadata across settings
 * surfaces (the Overview identity chip and the Members roster/invite
 * chips). Previously duplicated in both files; hoisted here so a label,
 * icon, or colour change lands once.
 *
 * The ladder is a single hue — owner filled, admin outlined,
 * agent neutral, viewer quiet. Owner used to be amber, which in this
 * system is reserved for "a person must act"; a role that is true forever
 * is never that.
 *
 * There used to be a `className` field beside `variant`: the same ladder
 * written twice, once as a token variant for <SettingsChip> and once as a
 * raw Tailwind string for the two spans the Members tab drew by hand. They
 * had already drifted — `viewer` was outline in the string and filled in
 * the variant, so the same role looked like two different roles depending
 * on which screen you were on. One ladder, one encoding.
 */
export const ROLE_META: Record<
  AccountRole,
  { icon: LucideIcon; label: string; variant: ChipVariant }
> = {
  owner: { icon: Crown, label: 'owner', variant: 'owner' },
  admin: { icon: Shield, label: 'admin', variant: 'admin' },
  agent: { icon: UserCog, label: 'agent', variant: 'muted' },
  // Outline-only so it stays quieter than the filled Agent chip in both
  // modes — bg-card would blend into a card surface in light mode.
  viewer: { icon: UserIcon, label: 'viewer', variant: 'quiet' },
};
