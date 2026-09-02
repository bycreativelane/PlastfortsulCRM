import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// What migration 065 added to the send path: the quick reply is remembered
// on the row, and a human send fires `team_message_sent`.

const h = vi.hoisted(() => ({
  dispatch: vi.fn(async () => {}),
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.dispatch,
}));

vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.text' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.tpl' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.list' })),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    }),
  }),
}));

import { sendMessageToConversation } from './send-message';

interface Captured {
  messageInserts: Record<string, unknown>[];
}

function sendPathDb(
  captured: Captured,
  opts: { quickReplyOwned: boolean; quickReplyColumn: boolean } = {
    quickReplyOwned: true,
    quickReplyColumn: true,
  }
): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    contact: { id: 'ct-1', phone: '+15551234567' },
  };
  const config = {
    id: 'cfg-1',
    phone_number_id: 'pn-1',
    access_token: 'token',
  };

  return {
    from(table: string) {
      let inserted: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') {
            inserted = row;
            captured.messageInserts.push(row);
          }
          return builder;
        },
        update: () => builder,
        maybeSingle: async () => {
          if (table === 'quick_replies') {
            return opts.quickReplyOwned
              ? { data: { id: 'qr-1', shortcut: 'aberto' }, error: null }
              : { data: null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === 'conversations')
            return { data: conversation, error: null };
          if (table === 'whatsapp_config') return { data: config, error: null };
          if (table === 'messages') {
            if (
              !opts.quickReplyColumn &&
              inserted &&
              'quick_reply_id' in inserted
            ) {
              return {
                data: null,
                error: {
                  code: 'PGRST204',
                  message: "Could not find the 'quick_reply_id' column",
                },
              };
            }
            return { data: { id: 'msg-1' }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => h.dispatch.mockClear());

describe('sendMessageToConversation — quick reply and the team trigger (065)', () => {
  it("stores the quick reply and fires team_message_sent for a person's send", async () => {
    const captured: Captured = { messageInserts: [] };
    await sendMessageToConversation(sendPathDb(captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Aqui está o seu orçamento',
      senderId: 'user-1',
      quickReplyId: 'qr-1',
    });

    expect(captured.messageInserts[0].quick_reply_id).toBe('qr-1');
    expect(h.dispatch).toHaveBeenCalledWith({
      accountId: 'acct-1',
      triggerType: 'team_message_sent',
      contactId: 'ct-1',
      context: {
        conversation_id: 'cv-1',
        message_id: 'msg-1',
        quick_reply_id: 'qr-1',
        shortcut: 'aberto',
        template_name: undefined,
      },
    });
  });

  it('drops a quick reply the account does not own, and still sends', async () => {
    const captured: Captured = { messageInserts: [] };
    await sendMessageToConversation(
      sendPathDb(captured, { quickReplyOwned: false, quickReplyColumn: true }),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'oi',
        senderId: 'user-1',
        quickReplyId: 'qr-foreign',
      }
    );
    expect(captured.messageInserts[0]).not.toHaveProperty('quick_reply_id');
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ quick_reply_id: undefined }),
      })
    );
  });

  it('saves the message without the column on a database that has not run 065', async () => {
    const captured: Captured = { messageInserts: [] };
    const result = await sendMessageToConversation(
      sendPathDb(captured, { quickReplyOwned: true, quickReplyColumn: false }),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'oi',
        senderId: 'user-1',
        quickReplyId: 'qr-1',
      }
    );
    expect(result.messageId).toBe('msg-1');
    expect(captured.messageInserts).toHaveLength(2);
    expect(captured.messageInserts[1]).not.toHaveProperty('quick_reply_id');
  });

  it('fires nothing for the public API — an API key is not a person', async () => {
    const captured: Captured = { messageInserts: [] };
    await sendMessageToConversation(sendPathDb(captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'oi',
      senderId: null,
      origin: 'api',
    });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('names the template on a template send so /orcamento_enviado can be a trigger', async () => {
    const captured: Captured = { messageInserts: [] };
    await sendMessageToConversation(sendPathDb(captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'orcamento_enviado',
      templateParams: ['Marcos', 'nº 4172'],
      senderId: 'user-1',
    });
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          template_name: 'orcamento_enviado',
        }),
      })
    );
  });
});
