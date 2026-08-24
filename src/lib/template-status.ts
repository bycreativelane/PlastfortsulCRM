/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION) — the UI maps it to
 * a human label + a `StatusBadge` variant here so the template manager,
 * inbox picker, and broadcast picker stay aligned.
 *
 * These used to be hand-written Tailwind shades ("dark-theme badge
 * classes", per the old comment) on a product whose default mode is
 * LIGHT. Half the shades involved (yellow-600, slate-600/700,
 * orange-600, blue-600) sit outside the @theme remap in globals.css, so
 * they rendered as raw Tailwind washes under remapped ink and landed
 * between 2.4:1 and 3.05:1 — below AA for text. Naming the variant
 * instead of the colour hands the decision back to the one place that
 * has audited pairs for both modes.
 *
 * The mapping follows the colour doctrine, not Meta's severity ordering:
 *   human  — a person must act (PAUSED: the template is live but stopped)
 *   danger — it failed or was taken away (REJECTED, DISABLED)
 *   ok     — confirmed (APPROVED)
 *   auto   — the machine is working on it (PENDING, IN_APPEAL); grey on
 *            purpose, because "Meta is reviewing" is information, not a
 *            summons
 *   neutral— nothing has happened yet (DRAFT, PENDING_DELETION)
 */

import type { MessageTemplateStatus } from '@/types';

export type TemplateStatusVariant =
  | 'neutral'
  | 'auto'
  | 'human'
  | 'ok'
  | 'danger';

export interface TemplateStatusDisplay {
  label: string;
  variant: TemplateStatusVariant;
}

export const templateStatusConfig: Record<
  MessageTemplateStatus,
  TemplateStatusDisplay
> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  PENDING: { label: 'Pending', variant: 'auto' },
  APPROVED: { label: 'Approved', variant: 'ok' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
  PAUSED: { label: 'Paused', variant: 'human' },
  DISABLED: { label: 'Disabled', variant: 'danger' },
  IN_APPEAL: { label: 'In Appeal', variant: 'auto' },
  PENDING_DELETION: { label: 'Pending Deletion', variant: 'neutral' },
};
