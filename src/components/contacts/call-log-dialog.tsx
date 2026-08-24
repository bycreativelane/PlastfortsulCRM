'use client';

import { useEffect, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { APP_LOCALE } from '@/lib/i18n/locale';
import type { Contact } from '@/types';

/** The four the prototype offers, in its order. */
const OUTCOMES = ['spoke', 'noAnswer', 'voicemail', 'callBack'] as const;
type Outcome = (typeof OUTCOMES)[number];

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A call that ALREADY HAPPENED.
 *
 * The prototype says this in the dialog itself and it is the whole design:
 * "o CRM não disca nem agenda ligações. Aqui você só registra uma que já
 * aconteceu." Nothing here dials, schedules, or creates a task — half the
 * value of writing it down is that the next person to open the thread knows
 * a phone call happened at all, because on WhatsApp it leaves no trace.
 *
 * It lands as an internal note (`contact_notes`), which is the app's existing
 * shared memory of a customer: account-scoped since migration 017, already
 * rendered in the contact panel and the record. A separate `calls` table
 * would be a second timeline to merge with the first for no gain — a call is
 * a thing somebody wrote down about this customer, which is what a note is.
 *
 * The customer never sees any of it.
 */
export function CallLogDialog({
  open,
  onOpenChange,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  onSaved: () => void;
}) {
  const t = useTranslations('Contacts.callLog');
  const { accountId } = useAuth();

  const [date, setDate] = useState(todayIso());
  const [duration, setDuration] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('spoke');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(todayIso());
    setDuration('');
    setOutcome('spoke');
    setNotes('');
  }, [open]);

  async function save() {
    if (!contact || !accountId) return;
    setSaving(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      setSaving(false);
      toast.error(t('failed'));
      return;
    }

    // One line, in the language of the app, so the note reads as a sentence
    // in the timeline rather than as a form dump.
    const when = new Date(date).toLocaleDateString(APP_LOCALE, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const header = [
      t('noteHeader', { date: when, outcome: t(`outcomes.${outcome}`) }),
      duration.trim() ? t('noteDuration', { duration: duration.trim() }) : '',
    ]
      .filter(Boolean)
      .join(' · ');

    const { error } = await supabase.from('contact_notes').insert({
      account_id: accountId,
      contact_id: contact.id,
      user_id: userId,
      note_text: notes.trim() ? `${header}\n${notes.trim()}` : header,
    });
    setSaving(false);

    if (error) {
      toast.error(t('failed'));
      return;
    }
    toast.success(t('saved'));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('title')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {contact?.name || contact?.phone}
          </DialogDescription>
        </DialogHeader>

        <div className="text-muted-foreground bg-muted/50 text-2xs flex items-start gap-2 rounded-md px-3 py-2 leading-relaxed">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>{t('note')}</p>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="cl-date">{t('whenLabel')}</FieldLabel>
              <DateField id="cl-date" value={date} onValueChange={setDate} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="cl-duration">
                {t('durationLabel')}
              </FieldLabel>
              <Input
                id="cl-duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder={t('durationPlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel>{t('outcomeLabel')}</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-slot="button"
                  onClick={() => setOutcome(value)}
                  aria-pressed={outcome === value}
                  className={cn(
                    'h-7 rounded-md border px-2.5 text-xs font-semibold transition-colors',
                    outcome === value
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {t(`outcomes.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="cl-notes">{t('notesLabel')}</FieldLabel>
            <Textarea
              id="cl-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              className="min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
