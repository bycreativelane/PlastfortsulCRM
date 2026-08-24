'use client';

import { useCallback, useState } from 'react';
import {
  Ban,
  CircleDollarSign,
  Clock,
  Loader2,
  MessageSquareOff,
  MoreHorizontal,
  PackageX,
  Trophy,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CurrencyInput } from '@/components/ui/currency-input';
import { FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/currency';
import {
  LOSS_REASONS,
  isLostStage,
  isUndefinedColumn,
  isWonStage,
  type LossReason,
} from '@/lib/deals/outcome';
import type { Deal, PipelineStage } from '@/types';

const REASON_ICONS: Record<LossReason, LucideIcon> = {
  price: CircleDollarSign,
  freight: Truck,
  leadTime: Clock,
  competitor: Users,
  noReply: MessageSquareOff,
  productMismatch: PackageX,
  other: MoreHorizontal,
};

/** What the caller asked for, held while the gate is open. */
type Pending =
  | { mode: 'value'; deal: Deal; stage: PipelineStage | null }
  | { mode: 'loss'; deal: Deal; stage: PipelineStage | null };

/**
 * The gates in front of "won" and "lost", for every surface that can move a
 * deal into either.
 *
 * A hook and not four copies: the board's drag, its right-click menu, the
 * deal sheet's buttons and the thread header's stage picker can all close a
 * deal, and a rule enforced in three of those places is not a rule. Each
 * surface calls `request(...)` and renders `<DealOutcomeDialogs {...props} />`.
 *
 * `request` returns whether it handled the move. `false` means no gate
 * applied and the caller should do its own write — which keeps the ordinary
 * stage change on the fast path it already had.
 */
export function useDealOutcome({
  defaultCurrency,
  onDone,
}: {
  defaultCurrency: string;
  onDone: () => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);

  const request = useCallback(
    (deal: Deal, stage: PipelineStage | null, intent?: 'won' | 'lost') => {
      const won = intent === 'won' || (stage ? isWonStage(stage.name) : false);
      const lost =
        intent === 'lost' || (stage ? isLostStage(stage.name) : false);

      // The value gate only fires when there is no value. A deal that already
      // carries one moves without a dialog — asking again for a number the
      // record already has is a toll, not a check.
      if (won && !(deal.value > 0)) {
        setPending({ mode: 'value', deal, stage });
        return true;
      }
      if (lost) {
        setPending({ mode: 'loss', deal, stage });
        return true;
      }
      return false;
    },
    []
  );

  return {
    request,
    dialogProps: {
      pending,
      defaultCurrency,
      onClose: () => setPending(null),
      onDone: () => {
        setPending(null);
        onDone();
      },
    },
  };
}

export interface DealOutcomeDialogsProps {
  pending: Pending | null;
  defaultCurrency: string;
  onClose: () => void;
  onDone: () => void;
}

export function DealOutcomeDialogs({
  pending,
  defaultCurrency,
  onClose,
  onDone,
}: DealOutcomeDialogsProps) {
  return (
    <>
      <ValueGate
        pending={pending?.mode === 'value' ? pending : null}
        defaultCurrency={defaultCurrency}
        onClose={onClose}
        onDone={onDone}
      />
      <LossGate
        pending={pending?.mode === 'loss' ? pending : null}
        defaultCurrency={defaultCurrency}
        onClose={onClose}
        onDone={onDone}
      />
    </>
  );
}

/* ------------------------------------------------------------------ value */

function ValueGate({
  pending,
  defaultCurrency,
  onClose,
  onDone,
}: {
  pending: Pending | null;
  defaultCurrency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('Pipelines.outcome');
  const [value, setValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const open = !!pending;

  async function confirm() {
    if (!pending || !value || value <= 0) return;
    setSaving(true);
    const update: Record<string, unknown> = {
      value,
      status: 'won',
      updated_at: new Date().toISOString(),
    };
    if (pending.stage) update.stage_id = pending.stage.id;

    const { error } = await createClient()
      .from('deals')
      .update(update)
      .eq('id', pending.deal.id);
    setSaving(false);

    if (error) {
      toast.error(t('failed'));
      return;
    }
    toast.success(t('valueSaved'));
    setValue(null);
    onDone();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValue(null);
          onClose();
        }
      }}
    >
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <div className="bg-ok-soft text-ok-ink mb-1 grid size-9 place-items-center rounded-lg">
            <Trophy className="size-4.5" />
          </div>
          <DialogTitle className="text-popover-foreground">
            {t('valueTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('valueDescription', {
              stage: pending?.stage?.name ?? t('wonFallbackStage'),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <FieldLabel htmlFor="outcome-value">
            {t('valueLabel')} <span className="text-danger-ink">*</span>
          </FieldLabel>
          <CurrencyInput
            id="outcome-value"
            value={value}
            onValueChange={setValue}
            currency={pending?.deal.currency ?? defaultCurrency}
            placeholder="0"
            autoFocus
          />
          <p className="text-muted-foreground text-2xs leading-relaxed">
            {t('valueHint')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={confirm} disabled={saving || !value || value <= 0}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('valueConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------- loss */

function LossGate({
  pending,
  defaultCurrency,
  onClose,
  onDone,
}: {
  pending: Pending | null;
  defaultCurrency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('Pipelines.outcome');
  const [reason, setReason] = useState<LossReason | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const open = !!pending;

  function reset() {
    setReason(null);
    setNote('');
  }

  async function confirm() {
    if (!pending || !reason) return;
    setSaving(true);
    const supabase = createClient();

    const base: Record<string, unknown> = {
      status: 'lost',
      updated_at: new Date().toISOString(),
    };
    if (pending.stage) base.stage_id = pending.stage.id;

    let { error } = await supabase
      .from('deals')
      .update({ ...base, lost_reason: reason, lost_note: note.trim() || null })
      .eq('id', pending.deal.id);

    // Migration 043 has not run yet. The reason is the whole point of the
    // dialog, so it goes into the notes rather than being dropped — and the
    // moment the columns exist this branch stops being taken.
    if (error && isUndefinedColumn(error)) {
      const line = `${t('noteFallbackPrefix')}: ${t(`reasons.${reason}`)}${
        note.trim() ? ` — ${note.trim()}` : ''
      }`;
      const notes = pending.deal.notes
        ? `${pending.deal.notes}\n${line}`
        : line;
      ({ error } = await supabase
        .from('deals')
        .update({ ...base, notes })
        .eq('id', pending.deal.id));
    }
    setSaving(false);

    if (error) {
      toast.error(t('failed'));
      return;
    }
    toast.success(t('lossSaved'));
    reset();
    onDone();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <div className="bg-danger-soft text-danger-ink mb-1 grid size-9 place-items-center rounded-lg">
            <Ban className="size-4.5" />
          </div>
          <DialogTitle className="text-popover-foreground">
            {t('lossTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {pending?.deal.title}
            {pending && pending.deal.value > 0
              ? ` · ${formatCurrency(
                  pending.deal.value,
                  pending.deal.currency ?? defaultCurrency
                )}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FieldLabel>
            {t('reasonLabel')} <span className="text-danger-ink">*</span>
          </FieldLabel>

          {/* Cards, not a dropdown. Seven reasons is a list somebody reads
              once and then recognises by shape — and the point of asking is
              that it gets answered honestly rather than with whatever was
              first in a select. */}
          <div className="grid grid-cols-2 gap-1.5">
            {LOSS_REASONS.map((value) => {
              const Icon = REASON_ICONS[value];
              const selected = reason === value;
              return (
                <button
                  key={value}
                  type="button"
                  data-slot="button"
                  aria-pressed={selected}
                  onClick={() => setReason(value)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-semibold transition-colors [&>svg]:size-3.5 [&>svg]:shrink-0',
                    selected
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border bg-card-2 text-secondary-foreground hover:bg-card hover:text-foreground [&>svg]:text-muted-foreground'
                  )}
                >
                  <Icon />
                  <span className="min-w-0 truncate">
                    {t(`reasons.${value}`)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="outcome-note">{t('noteLabel')}</FieldLabel>
            <Textarea
              id="outcome-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              className="min-h-16"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={saving || !reason}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('lossConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
