'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BookOpen, Loader2, RefreshCw, Sparkles, Wrench } from 'lucide-react';

import { insertIntoComposer } from '@/components/inbox/message-composer';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * "Me ajuda a responder isso."
 *
 * The composer has had an AI button since the assistant shipped, and it
 * answers THE CONVERSATION — the newest thing said. That is right most
 * of the time and wrong exactly when it matters: a customer sends four
 * messages in a row, the useful one is the second, and the agent wants
 * help with that one.
 *
 * So the entry point moved onto the message. Same route (see the note in
 * `/api/ai/draft`), one extra field, and three things this panel does
 * that dropping text straight into the composer cannot:
 *
 * 1. IT SHOWS ITS SOURCES. The excerpts the answer was grounded in, from
 *    the account's own knowledge base. A suggestion nobody can check is
 *    one people either paste blindly or stop using, and both are worse
 *    than not offering it.
 * 2. IT SHOWS WHAT IT LOOKED UP. "It read the contact record" is most of
 *    why an answer about that customer can be trusted.
 * 3. IT DOES NOT TOUCH THE COMPOSER UNTIL ASKED. The old button
 *    overwrites whatever the agent had half-typed. This one waits for
 *    "usar" — and half-typed text is the thing an agent is least willing
 *    to lose.
 *
 * NOTHING IS SENT FROM HERE. The button hands text to the composer; a
 * person still presses Send.
 */
export function MessageAssist({
  conversationId,
  messageId,
  className,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  conversationId: string;
  messageId: string;
  className?: string;
  triggerClassName?: string;
  /**
   * Opened from the AI menu rather than by its own trigger.
   *
   * Uncontrolled when absent, so the component still works on its own —
   * but the toolbar drives it, which is what keeps the menu and the
   * panel from disagreeing about when a suggestion is on offer.
   */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) {
  const t = useTranslations('Inbox.assist');
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);

  const ask = useCallback(async () => {
    setLoading(true);
    setDraft(null);
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_id: messageId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.code === 'ai_not_configured'
            ? t('notConfigured')
            : (data.error ?? t('failed'))
        );
        setOpen(false);
        return;
      }
      setDraft(typeof data.draft === 'string' ? data.draft.trim() : '');
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setTools(Array.isArray(data.tools) ? data.tools : []);
    } catch {
      toast.error(t('failed'));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, [conversationId, messageId, t]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Asked on open rather than on mount: this trigger is on every
        // customer bubble in the thread, and a thread has hundreds.
        if (next && !draft && !loading) void ask();
      }}
    >
      <PopoverTrigger
        className={cn(triggerClassName)}
        aria-label={t('suggest')}
        title={t('suggest')}
      >
        <Sparkles />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        // Wide enough to read a paragraph, capped so it never covers the
        // thread it is about. On a phone it takes the viewport minus the
        // gutters, which is the only sane answer there.
        className={cn(
          'w-[min(24rem,calc(100vw-2rem))] space-y-3 p-3',
          className
        )}
      >
        <div className="flex items-center gap-2">
          <span className="bg-primary-soft text-primary grid size-6 shrink-0 place-items-center rounded-full">
            <Sparkles className="size-3.5" />
          </span>
          <span className="text-foreground flex-1 text-sm font-semibold">
            {t('title')}
          </span>
          <button
            type="button"
            onClick={ask}
            disabled={loading}
            aria-label={t('again')}
            title={t('again')}
            className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 place-items-center rounded-md transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
            <span className="text-muted-foreground text-xs">
              {t('thinking')}
            </span>
          </div>
        ) : draft === null ? null : draft === '' ? (
          <p className="text-muted-foreground py-4 text-xs">{t('empty')}</p>
        ) : (
          <>
            <p className="border-border bg-card-2 text-foreground max-h-56 overflow-y-auto rounded-md border p-2.5 text-sm break-words whitespace-pre-wrap">
              {draft}
            </p>

            {tools.length > 0 && (
              <p className="text-muted-foreground text-2xs flex items-center gap-1.5">
                <Wrench className="size-3 shrink-0" />
                {t('lookedUp', { count: tools.length })}
              </p>
            )}

            {/* The receipts. Collapsed, because the answer is what the
                agent came for and the excerpts are what they check when
                the answer surprises them. */}
            {sources.length > 0 && (
              <details className="group/sources">
                <summary className="text-muted-foreground hover:text-foreground text-2xs flex cursor-pointer list-none items-center gap-1.5 font-medium [&::-webkit-details-marker]:hidden">
                  <BookOpen className="size-3 shrink-0" />
                  {t('sources', { count: sources.length })}
                </summary>
                <ul className="mt-1.5 space-y-1.5">
                  {sources.map((excerpt, i) => (
                    <li
                      key={i}
                      className="border-border/70 text-muted-foreground border-l-2 pl-2 text-2xs leading-snug"
                    >
                      {excerpt}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                {t('discard')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  insertIntoComposer(conversationId, draft);
                  setOpen(false);
                }}
              >
                {t('use')}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
