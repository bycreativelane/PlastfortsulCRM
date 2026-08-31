'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/lib/supabase/client';
import type { Pipeline, PipelineStage } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { COLOR_PRESETS } from '@/components/ui/color-picker';
import { ColorSwatch } from '@/components/ui/color-swatch';
import { Trash2, Plus, GripVertical, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

/**
 * Colours a stage may be painted.
 *
 * Amber, orange, green and rose used to be on this list and are not any more.
 * A stage colour is orientation — which column am I looking at — but it does
 * not stay on the board: it becomes a chip in the conversation list, sitting
 * in the same row as the amber that means "a person has to act", the green
 * that means "confirmed" and the red that means "lost". A stage called
 * "Qualified" painted amber is indistinguishable from a demand, and once two
 * amber things on a row mean two different things, neither means anything.
 *
 * Existing stages keep whatever colour they were given; this list only
 * governs what can be picked from here.
 */
const STAGE_COLORS = COLOR_PRESETS;

interface PipelineSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline;
  stages: PipelineStage[];
  onPipelinesChanged: () => void;
  onStagesChanged: () => void;
  onCreateNewPipeline: () => void;
}

export function PipelineSettings({
  open,
  onOpenChange,
  pipeline,
  stages,
  onPipelinesChanged,
  onStagesChanged,
  onCreateNewPipeline,
}: PipelineSettingsProps) {
  const t = useTranslations('Pipelines.settings');
  const supabase = createClient();

  const [name, setName] = useState(pipeline.name);
  const [localStages, setLocalStages] = useState<PipelineStage[]>(stages);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset form state when the dialog opens or its prop inputs change
  // — legitimate prop-driven sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setName(pipeline.name);
    setLocalStages([...stages].sort((a, b) => a.position - b.position));
    setShowDeleteConfirm(false);
  }, [open, pipeline, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLocalStages(arrayMove(localStages, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);

    // One upsert for all stages — batches N stage writes into a single
    // round-trip. Previous implementation did N sequential UPDATEs which
    // latency-scaled linearly with stage count.
    const stageRows = localStages.map((s, i) => ({
      id: s.id,
      pipeline_id: s.pipeline_id,
      name: s.name,
      color: s.color,
      position: i,
    }));

    const [renameRes, stagesRes] = await Promise.all([
      supabase
        .from('pipelines')
        .update({ name: name.trim() })
        .eq('id', pipeline.id),
      supabase.from('pipeline_stages').upsert(stageRows, { onConflict: 'id' }),
    ]);

    setSaving(false);

    if (renameRes.error || stagesRes.error) {
      toast.error(t('toastFailedSave'));
      return;
    }

    onOpenChange(false);
    onPipelinesChanged();
    onStagesChanged();
    toast.success(t('toastSaved'));
  }

  async function handleAddStage() {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from('pipeline_stages')
      .insert({
        pipeline_id: pipeline.id,
        name: trimmed,
        color: newStageColor,
        position: localStages.length,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t('toastFailedAddStage'));
      return;
    }
    setLocalStages([...localStages, data as PipelineStage]);
    setNewStageName('');
    setNewStageColor(
      STAGE_COLORS[(localStages.length + 1) % STAGE_COLORS.length]
    );
  }

  async function handleRemoveStage(stageId: string) {
    // Refuse to delete if deals still reference the stage (FK would fail).
    const { count } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('stage_id', stageId);
    if (count && count > 0) {
      toast.error(t('toastMoveOrDeleteDeals'));
      return;
    }
    const { error } = await supabase
      .from('pipeline_stages')
      .delete()
      .eq('id', stageId);
    if (error) {
      toast.error(t('toastFailedDeleteStage'));
      return;
    }
    setLocalStages(localStages.filter((s) => s.id !== stageId));
  }

  async function handleDeletePipeline() {
    setDeleting(true);
    // ON DELETE CASCADE handles deals + stages.
    const { error } = await supabase
      .from('pipelines')
      .delete()
      .eq('id', pipeline.id);
    setDeleting(false);
    if (error) {
      toast.error(t('toastFailedDeletePipeline'));
      return;
    }
    onOpenChange(false);
    onPipelinesChanged();
    toast.success(t('toastDeleted'));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-h-vh-85 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('managePipeline')}
          </DialogTitle>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="py-4">
            <div className="bg-danger-soft text-danger-ink flex items-center gap-3 rounded-lg p-4">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">{t('deletePipeline')}</p>
                {/* Same ink as the title, not a muted grey: `--danger-ink` is
                    the one tone audited to 4.5:1 against `--danger-soft` in
                    both modes. */}
                <p className="mt-1 text-xs">{t('deletePipelineDesc')}</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="border-border text-muted-foreground hover:bg-muted bg-transparent"
              >
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeletePipeline}
                disabled={deleting}
              >
                {deleting ? t('deleting') : t('deletePipelineBtn')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <FieldLabel>{t('pipelineName')}</FieldLabel>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <FieldLabel>{t('stages')}</FieldLabel>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorder}
                >
                  <SortableContext
                    items={localStages.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {localStages.map((stage, index) => (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          onNameChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], name: v };
                            setLocalStages(updated);
                          }}
                          onColorChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], color: v };
                            setLocalStages(updated);
                          }}
                          onRemove={() => handleRemoveStage(stage.id)}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Add new stage.
                    The colour sits BESIDE the name now, the same way every
                    row above it does. It used to be a loose strip of six
                    swatches floating over the input with no visible tie to
                    it — and now that the choice is any colour rather than
                    one of six, a strip is not a shape it can take. */}
                <div className="flex items-center gap-2">
                  <ColorSwatch
                    value={newStageColor}
                    onChange={setNewStageColor}
                    previewLabel={newStageName}
                    label={t('changeColor')}
                  />
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder={t('newStageNamePlaceholder')}
                    className="border-border bg-muted text-foreground text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddStage();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddStage}
                    disabled={!newStageName.trim()}
                    className="border-border text-muted-foreground hover:bg-muted shrink-0 bg-transparent"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t('add')}
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={onCreateNewPipeline}
                className="border-border text-muted-foreground hover:bg-muted w-full bg-transparent"
              >
                <Plus className="mr-1 h-3 w-3" />
                {t('createNewPipeline')}
              </Button>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              {/* Quiet, not solid red. A filled destructive button sitting in
                  the same row as "Salvar alterações" gives the two equal
                  weight, and the one you reach for a hundred times a week is
                  not the one that archives every deal in the pipeline. The
                  confirmation step behind it is where the red belongs. */}
              <Button
                variant="ghost"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive mr-auto"
              >
                {t('deletePipeline')}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted bg-transparent"
              >
                {t('cancel')}
              </Button>
              <Button onClick={handleSave} disabled={saving || !name.trim()}>
                {saving ? t('saving') : t('saveChanges')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortableStageRow({
  stage,
  onNameChange,
  onColorChange,
  onRemove,
  t,
}: {
  stage: PipelineStage;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onRemove: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border-border bg-muted flex items-center gap-2 rounded-lg border p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md active:cursor-grabbing"
        aria-label={t('dragToReorder')}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <ColorSwatch
        value={stage.color}
        onChange={onColorChange}
        previewLabel={stage.name}
        label={t('changeColor')}
      />
      <Input
        value={stage.name}
        onChange={(e) => onNameChange(e.target.value)}
        className="text-foreground focus:border-border h-7 flex-1 border-transparent bg-transparent text-sm"
      />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
