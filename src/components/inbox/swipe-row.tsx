'use client';

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Archive, MailOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import {
  hideConversation,
  markConversationUnread,
  type ConversationPatch,
} from '@/lib/conversations/actions';
import type { Conversation } from '@/types';
import { cn } from '@/lib/utils';
import {
  COMMIT_PX,
  MAX_PX,
  isSwipeStarted,
  swipeOffset,
  swipeOutcome,
  type SwipeAbilities,
} from './swipe-row-logic';

/**
 * A conversation row you can throw.
 *
 * ------------------------------------------------------------------
 * WHY A GESTURE AT ALL
 * ------------------------------------------------------------------
 *
 * Every act on a conversation — park it, hide it, mark it unread,
 * hand it to somebody — lived behind the `⋯`, which on a phone is a
 * small target, a menu, and a second aim. Two precise taps for a
 * decision that takes a tenth of a second to make, on a device somebody
 * is holding one-handed with a box in the other. Every messaging app on
 * the same phone answers this with a swipe, so the gesture is not a
 * novelty here — its ABSENCE is the thing that reads as unfinished.
 *
 * Two actions, one per direction, and they are the two that are safe to
 * do by accident:
 *
 *   ← left   Arquivar   (`hidden_at`) — reversible from Ocultas
 *   → right  Não lida   (`unread_count`) — reversible by opening it
 *
 * Parking, assigning and deleting stay in the menu. A gesture is a thing
 * a pocket can perform; nothing behind one may be irreversible, and
 * nothing behind one may involve a choice (which colleague?).
 *
 * ------------------------------------------------------------------
 * WHY IT NEVER STEALS A SCROLL
 * ------------------------------------------------------------------
 *
 * `touch-action: pan-y` is the whole safety story, and it is declared
 * rather than computed: the browser keeps vertical panning for itself
 * and only hands us the horizontal component. A finger that moves down
 * scrolls the list and this code never sees it — no threshold to tune,
 * no `preventDefault` race, and no chance of a list that will not
 * scroll because a row decided the drag was its own.
 *
 * Pointer events and not touch events, so a pen works and so pointer
 * capture is available: once a drag starts the row keeps receiving
 * moves even if the finger slides off it, which is what stops a fast
 * swipe from freezing halfway when it crosses into the next row.
 *
 * ------------------------------------------------------------------
 * AND ONLY UNDER A FINGER
 * ------------------------------------------------------------------
 *
 * `pointer: coarse` gates the whole thing. On a desk the right-click
 * menu already carries all of this, a mouse-drag across a list row means
 * "select text" to everybody who has ever used a computer, and a row
 * that slides under the cursor would be a surprise with no upside.
 *
 * The thresholds and the direction rules are in `./swipe-row-logic`,
 * which has no DOM in it and is unit-tested. This file is the plumbing
 * around them: it is either wired up or visibly broken on first touch,
 * whereas an off-by-one in a threshold is not.
 */

function subscribeCoarse(onChange: () => void) {
  const media = window.matchMedia('(pointer: coarse)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const getCoarse = () => window.matchMedia('(pointer: coarse)').matches;
/** No pointer on the server; the desk behaviour is the safe default. */
const getCoarseServer = () => false;

export function SwipeRow({
  conversation,
  onPatch,
  children,
}: {
  conversation: Conversation;
  /** Same signature the row menu uses, so both write state one way. */
  onPatch: (id: string, patch: ConversationPatch) => void;
  children: ReactNode;
}) {
  const t = useTranslations('Inbox.conversationMenu');
  const { user } = useAuth();
  const canWrite = useCan('send-messages');
  const coarse = useSyncExternalStore(
    subscribeCoarse,
    getCoarse,
    getCoarseServer
  );

  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const busy = useRef(false);
  /**
   * A drag just ended, so the click it is about to produce is not a tap.
   *
   * Without this the gesture works AND opens the conversation: the row
   * beneath is a `<button>`, and a pointer sequence that moves still
   * ends in a `click` on the element it started and finished on. You
   * would archive a thread and land inside it — the two things the
   * gesture exists to avoid, at once.
   *
   * A ref and not state: it is read inside an event handler in the same
   * tick the flag is set, and a re-render is neither needed nor wanted
   * between the two.
   */
  const swallowClick = useRef(false);

  /**
   * What each direction is allowed to do, recomputed on every render so
   * a realtime patch mid-gesture is respected at release.
   *
   * Already unread means the right swipe has nothing to do, so it is not
   * offered: a gesture that fires and changes nothing is worse than one
   * that is absent, because it teaches that the gesture is unreliable.
   */
  const abilities: SwipeAbilities = useMemo(
    () => ({
      canArchive: canWrite && !conversation.hidden_at,
      canMarkUnread: canWrite && conversation.unread_count === 0,
    }),
    [canWrite, conversation.hidden_at, conversation.unread_count]
  );

  const reset = useCallback(() => {
    setSettling(true);
    setOffset(0);
    start.current = null;
    dragging.current = false;
  }, []);

  const commit = useCallback(
    async (direction: 'archive' | 'unread') => {
      if (busy.current) return;
      busy.current = true;
      const db = createClient();
      const { error, patch } =
        direction === 'archive'
          ? await hideConversation(db, conversation.id, user?.id ?? null)
          : await markConversationUnread(db, conversation.id);
      busy.current = false;

      if (error) {
        // Same courtesy the menu extends: `hidden_at` arrives with
        // migration 045, and until it is applied this fails on an
        // unknown column rather than on anything the operator did.
        toast.error(
          /hidden_at|waiting_since/.test(error)
            ? t('toastNeedsMigration')
            : t('toastFailed')
        );
        return;
      }
      toast.success(
        direction === 'archive' ? t('toastHidden') : t('toastMarkedUnread')
      );
      onPatch(conversation.id, patch);
    },
    [conversation.id, onPatch, t, user?.id]
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Primary button only, and never on a pointer that is not a
    // finger — `coarse` gates the handlers being attached at all, but
    // a hybrid laptop can report both.
    if (e.pointerType === 'mouse') return;
    setSettling(false);
    start.current = { x: e.clientX, y: e.clientY };
    dragging.current = false;
    swallowClick.current = false;
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const from = start.current;
      if (!from) return;
      const dx = e.clientX - from.x;

      if (!dragging.current) {
        if (!isSwipeStarted(dx)) return;
        dragging.current = true;
        // From here the row owns the gesture: capture keeps the moves
        // coming even once the finger leaves this element.
        e.currentTarget.setPointerCapture(e.pointerId);
      }

      setOffset(swipeOffset(dx, abilities));
    },
    [abilities]
  );

  const onPointerUp = useCallback(() => {
    if (!dragging.current) {
      start.current = null;
      return;
    }
    // Swallow the click even when the swipe springs back short of the
    // threshold: the person moved the row on purpose, and opening the
    // thread because they changed their mind is the wrong answer to a
    // cancelled gesture.
    swallowClick.current = true;
    const outcome = swipeOutcome(offset, abilities);
    reset();
    if (outcome) void commit(outcome);
  }, [offset, reset, commit, abilities]);

  /**
   * Capture phase, so it runs BEFORE the row's own `onClick` rather than
   * after it. In the bubble phase the conversation would already be open.
   */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Desk, or an account that cannot write: the row renders exactly as it
  // did before this file existed. No wrapper element, no listeners.
  if (!coarse || (!abilities.canArchive && !abilities.canMarkUnread))
    return <>{children}</>;

  const armed = Math.abs(offset) >= COMMIT_PX;

  return (
    <div className="relative overflow-hidden">
      {/* The backdrops. Both are always mounted and the offset decides
          which is uncovered — animating one in would put a paint between
          the finger moving and the colour appearing, which is the half
          frame that makes a gesture feel cheap.

          `aria-hidden`: this is a second rendering of two actions the
          context menu already lists properly. A screen-reader user
          reaches them there, where they have names and roles. */}
      <div
        aria-hidden
        className="absolute inset-0 flex items-center justify-between"
      >
        <span
          className={cn(
            'bg-primary text-primary-foreground flex h-full items-center gap-2 pl-4 text-xs font-semibold transition-opacity duration-(--dur-1)',
            offset > 0 ? 'opacity-100' : 'opacity-0'
          )}
          style={{ width: MAX_PX }}
        >
          <MailOpen className={cn('size-4 shrink-0', armed && 'scale-110')} />
          {t('swipeUnread')}
        </span>
        <span
          className={cn(
            'bg-secondary text-secondary-foreground flex h-full items-center justify-end gap-2 pr-4 text-xs font-semibold transition-opacity duration-(--dur-1)',
            offset < 0 ? 'opacity-100' : 'opacity-0'
          )}
          style={{ width: MAX_PX }}
        >
          <Archive className={cn('size-4 shrink-0', armed && 'scale-110')} />
          {t('swipeHide')}
        </span>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        onClickCapture={onClickCapture}
        // The one line that guarantees the list still scrolls: the
        // browser keeps the vertical axis and hands us only the
        // horizontal one.
        className={cn(
          'bg-card relative touch-pan-y',
          settling && 'ease-out-soft transition-transform duration-(--dur-2)'
        )}
        style={{ transform: `translate3d(${offset}px,0,0)` }}
      >
        {children}
      </div>
    </div>
  );
}
