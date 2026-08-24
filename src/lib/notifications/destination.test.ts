import { describe, it, expect } from 'vitest';

import { destinationFor } from './destination';
import type { Notification } from '@/types';

/**
 * Shared by the bell panel and the notifications page.
 *
 * They disagreed: the panel learned the `contact_id` fallback and the page
 * did not, so the same row opened a contact from one surface and swallowed
 * the click on the other — and the page is where people go when the panel
 * has already failed to answer them.
 */

function notification(over: Partial<Notification>): Notification {
  return {
    id: 'n1',
    account_id: 'a1',
    user_id: 'u1',
    type: 'new_message',
    title: null,
    body: null,
    read_at: null,
    created_at: '2026-08-24T12:00:00.000Z',
    conversation_id: null,
    contact_id: null,
    actor_user_id: null,
    ...over,
  } as Notification;
}

describe('destinationFor', () => {
  it('prefers the conversation', () => {
    expect(
      destinationFor(notification({ conversation_id: 'c1', contact_id: 'ct1' }))
    ).toBe('/inbox?c=c1');
  });

  it('falls back to the contact', () => {
    expect(destinationFor(notification({ contact_id: 'ct1' }))).toBe(
      '/contacts?id=ct1'
    );
  });

  it('answers null when there is nowhere to go', () => {
    // Which is what makes the row render as text instead of as a button
    // that does nothing.
    expect(destinationFor(notification({}))).toBeNull();
  });
});
