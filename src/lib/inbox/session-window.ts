/**
 * Meta's 24-hour customer service window.
 *
 * After a customer's last inbound message, there are 24 hours in which you can
 * reply with anything. Past that, only a template Meta has pre-approved will
 * deliver — so the window closing is not a soft deadline, it is the difference
 * between "type a reply" and "you cannot say this to them any more today".
 *
 * Three states, because two were not enough:
 *
 *   open     — hours left. Neutral: this is the normal condition and the
 *              interface should not comment on it.
 *   closing  — under CLOSING_HOURS left. Amber, the one colour that means a
 *              person has to do something, because they do: reply now or lose
 *              the ability to.
 *   expired  — closed. Red.
 *
 * The middle state is the whole point. Showing "3h remaining" in the same calm
 * blue as "22h remaining" tells an agent nothing they can act on, and the
 * moment the number actually matters is the moment it stops being neutral.
 */

/** Length of Meta's window. */
export const WINDOW_HOURS = 24;

/**
 * How long before expiry the pill starts asking for attention.
 *
 * Two hours: long enough to still do something about it (write the reply,
 * find the customer's answer, escalate), short enough that it is not amber
 * for most of the day — which would make amber mean nothing.
 */
export const CLOSING_HOURS = 2;

export type SessionState = 'none' | 'open' | 'closing' | 'expired';

export interface SessionWindow {
  state: SessionState;
  /** Whole hours remaining, floored. Zero once under an hour. */
  hoursLeft: number;
  /** Whole minutes remaining, floored. */
  minutesLeft: number;
}

/**
 * Where the window stands.
 *
 * `lastInboundAt` is the timestamp of the customer's most recent message, or
 * null when they have never written — which is NOT the same as expired. A
 * contact you imported and have not heard from has no window at all, and
 * telling an agent it "expired" would suggest something lapsed that never
 * started.
 */
export function sessionWindow(
  lastInboundAt: string | Date | null | undefined,
  now: Date = new Date()
): SessionWindow {
  if (!lastInboundAt) return { state: 'none', hoursLeft: 0, minutesLeft: 0 };

  const last = new Date(lastInboundAt);
  if (Number.isNaN(last.getTime())) {
    return { state: 'none', hoursLeft: 0, minutesLeft: 0 };
  }

  const msLeft = last.getTime() + WINDOW_HOURS * 3_600_000 - now.getTime();
  if (msLeft <= 0) return { state: 'expired', hoursLeft: 0, minutesLeft: 0 };

  const minutesLeft = Math.floor(msLeft / 60_000);
  const hoursLeft = Math.floor(minutesLeft / 60);

  return {
    state: msLeft <= CLOSING_HOURS * 3_600_000 ? 'closing' : 'open',
    hoursLeft,
    minutesLeft,
  };
}
