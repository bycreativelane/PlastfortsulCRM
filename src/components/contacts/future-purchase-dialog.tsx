'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { moveContactToFuturePurchase } from '@/lib/deals/future-purchase';
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
import { cn } from '@/lib/utils';
import type { Contact } from '@/types';

/** The three the prototype offers before "a specific date". */
const PRESETS = [15, 30, 60] as const;

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  // Local, not UTC: `toISOString()` on a date west of Greenwich hands back
  // the previous day, which is the same trap `DateField` documents.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "Volte a falar comigo em setembro."
 *
 * The single most common outcome of a sales conversation that does not close,
 * and until now the CRM had nowhere to put it: the operator either kept it in
 * their head or invented a reminder somewhere else.
 *
 * It writes `contacts.next_purchase_expected_at`, which exists since migration
 * 040 and whose column comment names this exact feature as its writer. That is
 * also the column the repurchase automation reads, so a date set here is not a
 * note — it is the thing that will eventually make the CRM speak.
 *
 * Desde 7 de setembro de 2026 ele também MOVE a oportunidade para
 * VENDAS → Compra Futura (item 5 do pacote de correções). Antes disso o
 * comentário aqui dizia que o funil não se movia sozinho, e dizia a verdade
 * — que era o problema: o vendedor registrava a compra futura na conversa e
 * a oportunidade ficava parada até alguém abrir o Kanban e arrastá-la.
 *
 * O que continua fora: escolher o template a enviar no dia. Isso é da
 * automação de Compra Futura, e não deste diálogo.
 */
export function FuturePurchaseDialog({
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
  const t = useTranslations('Contacts.futurePurchase');
  const { user, accountId } = useAuth();
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(contact?.next_purchase_expected_at ?? '');
  }, [open, contact]);

  async function save() {
    if (!contact) return;
    setSaving(true);
    const { error } = await createClient()
      .from('contacts')
      .update({
        // Empty clears it — "actually, no date" has to be expressible, or the
        // only way to undo a wrong date is to invent another one.
        next_purchase_expected_at: date || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id);
    setSaving(false);

    if (error) {
      toast.error(t('toastFailed'));
      return;
    }
    // Só quando há data: limpar a compra futura não é o mesmo que marcar
    // uma, e mover a oportunidade ao apagar a data faria o desfazer ter um
    // efeito que ninguém pediu.
    if (date && accountId && user?.id) {
      const outcome = await moveContactToFuturePurchase(
        createClient(),
        contact.id,
        accountId,
        user.id
      );
      // Falhar em mover NÃO desfaz a data. A data é o que a automação de
      // recompra lê, e ela é a parte que sempre funcionou; perder o
      // registro porque o funil não tem a etapa seria trocar um problema
      // por um pior.
      if (outcome.action === 'skipped') {
        toast.warning(t('toastStageSkipped'));
      } else {
        toast.success(t('toastSavedAndMoved'));
        onOpenChange(false);
        onSaved();
        return;
      }
    }

    toast.success(date ? t('toastSaved') : t('toastCleared'));
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
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <FieldLabel htmlFor="fp-date">{t('whenLabel')}</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((days) => {
                const iso = isoInDays(days);
                return (
                  <button
                    key={days}
                    type="button"
                    data-slot="button"
                    onClick={() => setDate(iso)}
                    className={cn(
                      'h-7 rounded-md border px-2.5 text-xs font-semibold transition-colors',
                      date === iso
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {t('inDays', { days: String(days) })}
                  </button>
                );
              })}
            </div>
            <DateField id="fp-date" value={date} onValueChange={setDate} />
          </div>

          <p className="text-muted-foreground text-2xs leading-relaxed">
            {t('hint')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
