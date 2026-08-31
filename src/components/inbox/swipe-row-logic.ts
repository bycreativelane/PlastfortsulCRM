/**
 * The decisions a swipe makes, with no DOM in them.
 *
 * Separated from `swipe-row.tsx` because this is the half that can be
 * wrong in a way nobody notices: an off-by-one on the commit threshold,
 * a direction that stays live after the account loses write access, a
 * row that slides open onto an action it is not allowed to perform. The
 * pointer plumbing around it is either wired up or visibly broken on
 * first touch; these rules are not.
 *
 * The test environment for this project is `node` with no jsdom, so a
 * component that keeps its rules inside its handlers is a component
 * that cannot be tested at all. These can.
 */

/** Past this much travel, letting go commits the action. */
export const COMMIT_PX = 88;
/** The furthest the row may travel, so the backdrop never runs out. */
export const MAX_PX = 132;
/**
 * Horizontal movement before the row starts following the finger.
 *
 * Not about scrolling — `touch-action: pan-y` settles that in CSS — but
 * about the TAP. Without it a press that wobbles two pixels slides the
 * row visibly before opening the conversation, which reads as an
 * unsteady interface rather than a responsive one.
 */
export const START_PX = 10;

export interface SwipeAbilities {
  /** Nobody has hidden it yet, and this account may write. */
  canArchive: boolean;
  /** It is currently read, and this account may write. */
  canMarkUnread: boolean;
}

export type SwipeAction = 'archive' | 'unread';

/**
 * Where the row should sit for a given finger travel.
 *
 * Negative is left (towards Ocultar), positive is right (towards Não
 * lida). A direction with no action behind it returns 0 — the row
 * refusing to budge is the honest signal that there is nothing that
 * way, and better than sliding open onto an empty backdrop.
 */
export function swipeOffset(dx: number, abilities: SwipeAbilities): number {
  const allowed = dx < 0 ? abilities.canArchive : abilities.canMarkUnread;
  if (!allowed) return 0;
  return Math.max(-MAX_PX, Math.min(MAX_PX, dx));
}

/**
 * What releasing at `offset` should do, or nothing.
 *
 * The ability is checked a second time here on purpose. Between the
 * finger moving and the finger lifting, a realtime patch can arrive —
 * a colleague hides the thread, a new message makes it unread — and
 * committing on a stale permission is how a gesture performs an action
 * the row no longer offers.
 */
export function swipeOutcome(
  offset: number,
  abilities: SwipeAbilities
): SwipeAction | null {
  if (offset <= -COMMIT_PX && abilities.canArchive) return 'archive';
  if (offset >= COMMIT_PX && abilities.canMarkUnread) return 'unread';
  return null;
}

/** Has the finger moved far enough sideways for this to be a swipe? */
export function isSwipeStarted(dx: number): boolean {
  return Math.abs(dx) >= START_PX;
}
