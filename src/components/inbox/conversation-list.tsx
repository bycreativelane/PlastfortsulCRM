'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from '@/lib/inbox/conversations';
import { cn } from '@/lib/utils';
import { avatarClass, avatarInitials } from '@/lib/avatar-color';
import { NotificationsMenu } from '@/components/layout/notifications-menu';
import type { Conversation } from '@/types';
import { ChevronDown, Filter, Inbox, Search, X, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatePanel } from '@/components/ui/state-panel';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SegBar } from '@/components/ui/seg-bar';
import { Tag as TagChip } from '@/components/ui/tag';
import { DARK_SURFACE, LIGHT_SURFACE, stageChip } from '@/lib/stage-color';
import { AlertTriangle } from 'lucide-react';
import { dateLocale } from '@/lib/i18n/dates';
import {
  SCOPES,
  buildFilterOptions,
  groupOptions,
  hasOccurrence,
  matchesSearch,
  typeTagOf,
  withCounts,
  type Scope,
} from './conversation-filters';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations('Inbox.conversationList');
  const { user } = useAuth();
  const { mode } = useTheme();

  // Scope is the always-visible split (owned vs unclaimed); `filterId` is the
  // one option chosen from the menu, or null. They combine with AND — see
  // ./conversation-filters for why that is the only combination worth having.
  const [scope, setScope] = useState<Scope>('entrada');
  const [filterId, setFilterId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [agentNames, setAgentNames] = useState<Map<string, string>>(
    () => new Map()
  );

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .order('last_message_at', { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error('Failed to fetch conversations:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Two lookups the list cannot derive from the conversations themselves,
  // loaded once: the funnels (so Pipeline can be a filter group without one
  // row per contact) and the members (so the owner slot can say WHO rather
  // than the word "assigned", which is what the tab already says).
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const [pipelineRes, profileRes] = await Promise.all([
        supabase.from('pipelines').select('id, name').order('created_at'),
        supabase.from('profiles').select('user_id, full_name'),
      ]);
      if (cancelled) return;
      if (pipelineRes.data) setPipelines(pipelineRes.data);
      if (profileRes.data) {
        setAgentNames(
          new Map(
            (profileRes.data as Array<{ user_id: string; full_name: string }>)
              .filter((p) => p.user_id && p.full_name)
              .map((p) => [p.user_id, p.full_name])
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Everything below is derived in one chain, and the order matters:
  //
  //   search  →  scope  →  filter
  //
  // Search first, because it is a global find and should not be trapped by a
  // tab you forgot you were on. Then scope, which is what the segments count.
  // Then the chosen filter, which is what the menu counts. Each stage is the
  // input to the next stage's counts, which is what makes every number on
  // screen equal to the number of rows clicking it produces.
  const searched = useMemo(
    () => conversations.filter((c) => matchesSearch(c, search)),
    [conversations, search]
  );

  const segments = useMemo(
    () => [
      {
        value: 'entrada' as const,
        label: t('scopeInbox'),
        count: searched.filter(SCOPES.entrada).length,
      },
      {
        value: 'esperando' as const,
        label: t('scopeWaiting'),
        count: searched.filter(SCOPES.esperando).length,
        // Amber: an unclaimed conversation is pending human work, and that is
        // the one thing in this system allowed to ask for attention.
        tone: 'human' as const,
      },
    ],
    [searched, t]
  );

  const inScope = useMemo(
    () => searched.filter(SCOPES[scope]),
    [searched, scope]
  );

  const options = useMemo(
    () =>
      withCounts(
        buildFilterOptions(conversations, pipelines, user?.id ?? null, {
          groupOwner: t('groupOwner'),
          groupState: t('groupState'),
          groupType: t('groupType'),
          groupPipeline: t('groupPipeline'),
          groupStage: t('groupStage'),
          mine: t('filterMine'),
          unread: t('filterUnread'),
          withAutomation: t('filterAutomated'),
          withOccurrence: t('filterOccurrence'),
          open: t('filterOpen'),
          closed: t('filterClosed'),
          typeLead: t('filterTypeLead'),
          typeCustomer: t('filterTypeCustomer'),
          typeInternal: t('filterTypeInternal'),
          typeNone: t('filterTypeNone'),
        }),
        inScope
      ),
    [conversations, pipelines, user?.id, inScope, t]
  );

  const activeOption = options.find((o) => o.id === filterId) ?? null;

  const filtered = useMemo(
    () => (activeOption ? inScope.filter(activeOption.match) : inScope),
    [inScope, activeOption]
  );

  // A stage chip's ink is computed against the surface it lands on, so the
  // same stage colour stays legible in either mode.
  const surface = mode === 'dark' ? DARK_SURFACE : LIGHT_SURFACE;

  const clearFilter = useCallback(() => setFilterId(null), []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  return (
    // w-full on a phone so the list occupies the whole viewport when it's
    // the single pane showing; a fixed rail from md up, where it shares the
    // row with the thread (+ the contact sidebar at xl). 288px at md so a
    // 768px tablet still leaves the thread 480px, 320px from lg.
    <div className="border-border bg-card flex h-full w-full flex-col border-r md:w-72 lg:w-80">
      <div className="border-border flex flex-col gap-2 border-b p-3">
        {/* The one split that stays on screen. Everything else is a click
            away, which is what took this bar from five rows to two. */}
        <SegBar
          label={t('scopeLabel')}
          segments={segments}
          value={scope}
          onValueChange={setScope}
        />

        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t('searchPlaceholder')}
            // Below md this list IS the inbox screen, and search plus the
            // filter under it are the only way to reach a conversation that
            // is not near the top. 32px is right for a mouse and wrong for
            // a thumb, so the height follows the pointer, not the width —
            // a 1024px tablet is touch and a 1024px laptop is not.
            className="border-border bg-card-2 h-8 pl-9 text-sm [@media(pointer:coarse)]:h-11"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-colors duration-(--dur-1) [@media(pointer:coarse)]:h-10',
                activeOption
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Filter className="size-3.5" />
              {activeOption?.label ?? t('filterButton')}
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-vh-62 w-60 overflow-y-auto"
            >
              {groupOptions(options).map(([group, items]) => (
                <div key={group}>
                  <div className="text-muted-foreground eyebrow px-2 pt-2 pb-1">
                    {group}
                  </div>
                  {items.map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      // Zero-result options are disabled, never hidden. A menu
                      // whose entries come and go teaches you to distrust it,
                      // and "there are none right now" is itself an answer.
                      disabled={option.count === 0}
                      onClick={() => setFilterId(option.id)}
                      className={cn(
                        'text-sm',
                        option.id === filterId
                          ? 'text-foreground font-semibold'
                          : 'text-popover-foreground'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                      <span className="bg-muted text-secondary-foreground text-2xs ml-auto grid h-4.5 min-w-4.5 place-items-center rounded-full px-1.5 font-bold">
                        {option.count}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeOption && (
            <button
              onClick={clearFilter}
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold transition-colors duration-(--dur-1) [@media(pointer:coarse)]:h-10"
            >
              <X className="size-3" />
              {t('clearFilter')}
            </button>
          )}

          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {t('resultCount', { count: filtered.length })}
          </span>

          {/* The bell, and it is here because on `lg` and up it exists
              nowhere else: `dashboard-shell.tsx` hides the whole app header
              on `/inbox` so the thread keeps its 56px, which takes the
              notifications with it. An agent who lives in this screen all
              day was the one person who could not see that a conversation
              had been handed to them.

              `hidden lg:inline-flex` is the other half of that rule — below
              `lg` the shell's header IS rendered, and two bells on one
              screen is worse than none.

              `size-7` to match the filter chip beside it rather than the
              36px it takes in the header. Last in the row, after the count,
              because it is the one control here that is not about the
              list. */}
          <NotificationsMenu className="hidden size-7 shrink-0 lg:inline-flex" />
        </div>
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          // Say WHY it is empty and offer the way out. A blank list under an
          // active filter reads as "there is nothing", which is the wrong
          // conclusion and the reason people stop trusting filters.
          <StatePanel
            icon={Inbox}
            title={t('noConversations')}
            description={
              activeOption
                ? t('emptyWithFilter', {
                    scope:
                      scope === 'entrada' ? t('scopeInbox') : t('scopeWaiting'),
                    filter: activeOption.label,
                  })
                : t('emptyScope')
            }
            actions={
              activeOption ? (
                <Button variant="outline" size="sm" onClick={clearFilter}>
                  <X />
                  {t('clearFilter')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                surface={surface}
                agentNames={agentNames}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  /** Surface the stage chip lands on, so its ink can be made legible on it. */
  surface: typeof LIGHT_SURFACE;
  /** auth user id -> display name, for the owner slot. */
  agentNames: Map<string, string>;
  t: ReturnType<typeof useTranslations>;
}

/**
 * One conversation, as four lines:
 *
 *   Ricardo Menezes                              14:32
 *   Cond. Solar das Palmeiras
 *   ⚡ Consegue melhorar o preço?                    (2)
 *   [Cliente] [Em Negociação] ⚠           Thales
 *
 * The last line is the one that earns its keep. Contact type and stage are
 * exactly what someone scans for, so they get the filled treatment the rest of
 * the interface denies them — and the stage's colour is the same one its Kanban
 * column carries, resolved through `stageChip` so any hue stays readable.
 *
 * The owner sits at the far right and never truncates: it was the first thing
 * to fall off the edge in the earlier layout, and "who has this" is not
 * optional information in a shared mailbox. When nobody has it, that slot turns
 * amber — the queue is the one place this list is allowed to shout.
 */
function ConversationItem({
  conversation,
  isActive,
  onSelect,
  surface,
  agentNames,
  t,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t('unknown');
  const initials = avatarInitials(displayName);

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: dateLocale,
      })
    : '';

  const stage = conversation.deal?.stage;
  const chip = stage ? stageChip(stage.color, surface) : null;
  // ONE tag, and it is the contact's TYPE — never the product or automatic
  // ones. The row is four lines in a 320px column; a contact carrying
  // "Cliente, Saco de lixo, Possui Ocorrência" would spend the whole last
  // line on chips and still truncate. The prototype makes the same choice
  // for the same reason, from a `tipo` field this app does not have.
  const typeTag = typeTagOf(conversation);
  const typeChip = typeTag ? stageChip(typeTag.color, surface) : null;
  const occurrence = hasOccurrence(conversation);
  const ownerName = conversation.assigned_agent_id
    ? (agentNames.get(conversation.assigned_agent_id) ?? '')
    : '';
  const automated =
    !conversation.ai_autoreply_disabled &&
    (conversation.ai_reply_count ?? 0) > 0;

  return (
    <button
      onClick={handleClick}
      className={cn(
        'border-border hover:bg-card-2 relative flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors duration-(--dur-1)',
        isActive &&
          'bg-muted before:bg-primary before:absolute before:inset-y-0 before:left-0 before:w-[3px]'
      )}
    >
      {/* Coloured from the name, not `bg-muted` — which on a SELECTED row
          was the row's own fill, so the disc vanished at 1.00:1. See
          `@/lib/avatar-color`. */}
      <div
        className={cn(
          'text-avatar-ink flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold',
          avatarClass(displayName)
        )}
      >
        {contact?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={contact.avatar_url}
            alt=""
            className="size-9 object-cover"
          />
        ) : (
          initials
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold">
            {displayName}
          </span>
          <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
            {timeAgo}
          </span>
        </div>

        {contact?.company ? (
          <div className="text-muted-foreground text-2xs truncate">
            {contact.company}
          </div>
        ) : null}

        <div className="mt-0.5 flex items-center gap-1.5">
          {/* Grey lightning, never a colour: the machine reports, it does not
              ask for anything. */}
          {automated && (
            <Zap
              className="text-muted-foreground size-3 shrink-0"
              aria-label={t('automatedThread')}
            />
          )}
          <p className="text-secondary-foreground min-w-0 flex-1 truncate text-xs">
            {conversation.last_message_text || t('noMessagesYet')}
          </p>
          {conversation.unread_count > 0 && (
            <span className="bg-human-strong text-2xs grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-full px-1.5 font-bold text-white">
              {conversation.unread_count}
            </span>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {typeChip && typeTag ? (
              <TagChip
                size="sm"
                filled={{ background: typeChip.background, ink: typeChip.ink }}
              >
                {typeTag.name}
              </TagChip>
            ) : null}
            {chip && stage ? (
              <TagChip
                size="sm"
                filled={{ background: chip.background, ink: chip.ink }}
              >
                {stage.name}
              </TagChip>
            ) : null}
            {occurrence ? (
              // An icon square, not a chip with words. The row has no width
              // to spend on "Possui Ocorrência" and this is the one thing on
              // it that has to be noticed before the message is read: this
              // customer has had a problem, so read the history before you
              // promise anything. 16px and 10px are the prototype's.
              <span
                title={t('hasOccurrence')}
                aria-label={t('hasOccurrence')}
                className="bg-danger-soft text-danger-ink grid size-4 shrink-0 place-items-center rounded-sm"
              >
                <AlertTriangle className="size-2.5" aria-hidden />
              </span>
            ) : null}
          </span>
          {conversation.assigned_agent_id ? (
            // The NAME, not the word "assigned". Every row in Entrada is
            // assigned by construction, so the word was a constant printed
            // once per row; who has it is the thing you actually scan for.
            <span className="text-muted-foreground text-2xs shrink-0">
              {ownerName || t('assigned')}
            </span>
          ) : (
            // One amber per row. Unread and unowned is not the rare
            // coincidence it looks like — it is what a new message from a
            // stranger IS, so nearly every row in a busy list was lighting
            // two ambers plus the stage colour, and twenty of those is a
            // column of amber that points at nothing. When the count is
            // already shouting, this drops to grey: the words still say
            // "unassigned", and the row is being pointed at either way.
            // Filled amber is kept for the read-but-unowned thread, which
            // is the one nobody is otherwise going to look at again.
            <TagChip
              size="sm"
              className={cn(
                'shrink-0 font-semibold',
                conversation.unread_count > 0
                  ? 'bg-muted text-secondary-foreground'
                  : 'bg-human-soft text-human-ink'
              )}
            >
              {t('unassigned')}
            </TagChip>
          )}
        </div>
      </div>
    </button>
  );
}
