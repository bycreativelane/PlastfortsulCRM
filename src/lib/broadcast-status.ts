/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * These used to carry their own class triple —
 * `bg-*-500/10 + text-*-400 + border-*-500/20` — on the claim that the
 * translucent fills sat fine on both surfaces. They did not. `yellow-500`
 * and `purple-*` are not remapped for light mode, so "enviando" measured
 * 2.75:1 and "respondeu" 2.45:1 on white: two of the six statuses were
 * effectively unreadable in the product's default theme. Six hues also
 * meant a recipients table could light up in six directions at once,
 * which is what the colour doctrine exists to prevent.
 *
 * So each status now names a `StatusBadge` VARIANT instead of a palette,
 * and the variant is chosen by meaning, not by mood:
 *
 *   neutral — nothing is being asked of anyone (draft, scheduled, and
 *             every step of normal delivery).
 *   auto    — the machine is working on it right now (sending). Grey by
 *             doctrine: automation is information, not attention.
 *   ok      — confirmed, and scarce: a finished campaign, and a
 *             recipient who actually wrote back.
 *   danger  — it failed.
 *
 * Amber is deliberately absent. Nothing on these two screens needs a
 * person to act on a per-row basis; the amber has to stay worth
 * something for the screens where it does.
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

/** The subset of `StatusBadge` variants these two tables can speak in. */
export type StatusVariant = "neutral" | "auto" | "ok" | "danger";

export interface StatusDisplay {
  label: string;
  variant: StatusVariant;
  /**
   * Set true for statuses that are live / in-flight — currently only
   * `sending`. A STATIC dot, never a pulse: this is an eight-hour
   * screen and an animation that never ends holds pre-attentive
   * attention for as long as the send runs.
   */
  live?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: "draft",
    variant: "neutral",
  },
  scheduled: {
    label: "scheduled",
    variant: "neutral",
  },
  sending: {
    label: "sending",
    variant: "auto",
    live: true,
  },
  sent: {
    label: "sent",
    variant: "ok",
  },
  failed: {
    label: "failed",
    variant: "danger",
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: "pending",
    variant: "neutral",
  },
  sent: {
    label: "sent",
    variant: "neutral",
  },
  delivered: {
    label: "delivered",
    variant: "neutral",
  },
  read: {
    label: "read",
    variant: "neutral",
  },
  replied: {
    label: "replied",
    variant: "ok",
  },
  failed: {
    label: "failed",
    variant: "danger",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
