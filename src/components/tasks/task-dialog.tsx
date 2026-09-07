'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';

import type { Task } from '@/types';
import { TASK_KINDS } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { publishTask } from '@/lib/tasks/notify-client';
import { useAuth } from '@/hooks/use-auth';
import { useBusinessHours } from '@/hooks/use-business-hours';
import { useMemberDirectory } from '@/hooks/use-member-directory';
import { localParts } from '@/lib/automations/local-time';
import { firstOpenTime } from '@/lib/hours';
import {
  createTask,
  deleteTask,
  presetDue,
  updateTask,
  type DuePreset,
  type TaskInput,
} from '@/lib/tasks/mutations';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import { Textarea } from '@/components/ui/textarea';
import { TimeField } from '@/components/ui/time-field';
import { cn } from '@/lib/utils';

/**
 * Marcar um compromisso.
 *
 * O MESMO diálogo cria e edita, porque são a mesma pergunta — o que, quando,
 * de quem. Um segundo formulário "editar" divergiria do primeiro na terceira
 * vez que alguém acrescentasse um campo.
 *
 * OS ATALHOS DE PRAZO SÃO O PONTO. Digitar uma data por extenso para dizer
 * "amanhã" é o atrito que faz as pessoas não marcarem nada; e "amanhã", numa
 * sexta às 19h, tem de ser segunda às 08:00, não sábado à meia-noite. Isso
 * sai de `presetDue`, que lê o expediente da conta (066) — é a Fase 1 sendo
 * usada, não uma conveniência solta.
 *
 * O QUE ESTE DIÁLOGO NÃO FAZ: concluir. Concluir é um clique numa linha da
 * lista, não uma visita a um formulário — e o formulário aberto para marcar
 * o próximo passo não é o lugar de encerrar o anterior.
 */

/** Os lembretes que fazem sentido oferecer. Em minutos antes do prazo. */
const REMINDER_CHOICES = [0, 15, 30, 60, 120, 24 * 60] as const;

export interface TaskDialogTarget {
  contact_id?: string | null;
  deal_id?: string | null;
  conversation_id?: string | null;
}

export function TaskDialog({
  open,
  onOpenChange,
  task,
  target,
  defaultTitle,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` cria; uma tarefa edita. */
  task?: Task | null;
  /** A quem a tarefa se refere, quando ela nasce de uma ficha. */
  target?: TaskDialogTarget;
  /** Título sugerido — o registro de ligação manda "Retornar ligação". */
  defaultTitle?: string;
  onSaved?: () => void;
}) {
  const t = useTranslations('Tasks');
  const { accountId, user } = useAuth();
  const { hours } = useBusinessHours();
  const members = useMemberDirectory();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<string>('call');
  const [dueOn, setDueOn] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [remind, setRemind] = useState<string>('');
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [saving, setSaving] = useState(false);

  /** "Hoje" no fuso da CONTA, não no do navegador. */
  const todayIso = useMemo(
    () => localParts(new Date(), hours.timezone).dateKey,
    [hours.timezone]
  );
  const nowTime = useMemo(() => {
    const p = localParts(new Date(), hours.timezone);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  }, [hours.timezone]);

  /**
   * O formulário recomeça a cada abertura.
   *
   * Um diálogo que reabre com o que a pessoa digitou da última vez e
   * desistiu é um diálogo que salva a coisa errada quando ela não presta
   * atenção — e como o mesmo componente edita duas tarefas diferentes, a
   * chave inclui QUAL.
   *
   * Ajuste durante a renderização e não num efeito, como em
   * `settings/hours-panel.tsx`: o efeito faria o mesmo trabalho um render
   * depois, e nesse render intermediário o formulário mostraria os campos
   * da tarefa anterior.
   */
  const seedKey = open ? (task?.id ?? `new:${defaultTitle ?? ''}`) : null;
  const [seededFrom, setSeededFrom] = useState<string | null>(null);

  if (seedKey !== seededFrom) {
    setSeededFrom(seedKey);
    if (seedKey !== null) {
      setTitle(task?.title ?? defaultTitle ?? '');
      setDescription(task?.description ?? '');
      setKind(task?.kind ?? 'call');
      setDueOn(task?.due_on ?? '');
      setDueTime(task?.due_time?.slice(0, 5) ?? '');
      setRemind(
        task?.remind_minutes_before == null
          ? ''
          : String(task.remind_minutes_before)
      );
      setAssignedTo(task?.assigned_to ?? user?.id ?? '');
    }
  }

  function applyPreset(preset: DuePreset) {
    const due = presetDue(preset, hours, todayIso, nowTime);
    setDueOn(due.due_on);
    setDueTime(due.due_time ?? '');
  }

  /** Pôr uma data à mão sem hora sugere a abertura do expediente. */
  function handleDayChange(iso: string) {
    setDueOn(iso);
    if (iso && !dueTime) setDueTime(firstOpenTime(hours, iso) ?? '');
    if (!iso) setDueTime('');
  }

  async function handleSave() {
    if (!accountId || !title.trim()) return;
    setSaving(true);

    const input: TaskInput = {
      title: title.trim(),
      description: description.trim() || null,
      kind,
      due_on: dueOn || null,
      due_time: dueOn && dueTime ? dueTime : null,
      remind_minutes_before: dueOn && remind !== '' ? Number(remind) : null,
      assigned_to: assignedTo || null,
      ...target,
    };

    const db = createClient();
    const created = task
      ? null
      : await createTask(db, accountId, user?.id ?? null, input);
    const ok = task ? await updateTask(db, task.id, input) : Boolean(created);

    setSaving(false);
    if (!ok) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(task ? t('updated') : t('created'));
    onOpenChange(false);
    onSaved?.();

    // Depois de fechar, e sem `await`: a tarefa já está salva, e a agenda
    // externa é um destino a mais — não uma condição do salvamento.
    const savedId = task?.id ?? created?.id;
    if (savedId) void publishTask(savedId);
  }

  async function handleDelete() {
    if (!task) return;
    setSaving(true);
    const ok = await deleteTask(createClient(), task.id);
    setSaving(false);
    if (!ok) {
      toast.error(t('deleteFailed'));
      return;
    }
    toast.success(t('deleted'));
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? t('editTitle') : t('newTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <FieldLabel htmlFor="task-title">{t('titleLabel')}</FieldLabel>
            <Input
              id="task-title"
              value={title}
              autoFocus
              placeholder={t('titlePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && title.trim()) handleSave();
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <FieldLabel>{t('kindLabel')}</FieldLabel>
              <OptionSelect
                value={kind}
                onValueChange={setKind}
                className="border-border bg-muted text-foreground"
              >
                {TASK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </OptionSelect>
            </div>

            <div className="grid gap-2">
              <FieldLabel>{t('assigneeLabel')}</FieldLabel>
              <OptionSelect
                value={assignedTo}
                onValueChange={setAssignedTo}
                className="border-border bg-muted text-foreground"
              >
                <option value="">{t('unassigned')}</option>
                {Array.from(members.values()).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
              </OptionSelect>
            </div>
          </div>

          {/* ---- O prazo ---- */}
          <div className="grid gap-2">
            <FieldLabel>{t('dueLabel')}</FieldLabel>

            <div className="flex flex-wrap gap-1.5">
              {(
                ['today', 'tomorrow', 'in3days', 'nextWeek'] as DuePreset[]
              ).map((preset) => {
                const due = presetDue(preset, hours, todayIso, nowTime);
                const active = dueOn === due.due_on;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-primary-soft text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {t(`preset.${preset}`)}
                  </button>
                );
              })}
              {dueOn && (
                <button
                  type="button"
                  onClick={() => handleDayChange('')}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-2 py-1 text-xs font-medium transition-colors"
                >
                  {t('preset.none')}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DateField
                value={dueOn}
                onValueChange={handleDayChange}
                className="w-36"
                aria-label={t('dueLabel')}
              />
              <TimeField
                value={dueTime}
                onValueChange={setDueTime}
                step={hours.slotMinutes}
                disabled={!dueOn}
                className="w-28"
                aria-label={t('timeLabel')}
              />
              <OptionSelect
                value={remind}
                onValueChange={setRemind}
                disabled={!dueOn}
                className="border-border bg-muted text-foreground w-auto min-w-40"
              >
                <option value="">{t('noReminder')}</option>
                {REMINDER_CHOICES.map((m) => (
                  <option key={m} value={String(m)}>
                    {/* Uma chave por escolha, e não "{m} minutos antes":
                        1440 minutos antes é uma frase que ninguém diz. */}
                    {t(`reminder.${m}` as 'reminder.0')}
                  </option>
                ))}
              </OptionSelect>
            </div>

            {/* Sem hora o lembrete cai na abertura do expediente, e é melhor
                dizer isso do que deixar a pessoa descobrir às 08:00. */}
            {dueOn && !dueTime && remind !== '' && (
              <p className="text-muted-foreground text-xs">
                {t('reminderNoTimeHint', {
                  time: firstOpenTime(hours, dueOn) ?? '09:00',
                })}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <FieldLabel htmlFor="task-desc">{t('notesLabel')}</FieldLabel>
            <Textarea
              id="task-desc"
              value={description}
              placeholder={t('notesPlaceholder')}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20 resize-none"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {task ? (
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={saving}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
              {t('delete')}
            </Button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving || !title.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
