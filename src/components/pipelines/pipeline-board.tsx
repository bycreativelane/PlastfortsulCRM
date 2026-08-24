'use client';

import {
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Deal, PipelineStage } from '@/types';
import { DealCard } from './deal-card';
import { DealContextMenu } from './deal-context-menu';
import { Button } from '@/components/ui/button';
import { StatePanel } from '@/components/ui/state-panel';
import { GripVertical, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { useTranslations } from 'next-intl';
import {
  usePlaybookProgress,
  type PlaybookProgress,
} from '@/hooks/use-playbook-progress';

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  /** Reload after a write the card's right-click menu made on its own. */
  onDealChanged: () => void;
  /** Hand a won/lost decision to the page's gates. See `deal-outcome`. */
  onRequestOutcome?: (deal: Deal, status: 'won' | 'lost') => boolean;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onAddDeal,
  onEditDeal,
  onDealChanged,
  onRequestOutcome,
}: PipelineBoardProps) {
  const { defaultCurrency } = useAuth();
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages]
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    //
    // No TouchSensor on purpose. A delay-activated touch drag (the usual
    // recipe) would fire while the finger is still down, which is exactly
    // when Base UI's long press is counting towards opening the card's
    // context menu — the touch route to "Mover para". The two cannot share
    // a press. So on touch the card itself stays pannable and the drag
    // starts from the grip in `DraggableDealCard`, which is the only
    // surface that opts out of scrolling.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor)
  );

  // Two queries for the whole board, not one per card. Refetches whenever
  // the deal list changes identity, which covers a stage move, a status
  // change and a tick made from the deal sheet.
  const { progress, refresh: refreshPlaybooks } = usePlaybookProgress(
    sortedStages,
    deals
  );

  const activeDeal = activeDealId
    ? (deals.find((d) => d.id === activeDealId) ?? null)
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    // The board takes the height its parent gives it and scrolls sideways
    // inside that. A Kanban that grows vertically past the fold has stopped
    // being a board — you can no longer compare two columns without
    // scrolling, which is the only thing the layout is for.
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* snap-x + snap-mandatory on mobile so swipes land the next
          stage cleanly at the viewport edge instead of mid-column.
          Disabled on lg+ where snapping would interfere with the
          natural layout. The board can still overflow horizontally on
          lg+ once a pipeline has many stages (columns keep a 260px
          min-width), so a thin scrollbar stays visible on desktop. */}
      <div className="pipeline-scroll flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-3 overflow-x-auto pb-1 lg:snap-none">
        {sortedStages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const totalValue = stageDeals.reduce(
            (s, d) => s + Number(d.value || 0),
            0
          );
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              stages={sortedStages}
              deals={stageDeals}
              totalValue={totalValue}
              currency={defaultCurrency}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
              onDealMoved={onDealMoved}
              onRequestOutcome={onRequestOutcome}
              onDealChanged={() => {
                onDealChanged();
                refreshPlaybooks();
              }}
              progress={progress}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          // --dur-2 / --ease-out, written out because dnd-kit takes numbers
          // and a string, not CSS variables. Something moved: 180ms.
          duration: 180,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              onEdit={() => {}}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  stages,
  deals,
  totalValue,
  currency,
  onAddDeal,
  onEditDeal,
  onDealMoved,
  onDealChanged,
  onRequestOutcome,
  progress,
}: {
  stage: PipelineStage;
  /** Every stage on the board — the right-click "move to" list. */
  stages: PipelineStage[];
  deals: Deal[];
  totalValue: number;
  currency: string;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onDealMoved: (dealId: string, newStageId: string) => void;
  onDealChanged: () => void;
  onRequestOutcome?: (deal: Deal, status: 'won' | 'lost') => boolean;
  /** Playbook counts for the whole board, keyed by deal id. */
  progress: Map<string, PlaybookProgress>;
}) {
  const t = useTranslations('Pipelines.board');
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    // A recessed lane, not a card. The column is the container the cards sit
    // IN, so it takes the muted surface and the cards take white — the
    // opposite of a bordered box holding bordered boxes, which flattens the
    // stack into one grey rectangle.
    <div className="bg-muted flex w-[85vw] max-w-[320px] min-w-[260px] shrink-0 snap-start flex-col overflow-hidden rounded-b-lg lg:w-auto lg:max-w-none lg:flex-1 lg:shrink lg:basis-[260px] lg:snap-none">
      {/* A 2px rule in the stage's colour, square-edged and flush to the top.
          Orientation, not attention: with ten stages scrolling sideways you
          need to know where you are without reading the title, and keeping it
          to a hairline is what stops it becoming a signal.
          It was 3px with rounded top corners, which turned the line into a
          little coloured cap and made each column read as a boxed card. */}
      <div
        className="h-0.5 shrink-0"
        style={{ backgroundColor: stage.color }}
      />

      {/* Stage name is the primary fact; the total is auxiliary and sized to
          say so. It read as one flat line of grey before. */}
      <div className="shrink-0 px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-foreground min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
            {stage.name}
          </h3>
          <span className="bg-card text-secondary-foreground text-3xs shrink-0 rounded-full px-1.5 font-bold">
            {deals.length}
          </span>
        </div>
        <p className="text-muted-foreground text-2xs font-medium tabular-nums">
          {formatCurrency(totalValue, currency)}
        </p>
      </div>

      <div
        ref={setNodeRef}
        className={`flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors duration-(--dur-1) ${
          isOver ? 'bg-primary-soft' : ''
        }`}
      >
        {deals.length === 0 ? (
          <StatePanel title={t('dropDealHere')} framed className="flex-1" />
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              stages={stages}
              onEdit={onEditDeal}
              onMove={onDealMoved}
              onChanged={onDealChanged}
              onRequestOutcome={onRequestOutcome}
              playbook={progress.get(deal.id)}
            />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="text-muted-foreground hover:bg-card hover:text-foreground mx-2 mb-2 h-7 shrink-0 justify-start rounded-md text-xs"
      >
        <Plus className="mr-1 size-3" />
        {t('addDeal')}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  stages,
  onEdit,
  onMove,
  onChanged,
  onRequestOutcome,
  playbook,
}: {
  deal: Deal;
  stage: PipelineStage;
  stages: PipelineStage[];
  onEdit: (deal: Deal) => void;
  onMove: (dealId: string, newStageId: string) => void;
  onChanged: () => void;
  onRequestOutcome?: (deal: Deal, status: 'won' | 'lost') => boolean;
  playbook?: PlaybookProgress;
}) {
  const t = useTranslations('Pipelines.board');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  // Same press, on the grip instead of the card. `stopPropagation` keeps the
  // wrapper's copy of the listener from running a second time for one finger.
  function startDragFromGrip(event: ReactPointerEvent) {
    event.stopPropagation();
    listeners?.onPointerDown?.(event);
  }

  // The context menu sits INSIDE the draggable rather than around it: dnd-kit
  // ignores button 2 outright, so the two never contend for the same press,
  // and keeping the drag node the outer element leaves the sensor's geometry
  // exactly as it was.
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // `touch-manipulation`, not `touch-action: none`. The cards cover the
      // whole column bar 8px of gutter, so forbidding pan on each of them
      // meant a finger landing anywhere on a column could scroll neither the
      // column nor the board — the phone got the first stage and the first
      // three cards and no way to reach the rest.
      className="relative touch-manipulation"
      style={{ opacity: isDragging ? 0.3 : 1 }}
    >
      <DealContextMenu
        deal={deal}
        stages={stages}
        onEdit={onEdit}
        onMove={onMove}
        onChanged={onChanged}
        onRequestOutcome={onRequestOutcome}
      >
        <DealCard
          deal={deal}
          stage={stage}
          onEdit={onEdit}
          playbook={playbook}
          // Room for the grip, on touch only. Without it the value and the
          // assignee initial sit underneath it.
          className="pointer-coarse:pr-10"
        />
      </DealContextMenu>

      {/* The one square inch of the card that does not scroll. Coarse
          pointers only: with a mouse the whole card is already the handle,
          and a grip that only ever gets hovered is chrome. */}
      <button
        type="button"
        aria-label={t('dragHandle')}
        title={t('dragHandle')}
        onPointerDown={startDragFromGrip}
        className="text-muted-foreground/60 hover:text-muted-foreground absolute inset-y-0 right-0 hidden w-9 cursor-grab touch-none place-items-center rounded-r-lg active:cursor-grabbing pointer-coarse:grid"
      >
        <GripVertical className="size-4" />
      </button>
    </div>
  );
}
