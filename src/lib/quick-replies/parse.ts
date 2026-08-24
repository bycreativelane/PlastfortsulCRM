import { validateInteractivePayload } from '@/lib/whatsapp/interactive';

/**
 * The one place a quick reply's body is read off a request.
 *
 * Shared by POST and PATCH because the two used to validate the same fields
 * in two places, and `kind: 'media'` plus `shortcut` would have made that
 * three copies of the same three rules.
 */

export type ParsedQuickReplyKind = 'text' | 'interactive' | 'media';

/** The fields that answer "what does this snippet send?". */
export interface ParsedQuickReplyContent {
  kind: ParsedQuickReplyKind;
  content_text: string | null;
  interactive_payload: unknown;
  media_url: string | null;
  media_type: string | null;
}

export interface ParsedQuickReply extends ParsedQuickReplyContent {
  title: string;
  shortcut: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Same cap the column's CHECK enforces (migration 044). */
export const SHORTCUT_MAX = 32;

/**
 * Normalise a shortcut into something typeable after a slash.
 *
 * Lower-cased, stripped of a leading slash somebody typed out of habit, and
 * with everything that is not a letter, digit, dash or underscore removed —
 * a shortcut with a space in it can never be reached, because the `/` panel
 * closes on the first space (a slash mid-sentence must stay a slash).
 *
 * Accents survive: `orçamento` is a word people type, and the panel matches
 * on the same string the database indexes.
 */
export function normalizeShortcut(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    // Not a real limit on anything — a shortcut is a thing you type instead
    // of reading.
    .slice(0, SHORTCUT_MAX);
  return cleaned || null;
}

/**
 * Read `kind` and whichever content column that kind makes authoritative.
 *
 * The others come back null on purpose: a row switched from interactive to
 * text that kept its old payload is a row the picker mis-routes on.
 */
export function parseQuickReplyContent(
  body: Record<string, unknown>
): ParseResult<ParsedQuickReplyContent> {
  const kind: ParsedQuickReplyKind =
    body.kind === 'interactive'
      ? 'interactive'
      : body.kind === 'media'
        ? 'media'
        : 'text';

  const caption = typeof body.content_text === 'string' ? body.content_text : '';

  if (kind === 'interactive') {
    const result = validateInteractivePayload(body.interactive_payload);
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      value: {
        kind,
        content_text: null,
        interactive_payload: body.interactive_payload,
        media_url: null,
        media_type: null,
      },
    };
  }

  if (kind === 'media') {
    const url = typeof body.media_url === 'string' ? body.media_url.trim() : '';
    if (!url) {
      // The database says the same thing in a CHECK (migration 044). Saying
      // it here too turns a 500 into a sentence somebody can act on.
      return {
        ok: false,
        error: 'media_url is required for media quick replies',
      };
    }
    return {
      ok: true,
      value: {
        kind,
        // The caption is optional for media — a catalogue often speaks for
        // itself — which is the one rule that differs from a text snippet.
        content_text: caption.trim() ? caption : null,
        interactive_payload: null,
        media_url: url,
        media_type: typeof body.media_type === 'string' ? body.media_type : null,
      },
    };
  }

  if (!caption.trim()) {
    return {
      ok: false,
      error: 'content_text is required for text quick replies',
    };
  }
  return {
    ok: true,
    value: {
      kind,
      content_text: caption,
      interactive_payload: null,
      media_url: null,
      media_type: null,
    },
  };
}

/** A whole quick reply, as POST needs it. */
export function parseQuickReplyBody(
  body: Record<string, unknown>
): ParseResult<ParsedQuickReply> {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return { ok: false, error: 'title is required' };

  const content = parseQuickReplyContent(body);
  if (!content.ok) return content;

  return {
    ok: true,
    value: { title, shortcut: normalizeShortcut(body.shortcut), ...content.value },
  };
}
