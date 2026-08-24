'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DateField } from '@/components/ui/date-field';
import { FieldLabel } from '@/components/ui/field';
import { OptionSelect } from '@/components/ui/option-select';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  OCCURRENCE_KINDS,
  isMissingTableError,
  type ContactOccurrence,
} from '@/lib/occurrences/kinds';
import { APP_LOCALE } from '@/lib/i18n/locale';
import type { Contact } from '@/types';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The customer's problems: the history, and the form that adds to it.
 *
 * ONE dialog for both, because they are one question. Spec section 15 asks
 * for the warning to open the history; section 14 lists what an occurrence
 * records. Splitting them would mean an operator who just saw "já teve
 * problema com Solda" has to close that and find a different button to say
 * "and now there is another one".
 *
 * Section 17 is why the list shows resolved ones too, and why nothing here
 * deletes: a problem that was fixed is exactly what you want to know before
 * promising the same thing again. Resolving sets `status`; the row stays.
 *
 * WAITING ON A MIGRATION. `042_contact_occurrences.sql` is written and not
 * applied — migrations are applied by Gabriel, never by an agent. Until then
 * every read and write here fails with a missing relation, and the dialog
 * says so in those words rather than showing a database error or, worse, an
 * empty history that looks like good news.
 */
export function OccurrenceDialog({
  open,
  onOpenChange,
  contact,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  onChanged: () => void;
}) {
  const t = useTranslations('Contacts.occurrences');
  const { accountId } = useAuth();

  const [rows, setRows] = useState<ContactOccurrence[] | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [kind, setKind] = useState<string>(OCCURRENCE_KINDS[0]);
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    if (!contact) return;
    setLoading(true);
    const { data, error } = await createClient()
      .from('contact_occurrences')
      .select('*')
      .eq('contact_id', contact.id)
      .order('occurred_on', { ascending: false });
    setLoading(false);
    if (error) {
      setPending(isMissingTableError(error));
      setRows([]);
      return;
    }
    setPending(false);
    setRows((data ?? []) as ContactOccurrence[]);
  }, [contact]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdding(false);
    setKind(OCCURRENCE_KINDS[0]);
    setOccurredOn(todayIso());
    setDescription('');
    load();
  }, [open, load]);

  async function register() {
    if (!contact || !accountId || !description.trim()) return;
    setSaving(true);
    const { error } = await createClient().from('contact_occurrences').insert({
      account_id: accountId,
      contact_id: contact.id,
      kind,
      occurred_on: occurredOn,
      description: description.trim(),
      status: 'open',
    });
    setSaving(false);

    if (error) {
      toast.error(isMissingTableError(error) ? t('pendingToast') : t('failed'));
      setPending(isMissingTableError(error));
      return;
    }
    toast.success(t('registered'));
    setAdding(false);
    setDescription('');
    load();
    onChanged();
  }

  async function resolve(row: ContactOccurrence) {
    const { error } = await createClient()
      .from('contact_occurrences')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) {
      toast.error(t('failed'));
      return;
    }
    toast.success(t('resolvedToast'));
    load();
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('title')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {contact?.name || contact?.phone}
            {contact?.company ? ` · ${contact.company}` : ''}
          </DialogDescription>
        </DialogHeader>

        {/* Section 17, stated where it applies. */}
        <p className="text-muted-foreground bg-muted/50 text-2xs rounded-md px-3 py-2 leading-relaxed">
          {t('permanenceNote')}
        </p>

        {pending ? (
          <div className="border-human-border bg-human-soft text-human-ink flex items-start gap-2 rounded-md border px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="text-xs leading-relaxed">{t('pendingMigration')}</p>
          </div>
        ) : loading && rows === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {(rows ?? []).length === 0 ? (
              <p className="text-muted-foreground py-2 text-xs">{t('empty')}</p>
            ) : (
              (rows ?? []).map((row) => (
                <div
                  key={row.id}
                  className="border-border rounded-md border px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground text-xs font-semibold">
                      {row.kind}
                    </span>
                    <StatusBadge
                      size="sm"
                      variant={row.status === 'open' ? 'danger' : 'ok'}
                    >
                      {row.status === 'open' ? t('open') : t('resolved')}
                    </StatusBadge>
                  </div>
                  <p className="text-secondary-foreground mt-1 text-xs whitespace-pre-wrap">
                    {row.description}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-2xs">
                      {new Date(row.occurred_on).toLocaleDateString(
                        APP_LOCALE,
                        {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        }
                      )}
                    </span>
                    {row.status === 'open' && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => resolve(row)}
                      >
                        <Check className="size-3" />
                        {t('markResolved')}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {adding && !pending && (
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="oc-kind">{t('kindLabel')}</FieldLabel>
              <OptionSelect
                id="oc-kind"
                value={kind}
                onValueChange={setKind}
              >
                {OCCURRENCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </OptionSelect>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="oc-date">{t('dateLabel')}</FieldLabel>
              <DateField
                id="oc-date"
                value={occurredOn}
                onValueChange={setOccurredOn}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="oc-desc">{t('descriptionLabel')}</FieldLabel>
              <Textarea
                id="oc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
                className="min-h-20"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          {adding ? (
            <Button
              onClick={register}
              disabled={saving || !description.trim() || pending}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {t('register')}
            </Button>
          ) : (
            <Button onClick={() => setAdding(true)} disabled={pending}>
              <Plus className="size-3.5" />
              {t('newOccurrence')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
