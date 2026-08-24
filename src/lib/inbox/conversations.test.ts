import { describe, it, expect } from 'vitest';
import { normalizeConversation } from './conversations';
import type { Conversation } from '@/types';

function makeConversation(
  contact: Partial<Conversation['contact']> | null
): Conversation {
  return {
    id: 'c1',
    user_id: 'u1',
    contact_id: 'ct1',
    status: 'open',
    unread_count: 0,
    created_at: '',
    updated_at: '',
    contact: contact
      ? {
          id: 'ct1',
          user_id: 'u1',
          account_id: 'a1',
          phone: '123',
          created_at: '',
          updated_at: '',
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: 'u1',
  name,
  color: '#fff',
  created_at: '',
});

describe('normalizeConversation', () => {
  it('flattens embedded contact_tags into contact.tags', () => {
    const raw = {
      id: 'c1',
      user_id: 'u1',
      contact_id: 'ct1',
      status: 'open' as const,
      unread_count: 0,
      created_at: '',
      updated_at: '',
      contact: {
        id: 'ct1',
        user_id: 'u1',
        account_id: 'a1',
        phone: '123',
        created_at: '',
        updated_at: '',
        contact_tags: [{ tags: tag('t1', 'VIP') }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag('t1', 'VIP')]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags
    ).toBeUndefined();
  });

  /* The bug these exist for: the deals used to be embedded on
     `deals.conversation_id`, which is only set when the deal was created FROM
     a thread. Every deal made on the board came back empty, and an empty
     stage chip is indistinguishable from "no opportunity". */
  it('reads the open deal from the CONTACT, not from the conversation', () => {
    const stage = {
      id: 's1',
      name: 'Em Negociação',
      color: '#0d9dbb',
      pipeline: { name: 'Vendas' },
    };
    const raw = {
      id: 'c1',
      user_id: 'u1',
      contact_id: 'ct1',
      status: 'open' as const,
      unread_count: 0,
      created_at: '',
      updated_at: '',
      contact: {
        id: 'ct1',
        name: 'Marcos',
        deals: [
          {
            id: 'd1',
            status: 'open',
            stage_id: 's1',
            pipeline_id: 'p1',
            stage,
          },
        ],
      },
    } as never;

    const normalized = normalizeConversation(raw);
    expect(normalized.deal?.id).toBe('d1');
    expect(normalized.deal?.stage?.pipeline?.name).toBe('Vendas');
    // And the raw embed does not survive onto the contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).deals
    ).toBeUndefined();
  });

  it('shows no stage when every deal on the contact is closed', () => {
    const raw = {
      id: 'c1',
      user_id: 'u1',
      contact_id: 'ct1',
      status: 'open' as const,
      unread_count: 0,
      created_at: '',
      updated_at: '',
      contact: {
        id: 'ct1',
        deals: [
          { id: 'd1', status: 'won', stage_id: 's1', pipeline_id: 'p1' },
          { id: 'd2', status: 'lost', stage_id: 's2', pipeline_id: 'p1' },
        ],
      },
    } as never;
    // Last quarter's outcome on today's thread is worse than nothing.
    expect(normalizeConversation(raw).deal).toBeNull();
  });

  it('takes the newest when several are open', () => {
    const raw = {
      id: 'c1',
      user_id: 'u1',
      contact_id: 'ct1',
      status: 'open' as const,
      unread_count: 0,
      created_at: '',
      updated_at: '',
      contact: {
        id: 'ct1',
        deals: [
          { id: 'old', status: 'open', stage_id: 's1', pipeline_id: 'p1' },
          { id: 'new', status: 'open', stage_id: 's2', pipeline_id: 'p1' },
        ],
      },
    } as never;
    expect(normalizeConversation(raw).deal?.id).toBe('new');
  });

  it('passes through a conversation with no contact', () => {
    const raw = {
      id: 'c1',
      user_id: 'u1',
      contact_id: 'ct1',
      status: 'open' as const,
      unread_count: 0,
      created_at: '',
      updated_at: '',
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});
