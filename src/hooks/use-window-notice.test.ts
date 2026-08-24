import { describe, expect, it } from 'vitest';
import { windowKeyFor } from './use-window-notice';

describe('windowKeyFor', () => {
  it('is the inbound message that opened the window', () => {
    expect(windowKeyFor('2026-08-23T19:56:47.716Z')).toBe(
      '2026-08-23T19:56:47.716Z'
    );
  });

  it('has a key for a thread the customer never wrote to', () => {
    // A real state — a contact added by hand, an outbound-only thread — and
    // one that has to be dismissible without colliding with a timestamp.
    expect(windowKeyFor(null)).toBe('none');
    expect(windowKeyFor(undefined)).toBe('none');
  });

  it('changes when the customer replies', () => {
    // The whole point of storing the window rather than `true`: a new
    // inbound message is a new window, so a notice dismissed for the old one
    // comes back when this one closes.
    const before = windowKeyFor('2026-08-22T10:00:00.000Z');
    const after = windowKeyFor('2026-08-23T10:00:00.000Z');
    expect(after).not.toBe(before);
  });
});
