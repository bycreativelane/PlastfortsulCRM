'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AudioLines, FileText, ImageIcon, Loader2, Sparkles } from 'lucide-react';

import type { Message } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

/**
 * Everything the AI can do to THIS message.
 *
 * ------------------------------------------------------------------
 * ONE LIST, TWO SURFACES
 * ------------------------------------------------------------------
 *
 * These actions are reachable two ways: the sparkle in the hover
 * toolbar, and right-click (or long-press) on the bubble. Writing them
 * twice would guarantee they drift — the toolbar would learn a new
 * action and the context menu would not, and the difference would look
 * like a bug in whichever one you found second.
 *
 * So `MessageAiItems` renders the rows through whichever primitive the
 * caller asked for. `ui/context-menu.tsx` and `ui/dropdown-menu.tsx`
 * have identical APIs on purpose, which is what makes the switch a
 * three-line assignment instead of two copies of the JSX. Same trick as
 * `conversation-menu.tsx`.
 *
 * ------------------------------------------------------------------
 * ONLY WHAT APPLIES TO THE MESSAGE UNDER THE CURSOR
 * ------------------------------------------------------------------
 *
 * An audio has nothing to describe, a text message has nothing to
 * transcribe, and "suggest a reply" to something the business itself
 * said can only be a mistake — the route refuses it. An option that is
 * always there and sometimes says no teaches people to distrust the
 * whole menu, so an action that would refuse is not shown.
 *
 * ------------------------------------------------------------------
 * "READ THIS ONE" EXISTS BECAUSE THE AUTOMATIC PASS ONLY RUNS ONCE
 * ------------------------------------------------------------------
 *
 * Transcription happens as a message arrives. Everything older than the
 * day the account turned it on has no transcript and, without this, no
 * way to get one — so an attendant opening a six-month thread of voice
 * notes could see a feature that had been applied to nothing in front
 * of them.
 */

const AUDIO = /^audio\//i;
const IMAGE = /^image\//i;
const PDF = /^application\/pdf$/i;

export type MessageAiVariant = 'dropdown' | 'context';

interface AiProps {
  message: Message;
  /** Opens the existing suggested-reply popover. Absent = not offered. */
  onSuggestReply?: () => void;
  /** The words, once they exist, so the bubble can show them at once. */
  onTranscript?: (text: string) => void;
}

/**
 * The decision and the call, without the markup.
 *
 * Both surfaces need the same three answers — is there anything to
 * read, is there anything to suggest, and is a call in flight — and the
 * hook is what keeps that from being asked differently in two places.
 */
function useMessageAi({ message, onSuggestReply, onTranscript }: AiProps) {
  const t = useTranslations('Inbox.aiMenu');
  const [busy, setBusy] = useState(false);

  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';
  const mime = message.media_type ?? '';

  const kind = AUDIO.test(mime)
    ? 'audio'
    : IMAGE.test(mime)
      ? 'image'
      : PDF.test(mime)
        ? 'document'
        : null;

  // Already read, and it worked. Offering "read it" again would spend
  // the account's tokens to produce the text already on screen.
  const alreadyRead =
    message.media_transcript_status === 'done' &&
    !!message.media_transcript?.trim();

  const canRead = kind !== null && !alreadyRead;
  const canSuggest = !isAgent && !!onSuggestReply;

  async function readAttachment() {
    setBusy(true);
    try {
      const res = await fetch('/api/ai/understand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: message.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };

      if (!res.ok) {
        // Each failure gets its own sentence. "Não deu certo" three
        // times for three different problems is how somebody retries
        // the one thing that will never work.
        toast.error(
          json.error === 'media_gone'
            ? t('errorGone')
            : json.error === 'assist_disabled'
              ? t('errorDisabled')
              : json.error === 'unsupported'
                ? t('errorUnsupported')
                : t('errorFailed')
        );
        return;
      }

      if (json.text) {
        onTranscript?.(json.text);
        toast.success(t('done'));
      }
    } catch {
      toast.error(t('errorFailed'));
    } finally {
      setBusy(false);
    }
  }

  const ReadIcon =
    kind === 'audio' ? AudioLines : kind === 'image' ? ImageIcon : FileText;

  const readLabel =
    kind === 'audio'
      ? t('transcribe')
      : kind === 'image'
        ? t('describe')
        : t('readDocument');

  return {
    busy,
    canRead,
    canSuggest,
    readAttachment,
    ReadIcon,
    readLabel,
    /** Nothing to offer at all — the caller renders no menu section. */
    empty: !canRead && !canSuggest,
  };
}

/**
 * The rows themselves.
 *
 * Takes the hook's result rather than calling it, so the surface that
 * owns the state is also the one that can show it. Calling the hook here
 * as well would give the trigger's spinner a different `busy` from the
 * item that sets it, and the spinner would never turn.
 */
function AiRows({
  ai,
  variant,
  leadingSeparator,
  onSuggestReply,
}: {
  ai: ReturnType<typeof useMessageAi>;
  variant: MessageAiVariant;
  leadingSeparator?: boolean;
  onSuggestReply?: () => void;
}) {
  const t = useTranslations('Inbox.aiMenu');

  const Item = variant === 'context' ? ContextMenuItem : DropdownMenuItem;
  const Label = variant === 'context' ? ContextMenuLabel : DropdownMenuLabel;
  const Group = variant === 'context' ? ContextMenuGroup : DropdownMenuGroup;

  return (
    <>
      {leadingSeparator && variant === 'context' && <ContextMenuSeparator />}
      {/* The label lives INSIDE the group. Base UI throws at render for a
          label with no group around it — not a warning, a crash that
          takes the route to its error boundary — and
          `menu-label-group.test.ts` exists because that has happened
          before. It caught this one. */}
      <Group>
        <Label>{t('title')}</Label>

        {ai.canSuggest && (
          <Item onClick={onSuggestReply}>
            <Sparkles className="mr-2 size-4" />
            {t('suggest')}
          </Item>
        )}

        {ai.canRead && (
          <Item disabled={ai.busy} onClick={ai.readAttachment}>
            <ai.ReadIcon className="mr-2 size-4" />
            {ai.readLabel}
          </Item>
        )}
      </Group>
    </>
  );
}

/**
 * The rows for a right-click menu, which owns them among other actions.
 *
 * Returns `null` when this message has no AI action available, so the
 * caller can drop it in unconditionally and never get an empty heading.
 */
export function MessageAiItems({
  variant = 'dropdown',
  leadingSeparator = false,
  ...props
}: AiProps & {
  variant?: MessageAiVariant;
  /** Draw a rule above the group. For a menu with rows before it. */
  leadingSeparator?: boolean;
}) {
  const ai = useMessageAi(props);
  if (ai.empty) return null;

  return (
    <AiRows
      ai={ai}
      variant={variant}
      leadingSeparator={leadingSeparator}
      onSuggestReply={props.onSuggestReply}
    />
  );
}

/** The sparkle in the hover toolbar. Renders nothing when it would be empty. */
export function MessageAiMenu({
  triggerClassName,
  ...props
}: AiProps & { triggerClassName?: string }) {
  const t = useTranslations('Inbox.aiMenu');
  const ai = useMessageAi(props);

  if (ai.empty) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClassName} aria-label={t('open')}>
        {ai.busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <AiRows
          ai={ai}
          variant="dropdown"
          onSuggestReply={props.onSuggestReply}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
