import { formatDistanceToNow } from 'date-fns';

import { dateFnsOptions } from '@/lib/i18n/dates';
import type { AutomationTriggerType } from '@/types';

/**
 * The trigger types this build knows how to name.
 *
 * The names themselves are NOT here. They live in
 * `Automations.builder.triggers.*` — the same catalogue the builder's
 * trigger picker reads — so a trigger is worded identically wherever it
 * appears. This file used to carry them as English literals, which
 * printed "Keyword Match" into the chip of every row of a Portuguese
 * table.
 *
 * Typed as a full Record so adding a trigger type to `AutomationTriggerType`
 * fails the build here until it is listed.
 */
const KNOWN_TRIGGERS: Record<AutomationTriggerType, true> = {
  new_message_received: true,
  first_inbound_message: true,
  keyword_match: true,
  new_contact_created: true,
  conversation_assigned: true,
  tag_added: true,
  time_based: true,
  interactive_reply: true,
  webhook_received: true,
  deal_stage_entered: true,
  team_message_sent: true,
  date_field_reached: true,
};

/**
 * The message-catalogue key for a trigger, or null when the row carries a
 * type this build does not recognise — an automation written by a newer
 * version, say. The caller falls back to the raw type rather than asking
 * next-intl for a key that does not exist.
 */
export function triggerLabelKey(type: string): AutomationTriggerType | null {
  return Object.prototype.hasOwnProperty.call(KNOWN_TRIGGERS, type)
    ? (type as AutomationTriggerType)
    : null;
}

/**
 * "há 3 horas" — a relative timestamp in the language this instance is
 * configured to speak.
 *
 * Hand-rolled before, which meant "3h ago" and "never" in English no
 * matter the locale, and a final `toLocaleDateString()` that followed the
 * BROWSER's language — exactly the trap src/lib/i18n/dates.ts exists to
 * close. Returns null for "there is no timestamp" so the caller supplies
 * its own translated wording instead of this module inventing one.
 */
export function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return formatDistanceToNow(then, { addSuffix: true, ...dateFnsOptions });
}
