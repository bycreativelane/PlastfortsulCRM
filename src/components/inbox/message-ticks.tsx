import { Check, CheckCheck, Clock, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Message } from '@/types';

/**
 * The ticks, defined once.
 *
 * They were living inside `message-bubble.tsx`, which was fine while the
 * bubble was the only place that drew them. The conversation list needs the
 * same vocabulary now — "quando lead responde fica sem os verificados,
 * quando matheus responde aparece os verificados" — and two copies of a
 * four-state icon table is how the list ends up saying `delivered` in a grey
 * the thread stopped using.
 *
 * The one colour in the set is the blue on `read`. Universal convention, and
 * a state people actively look for — worth the exception to the rule that
 * colour means "act on this".
 *
 * Nothing here has a case for the customer's own messages: an inbound
 * message has no delivery state to report, and drawing a tick beside one
 * would be claiming WhatsApp told us something it never says.
 */
export function MessageTicks({
  status,
  className,
}: {
  status: Message['status'] | null | undefined;
  className?: string;
}) {
  const cls = cn('size-3 shrink-0', className);
  switch (status) {
    case 'sending':
      return <Clock className={cn(cls, 'text-muted-foreground')} aria-hidden />;
    case 'sent':
      return <Check className={cn(cls, 'text-muted-foreground')} aria-hidden />;
    case 'delivered':
      return (
        <CheckCheck className={cn(cls, 'text-muted-foreground')} aria-hidden />
      );
    case 'read':
      return <CheckCheck className={cn(cls, 'text-wa-tick')} aria-hidden />;
    case 'failed':
      return <XCircle className={cn(cls, 'text-destructive')} aria-hidden />;
    default:
      return null;
  }
}
