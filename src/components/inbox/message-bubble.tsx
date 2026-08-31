'use client';

import { cn } from '@/lib/utils';
import { MessageTicks } from './message-ticks';
import type { Message, MessageReaction } from '@/types';
import {
  MapPin,
  LayoutTemplate,
  CornerDownLeft,
  Sparkles,
  Captions,
} from 'lucide-react';
import { format } from 'date-fns';
import { ReplyQuote } from './reply-quote';
import { MessageReactions } from './message-reactions';
import {
  MediaAudioBubble,
  MediaDocumentBubble,
  MediaImageBubble,
  MediaUnavailable,
  MediaVideoBubble,
} from './message-media';
import { InteractivePreview } from '@/components/interactive/interactive-preview';
import { useTranslations } from 'next-intl';
import { splitSignature } from '@/lib/inbox/message-preview';

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /**
   * Opens the thread's media viewer on this message. Only images and videos
   * call it; omitted when the parent renders no viewer, in which case media
   * stays inline and non-clickable.
   */
  onOpenMedia?: (messageId: string) => void;
  /**
   * First bubble of a same-sender run. WhatsApp draws the tail only
   * there and butts the rest of the run tight underneath, which is
   * what makes a burst of four messages read as one turn instead of
   * four. Defaults to true so a lone bubble still gets its tail.
   */
  firstOfRun?: boolean;
  /**
   * The colleague who wrote this, when we know — `profiles.full_name`
   * resolved from `messages.sender_id`.
   *
   * NOT the same thing as the `*Nome*` signature below. That prefix is
   * addressed to the CUSTOMER, is off by default, and carries whatever
   * nickname one browser's localStorage holds. This is who actually
   * pressed send, and it is drawn for the team.
   *
   * Null until migration 056 — before it, no send path wrote `sender_id`.
   */
  senderName?: string | null;
}


/**
 * The words inside an attachment, when the account has them.
 *
 * `media_transcript` arrives with migration 049 and is written by the
 * inbound webhook — the spoken text of a voice note, or a description of
 * a photograph. See `@/lib/ai/media-understanding` for why: everything
 * downstream of a message reads `content_text`, and for these two kinds
 * it is empty.
 *
 * COLLAPSED, and that is the whole design of it. An agent scanning a
 * thread wants to see that a voice note has a transcript, not to read a
 * paragraph of it in every bubble on the way past — a wall of transcribed
 * speech would make the audio player harder to find, not easier. So the
 * summary line is one row at metadata weight and the text is one click
 * behind it, which is also what keeps the bubble the same height it was
 * before this feature existed.
 *
 * Nothing renders for `failed` or `unsupported`. A bubble saying "we
 * could not transcribe this" is an apology in a place where the customer
 * is waiting, and the person who can act on it is not looking at this
 * screen — the failure is in the server log and, once 049 is applied, on
 * the row itself.
 */
function MediaTranscript({
  message,
  t,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
}) {
  const text = message.media_transcript?.trim();
  if (!text || message.media_transcript_status !== 'done') return null;

  return (
    <details className="group/transcript mt-1.5">
      <summary className="text-muted-foreground hover:text-foreground text-2xs flex cursor-pointer list-none items-center gap-1 font-medium transition-colors [&::-webkit-details-marker]:hidden">
        <Captions className="size-3 shrink-0" />
        {message.content_type === 'image' ? t('imageRead') : t('transcript')}
      </summary>
      {/* The rule is the tell: an indented block with a left border reads
          as a quotation of the attachment rather than as something
          somebody typed, which matters in a thread where every other
          paragraph IS something somebody typed. */}
      <p className="border-border/70 text-muted-foreground mt-1 border-l-2 pl-2 text-xs break-words whitespace-pre-wrap italic">
        {text}
      </p>
    </details>
  );
}

function MessageContent({
  message,
  t,
  isAgent,
  onOpenMedia,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  /** Outbound bubbles sit on the primary fill — badges must invert. */
  isAgent: boolean;
  onOpenMedia?: (messageId: string) => void;
}) {
  // Passed to the media bubbles as a no-arg callback; `undefined` when the
  // parent wired up no viewer, which is what makes them non-clickable.
  const openMedia = onOpenMedia ? () => onOpenMedia(message.id) : undefined;

  switch (message.content_type) {
    case 'text':
      return (
        <p className="text-sm break-words whitespace-pre-wrap">
          {message.content_text}
        </p>
      );

    case 'image':
      return (
        <div>
          {message.media_url ? (
            <MediaImageBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t('photo')} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">
              {message.content_text}
            </p>
          )}
          <MediaTranscript message={message} t={t} />
        </div>
      );

    case 'video':
      return (
        <div>
          {message.media_url ? (
            <MediaVideoBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t('video')} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case 'audio':
      return (
        <div>
          {message.media_url ? (
            <MediaAudioBubble message={message} t={t} />
          ) : (
            <MediaUnavailable label={t('audio')} t={t} />
          )}
          <MediaTranscript message={message} t={t} />
        </div>
      );

    case 'document':
      if (!message.media_url) {
        return (
          <MediaUnavailable
            label={message.content_text || t('document')}
            t={t}
          />
        );
      }
      return <MediaDocumentBubble message={message} t={t} />;

    case 'template':
      // Both bubble fills are light surfaces now (WhatsApp green and
      // white), so the chip no longer has to invert on outbound — one
      // neutral treatment reads correctly on either. Falls back to the
      // template's name when we have no stored body (legacy rows sent
      // before issue #483).
      return (
        <div>
          <span
            className={cn(
              'text-3xs mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium',
              'bg-foreground/8 text-muted-foreground'
            )}
          >
            <LayoutTemplate className="h-3 w-3" />
            {t('template')}
          </span>
          {message.content_text ? (
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">
              {message.content_text}
            </p>
          ) : (
            message.template_name && (
              <p className="mt-1 text-sm break-words italic opacity-80">
                {message.template_name}
              </p>
            )
          )}
        </div>
      );

    case 'location':
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
          <span>{message.content_text || t('locationShared')}</span>
        </div>
      );

    case 'interactive': {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        // `bg-card` is literally white in light mode, and the component's
        // own ring is the app's cool `--border`: a white card with a grey
        // ring inside a green bubble. Re-grounded here rather than in the
        // component, which also renders on the page in the composer, the
        // automation builder and the quick-replies manager, where its own
        // surface is the correct one.
        return (
          <InteractivePreview payload={message.interactive_payload} onBubble />
        );
      }
      if (message.sender_type === 'customer') {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground eyebrow inline-flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" />
              {t('buttonReply')}
            </span>
            <p className="text-sm break-words whitespace-pre-wrap">
              {message.content_text || t('interactiveReply')}
            </p>
          </div>
        );
      }
      return (
        <p className="text-sm break-words whitespace-pre-wrap">
          {message.content_text || t('interactiveReply')}
        </p>
      );
    }

    default:
      return (
        <p className="text-sm break-words whitespace-pre-wrap">
          {message.content_text || t('unsupported')}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  onOpenMedia,
  firstOfRun = true,
  senderName,
}: MessageBubbleProps) {
  const t = useTranslations('Inbox.bubble');

  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';
  const time = format(new Date(message.created_at), 'HH:mm');

  // "Quem escreveu isso?" is answered IN the message, because the customer
  // has no interface to read a label off — `signMessage` prefixes `*Nome*`
  // and WhatsApp renders it bold on their phone. On OUR side that prefix is
  // noise: we already know it was us, and the asterisks are an artefact of
  // their renderer, not ours.
  //
  // So it is lifted out here and drawn as what it actually is. The body goes
  // down to `MessageContent` in place of the raw text, which fixes every
  // content type at once — a photo's caption is signed the same way a text
  // message is. See `@/lib/inbox/message-preview` for why the parse is as
  // narrow as it is.
  const signed = splitSignature(message.content_text, { outbound: isAgent });
  const body =
    signed.signature === null
      ? message
      : { ...message, content_text: signed.body };

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div className={cn('flex flex-col', isAgent ? 'items-end' : 'items-start')}>
      {/* WhatsApp's own bubble, not a tinted version of the app's
          accent. The thread is the one screen an agent stares at all
          day, and it is the one screen where they already know the
          layout by heart — recognition beats originality here. Hence
          real WhatsApp colours (white in, #d9fdd3 out), the hairline
          shadow, and the tail on the first bubble of each run.

          Note it is NOT `bg-primary` any more: an outbound bubble
          filled with the brand blue made every reply the loudest thing
          on screen, which is the opposite of the colour doctrine. */}
      <div
        className={cn(
          'text-foreground relative rounded-lg px-2.5 py-1.5 shadow-[var(--wa-shadow)]',
          isAgent ? 'bg-wa-out' : 'bg-wa-in',
          firstOfRun && (isAgent ? 'rounded-tr-sm' : 'rounded-tl-sm')
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            // Outbound is a light green surface now, not the primary
            // fill, so the inverted treatment would be unreadable.
            onPrimary={false}
          />
        )}
        {/* Who wrote it, once per run.
        
            Two sources, one line. `senderName` is the recorded author and
            wins; `signed.signature` is the `*Nome*` the customer sees, and
            it stays as the fallback for every message sent before 056 — of
            which there is a whole history.
        
            Only on the FIRST bubble of a run, which is what WhatsApp does
            in a group and for the reason it does it: a burst of four
            messages from one person is one turn, and labelling each line
            turns a conversation into a transcript.
        
            The same grey every machine-and-metadata marker in this thread
            uses. It is attribution, not emphasis: the person reading it
            works here and needs to know which colleague replied, which is
            one glance, not a headline. */}
        {firstOfRun && (senderName || signed.signature) && (
          <span className="text-muted-foreground eyebrow block leading-tight">
            {senderName || signed.signature}
          </span>
        )}
        <MessageContent
          message={body}
          t={t}
          isAgent={isAgent}
          onOpenMedia={onOpenMedia}
        />
        <div
          className={cn(
            'mt-1 flex items-center gap-1',
            isAgent ? 'justify-end' : 'justify-start'
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {message.ai_generated && (
            <span
              // Grey, like every other machine marker in the system.
              // The sparkle carries the meaning; colour is reserved
              // for things a person has to act on.
              className="bg-foreground/8 text-muted-foreground eyebrow inline-flex items-center gap-0.5 rounded-full px-1.5 py-px leading-none"
              title={t('aiBadgeTitle')}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t('aiBadge')}
            </span>
          )}
          {/* Inside the bubble, bottom-right, same as WhatsApp — not
              a metadata line underneath it. Both fills are light, so
              one colour serves both directions. */}
          <span className="text-muted-foreground text-3xs">{time}</span>
          {isAgent && <MessageTicks status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
