'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { setConversationStatus } from '@/lib/conversations/actions';
import { ConversationMenu } from './conversation-menu';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import { PresenceDot } from '@/components/presence/presence-dot';
import { presenceLabel } from '@/lib/presence';
import { cn } from '@/lib/utils';
import { formatPhone } from '@/lib/whatsapp/phone-format';
import { avatarClass, avatarInitials } from '@/lib/avatar-color';
import {
  DealOutcomeDialogs,
  useDealOutcome,
} from '@/components/pipelines/deal-outcome';
import { isLostStage, isWonStage } from '@/lib/deals/outcome';
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
  InteractiveMessagePayload,
  PipelineStage,
  Deal,
} from '@/types';
import {
  MessageSquare,
  ChevronDown,
  Check,
  ArrowLeft,
  Info,
  Phone,
  RefreshCw,
  MoreVertical,
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MessageBubble } from './message-bubble';
import {
  OwnerChipContent,
  WindowPill,
  ownerChipVariants,
} from './thread-chrome';
import { sessionWindow } from '@/lib/inbox/session-window';
import { buildAssignCandidates } from './assign-mention';
import { MessageActions } from './message-actions';
import { MediaLightbox } from './media-lightbox';
import { collectMediaGallery } from '@/lib/media/gallery';
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from './message-composer';
import { deleteAccountMedia } from '@/lib/storage/upload-media';
import { TemplatePicker } from './template-picker';
import { WindowClosedNotice } from './window-closed-notice';
import { useWindowNotice, windowKeyFor } from '@/hooks/use-window-notice';
import { AiThreadBanner } from './ai-thread-banner';
import { buildReplyPreview } from './reply-quote';
import { StatePanel } from '@/components/ui/state-panel';
import { renderTemplateBody } from '@/lib/whatsapp/template-body';
import { toast } from 'sonner';
import { dateLocale } from '@/lib/i18n/dates';

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (
    conversationId: string,
    patch: Partial<Conversation>
  ) => void;
  /**
   * Apply a conversation write's patch to the page's state. Optional so the
   * thread still renders in harnesses and tests that do not wire the inbox
   * page's store; without them the phone overflow menu simply does not
   * render its conversation actions.
   */
  onConversationPatch?: (
    conversationId: string,
    patch: Partial<Conversation>
  ) => void;
  onConversationRemoved?: (conversationId: string) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Write down a call that already happened. Optional — the header button
   * only renders when the page wires it up.
   */
  onLogCall?: () => void;
  /**
   * Opens the contact panel as an overlay. Below `xl` the sidebar never
   * renders as a column, and until this existed the tags, the open deal
   * and the notes for the person you are talking to had no route at all
   * from the thread — on the one device this app is used on all day.
   */
  onOpenContactSheet?: () => void;
}

function formatDateSeparator(
  dateStr: string,
  t: ReturnType<typeof useTranslations>
): string {
  const date = new Date(dateStr);
  if (isToday(date)) return t('today');
  if (isYesterday(date)) return t('yesterday');
  // `PPP` and not `'MMMM d, yyyy'`: the second is not a date format,
  // it is the AMERICAN date format spelled out. `PPP` asks the locale.
  return format(date, 'PPP', { locale: dateLocale });
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = '';

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), 'yyyy-MM-dd');
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: {
  label: string;
  value: ConversationStatus;
  color: string;
}[] = [
  // The same argument the WindowPill makes in ./thread-chrome, in the
  // control right next to it. Open is the normal condition, so it is plain
  // ink and says nothing. Pending is the one state where a person has to
  // pick this thread back up, so it takes the system's single amber — as
  // the `human` token, not `amber-400`, which is a raw palette step that
  // falls to ~1.8:1 on a white card and is unreadable in light mode.
  { label: 'Open', value: 'open', color: 'text-foreground' },
  { label: 'Pending', value: 'pending', color: 'text-human-ink' },
  { label: 'Closed', value: 'closed', color: 'text-muted-foreground' },
];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`.
 *
 * The colour underneath is `--wa-bg` — WhatsApp's own wallpaper, cream
 * in light and neutral near-black in dark, sampled off the phone app
 * rather than the web client — not the app background. It is applied to the WHOLE thread column, composer
 * included, rather than just the scrollable message area: in WhatsApp
 * the wallpaper runs behind the composer and only the input pill
 * floats on top of it. A composer with its own opaque fill reads as a
 * separate toolbar bolted to the bottom, which is exactly the seam we
 * are trying not to have.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES = 'bg-wa-bg wa-doodle';

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onConversationPatch,
  onConversationRemoved,
  onBack,
  resyncToken = 0,
  onRefresh,
  onOpenContactSheet,
  onLogCall,
}: MessageThreadProps) {
  const t = useTranslations('Inbox.messageThread');
  const tTimer = useTranslations('Inbox.sessionTimer');
  const tQuote = useTranslations('Inbox.replyQuote');
  const tPresence = useTranslations('Presence');

  const { user, defaultCurrency } = useAuth();
  const { getPresence, getRow, now } = usePresence();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  // Which attachment the media viewer is showing. Lives here rather than in
  // the bubble so the viewer can page through every image/video in the
  // thread (issue #373). Paired with the conversation it belongs to and read
  // back through that check below, so switching threads closes the viewer
  // without an effect racing the messages refetch.
  const [openMedia, setOpenMedia] = useState<{
    conversationId: string;
    messageId: string;
  } | null>(null);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Failed to fetch profiles:', error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    // The window is measured from the customer's LAST inbound message —
    // see lib/inbox/session-window.ts for why it has three states and not
    // two.
    const lastInbound = [...messages]
      .reverse()
      .find((m) => m.sender_type === 'customer');

    const window = sessionWindow(lastInbound?.created_at ?? null);

    const remaining =
      window.state === 'none'
        ? tTimer('noCustomerMessages')
        : window.state === 'expired'
          ? tTimer('expired')
          : window.hoursLeft >= 1
            ? tTimer('xhRemaining', { hours: window.hoursLeft })
            : tTimer('xmRemaining', { minutes: window.minutesLeft });

    return {
      // `expired` keeps its old meaning for the composer, which gates
      // free-form sending on it. "none" counts as expired there: with no
      // inbound message there is no window to be inside of.
      expired: window.state === 'expired' || window.state === 'none',
      state: window.state,
      remaining,
      // Which window this is, for the notice's dismissal key. Computed here
      // because this is where the last inbound message is already found;
      // nothing else can know it without re-scanning `messages`.
      lastInboundAt: lastInbound?.created_at ?? null,
    };
  }, [messages, tTimer]);

  // Dismissal is per conversation AND per window — see the hook. A reply
  // from the customer opens a new window, and the notice returns when that
  // one closes.
  const windowNotice = useWindowNotice(
    conversation?.id ?? null,
    windowKeyFor(sessionInfo.lastInboundAt)
  );

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  const mediaMessageId =
    openMedia && openMedia.conversationId === conversationId
      ? openMedia.messageId
      : null;
  const handleMediaChange = useCallback(
    (messageId: string | null) => {
      setOpenMedia(
        messageId && conversationId ? { conversationId, messageId } : null
      );
    },
    [conversationId]
  );

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error('Failed to fetch messages:', error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('message_reactions')
        .select('*')
        .eq('conversation_id', conversationId);
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch reactions:', error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith('temp-') &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', conversationId)
      .then(({ error }) => {
        if (error) console.error('Failed to reset unread_count:', error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        // So the optimistic bubble carries the same name the saved row
        // will — otherwise it appears unattributed and gets a name a
        // second later, which reads as somebody else answering.
        sender_id: user?.id,
        content_type: 'text',
        content_text: text,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: 'text',
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error('Failed to send message:', reason);
          toast.error(t('toastSendFailed', { reason }));
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send message:', err);
        const reason = err instanceof Error ? err.message : t('networkError');
        toast.error(t('toastSendFailed', { reason }));
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, t]
  );

  // Best-effort GC of an object no message ended up owning. A null path is
  // a borrowed file (see SendMediaPayload.path) and is left alone.
  const discardOrphan = useCallback((path: string | null) => {
    if (!path) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === 'document'
          ? payload.caption || payload.filename || 'Document'
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        // So the optimistic bubble carries the same name the saved row
        // will — otherwise it appears unattributed and gets a name a
        // second later, which reads as somebody else answering.
        sender_id: user?.id,
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error('Failed to send media:', reason);
          toast.error(t('toastSendFailed', { reason }));
          onUpdateMessage(tempId, { status: 'failed' });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          //
          // Unless it isn't ours: a file staged from a media quick reply
          // arrives with a null path because that object belongs to the
          // snippet library. Deleting it here would mean one failed send
          // emptied the snippet for the whole account.
          discardOrphan(payload.path);
          return;
        }

        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send media:', err);
        const reason = err instanceof Error ? err.message : t('networkError');
        toast.error(t('toastSendFailed', { reason }));
        onUpdateMessage(tempId, { status: 'failed' });
        discardOrphan(payload.path);
      }
    },
    [conversation, onNewMessage, onUpdateMessage, discardOrphan, t]
  );

  const handleSendInteractive = useCallback(
    async (payload: InteractiveMessagePayload, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;
      // Optimistic bubble — renders the buttons/list immediately via the
      // interactive_payload, same as the persisted row will.
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        // So the optimistic bubble carries the same name the saved row
        // will — otherwise it appears unattributed and gets a name a
        // second later, which reads as somebody else answering.
        sender_id: user?.id,
        content_type: 'interactive',
        content_text: payload.body,
        interactive_payload: payload,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: 'interactive',
            interactive_payload: payload,
            reply_to_message_id: replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error('Failed to send interactive message:', reason);
          toast.error(t('toastSendFailed', { reason }));
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }

        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send interactive message:', err);
        const reason = err instanceof Error ? err.message : t('networkError');
        toast.error(t('toastSendFailed', { reason }));
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, t]
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      // Through the shared writer rather than an inline update, so parking a
      // thread from here starts the same clock the row menu starts. The two
      // controls used to write different things — this one wrote `status`
      // and nothing else — which is exactly how "Esperando" ended up meaning
      // two unrelated things in two places.
      const { error, patch } = await setConversationStatus(
        createClient(),
        conversation.id,
        status,
        conversation.status
      );
      if (error) {
        toast.error(t('statusFailed'));
        return;
      }

      // The whole patch, not just the status. Parking from here also writes
      // `waiting_since`, and forwarding only the status left the list
      // sorting the row by whatever timestamp it happened to be carrying —
      // usually an old one, sometimes none — until a realtime event
      // arrived to correct it. The Esperando tab sorts on exactly that
      // column, so the row landed in the wrong place and then jumped.
      onStatusChange(conversation.id, patch);
    },
    [conversation, onStatusChange, t]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      }
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        // So the optimistic bubble carries the same name the saved row
        // will — otherwise it appears unattributed and gets a name a
        // second later, which reads as somebody else answering.
        sender_id: user?.id,
        content_type: 'template',
        content_text: renderedBody,
        template_name: template.name,
        status: 'sending',
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: 'template',
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error('Failed to send template:', reason);
          toast.error(t('toastTemplateSendFailed', { reason }));
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }

        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        console.error('Failed to send template:', err);
        const reason = err instanceof Error ? err.message : t('networkError');
        toast.error(t('toastTemplateSendFailed', { reason }));
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, t]
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Images + videos in the thread, in order — the set the media viewer
  // pages through with ← / →.
  const mediaGallery = useMemo(() => collectMediaGallery(messages), [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || 'Customer';

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg = m.sender_type === 'agent' || m.sender_type === 'bot';
      return isAgentMsg ? 'You' : contactDisplayName;
    },
    [contactDisplayName]
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg, tQuote),
      });
    },
    [authorLabelFor]
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn('[reactions] missing user or conversation');
        return;
      }
      if (messageId.startsWith('temp-')) {
        toast.error(t('toastWaitForSend'));
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === 'agent' &&
            r.actor_id === userId
        );
        if (emoji === '') return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: 'agent',
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch('/api/whatsapp/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : t('networkError');
        toast.error(t('toastReactionFailed', { reason }));
        setReactions(snapshot);
      }
    },
    [conversation, user?.id, t]
  );

  /* ---- Moving the deal ------------------------------------------------
   *
   * The header already states the stage; changing it there is the same
   * click twice rather than a trip to the board. This is the one write in
   * this file that is not about the conversation itself, and it earns the
   * exception: "he just agreed, move it to Em Andamento" is a thing an
   * agent decides WHILE reading the message that said so.
   *
   * The stage list is fetched per funnel, once the thread has a deal —
   * the conversation carries `pipeline_id` but not its siblings. */
  const [dealStages, setDealStages] = useState<PipelineStage[]>([]);
  const outcome = useDealOutcome({
    defaultCurrency,
    onDone: () => onRefresh?.(),
  });
  const dealPipelineId = conversation?.deal?.pipeline_id ?? null;

  useEffect(() => {
    if (!dealPipelineId) {
      setDealStages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await createClient()
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', dealPipelineId)
        .order('position');
      if (!cancelled && data) setDealStages(data as PipelineStage[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [dealPipelineId]);

  const handleStageChange = useCallback(
    async (stageId: string) => {
      const dealId = conversation?.deal?.id;
      if (!dealId) return;

      // Atendido and Perdido are gated everywhere else; moving a deal from
      // here is the same move. The conversation carries a thin slice of the
      // deal (no value, no title), so the gate needs the row itself — one
      // read, and only on the two stages that ask for anything.
      const target = dealStages.find((st) => st.id === stageId) ?? null;
      if (target && (isWonStage(target.name) || isLostStage(target.name))) {
        const { data } = await createClient()
          .from('deals')
          .select('*')
          .eq('id', dealId)
          .single();
        if (data && outcome.request(data as Deal, target)) return;
      }

      const { error } = await createClient()
        .from('deals')
        .update({ stage_id: stageId, updated_at: new Date().toISOString() })
        .eq('id', dealId);

      if (error) {
        toast.error(t('toastFailedStage'));
        return;
      }
      toast.success(t('toastStageChanged'));
      // The chip reads from the conversation row's embed, so the list has to
      // refetch for the move to show up here and on the row behind it.
      onRefresh?.();
    },
    [conversation, onRefresh, t, dealStages, outcome]
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('id', conversation.id);

      if (error) {
        console.error('Failed to update assignment:', error);
        toast.error(t('toastFailedAssign'));
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange]
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center px-6',
          DOODLE_BG_CLASSES
        )}
      >
        {/* On a card, not loose on the wallpaper. Bare text over a patterned
            surface has the doodles running behind every line, and the eye has
            to separate figure from ground before it can read — which is
            exactly the wrong amount of work for a two-line hint.

            Held to a readable measure too: unconstrained, the hint stretched
            the full width of the pane, which is the shape prose stops being
            readable in. The card is the only local part; the contents are
            the house empty state, same as everywhere else. */}
        <StatePanel
          className="bg-card w-80 max-w-full rounded-lg px-6 shadow-[var(--wa-shadow)]"
          icon={MessageSquare}
          title={t('selectConversation')}
          description={t('selectConversationHint')}
        />
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? t('assigned'))
    : t('assign');

  // Same list the header dropdown offers, ordered for the keyboard: take it,
  // teammates, hand it back to the queue.
  const assignCandidates = buildAssignCandidates(
    profiles,
    user?.id ?? null,
    {
      takeIt: t('takeIt'),
      unassign: t('unassign'),
      unnamed: t('unknown'),
    },
    assignedAgentId
  );

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div
      // The whole conversation is the drop zone, not just the composer.
      // `MessageComposer` finds this element with `closest()` and binds
      // the drag listeners to it — see the note there for why the old
      // arrangement lost every file dropped above the text box.
      data-thread-root
      className={cn('flex min-w-0 flex-1 flex-col', DOODLE_BG_CLASSES)}
    >
      {/* Header — solid card surface sits on top of the doodle so the
          name/avatar/dropdowns stay legible.

          `xl:pr-10` reserves the handle's lane. The contact-panel handle is
          anchored to this column's right edge at this header's own vertical
          centre (see inbox/page.tsx), so without a gutter it lands on top of
          whatever the action cluster ends with — the assign chip, in the
          state where the panel is closed and the handle is pulled fully
          inside the thread. 40px clears a 24px disc sitting 8px in and leaves the
          same 8px of air the cluster uses between its own items.

          Only at `xl`: below it there is no handle, and this header cannot
          spare a pixel at 360px. */}
      <div className="border-border bg-card flex items-center justify-between gap-2 border-b px-3 py-3 sm:px-4 xl:pr-10">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — phone only. Hidden on md+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t('backToConversations')}
              data-slot="button"
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-1) md:hidden"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          {/* The same disc the conversation list draws for this contact,
              one column to the right — same seed, same colour. */}
          <div
            className={cn(
              'text-avatar-ink flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium',
              avatarClass(displayName)
            )}
          >
            {avatarInitials(displayName)}
          </div>
          <div className="min-w-0">
            <h2 className="text-foreground truncate text-sm font-semibold">
              {displayName}
            </h2>
            {/* Under the name: where the deal stands, not the number.

                The stage was further along the header, in the empty half,
                which put the two facts about this conversation — who they
                are and where the deal stands — at opposite ends of a bar.
                They belong to the same glance. The number moved out
                entirely; it is on the panel, the record and the copy button.

                Funnel AND stage, because "Em andamento" exists in both of
                PlastfortSul's pipelines and the stage alone does not say
                which.

                And it is a CAPTION, not a control strip.

                It carried the phone as plain 12px grey. Putting a chip there
                changed the line into a box: the chip's own padding pushed its
                text 6px right of the name above it, and its 18px height sat
                the baseline lower than the line it replaced — which is what
                read as crooked. A dot and text align with the name because
                they are the same kind of object the line always held.

                The dot is the stage's colour, which is the whole point of
                the stage having one. */}
            {conversation.deal?.stage ? (
              dealStages.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    title={t('changeStage')}
                    aria-label={t('changeStage')}
                    className="text-muted-foreground hover:text-foreground -mx-1 flex min-w-0 items-center gap-1.5 rounded-sm px-1 text-xs transition-colors"
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: conversation.deal.stage.color }}
                    />
                    <span className="truncate">
                      {conversation.deal.stage.pipeline?.name
                        ? `${conversation.deal.stage.pipeline.name} · ${conversation.deal.stage.name}`
                        : conversation.deal.stage.name}
                    </span>
                    <ChevronDown className="size-3 shrink-0 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {dealStages.map((stage) => (
                      <DropdownMenuItem
                        key={stage.id}
                        onClick={() => handleStageChange(stage.id)}
                        className={cn(
                          'text-sm',
                          stage.id === conversation.deal?.stage_id
                            ? 'text-primary font-semibold'
                            : 'text-popover-foreground'
                        )}
                      >
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        <span className="flex-1 whitespace-nowrap">
                          {stage.name}
                        </span>
                        {stage.id === conversation.deal?.stage_id && (
                          <Check className="ml-2 size-3" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 truncate text-xs">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: conversation.deal.stage.color }}
                  />
                  {conversation.deal.stage.pipeline?.name
                    ? `${conversation.deal.stage.pipeline.name} · ${conversation.deal.stage.name}`
                    : conversation.deal.stage.name}
                </p>
              )
            ) : (
              <p className="text-muted-foreground truncate text-xs">
                {formatPhone(contact.phone)}
              </p>
            )}
          </div>
          {/* Meta's 24h window — hidden on the narrowest phones so the
              name + back arrow keep their room. EXCEPT once it has actually
              closed: the in-stream notice can be dismissed, and below 640px
              this pill is the only other place that says so. It buys its
              20px back by having something to say. */}
          <WindowPill
            className={cn(
              'ml-1 sm:ml-2',
              sessionInfo.state !== 'expired' && 'hidden sm:inline-flex'
            )}
            state={sessionInfo.state}
            label={sessionInfo.remaining}
            title={tTimer('windowTitle')}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Contact details, as an overlay — every width that cannot
              spare a column for the sidebar, which is now everything under
              xl. Same content, same component; it just arrives over the
              thread instead of beside it. */}
          {onOpenContactSheet && (
            <button
              type="button"
              onClick={onOpenContactSheet}
              aria-label={t('contactDetails')}
              title={t('contactDetails')}
              // `data-slot="button"` opts this raw element into the
              // coarse-pointer hit shield in globals.css: 28px of drawing,
              // 44px of target, and not one pixel of extra header width —
              // which this header cannot spare at 360px.
              data-slot="button"
              // `hidden sm:inline-flex` is the phone half of the fix for
              // "quebra fora da janela": back + avatar + name + info + call
              // + refresh + status + owner is ~330px of controls that all
              // refuse to shrink, against a 390px viewport. Everything
              // secondary moves into the `⋯` menu below `sm`.
              className="text-muted-foreground hover:bg-muted hover:text-foreground hidden size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-1) sm:inline-flex xl:hidden"
            >
              <Info className="size-4" />
            </button>
          )}

          {/* The contact-panel toggle used to live here, as a fourth
              header glyph with the same weight as the refresh icon and no
              visual relationship to the 288px panel it hid. It is now a
              handle on the seam itself, rendered by the inbox page — see
              the note there. Issue #258. */}

          {onLogCall && (
            <button
              type="button"
              onClick={onLogCall}
              aria-label={t('logCall')}
              title={t('logCall')}
              data-slot="button"
              className="text-muted-foreground hover:bg-muted hover:text-foreground hidden size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-1) sm:inline-flex"
            >
              <Phone className="size-4" />
            </button>
          )}

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label={t('refreshConversation')}
              title={t('refresh')}
              data-slot="button"
              className="text-muted-foreground hover:bg-muted hover:text-foreground hidden size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-1) disabled:opacity-60 sm:inline-flex"
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')}
              />
            </button>
          )}

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              // Same hit shield as the icon buttons beside it: 28px drawn,
              // 44px tappable, header width unchanged.
              data-slot="button"
              className={cn(
                'hover:bg-muted hidden h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs whitespace-nowrap transition-colors duration-(--dur-1) sm:inline-flex',
                currentStatus?.color ?? 'text-muted-foreground'
              )}
            >
              {currentStatus ? t(`status${currentStatus.label}`) : t('status')}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn('text-sm', opt.color)}
                >
                  {t(`status${opt.label}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Who owns this thread. Amber when nobody does — see
              ./thread-chrome. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              title={t('assign')}
              data-slot="button"
              className={ownerChipVariants({ owned: !!assignedAgentId })}
            >
              <OwnerChipContent
                label={assignLabel}
                // Only when somebody actually owns it. Unassigned, the
                // amber `UserPlus` is the whole message and initials of
                // a person who does not exist would be a lie.
                initials={
                  assignedAgentId && currentAssignee?.full_name
                    ? avatarInitials(currentAssignee.full_name)
                    : null
                }
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {profiles.length === 0 ? (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground text-sm"
                >
                  {t('noTeammates')}
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  const presence = getPresence(p.user_id);
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        'text-sm',
                        isSelected ? 'text-primary' : 'text-popover-foreground'
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(
                          presence,
                          getRow(p.user_id)?.last_seen_at ?? null,
                          now,
                          tPresence
                        )}
                        className="mr-2"
                      />
                      {/* A person's name is not a place to save width. */}
                      <span className="flex-1 whitespace-nowrap">
                        {p.full_name}
                        {p.user_id === user?.id ? t('me') : ''}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-muted-foreground text-sm"
                  >
                    {t('unassign')}
                  </DropdownMenuItem>
                </>
              )}
              {/* One member means the only name in this menu is your own,
                  and assigning a thread to yourself notifies nobody — the
                  trigger behind it skips self-assignment on purpose
                  (migration 027). Without this line that reads as the
                  notification being broken.

                  `length === 1`, never `=== 0`: the empty list is the
                  loading state and the failed-fetch state, and it already
                  has its own row above. */}
              {profiles.length === 1 && profiles[0].user_id === user?.id && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <div className="text-muted-foreground text-2xs max-w-56 px-2 py-1.5 leading-snug">
                    {t('soloAssignHint')}
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* The overflow, phone only.
              Everything the header just stopped drawing lives in here,
              plus the conversation actions the list rows already have —
              so parking a thread, hiding it or marking it unread is
              reachable from inside the conversation too, which is where
              somebody actually decides those things. */}
          {conversation && onConversationPatch && onConversationRemoved && (
            <ConversationMenu
              conversation={conversation}
              onPatch={onConversationPatch}
              onRemoved={onConversationRemoved}
              variant="dropdown"
              leadingItems={
                <>
                  {onOpenContactSheet && (
                    <DropdownMenuItem onClick={onOpenContactSheet}>
                      <Info className="mr-2 size-4" />
                      {t('contactDetails')}
                    </DropdownMenuItem>
                  )}
                  {onLogCall && (
                    <DropdownMenuItem onClick={onLogCall}>
                      <Phone className="mr-2 size-4" />
                      {t('logCall')}
                    </DropdownMenuItem>
                  )}
                  {onRefresh && (
                    <DropdownMenuItem
                      disabled={isRefreshing}
                      onClick={handleRefreshClick}
                    >
                      <RefreshCw className="mr-2 size-4" />
                      {t('refresh')}
                    </DropdownMenuItem>
                  )}
                </>
              }
            >
              <button
                type="button"
                aria-label={t('moreActions')}
                title={t('moreActions')}
                data-slot="button"
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-1) sm:hidden"
              >
                <MoreVertical className="size-4" />
              </button>
            </ConversationMenu>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <StatePanel
            icon={MessageSquare}
            title={t('noMessagesYet')}
            description={t('sendTemplateHint')}
          />
        ) : (
          <div className="space-y-4">
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  {/* Centred pill on the wallpaper, WhatsApp's own day
                      separator. `bg-muted` would disappear into the
                      beige. */}
                  <span className="bg-wa-in text-muted-foreground text-3xs rounded-lg px-3 py-1 font-medium shadow-[var(--wa-shadow)]">
                    {formatDateSeparator(group.date, t)}
                  </span>
                </div>
                {/* Messages */}
                {/* Tight by default; a run's FIRST bubble adds its own
                    top spacing below. That is what visually welds a
                    burst of messages from one sender into a single
                    turn. */}
                <div className="space-y-0.5">
                  {group.messages.map((msg, msgIndex) => {
                    // A run breaks when the sender side changes.
                    // agent and bot are both "us" — a bot reply
                    // continuing an agent's run is still our side of
                    // the conversation, and drawing a new tail for it
                    // would imply a third party.
                    //
                    // AND it breaks when a different colleague takes over,
                    // which is the case the report was about: Matheus
                    // answers twice, then Thales answers. One run would
                    // draw that as one turn by one person. Only possible
                    // since 056 — `sender_id` was never written before it,
                    // so on old rows both sides are null and this reads
                    // false, which is the old behaviour exactly.
                    const side = (m: Message) =>
                      m.sender_type === 'agent' || m.sender_type === 'bot';
                    const previous = group.messages[msgIndex - 1];
                    const authorChanged =
                      !!previous &&
                      side(previous) &&
                      side(msg) &&
                      (previous.sender_id ?? null) !== (msg.sender_id ?? null);
                    const firstOfRun =
                      !previous ||
                      side(previous) !== side(msg) ||
                      authorChanged;
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel:
                            parent.sender_type === 'agent' ||
                            parent.sender_type === 'bot'
                              ? t('me')
                              : contact?.name || contact?.phone || 'Unknown',
                          preview: buildReplyPreview(parent, tQuote),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === 'agent' && r.actor_id === user?.id
                      );
                      const next = own?.emoji === emoji ? '' : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <div key={msg.id} className={firstOfRun ? 'pt-2' : ''}>
                        <MessageActions
                          message={msg}
                          conversationId={conversationId}
                          onReply={() => handleStartReply(msg)}
                          onReact={(emoji) => {
                            if (emoji) void postReaction(msg.id, emoji);
                          }}
                        >
                          <MessageBubble
                            message={msg}
                            reply={reply}
                            reactions={msgReactions}
                            currentUserId={user?.id}
                            onToggleReaction={handlePillToggle}
                            onOpenMedia={handleMediaChange}
                            firstOfRun={firstOfRun}
                            // "Puxando sempre o nome do atendente que está
                            // mandando a mensagem." Resolved from the id the
                            // send path now records, so it survives the
                            // signature being off — which it is by default —
                            // and it is an identity rather than a nickname
                            // somebody typed into this browser.
                            senderName={
                              msg.sender_type === 'agent' && msg.sender_id
                                ? (profiles.find(
                                    (p) => p.user_id === msg.sender_id
                                  )?.full_name ?? null)
                                : null
                            }
                          />
                        </MessageActions>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Last in the stream, so it reads as the most recent thing that
                happened — which it is. Inside the scroll container, so it
                scrolls away instead of standing on the conversation. */}
            {sessionInfo.expired && !windowNotice.dismissed && (
              <WindowClosedNotice
                onOpenTemplates={handleOpenTemplates}
                onDismiss={windowNotice.dismiss}
              />
            )}
          </div>
        )}
      </div>

      {/* AI auto-reply banner — take over an active bot, or resume it
          after a handoff. Renders nothing unless the account has
          auto-reply configured. */}
      <AiThreadBanner
        conversationId={conversation.id}
        disabled={conversation.ai_autoreply_disabled ?? false}
        handoffSummary={conversation.ai_handoff_summary}
        assignedAgentId={assignedAgentId}
        currentUserId={user?.id}
        onChange={(patch) => {
          if ('assigned_agent_id' in patch) {
            onAssignChange(conversation.id, patch.assigned_agent_id ?? null);
          }
        }}
      />

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        // The signature's default: who is signed in, by name.
        agentName={
          profiles.find((p) => p.user_id === user?.id)?.full_name ?? ''
        }
        assignCandidates={assignCandidates}
        onAssign={handleAssignChange}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onSendInteractive={handleSendInteractive}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />

      {/* Full-size viewer for the thread's images/videos. Renders nothing
          until a bubble opens it. */}
      <MediaLightbox
        items={mediaGallery}
        activeId={mediaMessageId}
        onActiveIdChange={handleMediaChange}
        contactLabel={contactDisplayName}
      />

      {/* The same two gates the board and the sheet use, for the stage
          picker in the header above. */}
      <DealOutcomeDialogs {...outcome.dialogProps} />
    </div>
  );
}
