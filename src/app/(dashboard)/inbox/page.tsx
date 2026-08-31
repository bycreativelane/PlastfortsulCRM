'use client';

import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import type {
  Conversation,
  ContactTag,
  Deal,
  Message,
  Contact,
  ConversationStatus,
  PipelineStage,
} from '@/types';
import { useRealtime } from '@/hooks/use-realtime';
import { ConversationList } from '@/components/inbox/conversation-list';
import { TeamChannel } from '@/components/inbox/team-channel';
import { MessageThread } from '@/components/inbox/message-thread';
import { ContactSidebar } from '@/components/inbox/contact-sidebar';
import { ContactForm } from '@/components/contacts/contact-form';
import { DealForm } from '@/components/pipelines/deal-form';
import { FuturePurchaseDialog } from '@/components/contacts/future-purchase-dialog';
import { OccurrenceDialog } from '@/components/contacts/occurrence-dialog';
import { CallLogDialog } from '@/components/contacts/call-log-dialog';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = 'wacrm:inbox:contact-panel-open';

// The width at which the list and the thread stop being two screens and
// start being two columns. Below it, opening a conversation is a
// navigation (it replaces what's on screen) and therefore has to leave a
// history entry, or the system back gesture walks out of /inbox entirely.
const TWO_PANE_QUERY = '(min-width: 768px)';

// The width at which the contact panel can join them without starving the
// thread: nav 240 + list 320 + panel 288 = 848px of fixed columns, which
// only leaves a usable thread from 1280px up.
const CONTACT_PANEL_AUTO_QUERY = '(min-width: 1280px)';

// `useSearchParams` (the `?c=<id>` deep link below) requires a Suspense
// boundary or the production build bails to CSR and errors out. Thin
// wrapper supplies it; the inner component holds all the inbox state.
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}

function InboxPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('Inbox.messageThread');
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get('c');
  /**
   * `?team=1` opens the team room instead of a conversation.
   *
   * The room's preview card lives in the sidebar, on every route, so it
   * needs a URL that lands somebody in it — a link that only got them to
   * the inbox would put the thing they clicked one more click away, which
   * is exactly the friction the card exists to remove.
   */
  const deepLinkTeam = searchParams.get('team') === '1';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [teamOpen, setTeamOpen] = useState(false);

  /**
   * Drop `team=1` when the room closes, so the next click on the rail's
   * team card is a real navigation rather than a no-op onto the URL the
   * page is already showing. `replace` because leaving a room is not a
   * place in history — the back gesture should go where you were BEFORE
   * the room, not into it.
   *
   * Declared here, above every handler that calls it: a `useCallback`
   * named in a dependency array is read during render, so a definition
   * further down the component would be a temporal-dead-zone crash rather
   * than a late binding.
   */
  const leaveTeamUrl = useCallback(() => {
    if (!deepLinkTeam) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete('team');
    const query = next.toString();
    router.replace(query ? `/inbox?${query}` : '/inbox', { scroll: false });
  }, [deepLinkTeam, searchParams, router]);

  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);

  /**
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `true` (the historical behaviour) and is reconciled after
   * mount. We deliberately do NOT read localStorage — or matchMedia — in
   * the initializer: the server renders with `true`, so reading a stored
   * `false` (or a narrow viewport) synchronously would produce a
   * hydration mismatch. The effect below reconciles right after mount.
   *
   * With no stored choice we fall back to the viewport rather than to
   * `true`: on a 1024–1279px laptop the three fixed columns leave the
   * thread under 200px, and the only control that could close the panel
   * lives inside the header that just got crushed.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
    if (stored !== null) {
      setContactPanelOpen(stored === 'true');
      return;
    }
    if (!window.matchMedia(CONTACT_PANEL_AUTO_QUERY).matches) {
      setContactPanelOpen(false);
    }
  }, []);

  /**
   * The contact panel on narrow screens. Below `xl` the sidebar never
   * renders as a column, and everything it holds — tags, the open deal,
   * notes, the commercial history — had no other route from a thread.
   * Same component, shown over the thread instead of beside it.
   */
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const handleOpenContactSheet = useCallback(() => {
    setContactSheetOpen(true);
  }, []);

  /* ---- Editing from inside the conversation -------------------------
   *
   * Both dialogs live HERE and not in `ContactSidebar`, because the panel
   * is mounted twice — as the xl column and inside the mobile sheet — and
   * state held there would be two independent copies of the same dialog,
   * only one of which the user can see.
   *
   * They are also pure component state, never URL state. The thread
   * selection is driven by `?c=`, with a back-gesture watcher that clears
   * the active conversation whenever that param disappears without this
   * page having written it — a dialog that touched the URL could close the
   * thread underneath itself.
   */
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [dealPipelineId, setDealPipelineId] = useState('');
  const [dealStages, setDealStages] = useState<PipelineStage[]>([]);
  /** Bumped after a save so the contact panel refetches what it shows. */
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  /**
   * Refresh the PANEL and the LIST together.
   *
   * Reported as "etiquetas, oportunidades e ocorrências só aparecem após
   * atualizar a página". The panel was already refetching — every dialog
   * bumps `sidebarRefresh` and `ContactSidebar` listens to it. What was
   * not refetching is the conversation LIST, and that is where those
   * three things are most visible: the row draws the type tag chip, the
   * deal's stage chip and the occurrence triangle, all of them read from
   * the `conversations` query that `ConversationList` runs once.
   *
   * So half the screen updated and the other half did not, which reads
   * as "it did not save" — and F5 was the only thing that fixed it,
   * because F5 is what refetches the list.
   *
   * One function instead of two calls at each of the six call sites: the
   * seventh dialog somebody adds would have bumped one and forgotten the
   * other, which is exactly how this happened.
   */
  const refreshContactViews = useCallback(() => {
    setSidebarRefresh((n) => n + 1);
    setResyncToken((n) => n + 1);
  }, []);

  const handleEditContact = useCallback(async (c: Contact) => {
    // The form wants the contact's current tags so its picker opens with
    // them selected; one small query beats threading them through the panel.
    const { data } = await createClient()
      .from('contact_tags')
      .select('id, contact_id, tag_id')
      .eq('contact_id', c.id);
    setEditContactTags((data ?? []) as ContactTag[]);
    setEditContactOpen(true);
  }, []);

  const handleEditDeal = useCallback(
    async (c: Contact, deal: Deal | null) => {
      const supabase = createClient();
      // Editing: the deal names its own funnel. Creating: the first funnel
      // by creation date, which is the same one the board opens on. This
      // deliberately does NOT seed a pipeline — creating one as a side
      // effect of opening a dialog in the inbox is not something anybody
      // asked for.
      const pipelineId =
        deal?.pipeline_id ??
        (
          await supabase
            .from('pipelines')
            .select('id')
            .order('created_at')
            .limit(1)
        ).data?.[0]?.id ??
        '';
      if (!pipelineId) {
        toast.error(t('noPipelineForDeal'));
        return;
      }
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('position');
      setDealPipelineId(pipelineId);
      setDealStages((stages ?? []) as PipelineStage[]);
      setEditingDeal(deal);
      setDealFormOpen(true);
    },
    [t]
  );

  const handleContactSaved = useCallback(async () => {
    if (!activeContact) return;
    const { data } = await createClient()
      .from('contacts')
      .select('*')
      .eq('id', activeContact.id)
      .single();
    if (data) {
      const saved = data as Contact;
      setActiveContact(saved);
      // The list row and the thread header both read `conversation.contact`,
      // and `hydrateConversation` will NOT fix this: its merge only
      // backfills a MISSING contact (`c.contact ?? fetched.contact`), which
      // is deliberate — it protects fresher realtime fields. A renamed
      // contact therefore keeps the old name everywhere until a reload
      // unless it is patched explicitly.
      setConversations((prev) =>
        prev.map((c) =>
          c.contact?.id === saved.id
            ? { ...c, contact: { ...c.contact, ...saved } }
            : c
        )
      );
    }
    // The optimistic patch above carries the contact's own FIELDS, and
    // the row also draws things that hang off it — the type tag chip and
    // the occurrence triangle — which the save response does not return.
    // Only a refetch has those.
    refreshContactViews();
  }, [activeContact, refreshContactViews]);

  const [recordOpen, setRecordOpen] = useState(false);
  const handleOpenRecord = useCallback(() => {
    setRecordOpen(true);
  }, []);

  const [callLogOpen, setCallLogOpen] = useState(false);
  const handleLogCall = useCallback(() => {
    setCallLogOpen(true);
  }, []);

  const [occurrencesOpen, setOccurrencesOpen] = useState(false);
  const [futurePurchaseOpen, setFuturePurchaseOpen] = useState(false);

  const handleOpenOccurrences = useCallback(() => {
    setOccurrencesOpen(true);
  }, []);

  const handleScheduleFuturePurchase = useCallback(() => {
    setFuturePurchaseOpen(true);
  }, []);

  const handleDealSaved = useCallback(() => {
    // The row's stage chip comes from the conversation's `deal` embed, so
    // the list has to refetch for a stage change to show up in it.
    refreshContactViews();
  }, [refreshContactViews]);

  /**
   * The panel's MOUNT, which outlives its open state by one animation.
   *
   * The column animates its width shut, and a width animation needs
   * something to animate: unmounting on the click emptied it in one frame
   * and left a blank strip to do the sliding. So the mount follows `open`
   * immediately and `closed` only once the transition has finished.
   *
   * Not simply always-mounted. `ContactSidebar` fires three queries per
   * contact, and an agent who collapsed the panel collapsed it to stop
   * paying for what they are not reading — mounting it anyway would bill
   * them for it on every conversation they open.
   */
  const [panelMounted, setPanelMounted] = useState(true);
  useEffect(() => {
    if (contactPanelOpen) {
      setPanelMounted(true);
      return;
    }
    // `transitionend` cannot report back if the column stops existing.
    // Switching to a thread-less state mid-close would strand a mounted,
    // invisible, still-querying panel — and there is nothing to animate
    // with no conversation on screen anyway, so drop it outright.
    if (!activeConversation) setPanelMounted(false);
  }, [contactPanelOpen, activeConversation]);

  const handleToggleContactPanel = useCallback(() => {
    setContactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  // Fire the deep-link auto-select exactly once per URL — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to the deep-linked conversation if they've already clicked
  // elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);

  // The `?c=` value this component last wrote itself. When the param
  // changes to something else, the navigation came from OUTSIDE — the
  // browser's back/forward gesture — and the panes have to follow it.
  const urlConvIdRef = useRef<string | null>(null);
  // True while the current selection owns a history entry we pushed, so
  // the in-app back button can pop it instead of stacking a second one.
  const pushedForSelectionRef = useRef(false);

  // Tracks conversations whose hydrate fetch is currently in flight. The
  // conv-INSERT and the first-message-INSERT events both call into
  // hydrateConversation; the dedupe here keeps it at one refetch per
  // new conversation even when both events arrive within milliseconds.
  const hydratingConvIdsRef = useRef<Set<string>>(new Set());

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Pull the conversation row with its `contact` joined and merge it
  // into state. Needed because Supabase Realtime payloads only carry the
  // row's own columns — a brand-new conversation arrives without a
  // contact, which surfaced as "Unknown" names, empty avatars, and
  // (when the conv-INSERT event was delayed past the message-INSERT)
  // conversations stuck on "No messages yet" until the user reloaded.
  // Also self-heals if a realtime event was missed: callers can invoke
  // this whenever they reference a conversation id they don't recognise.
  const hydrateConversation = useCallback(async (convId: string) => {
    if (hydratingConvIdsRef.current.has(convId)) return;
    hydratingConvIdsRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .eq('id', convId)
        .maybeSingle();
      if (error) {
        // Supabase errors have non-enumerable properties — log fields
        // explicitly so the console message isn't just `{}`.
        console.error('Failed to hydrate conversation:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }
      if (!data) return;
      const fetched = normalizeConversation(data);
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id);
        if (existing) {
          // Already in state — keep its fields (a realtime UPDATE may
          // have landed while the fetch was in flight and patched
          // last_message_text / unread_count to fresher values than
          // the row we just read). Only backfill `contact`, which the
          // realtime payloads never carry.
          return prev.map((c) =>
            c.id === fetched.id
              ? { ...c, contact: c.contact ?? fetched.contact }
              : c
          );
        }
        return [fetched, ...prev];
      });
    } finally {
      hydratingConvIdsRef.current.delete(convId);
    }
  }, []);

  // Check WhatsApp connection status on mount

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === 'INSERT') {
        // Add to messages if it belongs to active conversation
        if (
          activeConversation &&
          newMsg.conversation_id === activeConversation.id
        ) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace optimistic message if it exists
            const withoutOptimistic = prev.filter(
              (m) => !m.id.startsWith('temp-')
            );
            return [...withoutOptimistic, newMsg];
          });
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state to decide between patching
        // the preview and triggering a hydrate — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_text: newMsg.content_text ?? '',
                    last_message_at: newMsg.created_at,
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c
            )
          );
        } else {
          // First time we're seeing this conv: the conv-INSERT event
          // hasn't landed yet, or was missed. Hydrate from the DB so
          // the row surfaces with its `contact` joined; the conv-UPDATE
          // event the webhook emits right after the message INSERT will
          // converge state when it arrives.
          hydrateConversation(newMsg.conversation_id);
        }
      }

      if (event.eventType === 'UPDATE') {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;

      if (event.eventType === 'INSERT') {
        // Prepend immediately for snappy UX so the new conv shows in the
        // list right away, then hydrate to fill in the `contact` join
        // (realtime payloads never include joins). Skip both if we
        // already have the row — that shouldn't happen normally, but
        // out-of-order delivery would have us prepending a duplicate.
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev;
            return [conv, ...prev];
          });
          hydrateConversation(conv.id);
        }
      }

      if (event.eventType === 'UPDATE') {
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversation?.id === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c
            )
          );
        } else {
          // UPDATE arrived before the INSERT (or after a missed INSERT)
          // — fetch the row so it surfaces with its contact joined. The
          // patch contained in `conv` will already be reflected in what
          // the hydrate fetch returns.
          hydrateConversation(conv.id);
        }

        // Update active conversation if it changed
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) => (prev ? { ...prev, ...conv } : prev));
        }
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Subscribe to realtime. The `isConnected` flag below feeds the
  // reconnect resync: realtime is best-effort and events sent while the
  // WS was disconnected (laptop sleep, network blip, background-tab
  // throttle) are simply lost. We need a way to catch up.
  const { isConnected } = useRealtime({
    channelName: 'inbox-realtime',
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  /**
   * Bump `resyncToken` whenever the realtime channel transitions from
   * disconnected → connected *after* the initial connect. The initial
   * connect is covered by the children's on-mount fetches; only later
   * reconnects need a manual refetch to fill the gap.
   *
   * Tracked via a `was-connected` ref rather than a count so that React
   * strict-mode's dev-only effect double-fire doesn't read as a
   * reconnect.
   */
  const wasConnectedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // false → true transition
      if (initialConnectDoneRef.current) {
        setResyncToken((n) => n + 1);
      } else {
        initialConnectDoneRef.current = true;
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);
      // Resolve a pending deep-link here rather than in an effect — this
      // is an event handler, so the setState calls below are allowed by
      // react-hooks/set-state-in-effect. Runs once per ?c=<id> URL value
      // via the ref, so realtime refreshes of the list can't snap the
      // user back to the deep-linked thread after they've navigated.
      if (
        deepLinkConvId &&
        autoSelectedForDeepLinkRef.current !== deepLinkConvId &&
        loaded.length > 0
      ) {
        autoSelectedForDeepLinkRef.current = deepLinkConvId;
        // The URL already says `?c=<id>` and we did not write it, but from
        // here on we own it — keep the back-gesture watcher in sync.
        urlConvIdRef.current = deepLinkConvId;
        // If the deep-linked conversation is already the active one
        // (e.g. because the user clicked it in the list and we
        // router.replace()'d the URL, which made the ConversationList
        // refetch and land us back here), do NOT re-apply it. Doing so
        // would setMessages([]) on a thread whose messages have
        // already been loaded by MessageThread — and because
        // conversationId didn't change, MessageThread wouldn't
        // refetch. The thread would read "No messages yet" until a
        // full page reload rehydrated state from scratch.
        if (activeConversation?.id === deepLinkConvId) return;
        const match = loaded.find((c) => c.id === deepLinkConvId);
        if (match) {
          setActiveConversation(match);
          setActiveContact(match.contact ?? null);
          setMessages([]);
          // Mirror the optimistic unread reset that handleSelectConversation
          // does — the user just deep-linked into this conv, treat that the
          // same as a click. Leaves activeConversation.unread_count alone so
          // the MessageThread reset effect still fires the server UPDATE.
          if (match.unread_count > 0) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === match.id ? { ...c, unread_count: 0 } : c
              )
            );
          }
        }
      }
    },
    [deepLinkConvId, activeConversation?.id]
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      // Picking a customer leaves the team room — one pane, one subject.
      setTeamOpen(false);
      leaveTeamUrl();
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact below to
      // keep the effect firing), and the realtime UPDATE that comes
      // back will sync to 0 again as a no-op. Zeroing the list copy
      // here means the user sees the badge disappear the instant they
      // click instead of waiting for the round-trip — and it persists
      // even if the realtime UPDATE is dropped.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id && c.unread_count > 0 ? { ...c, unread_count: 0 } : c
        )
      );
      // Record the selection on the deep-link ref BEFORE we change the
      // URL. The router.replace below flips `deepLinkConvId`, which can
      // in turn cause ConversationList to refetch and eventually call
      // handleConversationsLoaded again. Without this line, the ref
      // still points at the previous value, the auto-select block
      // sees `ref !== deepLinkConvId`, fires a second time, and
      // clobbers the messages MessageThread just fetched.
      autoSelectedForDeepLinkRef.current = conv.id;
      urlConvIdRef.current = conv.id;
      // Reflect the selection in the URL so a refresh lands the user back
      // in the same thread, and so copy-paste links work.
      //
      // How we write it depends on whether the two panes coexist. Side by
      // side (md+) a click is a selection, and replace() keeps history from
      // filling up with one entry per click. Below md the thread REPLACES
      // the list, which makes the click a navigation — with replace() the
      // system back gesture (the universal back button on Android) has no
      // entry to pop and walks straight out of /inbox, and the only way
      // back is an in-app button the user finds after being ejected.
      const sideBySide = window.matchMedia(TWO_PANE_QUERY).matches;
      pushedForSelectionRef.current = !sideBySide;
      const href = `/inbox?c=${conv.id}`;
      if (sideBySide) {
        router.replace(href, { scroll: false });
      } else {
        router.push(href, { scroll: false });
      }
    },
    [activeConversation?.id, router, leaveTeamUrl]
  );

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list
  // instead of re-opening the thread the user just backed out of.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /inbox?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    urlConvIdRef.current = null;
    if (pushedForSelectionRef.current) {
      // We own the top history entry: pop it so the in-app back button and
      // the system one land on exactly the same URL, with no forward stub.
      pushedForSelectionRef.current = false;
      router.back();
      return;
    }
    router.replace('/inbox', { scroll: false });
  }, [router]);

  /**
   * Follow a `?c=` that disappeared without us doing it — the back
   * gesture on the thread pane. `urlConvIdRef` holds what we last wrote,
   * so a mismatch is the browser talking, and the answer is the same as
   * the in-app back button: drop the selection, show the list.
   */
  useEffect(() => {
    if (deepLinkConvId === urlConvIdRef.current) return;
    if (deepLinkConvId !== null) return;
    urlConvIdRef.current = null;
    pushedForSelectionRef.current = false;
    autoSelectedForDeepLinkRef.current = null;
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
  }, [deepLinkConvId]);

  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleStatusChange = useCallback(
    (conversationId: string, patch: Partial<Conversation>) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, ...patch } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, ...patch } : prev));
      }
    },
    [activeConversation]
  );

  /**
   * Apply the exact patch a conversation write returned.
   *
   * The menu's actions each report what they wrote, so the list can move a
   * row between tabs, drop the unread badge or hide it without going back to
   * the database for a row we just changed. A refetch here would be a
   * visible stutter on an action that should feel like the row obeyed.
   */
  const handleConversationPatch = useCallback(
    (conversationId: string, patch: Partial<Conversation>) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, ...patch } : c))
      );

      // Marking the OPEN thread unread has to close it, and this is the
      // only place that knows which thread is open.
      //
      // MessageThread resets `unread_count` to 0 whenever a count surfaces
      // on the conversation it is displaying — that is what makes reading a
      // thread mark it read, including for messages that arrive while you
      // are looking at it. So marking the open one unread and staying in it
      // would fire that effect and undo the write within the same second:
      // the menu item would appear to do nothing at all.
      //
      // Closing the thread is also what the action MEANS. "Marcar como não
      // lida" in a shared mailbox is how somebody hands a conversation back
      // to the queue — for a colleague, or for themselves tomorrow — and
      // staying inside a thread you just handed back is the contradiction,
      // not the fix.
      const handingBack =
        (patch.unread_count ?? 0) > 0 || patch.hidden_at != null;

      setActiveConversation((prev) => {
        if (!prev || prev.id !== conversationId) return prev;
        if (handingBack) return null;
        return { ...prev, ...patch };
      });
    },
    []
  );

  /**
   * A conversation was deleted. Drop it, and close the thread if it was the
   * one on screen — leaving a deleted thread open would let somebody type
   * into a conversation that no longer exists.
   */
  const handleConversationRemoved = useCallback((conversationId: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    setActiveConversation((prev) =>
      prev?.id === conversationId ? null : prev
    );
  }, []);

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation]
  );

  // On a phone (<md) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side. Selecting a
  // conversation slides the thread in; the thread's back button pops
  // it back to the list. From md up both panes render side-by-side:
  // 768px is an iPad in portrait, where one pane meant a conversation
  // list with 600px of empty gutter to the right of every name.
  /**
   * The team room takes the thread's place rather than sitting beside it.
   *
   * On a phone the inbox is already a single pane and this is one more
   * destination in it; on a desktop the room replaces the customer thread,
   * which is right because it IS the thing being read. Opening it clears
   * the active conversation so the list has exactly one selected row —
   * two highlighted rows, one of them not on screen, is the state that
   * makes people click twice to be sure.
   */
  /**
   * `?team=1` opens the room — every time it ARRIVES, not once per mount.
   *
   * This used to latch on a `teamDeepLinkHandled` flag, on the reasoning
   * that re-asserting the room from the query string would bounce a click
   * on a customer thread back into it. The reasoning was right and the fix
   * was the wrong half: with the flag set, the second click on the rail's
   * team card — or on the What's New link — was a navigation to a URL the
   * page was ALREADY on, which changed nothing and left you looking at
   * whatever was open. The feature worked once per page load.
   *
   * The real fix is to keep the URL honest. Leaving the room strips
   * `team=1` (see `leaveTeamUrl`), so the parameter is present exactly
   * while the room is open, and this effect fires on each false→true
   * transition — which is what a click on the card now produces.
   */
  useEffect(() => {
    if (deepLinkTeam) setTeamOpen(true);
  }, [deepLinkTeam]);

  const handleOpenTeam = useCallback(() => {
    setTeamOpen(true);
    setActiveConversation(null);
    setActiveContact(null);
  }, []);

  /** Phone-only "back" out of the room, mirroring the thread's. */
  const handleCloseTeam = useCallback(() => {
    setTeamOpen(false);
    leaveTeamUrl();
  }, [leaveTeamUrl]);

  const hasActiveConv = !!activeConversation;
  const showTeam = teamOpen && !hasActiveConv;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Conversation list.
            Hidden on a phone when a conversation is selected so the
            thread can occupy the full width. Always visible on md+. */}
        <div
          className={cn(
            'flex h-full flex-1 md:flex-none',
            hasActiveConv || showTeam ? 'hidden md:flex' : 'flex'
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            onConversationPatch={handleConversationPatch}
            onConversationRemoved={handleConversationRemoved}
            teamOpen={teamOpen}
            onOpenTeam={handleOpenTeam}
            resyncToken={resyncToken}
          />
        </div>

        {/* Center panel: Message thread.
            Hidden on a phone when no conversation is selected so the
            list can occupy the full width. Always visible on md+
            (shows its own empty-state if no thread is picked yet).

            `min-w-0` is load-bearing: without it, a single wide piece
            of content inside the thread (long quote preview, very
            long URL in a message body) forces the flex child past
            its share and pushes the contact-sidebar panel off-screen
            on the right. Issue #165. */}
        <div
          className={cn(
            // `relative` anchors the contact-panel handle below. It is in
            // the base string and not in the ternary on purpose: two
            // positioning utilities at the same breakpoint are decided by
            // stylesheet order, and sidebar.tsx records that trap silently
            // anchoring its own handle to the viewport once already.
            'relative flex h-full min-w-0 flex-1',
            hasActiveConv || showTeam ? 'flex' : 'hidden md:flex'
          )}
        >
          {showTeam ? (
            <TeamChannel onBack={handleCloseTeam} />
          ) : (
            <MessageThread
              conversation={activeConversation}
              contact={activeContact}
              messages={messages}
              onMessagesLoaded={handleMessagesLoaded}
              onNewMessage={handleNewMessage}
              onUpdateMessage={handleUpdateMessage}
              onStatusChange={handleStatusChange}
              onConversationPatch={handleConversationPatch}
              onConversationRemoved={handleConversationRemoved}
              onAssignChange={handleAssignChange}
              onBack={handleCloseConversation}
              resyncToken={resyncToken}
              onRefresh={handleManualRefresh}
              onOpenContactSheet={handleOpenContactSheet}
              onLogCall={handleLogCall}
            />
          )}

          {/* The contact panel's handle, and it is the nav rail's handle
              with two things changed.
              
              It used to be a bare glyph in the thread header — same weight
              as the refresh icon beside it, roughly 700px from the panel it
              hides, with nothing to say the two were related. A control
              that moves a boundary belongs ON the boundary: this straddles
              the thread's right edge at the vertical midpoint, which is
              exactly where the pointer already is when you reach for the
              seam you want to move.

              It cannot live inside the panel, the way the prototype's `×`
              does, because the panel unmounts when closed and would take
              the only way of getting it back with it. The thread column is
              the element that survives both states and whose right edge IS
              the seam.

              NOT at the vertical middle, which is where it started and
              where it was wrong. The nav rail can sit at its own midpoint
              because what faces it there is the conversation list's
              padding; the contact panel's midpoint is its densest run of
              key/value rows, so a 24px disc straddling the border landed on
              top of "Última compra" and read as debris.

              `top-[30px]` is the thread header's own centre — `py-3` plus a
              36px avatar is 60px — so the handle sits in chrome on BOTH
              sides: level with the header bar on the left, and in the empty
              left padding of the panel's centred identity block on the
              right. Same seam, no content under it.

              The other two differences from the nav's: `xl`, matching the
              panel's own breakpoint, and the transform, which can only
              overhang when there is a panel to overhang into — the row is
              `overflow-hidden`, so a positive translate with the panel
              closed would be sliced in half. */}
          {hasActiveConv && (
            <button
              type="button"
              onClick={handleToggleContactPanel}
              aria-expanded={contactPanelOpen}
              aria-controls="contact-panel"
              title={
                contactPanelOpen ? t('hideContactPanel') : t('showContactPanel')
              }
              aria-label={
                contactPanelOpen ? t('hideContactPanel') : t('showContactPanel')
              }
              className={cn(
                'border-border bg-card text-muted-foreground hover:border-primary hover:text-primary absolute top-[30px] right-0 z-20 hidden size-6 -translate-y-1/2 place-items-center rounded-full border shadow-sm transition-colors xl:grid',
                contactPanelOpen ? 'translate-x-1/2' : '-translate-x-2'
              )}
            >
              {contactPanelOpen ? (
                <ChevronRight className="size-3.5" strokeWidth={2} />
              ) : (
                <ChevronLeft className="size-3.5" strokeWidth={2} />
              )}
            </button>
          )}
        </div>

        {/* Right panel: Contact sidebar — wide desktop only, and only when
            the agent hasn't collapsed it via the thread-header toggle
            (#258). Below xl it's always hidden and the sheet below is the
            way in, so the toggle — itself xl-only — never affects it.

            `xl` and not `lg`: the three columns here are all fixed width
            (nav 240 + list 320 + panel 288), so at 1024px they leave the
            thread 184px — narrower than its own header's min-content.

            Also gated on there BEING a conversation. With none picked the
            panel had nothing to show and no control of its own, so it read
            as an empty column the layout had forgotten about — and the one
            button that could have closed it lives in the thread header,
            which is not on screen either. */}
        {hasActiveConv && (
          <div
            id="contact-panel"
            // The close is a RESIZE, so it is `--dur-2` on the house curve
            // — the same token, and the same transitioned property, as the
            // nav rail's collapse. The rail's note says why it has to be
            // width and cannot be a transform: the column must actually
            // give the space back, not merely look narrower, or the thread
            // has nothing to grow into.
            //
            // `overflow-hidden` is what turns the resize into a movement.
            // The panel keeps its own 288px, so as the box narrows its left
            // edge travels right and the clip eats it from the right — it
            // slides out the way it came in, instead of 288px of content
            // reflowing into 0.
            //
            // Nothing here animates on load. The stored preference lands in
            // an effect on mount, long before any conversation resolves, so
            // `hasActiveConv` is still false and this is not mounted yet —
            // an agent who keeps the panel closed does not watch it slam
            // shut on every reload.
            onTransitionEnd={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.propertyName !== 'width') return;
              if (!contactPanelOpen) setPanelMounted(false);
            }}
            className={cn(
              'ease-out-soft hidden shrink-0 overflow-hidden transition-[width] duration-(--dur-2) xl:block',
              contactPanelOpen ? 'w-72' : 'w-0'
            )}
          >
            {panelMounted && (
              <ContactSidebar
                contact={activeContact}
                onEditContact={handleEditContact}
                onEditDeal={handleEditDeal}
                onOpenRecord={handleOpenRecord}
                onOpenOccurrences={handleOpenOccurrences}
                onLogCall={handleLogCall}
                onScheduleFuturePurchase={handleScheduleFuturePurchase}
                refreshToken={sidebarRefresh}
              />
            )}
          </div>
        )}
      </div>

      {/* The same panel, as an overlay, for every width that cannot spare
          a column for it. Opened from the thread header. */}
      <Sheet open={contactSheetOpen} onOpenChange={setContactSheetOpen}>
        <SheetContent
          side="right"
          size="form"
          className="border-border bg-card w-full gap-0 p-0 xl:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t('contactDetails')}</SheetTitle>
          </SheetHeader>
          <ContactSidebar
            contact={activeContact}
            className="w-full border-l-0"
            onEditContact={handleEditContact}
            onEditDeal={handleEditDeal}
            onOpenRecord={handleOpenRecord}
            onOpenOccurrences={handleOpenOccurrences}
            onLogCall={handleLogCall}
            onScheduleFuturePurchase={handleScheduleFuturePurchase}
            refreshToken={sidebarRefresh}
          />
        </SheetContent>
      </Sheet>

      {/* The two editors, mounted once for both copies of the panel.
          Editing a customer or their opportunity is something you do WHILE
          reading the conversation — the answer you are about to type
          depends on it — so it happens over the thread rather than by
          navigating away from it. */}
      <ContactForm
        open={editContactOpen}
        onOpenChange={setEditContactOpen}
        contact={activeContact}
        contactTags={editContactTags}
        onSaved={handleContactSaved}
      />
      {/* The full record, over the thread. Same component the Contacts
          page opens, so there is one contact record in the product rather
          than a panel and a page that drift. */}
      <ContactDetailView
        open={recordOpen}
        onOpenChange={setRecordOpen}
        contactId={activeContact?.id ?? null}
        onUpdated={handleContactSaved}
      />
      <CallLogDialog
        open={callLogOpen}
        onOpenChange={setCallLogOpen}
        contact={activeContact}
        onSaved={refreshContactViews}
      />
      <OccurrenceDialog
        open={occurrencesOpen}
        onOpenChange={setOccurrencesOpen}
        contact={activeContact}
        onChanged={refreshContactViews}
      />
      <FuturePurchaseDialog
        open={futurePurchaseOpen}
        onOpenChange={setFuturePurchaseOpen}
        contact={activeContact}
        onSaved={handleContactSaved}
      />
      {dealPipelineId && (
        <DealForm
          open={dealFormOpen}
          onOpenChange={setDealFormOpen}
          deal={editingDeal}
          pipelineId={dealPipelineId}
          stages={dealStages}
          defaultContactId={activeContact?.id}
          onSaved={handleDealSaved}
        />
      )}
    </div>
  );
}
