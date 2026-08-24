'use client';

import { useTranslations } from 'next-intl';
import { List, Reply } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

/**
 * WhatsApp-style read-only render of an interactive message. Used both
 * in the builder's live preview and by the inbox message bubble so a
 * sent buttons/list message shows the same way it does on the phone.
 *
 * Purely presentational — the buttons/rows are not clickable here (the
 * customer taps them on their own device). Kept namespace-free (plain
 * English) so it can be dropped into the composer, the automation
 * builder, and the quick-replies manager without namespace coupling.
 */
export function InteractivePreview({
  payload,
  className,
  onBubble = false,
}: {
  payload: InteractiveMessagePayload;
  className?: string;
  /**
   * Rendered INSIDE a message bubble rather than on the page.
   *
   * Its own surface is right in the composer, the automation builder and
   * the quick-replies manager — all of which sit on `--card`. Inside a
   * bubble that same card is a white rectangle with a cool grey ring on a
   * light-green fill, and the ribs between the buttons are the same grey.
   * A prop rather than a className because the dividers have to move too,
   * and a caller cannot reach them.
   */
  onBubble?: boolean;
}) {
  // `Interactive.previewPlaceholders`, NOT `Interactive.preview` — that
  // one is the word "Preview" the builder prints above this component, and
  // turning it into an object silently replaced the label with nothing.
  const t = useTranslations('Interactive.previewPlaceholders');
  const rib = onBubble ? 'border-foreground/10' : 'border-border';
  return (
    <div
      className={cn(
        'text-foreground w-full max-w-[260px] overflow-hidden rounded-lg shadow-sm ring-1',
        onBubble ? 'bg-wa-inset ring-foreground/10' : 'bg-card ring-border',
        className
      )}
    >
      <div className="px-3 py-2">
        {payload.header ? (
          <p className="mb-1 text-sm font-semibold break-words">
            {payload.header}
          </p>
        ) : null}
        <p className="text-sm break-words whitespace-pre-wrap">
          {payload.body || (
            <span className="text-muted-foreground">
              {t('bodyPlaceholder')}
            </span>
          )}
        </p>
        {payload.footer ? (
          <p
            className={cn(
              'text-2xs mt-1 break-words',
              onBubble ? 'text-foreground/70' : 'text-muted-foreground'
            )}
          >
            {payload.footer}
          </p>
        ) : null}
      </div>

      {payload.kind === 'buttons' ? (
        <div className={cn('flex flex-col border-t', rib)}>
          {payload.buttons.map((b, i) => (
            <button
              key={b.id || i}
              type="button"
              disabled
              className={cn(
                'text-primary flex items-center justify-center gap-1.5 border-t py-2 text-sm font-medium first:border-t-0',
                rib
              )}
            >
              <Reply className="h-3.5 w-3.5" />
              <span className="truncate">
                {b.title || t('buttonPlaceholder')}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled
          className={cn(
            'text-primary flex w-full items-center justify-center gap-1.5 border-t py-2 text-sm font-medium',
            rib
          )}
        >
          <List className="h-3.5 w-3.5" />
          <span className="truncate">
            {payload.button_label || t('menuPlaceholder')}
          </span>
        </button>
      )}
    </div>
  );
}
