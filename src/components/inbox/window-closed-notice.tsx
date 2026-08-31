'use client';

import { LayoutTemplate, Lock, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * The 24-hour window, said once, in the conversation.
 *
 * It used to be a full-width strip above the composer — permanent chrome
 * standing between the agent and the thread, repeating a fact that does not
 * change. _"pode deixar um aviso no centro do chat que consiga fechar para
 * visualizar o que já foi conversado"_.
 *
 * So it is a centred chip in the message stream, the shape this thread
 * already uses for something the SYSTEM says rather than a person: the day
 * separator (message-thread.tsx) wears the same geometry, the same shadow
 * and the same place in the flow. Being inside the scroll container is the
 * point — it scrolls away with the conversation instead of occupying fixed
 * height forever.
 *
 * `danger`, and the same `danger` the WindowPill in the header wears for
 * this exact state, down to the `Lock`: one condition, one colour, even
 * though the two live 500px apart.
 *
 * The Templates button is not decoration. Sending a template is the only
 * thing that still works outside the window, and until this component
 * existed the strip's own button was the only door to it from the thread.
 */
export function WindowClosedNotice({
  onOpenTemplates,
  onDismiss,
}: {
  onOpenTemplates: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('Inbox.sessionTimer');

  return (
    // `hidden sm:flex` — THE PHONE ALREADY HEARD IT, TWICE.
    //
    // With a closed window, a 375px screen was carrying three statements
    // of the same fact: the padlock chip in the header, this strip, and
    // the composer's own placeholder ("Janela fechada — use um
    // template") with its send button disabled. Three, on the device
    // with the least room, for a condition that lasts until the customer
    // writes again.
    //
    // The composer is the one that survives, and not by seniority: it is
    // where the person is about to hit the wall, it is already explaining
    // itself at the moment of the attempt, and its `+` menu reaches the
    // templates. This strip costs ~60px to repeat that a screen earlier.
    //
    // It stays from `sm` up, where the argument for it still holds — it
    // scrolls with the conversation and it can be dismissed.
    <div className="hidden items-center justify-center pt-2 sm:flex">
      <div className="bg-danger-soft text-danger-ink flex max-w-md items-center gap-2 rounded-lg px-3 py-1.5 text-xs shadow-[var(--wa-shadow)]">
        <Lock className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{t('closedNotice')}</span>
        <button
          type="button"
          onClick={onOpenTemplates}
          className="text-danger-ink hover:bg-danger-ink/10 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 font-medium transition-colors duration-(--dur-1)"
        >
          <LayoutTemplate className="size-3" />
          {t('closedTemplates')}
        </button>
        <button
          type="button"
          aria-label={t('closedDismiss')}
          title={t('closedDismiss')}
          onClick={onDismiss}
          className="text-danger-ink/70 hover:bg-danger-ink/10 hover:text-danger-ink flex size-6 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-1)"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
