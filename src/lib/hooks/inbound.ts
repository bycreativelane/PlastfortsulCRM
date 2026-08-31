import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The security primitives of the inbound webhook.
 *
 * Kept apart from the route so each one can be tested without standing
 * up a request — and because these are the four decisions the whole
 * feature's safety rests on. A route is easy to review; a comparison
 * that is subtly wrong is not.
 */

/** What a hook is allowed to make the automation engine do. */
export const HOOK_SCOPES = ['data', 'messages'] as const;
export type HookScope = (typeof HOOK_SCOPES)[number];

/**
 * Automation steps that reach a customer's WhatsApp.
 *
 * THE LIST IS THE SECURITY BOUNDARY, so it is written out rather than
 * derived from a naming convention: a future step called `notify_client`
 * would not match `send_*`, and a boundary that depends on somebody
 * naming things consistently is not a boundary.
 */
export const MESSAGE_STEPS = [
  'send_message',
  'send_buttons',
  'send_list',
  'send_template',
] as const;

export function stepNeedsMessagesScope(stepType: string): boolean {
  return (MESSAGE_STEPS as readonly string[]).includes(stepType);
}

/**
 * `whk_` + 32 random bytes, base64url.
 *
 * The prefix is not decoration: it is what lets a leaked string be
 * recognised for what it is — in a log, in a screenshot, in a secret
 * scanner — so the response can be "revoke that hook" instead of "what
 * is this?".
 */
export function generateHookToken(): string {
  return `whk_${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex. What the database stores; the token itself never is. */
export function hashHookToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The first characters, for the screen to tell two hooks apart. */
export function hookTokenHint(token: string): string {
  return token.slice(0, 12);
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The lookup is by hash and Postgres does the matching, so this is only
 * used where a second comparison happens in JS — but a `===` on a secret
 * is the kind of thing that gets copied into the next place, where it
 * does matter.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * The caller's address, as far as it can be known.
 *
 * ------------------------------------------------------------------
 * READ THIS BEFORE TRUSTING THE RESULT
 * ------------------------------------------------------------------
 *
 * `x-forwarded-for` is a header, and headers are written by whoever
 * sends them. It is trustworthy ONLY when a proxy the deployment
 * controls overwrites it — Vercel and most managed platforms do. Behind
 * a proxy nobody configured, or with none at all, a caller can put any
 * address in it and the allowlist becomes a decoration that reads as a
 * lock.
 *
 * That is why the IP allowlist is one layer here and never the only one:
 * the token still has to be right, and the scope still limits the blast
 * radius. Defence that can be spoofed is worth having and is not worth
 * relying on.
 *
 * The FIRST entry is the original client; the rest are the proxies it
 * passed through.
 */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const real = headers.get('x-real-ip')?.trim();
  return real ? normalizeIp(real) : null;
}

/**
 * `::ffff:187.1.2.3` and `187.1.2.3` are the same machine.
 *
 * A dual-stack proxy hands IPv4 addresses over in the mapped form, so a
 * list somebody typed by hand from `curl ifconfig.me` would never match.
 * That failure is silent and looks like "the allowlist is broken".
 */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length);
  // A bracketed IPv6 literal, and a `host:port` pair from some proxies.
  if (trimmed.startsWith('[')) return trimmed.slice(1).split(']')[0];
  return trimmed;
}

/**
 * Is this caller allowed?
 *
 * An EMPTY list means "anywhere", not "nowhere". That default is
 * deliberate and it is the friendly half of the trade: somebody pasting
 * a URL into Typebot for the first time should not have to find their
 * server's address before anything works. The scope limit is what makes
 * that safe — a hook with no IP list still cannot send a message.
 *
 * A non-empty list with an unknown caller ip is a REFUSAL, not a pass.
 * The opposite — failing open when the address cannot be read — is how
 * an allowlist quietly stops being one.
 */
export function ipAllowed(
  allowed: readonly string[],
  clientIp: string | null
): boolean {
  if (allowed.length === 0) return true;
  if (!clientIp) return false;
  // BOTH SIDES are normalised here, not just the list.
  //
  // The route reaches this through `clientIpFrom`, which already
  // normalises — so relying on that would work today and be a security
  // function whose correctness depends on its caller. The comparison
  // normalises what it compares.
  const client = normalizeIp(clientIp);
  return allowed.some((entry) => normalizeIp(entry) === client);
}

/**
 * The key that makes a retry harmless.
 *
 * Prefers an id the sender chose — `event_id`, `id`, `execution_id` are
 * what n8n, Typebot and most senders already carry — because that is
 * stable across a retry even if the sender re-serialises the body.
 *
 * Falls back to a hash of the payload. That is weaker in one specific
 * way worth naming: two GENUINELY separate submissions with identical
 * content collapse into one. For a form that carries a phone and a
 * timestamp this is nearly impossible; for one that carries only
 * "quero um orçamento", two people in the same minute would be one. The
 * unique index is partial (accepted only), so the second is recorded as
 * a duplicate rather than lost silently.
 */
export function dedupeKeyFor(payload: Record<string, unknown>): string {
  for (const field of ['event_id', 'eventId', 'execution_id', 'id']) {
    const value = payload[field];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
    if (typeof value === 'number') return String(value);
  }
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 64);
}

/**
 * Flatten the payload into automation variables.
 *
 * `{{vars.gclid}}` has to resolve to something a person can predict, so
 * nesting is joined with dots: `{ utm: { source: 'google' } }` becomes
 * `vars.utm.source`.
 *
 * THREE LIMITS, and each one is a denial-of-service the route would
 * otherwise accept from anybody who found the URL:
 *
 *   depth   a self-referencing structure cannot recurse forever
 *   keys    a payload with 50k fields cannot exhaust memory
 *   length  one field cannot carry a megabyte into every log row
 *
 * Arrays and objects that survive the depth limit are stringified rather
 * than dropped: a person debugging wants to SEE that something arrived,
 * even in a shape no template can address.
 */
const MAX_DEPTH = 4;
const MAX_KEYS = 200;
const MAX_VALUE_LENGTH = 2_000;

export function flattenToVars(
  payload: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};

  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (Object.keys(out).length >= MAX_KEYS) return;

    if (value === null || value === undefined) return;

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[prefix] = String(value).slice(0, MAX_VALUE_LENGTH);
      return;
    }

    if (depth >= MAX_DEPTH || Array.isArray(value)) {
      // `JSON.stringify` THROWS on a cycle, and this function is on the
      // path of a public endpoint that promises never to fail on a
      // payload. Unreachable through the route as written — a body that
      // came out of `JSON.parse` cannot contain one — but "unreachable
      // today" is a property of the caller, not of this function, and
      // this is the kind of guarantee the next caller will assume.
      try {
        out[prefix] = JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
      } catch {
        out[prefix] = '[unserializable]';
      }
      return;
    }

    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as object)) {
        // Only what a template can address. A key with a dot or a brace
        // in it would produce `{{vars.a.b}}` meaning two different
        // things depending on the payload, which is worse than dropping.
        if (!/^[\w-]+$/.test(key)) continue;
        walk(child, prefix ? `${prefix}.${key}` : key, depth + 1);
      }
    }
  };

  for (const [key, value] of Object.entries(payload)) {
    if (!/^[\w-]+$/.test(key)) continue;
    walk(value, key, 1);
  }

  return out;
}

/**
 * The phone the payload is about, if it names one.
 *
 * Several spellings because every sender picks its own, and asking the
 * operator to rename a field in Typebot before anything works is the
 * kind of friction that makes people give up on the integration.
 */
export function phoneFrom(payload: Record<string, unknown>): string | null {
  for (const field of [
    'phone',
    'telefone',
    'whatsapp',
    'phone_number',
    'phoneNumber',
    'celular',
  ]) {
    const value = payload[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}
