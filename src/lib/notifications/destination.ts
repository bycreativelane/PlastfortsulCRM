import type { Notification } from '@/types';

/**
 * Where a notification takes you, or nowhere.
 *
 * Shared by the bell panel and the notifications page, which is the whole
 * point: the panel learned the `contact_id` fallback and the page did not,
 * so the same row was a working link in one surface and a dead click in the
 * other — and the page is the one people open when the panel has already
 * failed to answer them.
 *
 * `null` is a real answer. A notification about something with no page to
 * open — an account-level event, or a row whose subject has since been
 * deleted — must render as text rather than as a control, because a button
 * that does nothing is indistinguishable from a button that is broken.
 */
export function destinationFor(n: Notification): string | null {
  if (n.conversation_id) return `/inbox?c=${n.conversation_id}`;
  if (n.contact_id) return `/contacts?id=${n.contact_id}`;
  return null;
}
