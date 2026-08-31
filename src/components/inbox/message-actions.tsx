'use client';

import { useState, type ReactNode } from 'react';
import { CornerUpLeft, Copy, SmilePlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { Message } from '@/types';
import { useTranslations } from 'next-intl';
import { MessageAiItems, MessageAiMenu } from './message-ai-menu';
import { MessageAssist } from './message-assist';

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/**
 * One action in the hover toolbar.
 *
 * 20px is a fine target for a cursor and an unusable one for a thumb — and
 * on a hybrid device (a touchscreen laptop) this bar can still be reached by
 * hovering, so a coarse pointer gets a bigger one. The bar is absolutely
 * positioned over the bubble, so growing it costs no layout anywhere.
 */
const TOOLBAR_ACTION =
  'text-popover-foreground hover:bg-muted hover:text-foreground flex size-5 items-center justify-center rounded-full transition-colors duration-(--dur-1) [@media(pointer:coarse)]:size-10 [&>svg]:size-3.5 [@media(pointer:coarse)]:[&>svg]:size-5';

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  /**
   * Enables the "suggest a reply" action. Absent on any surface with no
   * composer to hand the text back to — the action would be a button
   * that produces a paragraph and then has nowhere to put it.
   */
  conversationId?: string;
  children: ReactNode;
}

/**
 * The action surface around a `<MessageBubble>`, which stays a pure
 * presenter — its render path is unaffected when nothing is open.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS A REAL CONTEXT MENU NOW
 * ------------------------------------------------------------------
 *
 * Right-click used to be hand-rolled here: `preventDefault()`, then a
 * `touchOpen` flag that pinned the hover toolbar visible. The report was
 * "botão direito não tá funcional... ele só aparece o hover em cima sem
 * poder selecionar", and the mechanism explains it exactly — the
 * gesture never opened a menu, it only un-hid a strip of 20px circles
 * that then had to be aimed at, and the same element's `onBlur` (which
 * is `focusout`, and bubbles) could put it away again on the way there.
 *
 * A right-click that reveals a target instead of offering a choice is
 * not a context menu. This is one: the same primitive the conversation
 * list and the pipeline cards already use, with the cursor-anchoring and
 * the zoom correction those needed, so all three gestures in the product
 * behave identically.
 *
 * It also takes long-press with it, which is what a phone has instead —
 * so the toolbar no longer needs its own touch mechanism, and the two
 * can no longer fight over the same `contextmenu` event.
 *
 * ------------------------------------------------------------------
 * THE MENU CARRIES EVERYTHING, THE TOOLBAR IS THE SHORTCUT
 * ------------------------------------------------------------------
 *
 * Every action exists in the menu. The toolbar repeats the three that
 * are worth a single click on a desktop and would otherwise cost a
 * right-click plus a read. Neither is the only way to anything.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  conversationId,
  children,
}: MessageActionsProps) {
  const t = useTranslations('Inbox.actions');

  const [pickerOpen, setPickerOpen] = useState(false);
  /** The suggested-reply panel, opened from either menu. */
  const [assistOpen, setAssistOpen] = useState(false);

  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';

  const hasText = !!message.content_text?.trim();

  const handleCopy = async () => {
    const text = message.content_text ?? '';
    if (!text) {
      toast.error(t('nothingToCopy'));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
  };

  const canSuggest = !isAgent && !!conversationId;

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <div className={cn('flex w-full', isAgent ? 'justify-end' : 'justify-start')}>
      {/* `min-w-0` lets this flex child actually respect the 75% cap.
       *  Default `min-width: auto` lets content (a long quote preview,
       *  an unbroken URL) push past the cap and shove the row past
       *  100%, which used to bleed across into the contact-sidebar
       *  area. See issue #165. */}
      <div className="group/actions relative max-w-[75%] min-w-0">
        <ContextMenu>
          {/* The trigger is the BUBBLE, not the row. Right-clicking the
              empty half of a row should not act on the message sitting
              in the other half — the old full-width handler did, which
              is how you delete the wrong thing. */}
          <ContextMenuTrigger className="block">{children}</ContextMenuTrigger>
          <ContextMenuContent>
            {/* Reactions first and laid out across, the way every chat
                app puts them: it is the most-used action and the one
                that reads as a row of faces rather than a list of
                words. */}
            <ContextMenuGroup className="flex items-center gap-0.5 px-0.5 pb-1">
              {QUICK_EMOJIS.map((e) => (
                <ContextMenuItem
                  key={e}
                  className="size-9 justify-center p-0 text-lg"
                  aria-label={t('reactWith', { emoji: e })}
                  onClick={() => onReact(e)}
                >
                  {e}
                </ContextMenuItem>
              ))}
            </ContextMenuGroup>
            <ContextMenuSeparator />

            <ContextMenuGroup>
              <ContextMenuItem onClick={onReply}>
                <CornerUpLeft className="mr-2 size-4" />
                {t('reply')}
              </ContextMenuItem>
              {/* Disabled rather than hidden: a photo with no caption has
                  nothing to copy, and a row that vanishes moves every
                  row under it between one message and the next. */}
              <ContextMenuItem disabled={!hasText} onClick={handleCopy}>
                <Copy className="mr-2 size-4" />
                {t('copyText')}
              </ContextMenuItem>
            </ContextMenuGroup>

            <MessageAiItems
              variant="context"
              leadingSeparator
              message={message}
              onSuggestReply={canSuggest ? () => setAssistOpen(true) : undefined}
            />
          </ContextMenuContent>
        </ContextMenu>

        <div
          data-open={pickerOpen || assistOpen ? 'true' : undefined}
          className={cn(
            'border-border bg-popover/95 absolute -top-3 z-10 flex h-7 items-center gap-0.5 rounded-full border px-1 shadow-md backdrop-blur-sm transition-opacity duration-(--dur-1)',
            '[@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:gap-1 [@media(pointer:coarse)]:px-1.5',
            'opacity-0 group-focus-within/actions:opacity-100 group-hover/actions:opacity-100',
            'data-[open=true]:opacity-100',
            isAgent ? 'right-3' : 'left-3'
          )}
        >
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger className={TOOLBAR_ACTION} aria-label={t('react')}>
              <SmilePlus />
            </PopoverTrigger>
            <PopoverContent
              className="flex w-auto flex-row gap-1 p-1.5"
              sideOffset={6}
            >
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => handlePickEmoji(e)}
                  className="hover:bg-muted flex size-8 items-center justify-center rounded-full text-lg leading-none transition-transform duration-(--dur-1) hover:scale-125 [@media(pointer:coarse)]:size-11"
                  aria-label={t('reactWith', { emoji: e })}
                >
                  {e}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <button
            type="button"
            onClick={onReply}
            className={TOOLBAR_ACTION}
            aria-label={t('reply')}
          >
            <CornerUpLeft />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className={TOOLBAR_ACTION}
            aria-label={t('copyText')}
          >
            <Copy />
          </button>
          <MessageAiMenu
            message={message}
            triggerClassName={TOOLBAR_ACTION}
            onSuggestReply={canSuggest ? () => setAssistOpen(true) : undefined}
          />
        </div>

        {/* The suggestion panel, opened by either menu rather than by a
            trigger of its own — one entry point, so the two cannot
            disagree about when it is offered. It is portalled, so it
            shows even though the strip it is anchored to is transparent
            once the pointer has left the row. */}
        {canSuggest && conversationId ? (
          <MessageAssist
            conversationId={conversationId}
            messageId={message.id}
            triggerClassName="sr-only"
            open={assistOpen}
            onOpenChange={setAssistOpen}
          />
        ) : null}
      </div>
    </div>
  );
}
