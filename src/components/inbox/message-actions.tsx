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
import type { Message } from '@/types';
import { useTranslations } from 'next-intl';

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/**
 * One action in the hover/long-press toolbar.
 *
 * 20px is a fine target for a cursor and an unusable one for a thumb — and
 * this toolbar is opened by long-press, so on a phone it is the ONLY way to
 * reply-to or react to a message. The bar is absolutely positioned over the
 * bubble, so growing it on a coarse pointer costs no layout anywhere.
 */
const TOOLBAR_ACTION =
  'text-popover-foreground hover:bg-muted hover:text-foreground flex size-5 items-center justify-center rounded-full transition-colors duration-(--dur-1) [@media(pointer:coarse)]:size-10 [&>svg]:size-3.5 [@media(pointer:coarse)]:[&>svg]:size-5';

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  children: ReactNode;
}

/**
 * Hover/long-press toolbar wrapper around a `<MessageBubble>`. The bubble
 * itself stays a pure presenter — this component owns the action surface so
 * the bubble's render path is unaffected when the toolbar isn't visible.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  children,
}: MessageActionsProps) {
  const t = useTranslations('Inbox.actions');

  // Touch devices have no hover. Long-press fires `contextmenu`; we capture
  // it, suppress the native menu, and pin the toolbar open until the user
  // interacts elsewhere.
  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTouchOpen(true);
  };

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
    setTouchOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  const handleReply = () => {
    onReply();
    setTouchOpen(false);
  };

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <div
      className={cn('flex w-full', isAgent ? 'justify-end' : 'justify-start')}
      onContextMenu={handleContextMenu}
      onBlur={() => setTouchOpen(false)}
    >
      {/* `min-w-0` lets this flex child actually respect the 75% cap.
       *  Default `min-width: auto` lets content (a long quote preview,
       *  an unbroken URL) push past the cap and shove the row past
       *  100%, which used to bleed across into the contact-sidebar
       *  area. See issue #165. */}
      <div className="group/actions relative max-w-[75%] min-w-0">
        {children}
        <div
          data-touch-open={touchOpen || pickerOpen ? 'true' : undefined}
          className={cn(
            'border-border bg-popover/95 absolute -top-3 z-10 flex h-7 items-center gap-0.5 rounded-full border px-1 shadow-md backdrop-blur-sm transition-opacity duration-(--dur-1)',
            '[@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:gap-1 [@media(pointer:coarse)]:px-1.5',
            'opacity-0 group-focus-within/actions:opacity-100 group-hover/actions:opacity-100',
            'data-[touch-open=true]:opacity-100',
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
            onClick={handleReply}
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
        </div>
      </div>
    </div>
  );
}
