'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/types';
import { useTranslations } from 'next-intl';

interface ReplyQuoteProps {
  /** Sender label of the quoted message: "You" for our own messages,
   *  contact name for customer-sent messages. Caller resolves this — the
   *  quote component doesn't see the parent Message. */
  authorLabel: string;
  /** Compact text preview. Falls back to a placeholder for media types. */
  preview: string;
  /** Present → renders the composer-chip variant with an X button. Absent →
   *  renders the embedded-in-bubble variant. */
  onDismiss?: () => void;
  /** Dead branch, kept only until the prop is removed.
   *
   *  It existed when the outbound bubble was `bg-primary` and the quote had
   *  to be inverted to survive it. The bubble has been `bg-wa-out` — a light
   *  green — since the WhatsApp surfaces landed, so the only caller
   *  (`message-bubble.tsx`) hard-codes `false` with a comment saying why. */
  onPrimary?: boolean;
}

export function ReplyQuote({
  authorLabel,
  preview,
  onDismiss,
  onPrimary = false,
}: ReplyQuoteProps) {
  const t = useTranslations('Inbox.replyQuote');
  const isChip = !!onDismiss;
  return (
    <div
      className={cn(
        'flex items-start gap-2 border-l-2 px-2 py-1',
        onPrimary ? 'border-primary-foreground/50' : 'border-primary',
        isChip
          ? 'bg-muted/80 rounded-md'
          : onPrimary
            ? 'bg-primary-foreground/15 mb-1.5 rounded-md'
            : // A wash of the bubble's own ink. `bg-background/20` composited
              // to a shade LIGHTER than the bubble, so a quoted message lifted
              // off the thread instead of receding into it.
              'bg-wa-inset mb-1.5 rounded-md'
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={cn(
            'text-2xs truncate font-medium',
            onPrimary ? 'text-primary-foreground' : 'text-primary'
          )}
        >
          {authorLabel}
        </div>
        {/* Wrap the preview instead of truncating to a single line.
         *  `truncate` (white-space: nowrap) forced the quote onto one
         *  impossibly-wide line and — because the parent flex chain
         *  lacked `min-w-0` at every step — pushed the entire inbox
         *  layout wider, shoving the contact sidebar off-screen.
         *  `break-words` also wraps long URLs that have no whitespace
         *  to break on. Issue #165.
         *
         *  Two lines, though. Removing `truncate` also removed every
         *  limit: `buildReplyPreview` returns the whole `content_text`,
         *  so quoting an 800-character message rendered 800 characters
         *  above a five-word reply. `line-clamp` cuts by line without
         *  touching `white-space`, so it cannot bring #165 back, and two
         *  lines is enough to recognise what is being answered. */}
        <div className="text-foreground/80 line-clamp-2 text-xs leading-snug break-words whitespace-pre-wrap">
          {preview}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('cancelReply')}
          // 24px of drawing is a fine click and a poor tap; `data-slot`
          // opts into the coarse-pointer hit shield in globals.css, which
          // grows the target to 44px without moving the chip.
          data-slot="button"
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded transition-colors duration-(--dur-1)"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Build the one-line preview text shown inside a reply quote. */
export function buildReplyPreview(
  message: Message,
  t: ReturnType<typeof useTranslations>
): string {
  if (message.content_text) return message.content_text;
  switch (message.content_type) {
    case 'image':
      return t('photo');
    case 'video':
      return t('video');
    case 'audio':
      return t('audio');
    case 'document':
      return t('document');
    case 'location':
      return t('location');
    case 'template':
      return t('template');
    default:
      return t('message');
  }
}
