import { describe, expect, it } from 'vitest';

import { flattenDealTags } from './tags';
import type { Deal, Tag } from '@/types';

const tag = (id: string, name: string): Tag => ({
  id,
  user_id: 'u1',
  name,
  color: '#3b82f6',
  created_at: '2026-01-01T00:00:00Z',
});

function deal(contact: unknown): Deal {
  return {
    id: 'd1',
    user_id: 'u1',
    pipeline_id: 'p1',
    stage_id: 's1',
    contact_id: 'c1',
    title: 'Negócio',
    value: 100,
    created_at: '2026-01-01T00:00:00Z',
    contact,
  } as Deal;
}

describe('flattenDealTags', () => {
  it('lifts the join rows onto contact.tags', () => {
    const out = flattenDealTags(
      deal({
        id: 'c1',
        name: 'Marcos',
        contact_tags: [{ tags: tag('t1', 'VIP') }, { tags: tag('t2', 'Revenda') }],
      })
    );
    expect(out.contact?.tags?.map((t) => t.name)).toEqual(['VIP', 'Revenda']);
  });

  it('drops the join row of a deleted tag instead of crashing the board', () => {
    // A linha de junção sobrevive à etiqueta apagada; sem o filtro, o cartão
    // lê `.name` de `null` e derruba o quadro inteiro.
    const out = flattenDealTags(
      deal({ id: 'c1', contact_tags: [{ tags: null }, { tags: tag('t1', 'VIP') }] })
    );
    expect(out.contact?.tags).toEqual([tag('t1', 'VIP')]);
  });

  it('leaves the join key off the flattened contact', () => {
    const out = flattenDealTags(
      deal({ id: 'c1', contact_tags: [{ tags: tag('t1', 'VIP') }] })
    );
    expect(out.contact).not.toHaveProperty('contact_tags');
  });

  it('gives an empty array when the embed came back empty', () => {
    expect(flattenDealTags(deal({ id: 'c1', contact_tags: [] })).contact?.tags)
      .toEqual([]);
    expect(flattenDealTags(deal({ id: 'c1' })).contact?.tags).toEqual([]);
  });

  it('passes a contactless deal through untouched', () => {
    // `contact_id` é anulável desde a migração 004: apagar um contato deixa o
    // negócio com o histórico e sem ficha.
    const raw = deal(null);
    expect(flattenDealTags(raw)).toBe(raw);
  });
});
