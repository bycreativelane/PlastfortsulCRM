/**
 * Which bubble a saved file becomes.
 *
 * A media quick reply stores a `media_type` (the MIME the browser reported
 * at upload) and the composer stages it as one of its four kinds. The two
 * vocabularies are not the same and the translation has to be total —
 * `media_type` can be null on a row written before this column existed, or
 * by a browser that reported nothing, and a snippet with no kind is a
 * snippet that cannot be sent.
 *
 * `document` is the fallback for exactly that reason: WhatsApp will deliver
 * anything as a document, so an unknown type arrives intact rather than
 * being refused as a malformed image.
 */

export type QuickReplyMediaKind = 'image' | 'video' | 'document' | 'audio';

export function mediaKindFromMime(
  mime: string | null | undefined
): QuickReplyMediaKind {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * What the file picker accepts for a media snippet.
 *
 * The same list as the composer's PICKER_ACCEPT, minus audio: a canned voice
 * note is not a thing anybody asked for, and the recorder is the only way
 * one gets made. Mirrors the chat-media bucket's allowed_mime_types
 * (migration 023) so an unsupported file is refused by the picker rather
 * than by Storage.
 */
export const QUICK_REPLY_MEDIA_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/3gpp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
].join(',');
