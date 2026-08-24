'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PlaybookStep } from '@/types';

/** A step being edited. `id` is absent until it has been saved once. */
type Draft = { id?: string; title: string; hint: string };

interface PlaybookEditorProps {
  stageId: string;
  stageName: string;
  steps: PlaybookStep[];
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Editing a stage's playbook, in the place you were reading it.
 *
 * This deliberately has no home of its own — no settings section, no dialog
 * off the pipeline manager. An admin opens a deal, sees the checklist that
 * deal is being asked to work through, and edits THAT. The alternative was a
 * third place to go, and the request that started this pass was for fewer
 * places, not more.
 *
 * Saving diffs rather than replacing. Deleting a step cascades to every tick
 * of it (`deal_playbook_progress` is `ON DELETE CASCADE`), so a
 * delete-all-then-insert-all save would quietly erase the completion history
 * of every deal in the stage each time someone fixed a typo.
 */
export function PlaybookEditor({
  stageId,
  stageName,
  steps,
  onDone,
  onCancel,
}: PlaybookEditorProps) {
  const t = useTranslations('Pipelines.playbook');
  const supabase = createClient();
  const { accountId } = useAuth();

  // A brand-new playbook opens with one empty row rather than an empty list
  // and an "add" button: the first thing you have to do is always the same,
  // so making you ask for it is a click that buys nothing.
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    steps.length > 0
      ? steps.map((s) => ({ id: s.id, title: s.title, hint: s.hint ?? '' }))
      : [{ title: '', hint: '' }]
  );
  const [saving, setSaving] = useState(false);

  function update(index: number, patch: Partial<Draft>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d))
    );
  }

  function move(index: number, delta: number) {
    setDrafts((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    if (!accountId || saving) return;
    const cleaned = drafts.filter((d) => d.title.trim());
    setSaving(true);

    const keptIds = new Set(cleaned.map((d) => d.id).filter(Boolean));
    const removed = steps.filter((s) => !keptIds.has(s.id));

    const errors: string[] = [];

    if (removed.length > 0) {
      const { error } = await supabase
        .from('playbook_steps')
        .delete()
        .in(
          'id',
          removed.map((s) => s.id)
        );
      if (error) errors.push(error.message);
    }

    for (const [position, draft] of cleaned.entries()) {
      const title = draft.title.trim();
      const hint = draft.hint.trim() || null;
      if (draft.id) {
        const before = steps.find((s) => s.id === draft.id);
        const unchanged =
          before &&
          before.title === title &&
          (before.hint ?? null) === hint &&
          before.position === position;
        if (unchanged) continue;
        const { error } = await supabase
          .from('playbook_steps')
          .update({ title, hint, position })
          .eq('id', draft.id);
        if (error) errors.push(error.message);
      } else {
        const { error } = await supabase.from('playbook_steps').insert({
          account_id: accountId,
          stage_id: stageId,
          title,
          hint,
          position,
        });
        if (error) errors.push(error.message);
      }
    }

    setSaving(false);
    if (errors.length > 0) {
      toast.error(t('toastSaveFailed'));
      return;
    }
    toast.success(t('toastSaved'));
    onDone();
  }

  return (
    <div className="border-border bg-muted/50 space-y-2 rounded-lg border p-3">
      <p className="text-muted-foreground eyebrow">
        {t('editingFor', { stage: stageName })}
      </p>

      <ul className="space-y-2">
        {drafts.map((draft, index) => (
          <li
            key={draft.id ?? `new-${index}`}
            className="border-border bg-card space-y-1.5 rounded-md border p-2"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-2xs w-4 shrink-0 text-center font-bold tabular-nums">
                {index + 1}
              </span>
              <Input
                value={draft.title}
                onChange={(e) => update(index, { title: e.target.value })}
                placeholder={t('stepPlaceholder')}
                className="border-input bg-transparent"
              />
              <div className="flex shrink-0 items-center">
                <IconButton
                  label={t('moveUp')}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </IconButton>
                <IconButton
                  label={t('moveDown')}
                  disabled={index === drafts.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </IconButton>
                <IconButton
                  label={t('removeStep')}
                  destructive
                  onClick={() =>
                    setDrafts((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            </div>
            <Input
              value={draft.hint}
              onChange={(e) => update(index, { hint: e.target.value })}
              placeholder={t('hintPlaceholder')}
              className="border-input ml-[22px] w-[calc(100%-22px)] bg-transparent text-xs"
            />
          </li>
        ))}
      </ul>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setDrafts((prev) => [...prev, { title: '', hint: '' }])}
        className="border-border text-muted-foreground hover:bg-card w-full bg-transparent"
      >
        <Plus className="mr-1 size-3" />
        {t('addStep')}
      </Button>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-muted-foreground"
        >
          {t('cancel')}
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  // `Button`, not a styled `<button>`: same 28px box, but three of these sit
  // side by side inside a sheet that gets used one-handed, and only `Button`
  // carries the coarse-pointer hit shield that grows the target to 44px
  // without moving a pixel — plus the focus ring these never had.
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={
        destructive
          ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30'
          : 'text-muted-foreground hover:text-foreground disabled:opacity-30'
      }
    >
      {children}
    </Button>
  );
}
