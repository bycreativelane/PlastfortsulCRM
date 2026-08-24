'use client';

import {
  Suspense,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Pipeline, PipelineStage, Deal } from '@/types';
import { PipelineBoard } from '@/components/pipelines/pipeline-board';
import { PipelineSettings } from '@/components/pipelines/pipeline-settings';
import { DealForm } from '@/components/pipelines/deal-form';
import {
  DealOutcomeDialogs,
  useDealOutcome,
} from '@/components/pipelines/deal-outcome';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { StatePanel } from '@/components/ui/state-panel';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  GitBranch,
  Plus,
  ChevronDown,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { GatedButton } from '@/components/ui/gated-button';
import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/lib/currency';
import { SegBar } from '@/components/ui/seg-bar';
import { StatusDot } from '@/components/ui/status-badge';

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// `useSearchParams` (the `?p=<id>` deep link below) needs a Suspense
// boundary or the production build bails out to client rendering. Same
// thin wrapper the inbox uses for `?c=`.
export default function PipelinesPage() {
  return (
    <Suspense fallback={null}>
      <PipelinesPageInner />
    </Suspense>
  );
}

function PipelinesPageInner() {
  const t = useTranslations('Pipelines.page');

  // Spec-defined seed: colour and order from the product spec, the names
  // from the catalogue.
  //
  // These are UI copy that LANDS AS DATA. Five `pipeline_stages` rows are
  // written the moment a pipeline is created, so an English literal here
  // does not render in English — it WRITES English column headers onto a
  // Portuguese board and leaves them there, which is why "Qualified" and
  // "New Lead" survived a locale sweep that touched every visible string.
  // Renaming stages that already exist is a data decision, and not this
  // file's business.
  const specDefaultStages = useMemo(
    () => [
      { name: t('defaultStages.newLead'), color: '#3b82f6', position: 0 }, // blue
      { name: t('defaultStages.qualified'), color: '#eab308', position: 1 }, // yellow
      { name: t('defaultStages.proposalSent'), color: '#f97316', position: 2 }, // orange
      { name: t('defaultStages.negotiation'), color: '#8b5cf6', position: 3 }, // purple
      { name: t('defaultStages.won'), color: '#22c55e', position: 4 }, // green
    ],
    [t]
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const canEditSettings = useCan('edit-settings');
  const canCreateDeals = useCan('send-messages');
  const { accountId, defaultCurrency } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  /**
   * Which board you are on, mirrored in `?p=<id>`.
   *
   * Read once, on mount. The page writes this parameter itself every time
   * you switch funnels, and re-reading it would restart the loader on our
   * own write. What the URL buys: opening a card's conversation and coming
   * back lands on the funnel you left instead of the first one, and "the
   * Pós-venda funnel" is a link you can send someone.
   *
   * Lazy state and not `useRef(...).current`: the React Compiler rules
   * in this config treat reading `.current` during render as an error,
   * and they are right to — a ref read during render is invisible to
   * the compiler's memoisation. A lazy initialiser has exactly the
   * read-once semantics this needs and is clean under the rule.
   */
  const [initialPipelineId] = useState(() => searchParams.get('p'));
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  // Filter the board by who owns each deal. Kept out of the URL on purpose:
  // it is a lens you put on for thirty seconds while scanning, not a place
  // you navigate to or share.
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  // Below `sm` the owner chips and the legend move into a sheet: the toolbar
  // wrapped to four rows on a 360px screen and ate a third of the board.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>('');

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .order('created_at');
    if (error) {
      console.error('Failed to load pipelines:', error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('position');
      return data ?? [];
    },
    [supabase]
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from('deals')
        .select(
          '*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)'
        )
        .eq('pipeline_id', pipelineId)
        .order('created_at', { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase]
  );

  const seedDefaultPipeline =
    useCallback(async (): Promise<Pipeline | null> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return null;
      // pipelines.account_id is NOT NULL post-017 with no DB default.
      if (!accountId) return null;

      const { data: pipeline, error } = await supabase
        .from('pipelines')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: t('defaultPipelineName'),
        })
        .select()
        .single();

      if (error || !pipeline) {
        console.error('Failed to seed pipeline:', error?.message);
        return null;
      }

      const stagesPayload = specDefaultStages.map((s) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        color: s.color,
        position: s.position,
      }));
      await supabase.from('pipeline_stages').insert(stagesPayload);

      return pipeline as Pipeline;
    }, [supabase, accountId, t, specDefaultStages]);

  // `replace` and not `push`: swapping funnels is a change of view, not a
  // step you back out of, and a board someone switches thirty times an hour
  // would otherwise bury every other page in the history stack.
  const selectPipeline = useCallback(
    (id: string) => {
      setSelectedPipelineId(id);
      router.replace(`/pipelines?p=${id}`, { scroll: false });
    },
    [router]
  );

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) => {
          if (prev && list.some((p) => p.id === prev)) return prev;
          // A `?p=` that names a funnel this account cannot see falls back to
          // the first one rather than showing an empty board.
          if (
            initialPipelineId &&
            list.some((p) => p.id === initialPipelineId)
          ) {
            return initialPipelineId;
          }
          return list[0].id;
        });
      } else {
        setSelectedPipelineId('');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline, initialPipelineId]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId('');
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const outcome = useDealOutcome({
    defaultCurrency,
    // Cancelling leaves the card where the drag put it, so a refetch is the
    // only thing that tells the truth in either direction.
    onDone: refreshDeals,
  });

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      const moved = deals.find((d) => d.id === dealId);
      const target = stages.find((s) => s.id === newStageId) ?? null;

      // Dropping a card into Atendido or Perdido is the same decision as
      // pressing the button in the sheet, so it meets the same gate. The
      // board has already animated the card into its new column — the
      // dialog either commits that or `refreshDeals` puts it back.
      if (moved && target && outcome.request(moved, target)) {
        setDeals((prev) =>
          prev.map((d) =>
            d.id === dealId ? { ...d, stage_id: newStageId } : d
          )
        );
        return;
      }

      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d))
      );
      const { error } = await supabase
        .from('deals')
        .update({ stage_id: newStageId })
        .eq('id', dealId);
      if (error) {
        toast.error(t('toastFailedMoveDeal'));
        refreshDeals();
      }
    },
    [supabase, refreshDeals, t, deals, stages, outcome]
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? '');
      setDealFormOpen(true);
    },
    [stages]
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t('toastNotLinkedToAccount'));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from('pipelines')
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t('toastFailedCreatePipeline'));
      setCreating(false);
      return;
    }

    const stagesPayload = specDefaultStages.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from('pipeline_stages').insert(stagesPayload);

    setNewPipelineName('');
    setNewPipelineOpen(false);
    selectPipeline(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t('toastPipelineCreated'));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  /**
   * Owners with a deal on this board, plus an explicit "nobody".
   *
   * Derived from the deals actually loaded, so the chips never offer a person
   * who has nothing here. "Sem responsável" is only offered when there IS an
   * unowned deal — a filter that always returns zero is a filter that teaches
   * you to stop trying them.
   */
  const owners = useMemo(() => {
    const byId = new Map<string, string>();
    let hasUnowned = false;
    for (const deal of deals) {
      if (deal.assigned_to && deal.assignee?.full_name) {
        byId.set(deal.assigned_to, deal.assignee.full_name);
      } else {
        hasUnowned = true;
      }
    }
    return {
      list: Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      hasUnowned,
    };
  }, [deals]);

  // Worth showing at all? One owner and nothing unassigned means every
  // chip in the row would select the same set of cards — a filter that
  // cannot filter is a control that costs a row of the toolbar and
  // teaches nothing.
  const hasOwnerFilters = owners.list.length > 1 || owners.hasUnowned;

  const visibleDeals = useMemo(() => {
    if (ownerFilter === null) return deals;
    if (ownerFilter === '') return deals.filter((d) => !d.assigned_to);
    return deals.filter((d) => d.assigned_to === ownerFilter);
  }, [deals, ownerFilter]);

  /**
   * Money still in play on this board.
   *
   * Open deals only. A board total that folded in won and lost would answer
   * "how much has ever been here", which is a reporting question — this line
   * answers "how much am I working on", which is why it sits next to the
   * columns instead of in Reports.
   */
  const openTotal = useMemo(
    () =>
      visibleDeals
        .filter((d) => d.status === 'open')
        .reduce((sum, d) => sum + (d.value ?? 0), 0),
    [visibleDeals]
  );

  const pipelineSegments = useMemo(
    () =>
      pipelines.map((pipe) => ({
        value: pipe.id,
        label: pipe.name,
        count: pipe.id === selectedPipelineId ? visibleDeals.length : undefined,
      })),
    [pipelines, selectedPipelineId, visibleDeals.length]
  );

  if (loading) {
    return (
      // The board is an app-shaped route, so the shell gives it no
      // gutters — the skeleton has to bring its own, or it starts hard
      // against the sidebar and then jumps inward when the real board
      // arrives. For the same reason it now matches the real toolbar's `py-3`
      // and the real column's elastic 260–320 width: at `py-5` and a fixed
      // 288px the whole board stepped down 8px and re-flowed sideways the
      // moment the data landed.
      <div className="space-y-6 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div className="bg-muted h-8 w-48 animate-pulse rounded" />
          <div className="bg-muted h-9 w-28 animate-pulse rounded-lg" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex h-96 max-w-[320px] min-w-[260px] flex-1 flex-col overflow-hidden rounded-b-lg"
            >
              {/* The stage's colour rule, uncoloured — the 2px the real
                  column keeps flush to its top edge. */}
              <div className="bg-muted h-0.5 shrink-0" />
              <div className="bg-muted/50 flex-1 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    // A flex column, not a stack with margins: the board has to be able to
    // take the remaining height and scroll horizontally inside it. In normal
    // flow the columns grew to fit their cards and the page scrolled
    // vertically, which is the one direction a Kanban must not scroll.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {pipelines.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6 lg:px-8">
          {/* Two or three pipelines are a segmented switch — visible at a
              glance and one click to swap. Past that it has to collapse to a
              dropdown, because a segmented control with eight segments is a
              row of unreadable slivers. */}
          {pipelines.length <= 3 ? (
            <SegBar
              className="w-full sm:w-auto sm:min-w-[18rem]"
              label={t('selectPipeline')}
              segments={pipelineSegments}
              value={selectedPipelineId}
              onValueChange={selectPipeline}
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger className="border-border bg-card text-foreground hover:bg-muted inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors">
                <GitBranch className="text-muted-foreground size-4" />
                {selectedPipeline?.name ?? t('selectPipeline')}
                <ChevronDown className="text-muted-foreground size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {pipelines.map((pipe) => (
                  <DropdownMenuItem
                    key={pipe.id}
                    onClick={() => selectPipeline(pipe.id)}
                    className={
                      pipe.id === selectedPipelineId
                        ? 'text-foreground font-semibold'
                        : 'text-popover-foreground'
                    }
                  >
                    <GitBranch className="mr-2 size-3.5" />
                    {pipe.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Owner chips. Neutral by default and near-black when picked —
              "which one am I on" is a state, not an alert, so it gets no
              colour. Hidden below `sm`, where they live in the filter sheet
              instead: a row of five names is the line that used to push this
              toolbar to four rows on a phone. */}
          {hasOwnerFilters && (
            <OwnerChips
              className="hidden sm:flex"
              owners={owners}
              ownerFilter={ownerFilter}
              onSelect={setOwnerFilter}
              labelAll={t('ownerAll')}
              labelNone={t('ownerNone')}
            />
          )}

          {/* The phone's copy of the same chips, behind one button. Five
              names in a row plus the legend is what wrapped this toolbar to
              four rows at 360px, and a board that spends a third of its
              height on its own toolbar has stopped being a board. */}
          {hasOwnerFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFiltersOpen(true)}
              className="border-border bg-card h-8 sm:hidden"
            >
              <SlidersHorizontal className="size-3.5" />
              {t('filters')}
              {ownerFilter !== null && (
                <span className="bg-foreground text-background text-2xs grid h-4.5 min-w-4.5 place-items-center rounded-full px-1 font-bold">
                  1
                </span>
              )}
            </Button>
          )}

          {/* The board's own actions live at the end of its own toolbar,
              not in the app's top bar — same rule as every other page,
              which now keeps its buttons in its title row. The board has
              no title row to put them in (a Kanban spends every pixel of
              height on cards), so this row is the title row. */}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground hidden items-center gap-1.5 text-xs lg:flex">
              <StatusDot variant="auto" />
              {t('automatedStageLegend')}
            </span>
            {/* The label goes and the number stays below `sm`. "Em aberto:"
                is four times the width of the figure it introduces, and on a
                phone this line shares its row with the filter button and
                three actions. */}
            <span
              className="text-muted-foreground text-xs"
              title={t('openTotal')}
            >
              <span className="hidden sm:inline">{t('openTotal')} </span>
              <b className="text-foreground text-sm tabular-nums">
                {formatCurrency(openTotal, defaultCurrency)}
              </b>
            </span>
            <span aria-hidden className="bg-border hidden h-5 w-px sm:block" />
            <div className="flex items-center gap-2">
              {selectedPipeline && (
                <GatedButton
                  variant="outline"
                  size="sm"
                  canAct={canEditSettings}
                  gateReason="manage pipelines"
                  onClick={() => setSettingsOpen(true)}
                  title={t('managePipelines')}
                  aria-label={t('managePipelines')}
                  className="border-border bg-card h-8"
                >
                  <Settings className="size-3.5" />
                  <span className="hidden xl:inline">
                    {t('managePipelines')}
                  </span>
                </GatedButton>
              )}
              {/* Icons only below `sm`. The label is the widest part of each
                  of these and the phone has no room for three of them; the
                  per-column "+" is the route people actually use there. */}
              <GatedButton
                variant="outline"
                size="sm"
                canAct={canEditSettings}
                gateReason="create pipelines"
                onClick={() => setNewPipelineOpen(true)}
                title={t('addPipeline')}
                aria-label={t('addPipeline')}
                className="border-border bg-card h-8"
              >
                <Plus className="size-3.5" />
                <span className="hidden sm:inline">{t('addPipeline')}</span>
              </GatedButton>
              <GatedButton
                size="sm"
                canAct={canCreateDeals}
                gateReason="create deals"
                disabled={!selectedPipelineId || stages.length === 0}
                onClick={() => handleAddDeal()}
                title={t('addDeal')}
                aria-label={t('addDeal')}
                className="h-8"
              >
                <Plus className="size-3.5" />
                <span className="hidden sm:inline">{t('addDeal')}</span>
              </GatedButton>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-6 sm:pb-6 lg:px-8">
        {/* Board */}
        {pipelines.length === 0 ? (
          <StatePanel
            icon={GitBranch}
            title={t('noPipelinesYet')}
            description={t('createToStartTracking')}
            size="md"
            framed
            actions={
              <GatedButton
                canAct={canEditSettings}
                gateReason="create pipelines"
                onClick={() => setNewPipelineOpen(true)}
              >
                <Plus className="size-4" />
                {t('createPipeline')}
              </GatedButton>
            }
          />
        ) : (
          <PipelineBoard
            stages={stages}
            deals={visibleDeals}
            onDealMoved={handleDealMoved}
            onRequestOutcome={(deal, status) =>
              outcome.request(
                deal,
                stages.find((s) => s.id === deal.stage_id) ?? null,
                status
              )
            }
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
            onDealChanged={refreshDeals}
          />
        )}
      </div>

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('newPipeline')}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <FieldLabel>{t('pipelineName')}</FieldLabel>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t('pipelineNamePlaceholder')}
              className="bg-muted border-border text-foreground mt-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreatePipeline();
              }}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {t('defaultStagesDesc')}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
            >
              {creating ? t('creating') : t('createPipelineBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Board filters — the phone's home for the owner chips and the legend.
          A bottom sheet and not a dropdown: the trigger sits at the top of a
          screen held one-handed, and the answer should arrive under the
          thumb, not next to the button. */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t('filtersTitle')}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <div className="space-y-2">
              <p className="text-muted-foreground eyebrow">{t('ownerLabel')}</p>
              <OwnerChips
                owners={owners}
                ownerFilter={ownerFilter}
                // Picking closes the sheet. The filter is a thirty-second
                // lens; making you dismiss the thing you just used doubles
                // the cost of every glance.
                onSelect={(next) => {
                  setOwnerFilter(next);
                  setFiltersOpen(false);
                }}
                labelAll={t('ownerAll')}
                labelNone={t('ownerNone')}
              />
            </div>
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <StatusDot variant="auto" />
              {t('automatedStageLegend')}
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <DealOutcomeDialogs {...outcome.dialogProps} />

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}

/**
 * The row of owner chips.
 *
 * Extracted from the toolbar because it has two homes: inline from `sm`
 * up, and inside the filter sheet below it — five names in a row is the
 * line that pushed the board's toolbar to four rows on a phone. One
 * definition, two containers, so the two can never drift apart.
 *
 * Only the first name is shown. The chips sit in a row that competes
 * for width with the pipeline picker and the board's own actions, and
 * "Maria" identifies a colleague to the people who work with her
 * exactly as well as "Maria Aparecida da Silva" does.
 */
function OwnerChips({
  className,
  owners,
  ownerFilter,
  onSelect,
  labelAll,
  labelNone,
}: {
  className?: string;
  owners: { list: { id: string; name: string }[]; hasUnowned: boolean };
  ownerFilter: string | null;
  onSelect: (next: string | null) => void;
  labelAll: string;
  labelNone: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      <OwnerChip active={ownerFilter === null} onClick={() => onSelect(null)}>
        {labelAll}
      </OwnerChip>
      {owners.list.map((owner) => (
        <OwnerChip
          key={owner.id}
          active={ownerFilter === owner.id}
          onClick={() => onSelect(owner.id)}
        >
          {owner.name.split(/\s+/)[0]}
        </OwnerChip>
      ))}
      {owners.hasUnowned ? (
        <OwnerChip active={ownerFilter === ''} onClick={() => onSelect('')}>
          {labelNone}
        </OwnerChip>
      ) : null}
    </div>
  );
}

/**
 * A filter chip.
 *
 * Near-black when selected rather than tinted with the accent: "where I am"
 * is a state, and this design reserves colour for things asking to be acted
 * on. A row of blue chips would compete with the amber the board uses for
 * genuine attention.
 */
function OwnerChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // A real `Button` and not a styled `<button>`: below `sm` these live in a
  // sheet and are the only things there anyone taps, and only `Button` carries
  // the coarse-pointer 44px hit shield, the focus ring and the press.
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background dark:bg-foreground rounded-full px-2.5 font-semibold'
          : 'bg-card dark:bg-card rounded-full px-2.5 font-semibold'
      }
    >
      {children}
    </Button>
  );
}
