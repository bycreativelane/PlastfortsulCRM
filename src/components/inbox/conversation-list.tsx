'use client';

import {
  Fragment,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from '@/lib/inbox/conversations';
import { cn } from '@/lib/utils';
import { avatarClass, avatarInitials } from '@/lib/avatar-color';
import { NotificationsMenu } from '@/components/layout/notifications-menu';
import { MessageTicks } from './message-ticks';
import type { Conversation } from '@/types';
import {
  Check,
  ChevronDown,
  Contact,
  FileText,
  Filter,
  Image as ImageIcon,
  Inbox,
  MapPin,
  Mic,
  Music,
  Paperclip,
  Search,
  Sticker,
  Sparkles,
  Users,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslations } from 'next-intl';
import { useDrafts } from '@/hooks/use-drafts';
import { draftPreview } from '@/lib/inbox/drafts';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatePanel } from '@/components/ui/state-panel';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SegBar } from '@/components/ui/seg-bar';
import { Tag as TagChip } from '@/components/ui/tag';
import { CountBadge } from '@/components/ui/count-badge';
import { DARK_SURFACE, LIGHT_SURFACE, stageChip } from '@/lib/stage-color';
import { AlertTriangle } from 'lucide-react';
import { dateLocale } from '@/lib/i18n/dates';
import {
  SCOPES,
  buildFilterOptions,
  groupOptions,
  hasOccurrence,
  isVisible,
  matchesSearch,
  typeTagOf,
  withCounts,
  type Scope,
} from './conversation-filters';
import {
  conversationPreview,
  type MediaPlaceholderKind,
} from '@/lib/inbox/message-preview';
import { useTeamUnread } from '@/hooks/use-team-unread';
import { ConversationMenu } from './conversation-menu';
import { SwipeRow } from './swipe-row';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /** Apply a write's own patch to one row — see the inbox page. */
  onConversationPatch: (
    conversationId: string,
    patch: Partial<Conversation>
  ) => void;
  /** Drop a row after a real delete. */
  onConversationRemoved: (conversationId: string) => void;
  /** The team room is open, so its row is the selected one. */
  teamOpen: boolean;
  onOpenTeam: () => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

/**
 * The team room's entry point.
 *
 * A row, not a tab — see the note at the call site. Styled as a destination
 * rather than as a conversation: a filled disc instead of an initials
 * avatar, no time, no preview line, no chips. It has to read as "a different
 * kind of thing" at a glance, because clicking it replaces the whole thread
 * pane with something that has no customer in it.
 */
function TeamRoomRow({
  active,
  unread,
  mentioned,
  onOpen,
  label,
  hint,
}: {
  active: boolean;
  /** Quantas mensagens de outras pessoas ainda não foram lidas. */
  unread: number;
  /** Alguma delas chama quem está lendo (077). */
  mentioned: boolean;
  onOpen: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-(--dur-1)',
        active
          ? 'bg-primary-soft text-primary'
          : 'text-secondary-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full',
          active ? 'bg-primary text-white' : 'bg-muted text-primary'
        )}
      >
        <Users className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground text-2xs block truncate">
          {hint}
        </span>
      </span>
      {/*
        UM NÚMERO, E O MESMO DO TRILHO.

        Isto era um ponto, com uma nota defendendo que o número de linhas não
        lidas "não é um número sobre o qual alguém age diferente". O card do
        trilho já tinha revertido essa decisão com o uso — um recado e onze
        recados são situações diferentes — e as duas superfícies ficaram
        discordando: 11 no trilho, um ponto aqui.

        Agora os dois leem `useTeamUnread`, e a menção a quem está lendo
        pinta de âmbar nos dois (077).
      */}
      {unread > 0 && !active && (
        <CountBadge size="dot" tone={mentioned ? 'human' : 'primary'}>
          {unread > 99 ? '99+' : unread}
        </CountBadge>
      )}
    </button>
  );
}

/** Tab → its own name, for the sentence an empty list has to say. */
const SCOPE_LABEL_KEY: Record<Scope, 'scopeInbox' | 'scopeWaiting'> = {
  entrada: 'scopeInbox',
  esperando: 'scopeWaiting',
};

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  onConversationPatch,
  onConversationRemoved,
  teamOpen,
  onOpenTeam,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations('Inbox.conversationList');
  const tTeam = useTranslations('Inbox.team');
  const { user } = useAuth();
  const { mode } = useTheme();
  /**
   * Uma assinatura para a lista inteira, e não uma por linha.
   *
   * O compositor copia o que está sendo escrito para cá a cada 400 ms, e é
   * daqui que sai o selo "Rascunho:" do item 14. Cem linhas assinando o
   * mesmo store seriam cem `addEventListener` para responder à mesma
   * pergunta.
   */
  const drafts = useDrafts();

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
  /*
   * O número da sala da equipe — do store, e não de uma conta desta lista.
   *
   * Esta lista buscava a mensagem mais nova e comparava com o marcador do
   * navegador, com a sua própria assinatura de realtime. Discordava do card
   * do trilho sempre que um dos dois ouvia um evento que o outro não ouviu.
   * `useTeamUnread` é a conta única (ver o topo do hook).
   */
  const equipe = useTeamUnread();

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
  // tab you forgot you were on. Then scope. Then the chosen filter, which is
  // what the menu counts.
  //
  // The segments count LAST, not at the scope stage: with a filter on,
  // clicking Entrada returns scope AND filter, so a number measured before
  // the filter is a number you cannot land on. The one exception is a filter
  // that replaces the scope — see `segmentBase`.
  //
  // Each stage is the input to the next stage's counts, which is what makes
  // every number on screen equal to the number of rows clicking it produces.
  const searched = useMemo(
    () => conversations.filter((c) => matchesSearch(c, search)),
    [conversations, search]
  );

  // Hidden conversations are out of all three tabs — pulled here, once,
  // rather than inside each scope, so a row cannot be counted in one place
  // and missing from another. The Ocultas filter is the single way back and
  // it reads `conversations` directly, below.
  const visible = useMemo(() => searched.filter(isVisible), [searched]);

  const inScope = useMemo(() => {
    // The two filters that reach outside the current tab. Asking for hidden
    // or finished conversations inside a tab that excludes them by
    // definition would always answer zero, so they replace the scope rather
    // than narrowing it.
    if (filterId === 'hidden') return searched.filter((c) => !!c.hidden_at);
    if (filterId === 'closed') {
      return searched.filter((c) => isVisible(c) && c.status === 'closed');
    }

    const rows = visible.filter(SCOPES[scope]);

    // Esperando sorts OLDEST FIRST, and it is the only tab that does.
    //
    // Everywhere else "newest first" is right because the newest message is
    // the one somebody has to answer. In a parked queue the newest item is
    // the one that needs attention LEAST — it was parked a minute ago — and
    // the thread nobody has looked at since Tuesday is the entire reason the
    // tab exists. Newest-first buries exactly the row the tab is for.
    //
    // Falls back to `last_message_at` for rows parked before migration 045,
    // which have no `waiting_since` to sort by.
    if (scope !== 'esperando') return rows;
    return [...rows].sort((a, b) => {
      const at = a.waiting_since ?? a.last_message_at ?? '';
      const bt = b.waiting_since ?? b.last_message_at ?? '';
      return at.localeCompare(bt);
    });
  }, [searched, visible, scope, filterId]);

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
          unassigned: t('filterUnassigned'),
          unread: t('filterUnread'),
          withAutomation: t('filterAutomated'),
          withOccurrence: t('filterOccurrence'),
          closed: t('filterClosed'),
          hidden: t('filterHidden'),
          typeLead: t('filterTypeLead'),
          typeCustomer: t('filterTypeCustomer'),
          typeInternal: t('filterTypeInternal'),
          typeNone: t('filterTypeNone'),
        }),
        inScope,
        // Encerradas and Ocultas are counted against everything the search
        // matched, not against the current tab — neither can ever appear
        // inside a tab that excludes them by definition. See `withCounts`.
        searched
      ),
    [conversations, pipelines, user?.id, inScope, searched, t]
  );

  const activeOption = options.find((o) => o.id === filterId) ?? null;

  const filtered = useMemo(
    () => (activeOption ? inScope.filter(activeOption.match) : inScope),
    [inScope, activeOption]
  );

  // Counted WITHIN the active filter, which is the rule `seg-bar.tsx`
  // states in its own header: "a number you can't act on by clicking is
  // worse than no number". They used to count the scope stage, so with
  // "Sem resposta há 24h" on, Entrada could read 12 and produce 3.
  //
  // The exception is the filter that REPLACES the scope: Encerradas and
  // Ocultas take the bar out of play entirely, and there the segments
  // count the scope you return to.
  const segmentBase = useMemo(
    () =>
      activeOption && !activeOption.replacesScope
        ? visible.filter(activeOption.match)
        : visible,
    [visible, activeOption]
  );

  const segments = useMemo(
    () => [
      {
        value: 'entrada' as const,
        label: t('scopeInbox'),
        count: segmentBase.filter(SCOPES.entrada).length,
      },
      {
        value: 'esperando' as const,
        label: t('scopeWaiting'),
        count: segmentBase.filter(SCOPES.esperando).length,
        // Amber: a parked thread is the one state where time passing is
        // itself the problem, and the only thing in this system allowed to
        // ask for attention.
        tone: 'human' as const,
      },
    ],
    [segmentBase, t]
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
        {/* The team's own room, above the tabs rather than inside them.
            It is not a third state — Entrada and Esperando answer "where
            does this conversation stand", and the team room is not a
            conversation with a customer at all. Putting it in that bar
            would also have squeezed a third label into 288px.
            Above the split means it is visible from both tabs, which is
            what it needs to be: a colleague's message does not stop
            mattering because you are looking at Esperando.

            (This comment described a three-segment bar with "Finalizados"
            in it for a while after that tab became a filter. A stale
            comment about layout is worse than none — it is the map
            somebody reaches for when the code stops making sense.) */}
        <TeamRoomRow
          active={teamOpen}
          unread={equipe.total}
          mentioned={equipe.mentions > 0}
          onOpen={onOpenTeam}
          label={tTeam('title')}
          hint={tTeam('rowHint')}
        />

        <SegBar
          // A barra ocupa a coluna: aqui os tres segmentos SAO a largura da
          // lista, e o `w-fit` do componente e para os toolbars que encolhem.
          className="w-full"
          label={t('scopeLabel')}
          segments={segments}
          value={scope}
          // Clicar num segmento com Encerradas ou Ocultas em vigor LARGA o
          // filtro. Antes a barra ficava acesa, clicável e inerte: o filtro
          // substitui o escopo, então trocar de escopo não mudava nada.
          //
          // Ela não é desabilitada de propósito. Apagar a barra tiraria a
          // saída mais rápida do estado em que a pessoa está presa, e é
          // justamente ali que ela mais precisa dela.
          onValueChange={(v) => {
            setScope(v);
            if (activeOption?.replacesScope) setFilterId(null);
          }}
        />

        {/* SEARCH AND FILTER SHARE A LINE ON A PHONE.

            This bar had four stacked bands — team room, Entrada/Esperando,
            search, filter+count — about 195px before the first
            conversation, on the screen this product is most used on. Two
            of them were a text field and a chip that between them never
            filled half a line.

            `lg:flex-col lg:items-stretch` puts the desk layout back
            exactly as it was: at that width the list is a 320px column
            where the two genuinely do not fit side by side. */}
        <div className="flex items-center gap-1.5 lg:flex-col lg:items-stretch lg:gap-2">
          <div className="relative min-w-0 flex-1 lg:w-full lg:flex-none">
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
              // No `[@media(pointer:coarse)]:h-11` any more: this was the
              // single Input in the app that remembered to grow itself on a
              // phone, and globals.css now gives every one of them the same
              // 44px floor.
              className="border-border bg-card-2 h-8 pl-9 text-sm"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1.5 lg:w-full">
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-colors duration-(--dur-1) [@media(pointer:coarse)]:h-11',
                  activeOption
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Filter className="size-3.5" />
                {/* Com teto: o rótulo é vocabulário livre da conta — o nome
                    de um funil ou de uma etapa — e abaixo de `lg` este
                    gatilho divide a linha com a busca. "Aguardando aprovação
                    do orçamento" empurrava a busca para fora. */}
                <span className="max-w-28 truncate">
                  {activeOption?.label ?? t('filterButton')}
                </span>
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-vh-62 w-60 overflow-y-auto"
              >
                {/* Grupo de verdade, e não dois `<div>` dentro de um
                    `role="menu"`. O padrão é o do `flow-builder.tsx`: o
                    `DropdownMenuGroup` dá `role="group"`, o
                    `DropdownMenuLabel` faz o cabeçalho anunciável e o seu
                    `px-1.5` alinha com os itens — o `px-2` de antes deixava
                    o cabeçalho meio caractere fora da coluna. */}
                {groupOptions(options).map(([group, items], i) => (
                  <Fragment key={group}>
                    {i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-muted-foreground eyebrow">
                        {group}
                      </DropdownMenuLabel>
                      {items.map((option) => (
                        <DropdownMenuItem
                          key={option.id}
                          // Zero-result options are disabled, never hidden. A
                          // menu whose entries come and go teaches you to
                          // distrust it, and "there are none right now" is
                          // itself an answer.
                          //
                          // The exception is the option that IS ON. Counts are
                          // measured before the filter, so reading the three
                          // unread threads zeroes the very row in force — and
                          // disabling it would lock away the only visible way
                          // out of it.
                          disabled={
                            option.count === 0 && option.id !== filterId
                          }
                          // Toggle: clicking the active row turns it off, the
                          // same destination as the X beside the trigger.
                          // Without it the row is clickable and does nothing.
                          onClick={() =>
                            setFilterId(
                              option.id === filterId ? null : option.id
                            )
                          }
                          // No colour pair here: `--foreground` and
                          // `--popover-foreground` are the same oklch in both
                          // modes, so the ternary that used to be here only
                          // ever delivered the weight.
                          className={cn(
                            'text-sm',
                            option.id === filterId && 'font-semibold'
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                          {/* The check the rest of the app uses for "this one".
                              The count badge stays neutral on purpose: there are
                              ~24 of them in this one list, and one meaning "where
                              you are" while the others mean "how many" reads as
                              noise rather than as a marker. */}
                          {option.id === filterId && (
                            <Check className="size-3.5" />
                          )}
                          <CountBadge
                            className={cn(
                              'ml-auto',
                              option.count === 0 &&
                                'text-muted-foreground bg-transparent'
                            )}
                          >
                            {option.count}
                          </CountBadge>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {activeOption && (
              <button
                onClick={clearFilter}
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold transition-colors duration-(--dur-1) [@media(pointer:coarse)]:h-11"
              >
                <X className="size-3" />
                {t('clearFilter')}
              </button>
            )}

            {/* `hidden lg:inline` — not information lost, information
              already given: the Entrada/Esperando bar directly above
              carries a count per tab, and on one shared line this was
              the item with the least to say. */}
            <span className="text-muted-foreground ml-auto hidden text-xs tabular-nums lg:inline">
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
                ? activeOption.replacesScope
                  ? // Encerradas e Ocultas SUBSTITUEM o escopo, então citar a
                    // aba seria culpar quem não filtrou nada: "Nada em
                    // Esperando com Encerradas" descreve uma interseção que o
                    // código nunca calculou.
                    t('emptyReplacedScope', { filter: activeOption.label })
                  : t('emptyWithFilter', {
                      scope: t(SCOPE_LABEL_KEY[scope]),
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
              <ConversationMenu
                key={conv.id}
                conversation={conv}
                onPatch={onConversationPatch}
                onRemoved={onConversationRemoved}
                // The same map the row already uses to draw the owner chip,
                // loaded once for the whole list. The menu takes it as a
                // prop rather than mounting `useMemberNames` itself, which
                // at one instance per row would be one `profiles` query per
                // conversation on screen.
                members={agentNames}
              >
                {/* INSIDE the context menu, not around it.
                    `ContextMenuTrigger` renders its child as the thing you
                    long-press; wrapping the menu instead would put the
                    swipe layer outside the trigger and the long-press
                    would stop reaching the row. Nested this way the two
                    gestures share one element and never contend — a press
                    that MOVES is a swipe, a press that does not is a
                    long-press.

                    On a desk `SwipeRow` returns its child untouched, with
                    no wrapper element and no listeners. */}
                <SwipeRow conversation={conv} onPatch={onConversationPatch}>
                  <ConversationItem
                    conversation={conv}
                    isActive={conv.id === activeConversationId}
                    onSelect={handleSelect}
                    surface={surface}
                    agentNames={agentNames}
                    // `!replacesScope` é obrigatório: com Encerradas ou
                    // Ocultas em vigor, `inScope` devolve linhas que não são
                    // a fila de espera, escopo nenhum.
                    showWaiting={
                      scope === 'esperando' && !activeOption?.replacesScope
                    }
                    draft={drafts[conv.id] ?? ''}
                    t={t}
                  />
                </SwipeRow>
              </ConversationMenu>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * The media kinds, as an icon and a word.
 *
 * A row is 320px wide and already carries a name, a time, a badge and two
 * chips — so the kind gets an icon, and the word beside it is there for the
 * one case an icon cannot carry alone (a voice note is not a music file, and
 * an operator triaging a queue treats them very differently).
 */
const MEDIA_ICON: Record<MediaPlaceholderKind, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  voice: Mic,
  document: FileText,
  sticker: Sticker,
  location: MapPin,
  contacts: Contact,
};

const MEDIA_LABEL_KEY: Record<MediaPlaceholderKind, string> = {
  image: 'mediaImage',
  video: 'mediaVideo',
  audio: 'mediaAudio',
  voice: 'mediaVoice',
  document: 'mediaDocument',
  sticker: 'mediaSticker',
  location: 'mediaLocation',
  contacts: 'mediaContacts',
};

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  /** Surface the stage chip lands on, so its ink can be made legible on it. */
  surface: typeof LIGHT_SURFACE;
  /** auth user id -> display name, for the owner slot. */
  agentNames: Map<string, string>;
  /**
   * Esperando é a única aba em que o número da direita é a idade do
   * PARQUEAMENTO, e não a da última mensagem.
   */
  showWaiting: boolean;
  /**
   * O que foi digitado nesta conversa e não foi enviado, já em uma linha.
   *
   * Vem de cima porque `useDrafts` assina um store: chamado aqui dentro,
   * cada uma das cem linhas abriria a própria assinatura para ler o mesmo
   * mapa. A lista lê uma vez e reparte.
   */
  draft: string;
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
  showWaiting,
  draft,
  t,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t('unknown');
  const initials = avatarInitials(displayName);

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  /*
   * NA FILA DE ESPERA, O NÚMERO É A ESPERA.
   *
   * Esperando ordena por `waiting_since` — a mais antiga em cima, e é a
   * única aba que ordena assim — e a linha imprimia a idade da ÚLTIMA
   * MENSAGEM. Como parquear é uma resposta, a conversa parqueada há três
   * dias com um "já te retorno" recente aparecia acima de uma com número
   * menor: a lista parecia ordenada ao contrário.
   *
   * Só a BASE do cálculo muda; o número curto é o mesmo. E cai de volta na
   * última mensagem para as linhas anteriores à 045, que não têm
   * `waiting_since` — essas ficam sem o rótulo, sem afirmar nada falso.
   */
  const waitingAt = showWaiting ? (conversation.waiting_since ?? null) : null;
  const timeBase = waitingAt ?? conversation.last_message_at;
  const timeAgo = timeBase
    ? formatDistanceToNow(new Date(timeBase), {
        addSuffix: false,
        locale: dateLocale,
      })
    : '';

  const preview = conversationPreview(
    conversation.last_message_text,
    conversation.last_message_kind,
    conversation.last_message_media_url
  );
  const MediaIcon = preview.media ? MEDIA_ICON[preview.media] : Paperclip;

  /**
   * The WhatsApp model for a row, which is a rule about DIRECTION.
   *
   *   what went out → ticks, and the name of whoever wrote it
   *   what came in  → neither
   *
   * WhatsApp itself writes "Você:" because the phone belongs to one person.
   * Here the number belongs to the whole team, so "Você" is a lie on every
   * colleague's screen — the attendant's name is the same idea told
   * truthfully. That is the point of the request: reading the list should
   * answer "did anyone reply, and who" without opening anything.
   *
   * All three fields arrive with migration 056 and are `undefined` before
   * it, which collapses this to `outbound === false` — the row then draws
   * exactly what it drew yesterday instead of an error.
   */
  const outbound =
    conversation.last_message_sender_type === 'agent' ||
    conversation.last_message_sender_type === 'bot';
  // No name for the assistant. The lightning already says a machine wrote
  // it, and "Agente IA: bom dia" reads as a colleague with an odd name.
  const senderName =
    outbound && conversation.last_message_sender_type === 'agent'
      ? (agentNames.get(conversation.last_message_sender_id ?? '') ?? '')
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
          {/* "Já teve problema", beside the name and round.
              
              It spent a version down in the chip run, as an 18px square
              between Cliente and Em Andamento. Two things were wrong with
              that. It was the only object in the row carrying no word, so
              in a line of chips it read as debris rather than as a member
              of the set — and the run is the row's SLOWEST line, scanned
              after the name and the message, which is the wrong place for
              the one fact that is supposed to change how you read the
              message above it.
              
              Up here it is attached to the person, which is what it is
              about: this customer has had a problem, so read the history
              before you promise anything. Round, because the row already
              has a round badge of exactly this size — the unread count —
              and a circle beside a name reads as a state OF that name.
              A square reads as a control. */}
          {occurrence ? (
            <span
              title={t('hasOccurrence')}
              aria-label={t('hasOccurrence')}
              className="bg-danger-soft text-danger-ink grid size-4.5 shrink-0 place-items-center rounded-full"
            >
              <AlertTriangle className="size-2.5" aria-hidden />
            </span>
          ) : null}
          <span
            className="text-muted-foreground text-2xs shrink-0 tabular-nums"
            title={
              waitingAt ? t('waitingSince', { duration: timeAgo }) : undefined
            }
            aria-label={
              waitingAt ? t('waitingSince', { duration: timeAgo }) : undefined
            }
          >
            {timeAgo}
          </span>
        </div>

        {contact?.company ? (
          <div className="text-muted-foreground text-2xs truncate">
            {contact.company}
          </div>
        ) : null}

        <div className="mt-0.5 flex items-center gap-1.5">
          {/* THE SPARKLE, not the lightning.

              This row said "a IA respondeu aqui" with the same mark the
              left nav uses for Automações and the composer used for
              Respostas rápidas — three unrelated meanings on one glyph,
              on the busiest screen in the product. The sparkle is the
              house mark for "a machine wrote this" (see the bubble's AI
              badge and the note in `settings-sections.ts`), so it is the
              one that belongs here.

              Still grey, never a colour: the machine reports, it does not
              ask for anything. */}
          {automated && (
            <Sparkles
              className="text-muted-foreground size-3 shrink-0"
              aria-label={t('automatedThread')}
            />
          )}
          {/* The message, or what KIND of message it was.

              The webhook has no text for a photo, so it stores Meta's own
              type name — `[audio]`, `[image]` — straight into
              `last_message_text`. Twenty rows of `[audio]` is a list that
              looks broken and says nothing; an icon and the word in
              Portuguese is the same information, read at a glance.

              Resolved here rather than at write time so every row already
              in the database is fixed too. Same for the `*Nome*` signature
              prefix, which belongs to the customer's copy of the message
              and not to ours. See `@/lib/inbox/message-preview`. */}
          {/* A THUMBNAIL WHEN THERE IS ONE, and the kind beside it otherwise.
              
              The row used to print Meta's own `[image]` here. Then it printed
              an icon and the word, which is readable but still describes the
              photo rather than showing it — and in a list of ten, the picture
              IS the identifier: you recognise the bag of silage before you
              read the name above it.
              
              A caption still wins the text slot. Photo plus "segue a foto do
              lote" is two facts, and before migration 047 the row could only
              carry one of them: a captioned photo stored the caption and
              looked exactly like a text message. */}
          {/*
            O RASCUNHO TOMA A LINHA INTEIRA, como no WhatsApp.

            Item 14 do pacote, com a referência transcrita: uma conversa com
            texto digitado e não enviado mostra "Rascunho: …" no lugar da
            prévia. No lugar, e não ao lado — a prévia responde "o que foi
            dito por último" e o rascunho responde "o que falta você mandar",
            e a segunda é a que muda o que a pessoa faz agora. Empilhar as
            duas numa coluna de 320px não caberia de qualquer jeito.

            Some sozinho no envio: o compositor zera o texto, e zerar não
            espera os 400 ms do resto.

            `text-human-ink` porque um rascunho é um "volte aqui" — a mesma
            família do contador de não lidas que fica no fim desta linha. O
            selo não disputa com ele: os dois dizem "você".

            A ORDEM DA LISTA NÃO MUDA. O item 14 pede isso em uma frase, e
            sai de graça: isto é uma troca de pintura dentro da linha, e
            quem ordena são as consultas lá em cima.
          */}
          {draft ? (
            <>
              <span className="text-human-ink shrink-0 text-xs font-medium">
                {t('draftPrefix')}
              </span>
              <p className="text-secondary-foreground min-w-0 flex-1 truncate text-xs">
                {draftPreview(draft)}
              </p>
            </>
          ) : (
            <>
              {preview.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  // `bg-muted` under it so a slow or dead URL is a grey
                  // square rather than a broken-image glyph in the middle
                  // of a row.
                  className="bg-muted size-7 shrink-0 rounded object-cover"
                />
              ) : preview.media ? (
                <MediaIcon
                  className="text-muted-foreground size-3 shrink-0"
                  aria-hidden
                />
              ) : null}
              {/* Ticks, then the name, then what was said — the order the
                  eye reads and the order WhatsApp uses. Both sit OUTSIDE
                  the truncating paragraph: inside it, a long message would
                  push the answer to "who replied" off the end of the line,
                  which is the one thing this row exists to show. */}
              {outbound && conversation.last_message_status ? (
                <MessageTicks status={conversation.last_message_status} />
              ) : null}
              {senderName ? (
                // Medium, not bold. It is a label on the message, and a row
                // whose loudest word is a colleague's name buries the
                // customer.
                <span className="text-muted-foreground max-w-[7rem] shrink-0 truncate text-xs font-medium">
                  {t('senderPrefix', { name: senderName })}
                </span>
              ) : null}
              <p
                className={cn(
                  'text-secondary-foreground min-w-0 flex-1 truncate text-xs',
                  // The KIND is a label, not something anybody wrote —
                  // italic keeps it from reading as the customer's own
                  // words.
                  preview.media && !preview.text && 'italic'
                )}
              >
                {preview.text ||
                  (preview.media
                    ? t(MEDIA_LABEL_KEY[preview.media])
                    : t('noMessagesYet'))}
              </p>
            </>
          )}
          {conversation.unread_count > 0 && (
            <CountBadge tone="human">{conversation.unread_count}</CountBadge>
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
