/**
 * What a message looks like when it is not the message — the one line in a
 * conversation row, and the label above a bubble.
 *
 * Two problems, both of them leaks from a layer below.
 *
 * THE SIGNATURE. A shared WhatsApp number answers in one voice, so an agent
 * can sign a reply and the customer sees "*Thales*" in bold above it. That
 * prefix is part of the message envelope — it has to be, because the
 * customer never sees this interface — and `signMessage` puts it into
 * `content_text` at send time. The cost is that OUR side then renders the
 * raw asterisks too, in the bubble and in the list, which is what the report
 * meant by "não precisa enviar no front o *Matheus* aparecendo".
 *
 * Solved on the way OUT rather than on the way IN. Stripping at send would
 * mean a second column and a migration, and would do nothing for the
 * thousands of messages already stored. Parsing at render fixes the history
 * for free.
 *
 * THE MEDIA PLACEHOLDER. The inbound webhook has no text for a photo, so it
 * writes Meta's own type name in brackets — `[audio]`, `[image]` — straight
 * into `conversations.last_message_text`. It is a debug string that reached
 * production: not translated, not capitalised, and it tells an operator
 * scanning a list of ten rows nothing they could not have guessed.
 *
 * Also resolved on read, for the same reason: every row already in the
 * database says `[audio]` today, and a fix that only applied to tomorrow's
 * messages would leave the list half-mended.
 */

/** The kinds Meta sends that have no text of their own. */
export type MediaPlaceholderKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts';

const PLACEHOLDER_KINDS = new Set<string>([
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contacts',
]);

/**
 * `[audio]` → `'audio'`. Null for anything a person actually wrote.
 *
 * Deliberately strict about the shape — the whole string, brackets at both
 * ends, one known word inside. A customer who writes "[audio]" as a joke
 * gets their message shown as typed, which is the only correct answer, and
 * a type we have never seen falls through to being displayed as-is rather
 * than silently becoming "Arquivo".
 */
export function mediaPlaceholderOf(
  text: string | null | undefined
): MediaPlaceholderKind | null {
  const match = /^\[([a-z_]+)\]$/.exec((text ?? '').trim());
  if (!match) return null;
  const kind = match[1];
  return PLACEHOLDER_KINDS.has(kind) ? (kind as MediaPlaceholderKind) : null;
}

export interface SignedText {
  /** The agent's name, when the message carries one. */
  signature: string | null;
  /** What is left after removing the signature line. */
  body: string;
}

/**
 * Pull `*Thales*\n` off the front of an outbound message.
 *
 * THE CONSTRAINTS ARE THE POINT, because this is a guess about text a person
 * typed and a wrong guess eats their first line:
 *
 *   · Only where a signature can exist — the caller passes outbound only.
 *     An inbound `*word*` is the customer's own bold and stays.
 *   · The asterisks must wrap the WHOLE first line, and that line must be
 *     followed by more message. A one-line `*urgente*` is emphasis, not a
 *     signature, and nothing is stripped from it.
 *   · No asterisk inside, and 40 characters at most. "Thales · Vendas"
 *     passes; a bolded opening sentence does not.
 *
 * Anything that fails those comes back untouched with `signature: null`,
 * which renders exactly as it does today.
 */
export function splitSignature(
  text: string | null | undefined,
  { outbound }: { outbound: boolean }
): SignedText {
  const value = text ?? '';
  if (!outbound) return { signature: null, body: value };

  const match = /^\*([^*\n]{1,40})\*\n([\s\S]+)$/.exec(value);
  if (!match) return { signature: null, body: value };

  const signature = match[1].trim();
  if (!signature) return { signature: null, body: value };

  return { signature, body: match[2] };
}

export interface ConversationPreview {
  /** The kind of thing it was, when it was not text. */
  media: MediaPlaceholderKind | null;
  /** A thumbnail to draw, when there is one worth drawing. */
  thumbnailUrl: string | null;
  /** What was said — a caption, or the message itself. May be empty. */
  text: string;
}

/** The kinds a 28px square can actually show. */
const THUMBNAILABLE = new Set<MediaPlaceholderKind>([
  'image',
  'video',
  'sticker',
]);

/**
 * The conversation row's one line of message.
 *
 * MEDIA AND TEXT TOGETHER, which the earlier version could not do. It
 * returned one or the other, because all it had was `last_message_text`: a
 * photo with no caption stored `[image]` and a photo WITH one stored the
 * caption, so a captioned photo was indistinguishable from a text message.
 * Migration 047 stores the kind alongside, so the row can say "photo" and
 * show what was written on it.
 *
 * `kind` and `mediaUrl` are optional and the bracket-parsing stays as the
 * fallback: every row written before 047 has neither, and they are the rows
 * the fix was reported about.
 */
export function conversationPreview(
  lastMessageText: string | null | undefined,
  kind?: string | null,
  mediaUrl?: string | null
): ConversationPreview {
  // The list cannot know whether the last message was ours, so it asks for
  // the signature to be stripped regardless. The shape is specific enough
  // that a customer's message is not plausibly mistaken for one, and the
  // failure mode if it were — losing a bolded first line — is smaller than
  // showing every one of our own replies with asterisks in it.
  const stripped = splitSignature(lastMessageText, { outbound: true }).body;

  const stored = normalizeKind(kind);
  const parsed = mediaPlaceholderOf(lastMessageText);
  const media = stored ?? parsed;

  return {
    media,
    thumbnailUrl:
      media && THUMBNAILABLE.has(media) && mediaUrl ? mediaUrl : null,
    // A bracket placeholder is not text anybody wrote — it is the debug
    // string this module exists to hide.
    text: parsed ? '' : stripped,
  };
}

/**
 * `content_type` → the kinds this module names.
 *
 * `text`, `template` and `interactive` are messages somebody composed, so
 * they have words of their own and no icon is wanted. Everything else is an
 * attachment.
 */
function normalizeKind(
  kind: string | null | undefined
): MediaPlaceholderKind | null {
  if (!kind) return null;
  return PLACEHOLDER_KINDS.has(kind) ? (kind as MediaPlaceholderKind) : null;
}
