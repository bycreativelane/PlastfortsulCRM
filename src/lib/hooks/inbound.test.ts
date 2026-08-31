import { describe, it, expect } from 'vitest';

import {
  dedupeKeyFor,
  flattenToVars,
  generateHookToken,
  hashHookToken,
  ipAllowed,
  phoneFrom,
  stepNeedsMessagesScope,
  MESSAGE_STEPS,
} from './inbound';

/**
 * The four decisions the inbound hook's safety rests on.
 *
 * Every one of them fails SILENTLY when it is wrong: an allowlist that
 * passes everybody, a scope check that misses a step, a dedupe key that
 * collides. Nothing errors, nothing looks broken, and the first sign is
 * a WhatsApp number that stopped working.
 */

describe('stepNeedsMessagesScope — the security boundary', () => {
  it('names every step that reaches a customer', () => {
    for (const step of MESSAGE_STEPS) {
      expect(stepNeedsMessagesScope(step)).toBe(true);
    }
  });

  it('lets the CRM-only steps through', () => {
    for (const step of [
      'add_tag',
      'remove_tag',
      'update_contact_field',
      'create_deal',
      'assign_conversation',
      'close_conversation',
      'send_webhook',
    ]) {
      expect(stepNeedsMessagesScope(step)).toBe(false);
    }
  });

  /**
   * The list is written out rather than matched on `send_*`, and this
   * test is why: a step called `notify_customer` would slip past a
   * prefix rule, and a boundary that depends on naming discipline is
   * not a boundary. If somebody adds a customer-facing step, this test
   * does not catch it — but the list is the one place to look.
   */
  it('does not rely on a name prefix', () => {
    expect(stepNeedsMessagesScope('send_webhook')).toBe(false);
  });
});

describe('ipAllowed', () => {
  it('an empty list means anywhere', () => {
    expect(ipAllowed([], '187.1.2.3')).toBe(true);
    expect(ipAllowed([], null)).toBe(true);
  });

  it('matches an address on the list', () => {
    expect(ipAllowed(['187.1.2.3', '10.0.0.1'], '10.0.0.1')).toBe(true);
  });

  it('refuses one that is not', () => {
    expect(ipAllowed(['187.1.2.3'], '187.1.2.4')).toBe(false);
  });

  /**
   * THE ONE THAT WOULD BE A HOLE.
   *
   * A list that fails OPEN when the address cannot be read is not a
   * list — anybody who strips `x-forwarded-for` walks straight through.
   */
  it('refuses an unknown caller when a list exists', () => {
    expect(ipAllowed(['187.1.2.3'], null)).toBe(false);
  });

  /**
   * A dual-stack proxy hands IPv4 over in mapped form. Somebody typing
   * the address they read off `curl ifconfig.me` would never match, and
   * the failure looks like "the allowlist is broken".
   */
  it('treats ::ffff:1.2.3.4 as 1.2.3.4', () => {
    expect(ipAllowed(['187.1.2.3'], '::ffff:187.1.2.3')).toBe(true);
    expect(ipAllowed(['::ffff:187.1.2.3'], '187.1.2.3')).toBe(true);
  });
});

describe('token', () => {
  it('is prefixed so a leak is recognisable', () => {
    expect(generateHookToken()).toMatch(/^whk_[A-Za-z0-9_-]{20,}$/);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, generateHookToken));
    expect(seen.size).toBe(200);
  });

  it('hashes stably, and the hash is not the token', () => {
    const token = generateHookToken();
    expect(hashHookToken(token)).toBe(hashHookToken(token));
    expect(hashHookToken(token)).not.toContain(token);
    expect(hashHookToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('flattenToVars', () => {
  it('flattens nesting with dots, so {{vars.utm.source}} resolves', () => {
    expect(flattenToVars({ utm: { source: 'google', medium: 'cpc' } })).toEqual({
      'utm.source': 'google',
      'utm.medium': 'cpc',
    });
  });

  it('keeps numbers and booleans as text a template can print', () => {
    expect(flattenToVars({ valor: 4820.5, novo: true })).toEqual({
      valor: '4820.5',
      novo: 'true',
    });
  });

  /**
   * A key with a dot in it would make `{{vars.a.b}}` mean two different
   * things depending on the payload — the flat key `a.b`, or `b` nested
   * inside `a`. Ambiguity in a template is worse than a missing value,
   * so those keys are dropped.
   */
  it('drops keys a template could not address unambiguously', () => {
    const out = flattenToVars({ 'a.b': 2, 'tem espaço': 3, ok: 4 });
    expect(out).toEqual({ ok: '4' });
  });

  /** A payload cannot be a denial of service. */
  it('caps the number of keys', () => {
    const huge = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, i) => [`k${i}`, i])
    );
    expect(Object.keys(flattenToVars(huge)).length).toBeLessThanOrEqual(200);
  });

  it('caps the length of one value', () => {
    const out = flattenToVars({ big: 'x'.repeat(50_000) });
    expect(out.big.length).toBeLessThanOrEqual(2_000);
  });

  it('does not recurse forever on deep nesting', () => {
    let deep: Record<string, unknown> = { end: 'bottom' };
    for (let i = 0; i < 50; i++) deep = { nest: deep };
    expect(() => flattenToVars(deep)).not.toThrow();
  });

  /**
   * Unreachable through the route — `JSON.parse` cannot produce a cycle
   * — but `flattenToVars` promises never to throw, and the route relies
   * on that promise. This test found the bug: the depth-limit branch
   * called `JSON.stringify`, which throws on a cycle.
   */
  it('survives a cycle instead of throwing', () => {
    const cyclic: Record<string, unknown> = { name: 'a' };
    cyclic.self = cyclic;
    expect(() => flattenToVars(cyclic)).not.toThrow();
    expect(flattenToVars(cyclic).name).toBe('a');
  });
});

describe('dedupeKeyFor', () => {
  it('prefers an id the sender chose', () => {
    expect(dedupeKeyFor({ event_id: 'evt_1', a: 1 })).toBe('evt_1');
    expect(dedupeKeyFor({ execution_id: 'run_9' })).toBe('run_9');
  });

  it('falls back to the body, so a retry of the same payload matches', () => {
    const body = { phone: '5551999', produto: 'saco 40x60' };
    expect(dedupeKeyFor(body)).toBe(dedupeKeyFor({ ...body }));
  });

  it('separates two genuinely different payloads', () => {
    expect(dedupeKeyFor({ phone: '1' })).not.toBe(dedupeKeyFor({ phone: '2' }));
  });
});

describe('phoneFrom', () => {
  it('accepts the spellings senders actually use', () => {
    expect(phoneFrom({ telefone: '5551999' })).toBe('5551999');
    expect(phoneFrom({ phone_number: '5551999' })).toBe('5551999');
    expect(phoneFrom({ celular: 5551999 })).toBe('5551999');
  });

  it('is null when the payload is not about a person', () => {
    expect(phoneFrom({ produto: 'saco' })).toBeNull();
  });
});
