'use client';

import { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { CURRENCIES } from '@/lib/currency';
import {
  lineTotal,
  replaceDealItems,
  type DealItemDraft,
} from '@/lib/products/catalog';
import { DealItemsEditor } from './deal-items';
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  PipelineStage,
  Profile,
} from '@/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  DealOutcomeDialogs,
  useDealOutcome,
} from '@/components/pipelines/deal-outcome';
import { DateField } from '@/components/ui/date-field';
import { OptionSelect } from '@/components/ui/option-select';
import { PlaybookChecklist } from './playbook-checklist';
import { FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  /**
   * Pre-selects the customer on a NEW deal.
   *
   * Optional, so the board is unaffected. It exists for the inbox: opening
   * "Nova oportunidade" from Ricardo's thread and being asked to pick a
   * contact is the form ignoring the one thing the context already knew.
   */
  defaultContactId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  defaultContactId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations('Pipelines.form');
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();
  const outcome = useDealOutcome({
    defaultCurrency,
    onDone: () => {
      onOpenChange(false);
      onSaved();
    },
  });
  // Same gate the board's right-click menu uses. RLS is the real barrier —
  // `deals_insert/update/delete` all require 'agent' — but a viewer was being
  // shown a live Save button and an armed Delete, and only found out the
  // answer by pressing them and reading an error toast. Say no before the
  // click, not after it.
  const canWrite = useCan('send-messages');

  const [title, setTitle] = useState('');
  const [value, setValue] = useState<number | null>(null);
  /**
   * The opportunity's line items (spec §10, migration 054).
   *
   * Held here rather than inside the editor because they are saved
   * AFTER the deal exists — on a new deal there is no id to attach them
   * to until the insert returns one.
   */
  const [items, setItems] = useState<DealItemDraft[]>([]);
  const [itemsPending, setItemsPending] = useState(false);
  const handleItems = useCallback(
    (state: { items: DealItemDraft[]; pending: boolean }) => {
      setItems(state.items);
      setItemsPending(state.pending);
    },
    []
  );
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState('');
  const [stageId, setStageId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [notes, setNotes] = useState('');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(deal.value ?? null);
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? '');
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? '');
      setExpectedCloseDate(deal.expected_close_date ?? '');
      setNotes(deal.notes ?? '');
    } else {
      setTitle('');
      setValue(null);
      setCurrency(defaultCurrency);
      setContactId(defaultContactId ?? '');
      setStageId(defaultStageId || stages[0]?.id || '');
      setAssignedTo('');
      setExpectedCloseDate('');
      setNotes('');
    }
  }, [open, deal, defaultStageId, defaultContactId, stages, defaultCurrency]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from('contacts').select('*').order('name'),
        supabase.from('profiles').select('*').order('full_name'),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t('toastRequired'));
      return;
    }
    setSaving(true);

    // The lines decide the value when there are lines. The trigger in
    // 054 does this again server-side — this is only so the row is right
    // in the same statement rather than a beat later, which is what the
    // board reads when it refreshes.
    const lineTotalSum = items.reduce((sum, item) => sum + lineTotal(item), 0);
    const hasLines = items.length > 0;

    const payload = {
      title: title.trim(),
      value: hasLines ? lineTotalSum : (value ?? 0),
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
    };

    if (deal) {
      const { error } = await supabase
        .from('deals')
        .update(payload)
        .eq('id', deal.id);
      if (error) {
        toast.error(t('toastFailedSave'));
        setSaving(false);
        return;
      }
      if (!itemsPending && accountId) {
        const { error: itemsError } = await replaceDealItems(supabase, {
          accountId,
          dealId: deal.id,
          items,
        });
        // The deal saved. Saying so and naming the part that did not is
        // better than a rollback the user did not ask for — the value is
        // already correct on the row above.
        if (itemsError) toast.error(t('toastItemsFailed'));
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t('toastNotSignedIn'));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t('toastNotLinked'));
        setSaving(false);
        return;
      }
      const { data: created, error } = await supabase
        .from('deals')
        .insert({
          ...payload,
          user_id: user.id,
          account_id: accountId,
          status: 'open',
        })
        // The id, so the lines have something to attach to. `.select()`
        // on an insert is one round trip either way.
        .select('id')
        .single();
      if (error || !created) {
        toast.error(t('toastFailedCreate'));
        setSaving(false);
        return;
      }
      if (!itemsPending && items.length > 0) {
        const { error: itemsError } = await replaceDealItems(supabase, {
          accountId,
          dealId: (created as { id: string }).id,
          items,
        });
        if (itemsError) toast.error(t('toastItemsFailed'));
      }
    }

    setSaving(false);
    toast.success(deal ? t('toastUpdated') : t('toastCreated'));
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;

    // Won and lost go through the gates: a sale with no value and a loss
    // with no reason are the two records nobody can reconstruct afterwards.
    // `request` returns true when it took the move; reopening never gates.
    if (status !== 'open') {
      const gated = outcome.request(
        deal,
        stages.find((st) => st.id === stageId) ?? null,
        status
      );
      if (gated) return;
    }

    setStatusAction(status);
    const { error } = await supabase
      .from('deals')
      .update({ status })
      .eq('id', deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t('toastFailedStatus'));
      return;
    }
    toast.success(
      status === 'won'
        ? t('toastMarkedWon')
        : status === 'lost'
          ? t('toastMarkedLost')
          : t('toastReopened')
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from('deals').delete().eq('id', deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t('toastFailedDelete'));
      return;
    }
    toast.success(t('toastDeleted'));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="record"
        className="bg-popover border-border text-popover-foreground w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-border/50 border-b p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t('editDeal') : t('newDeal')}
            </SheetTitle>
          </SheetHeader>

          {/* `overflow-y-auto` alone computes `overflow-x` to `auto` as
              well, so anything a pixel too wide inside adds a horizontal
              scrollbar across the bottom of the form. Nothing in a
              single-column form should ever scroll sideways. */}
          <div className="@container flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-4">
            <div className="grid gap-2">
              <FieldLabel>{t('title')}</FieldLabel>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <FieldLabel>{t('contact')}</FieldLabel>
              <OptionSelect
                value={contactId}
                onValueChange={setContactId}
                className="border-border bg-muted text-foreground"
              >
                <option value="">{t('selectContact')}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </OptionSelect>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="bg-primary/10 text-primary hover:bg-primary/20 mt-1 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t('linkToConversation')}
                </Link>
              )}
            </div>

            {/* Paired once the PANEL is wide enough — a container query,
                not `sm:`, because what decides is the sheet's own width.
                Paired by MEANING rather than by what happened to fit:
                money with the date it is expected, stage with the person
                who owns it. This was seven stacked rows in a sheet that
                rendered at 24rem, which is what put a scrollbar under a
                form of eight fields. */}
            <div className="grid gap-4 @lg:grid-cols-2">
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div className="grid gap-2">
                  <FieldLabel>{t('value')}</FieldLabel>
                  {/* Read-only once there are lines. The number is what
                      they add up to, and a field somebody can type over
                      an arithmetic result is a field that makes the
                      total a lie again — which is the whole thing line
                      items were added to stop. */}
                  <CurrencyInput
                    value={
                      items.length > 0
                        ? items.reduce((sum, i) => sum + lineTotal(i), 0)
                        : value
                    }
                    onValueChange={setValue}
                    currency={currency}
                    placeholder="0"
                    disabled={items.length > 0}
                    className="border-border bg-muted text-foreground"
                  />
                  {items.length > 0 ? (
                    <p className="text-muted-foreground text-2xs">
                      {t('valueFromItems')}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <FieldLabel>{t('currency')}</FieldLabel>
                  <OptionSelect
                    value={currency}
                    onValueChange={setCurrency}
                    className="border-border bg-muted text-foreground"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </OptionSelect>
                </div>
              </div>

              <div className="grid gap-2">
                <FieldLabel>{t('expectedCloseDate')}</FieldLabel>
                <DateField
                  value={expectedCloseDate}
                  onValueChange={setExpectedCloseDate}
                  className="[&_input]:border-border [&_input]:bg-muted [&_input]:text-foreground"
                />
              </div>
            </div>

            <div className="grid gap-4 @sm:grid-cols-2">
              <div className="grid gap-2">
                <FieldLabel>{t('stage')}</FieldLabel>
                <OptionSelect
                  value={stageId}
                  onValueChange={setStageId}
                  className="border-border bg-muted text-foreground"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </OptionSelect>
              </div>

              <div className="grid gap-2">
                <FieldLabel>{t('assignedTo')}</FieldLabel>
                <OptionSelect
                  value={assignedTo}
                  onValueChange={setAssignedTo}
                  className="border-border bg-muted text-foreground"
                >
                  <option value="">{t('unassigned')}</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </OptionSelect>
              </div>
            </div>

            {/* The lines, between the money and the notes — because they
                ARE the money, and the note is what somebody adds after
                deciding what is on the quote. Draws nothing at all on a
                database without migration 054. */}
            <DealItemsEditor
              accountId={accountId}
              dealId={deal?.id ?? null}
              currency={currency}
              disabled={!canWrite}
              onChange={handleItems}
            />

            <div className="grid gap-2">
              <FieldLabel>{t('notes')}</FieldLabel>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('notesPlaceholder')}
                className="border-border bg-muted text-foreground min-h-[100px]"
              />
            </div>

            {/* The stage's playbook, on the deal it applies to. Keyed to the
                deal's PERSISTED stage rather than the form's stage select:
                changing the select is an intention, not a move, and ticking
                a step for a stage the deal has not reached yet would record
                work against the wrong column. */}
            {deal && (
              <PlaybookChecklist
                dealId={deal.id}
                stageId={deal.stage_id}
                stageName={
                  stages.find((s) => s.id === deal.stage_id)?.name ?? ''
                }
                onProgressChanged={onSaved}
              />
            )}

            {deal && (
              <div className="border-border bg-muted/50 space-y-2 rounded-lg border p-3">
                <p className="text-muted-foreground eyebrow">{t('status')}</p>
                {/* Stacked, not side by side. `Button` sets
                    `whitespace-nowrap`, so a pair of them in equal columns
                    cannot shrink past their own labels: the box got its half
                    of the row and "Marcar como perdido" ran straight out of
                    it, which is what put a horizontal scrollbar under the
                    whole form. Full-width rows cannot clip at any sheet
                    width, and two decisions this consequential are better
                    read one under the other than side by side anyway. */}
                <div className="grid gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange('won')}
                    disabled={
                      !canWrite || !!statusAction || deal.status === 'won'
                    }
                    className="min-w-0 disabled:opacity-50"
                  >
                    {statusAction === 'won' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        {t('markAsWon')}
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => handleStatusChange('lost')}
                    disabled={
                      !canWrite || !!statusAction || deal.status === 'lost'
                    }
                    className="min-w-0"
                  >
                    {statusAction === 'lost' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        {t('markAsLost')}
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== 'open' && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange('open')}
                    disabled={!canWrite || !!statusAction}
                    className="text-muted-foreground hover:text-foreground w-full"
                  >
                    {t('reopenDeal')}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-border/50 bg-popover/80 border-t p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted flex-1 bg-transparent"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  !canWrite || saving || !title.trim() || !contactId || !stageId
                }
                className="flex-1"
              >
                {saving
                  ? t('saving')
                  : deal
                    ? t('saveChanges')
                    : t('createDeal')}
              </Button>
            </div>

            {deal &&
              canWrite &&
              (confirmDelete ? (
                // Real buttons, not styled spans: these are the two smallest
                // targets in a sheet that gets used one-handed, and only
                // `Button` carries the coarse-pointer hit shield, the focus
                // ring and the press.
                <div className="bg-danger-soft mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2">
                  <span className="text-danger-ink text-xs">
                    {t('deletePrompt')}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="text-muted-foreground font-semibold"
                    >
                      {t('cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="font-semibold"
                    >
                      {deleting ? t('deleting') : t('confirm')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  className="text-muted-foreground hover:text-destructive mt-3 w-full font-semibold"
                >
                  <Trash2 className="mr-1 size-3" />
                  {t('deleteDeal')}
                </Button>
              ))}
          </div>
        </div>
      </SheetContent>
      <DealOutcomeDialogs {...outcome.dialogProps} />
    </Sheet>
  );
}
