import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// `logTemplateSend` resolve o service role sozinho — ver a regra 2 no
// topo de `usage-log.ts`. O teste espia o mesmo client que ele usa.
const insert = vi.fn().mockResolvedValue({ error: null });
const from = vi.fn(() => ({ insert }));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from }),
}));

import {
  applyMetaPricing,
  logTemplateSend,
  normalizeDeclaredCategory,
} from './usage-log';

beforeEach(() => {
  insert.mockClear();
  insert.mockResolvedValue({ error: null });
  from.mockClear();
});

describe('normalizeDeclaredCategory', () => {
  it('lowercases the TitleCase the local table has carried since 001', () => {
    expect(normalizeDeclaredCategory('Marketing')).toBe('marketing');
    expect(normalizeDeclaredCategory('Utility')).toBe('utility');
    expect(normalizeDeclaredCategory('Authentication')).toBe('authentication');
  });

  it('drops an unknown value instead of letting the CHECK reject the row', () => {
    // Perder a categoria custa uma coluna; perder a linha custa o
    // disparo inteiro no relatório de custo.
    expect(normalizeDeclaredCategory('Carousel')).toBeNull();
    expect(normalizeDeclaredCategory('')).toBeNull();
    expect(normalizeDeclaredCategory(null)).toBeNull();
    expect(normalizeDeclaredCategory(undefined)).toBeNull();
  });
});

describe('logTemplateSend', () => {
  it('maps a send onto the log columns', async () => {
    await logTemplateSend({
      accountId: 'acct-1',
      wamid: 'wamid.AAA',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      broadcastId: null,
      templateId: 'tpl-1',
      templateName: 'promo_julho',
      templateLanguage: 'pt_BR',
      declaredCategory: 'Marketing',
      origin: 'inbox',
    });

    expect(from).toHaveBeenCalledWith('whatsapp_usage_log');
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      account_id: 'acct-1',
      wamid: 'wamid.AAA',
      conversation_id: 'conv-1',
      contact_id: 'contact-1',
      broadcast_id: null,
      template_id: 'tpl-1',
      template_name: 'promo_julho',
      template_language: 'pt_BR',
      declared_category: 'marketing',
      origin: 'inbox',
      last_status: 'sent',
    });
    // Nada de faturamento no disparo: quem preenche é o webhook.
    expect(row.billable).toBeUndefined();
    expect(row.priced_at).toBeUndefined();
  });

  it('does nothing without a wamid — there is nothing to reconcile later', async () => {
    await logTemplateSend({
      accountId: 'acct-1',
      wamid: '',
      templateName: 'promo',
      origin: 'broadcast',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('never throws when the insert fails', async () => {
    insert.mockResolvedValue({ error: { message: 'boom' } });
    await expect(
      logTemplateSend({
        accountId: 'acct-1',
        wamid: 'wamid.AAA',
        templateName: 'promo',
        origin: 'automation',
      })
    ).resolves.toBeUndefined();
  });
});

// ------------------------------------------------------------
// applyMetaPricing — recebe o client de quem chama (o webhook).
// ------------------------------------------------------------

function pricingDb(row: Record<string, unknown> | null) {
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    update,
  };
  const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  return { db, update, chain };
}

describe('applyMetaPricing', () => {
  it('writes what Meta charged onto the matching send row', async () => {
    const { db, update } = pricingDb({
      id: 'log-1',
      last_status: 'sent',
      priced_at: null,
    });

    await applyMetaPricing(db, {
      wamid: 'wamid.AAA',
      status: 'delivered',
      pricing: {
        billable: true,
        pricing_model: 'PMP',
        category: 'utility',
        type: 'regular',
      },
      conversation: { id: 'conv.meta.1', origin: { type: 'utility' } },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        billable: true,
        billable_category: 'utility',
        pricing_model: 'PMP',
        pricing_type: 'regular',
        meta_conversation_id: 'conv.meta.1',
        conversation_origin: 'utility',
        last_status: 'delivered',
      })
    );
    expect(update.mock.calls[0][0].priced_at).toEqual(expect.any(String));
  });

  it('keeps the category Meta billed even when it contradicts ours', async () => {
    // O caso que justifica a coluna separada: arquivamos Marketing e a
    // Meta cobrou Utility. `declared_category` fica intacto.
    const { db, update } = pricingDb({
      id: 'log-1',
      last_status: 'sent',
      priced_at: null,
    });
    await applyMetaPricing(db, {
      wamid: 'wamid.AAA',
      status: 'sent',
      pricing: { billable: true, category: 'utility' },
    });
    const patch = update.mock.calls[0][0];
    expect(patch.billable_category).toBe('utility');
    expect(patch).not.toHaveProperty('declared_category');
  });

  it('accepts a category the product has never heard of', async () => {
    // Sem CHECK na coluna, de propósito: o vocabulário da Meta muda, e
    // recusar a linha perderia o dado para sempre.
    const { db, update } = pricingDb({
      id: 'log-1',
      last_status: 'sent',
      priced_at: null,
    });
    await applyMetaPricing(db, {
      wamid: 'wamid.AAA',
      status: 'sent',
      pricing: { billable: true, category: 'some_future_bucket' },
    });
    expect(update.mock.calls[0][0].billable_category).toBe(
      'some_future_bucket'
    );
  });

  it('does not overwrite pricing that already arrived', async () => {
    const { db, update } = pricingDb({
      id: 'log-1',
      last_status: 'sent',
      priced_at: '2026-08-30T10:00:00.000Z',
    });
    await applyMetaPricing(db, {
      wamid: 'wamid.AAA',
      status: 'read',
      // Um evento posterior traz `pricing` vazio; sobrescrever apagaria
      // o que a tabela existe para guardar.
      pricing: {},
    });
    const patch = update.mock.calls[0][0];
    expect(patch).toEqual({ last_status: 'read' });
  });

  it('refuses a late status that would walk the ladder backwards', async () => {
    const { db, update } = pricingDb({
      id: 'log-1',
      last_status: 'read',
      priced_at: '2026-08-30T10:00:00.000Z',
    });
    await applyMetaPricing(db, { wamid: 'wamid.AAA', status: 'sent' });
    // Nada a escrever: sem avanço de status e sem faturamento novo.
    expect(update).not.toHaveBeenCalled();
  });

  it('never inserts when no send row matches', async () => {
    // A maioria dos status que chegam é de mensagem de texto, que não
    // tem linha aqui. Criar uma inventaria um disparo que não houve.
    const { db, update } = pricingDb(null);
    await applyMetaPricing(db, {
      wamid: 'wamid.UNKNOWN',
      status: 'delivered',
      pricing: { billable: true, category: 'marketing' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('never throws when the lookup fails', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'boom' } }),
    };
    const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await expect(
      applyMetaPricing(db, { wamid: 'wamid.AAA', status: 'sent' })
    ).resolves.toBeUndefined();
  });
});
