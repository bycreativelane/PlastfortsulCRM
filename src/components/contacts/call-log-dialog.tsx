'use client';

import { useEffect, useMemo, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useBusinessHours } from '@/hooks/use-business-hours';
import { localParts } from '@/lib/automations/local-time';
import { fromISO } from '@/lib/calendar';
import { formatMonthDay } from '@/lib/i18n/dates';
import { createTask, presetDue } from '@/lib/tasks/mutations';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ChoiceChip } from '@/components/ui/choice-chip';
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
 * The prototype says this in the dialog itself and it is half the design:
 * "o CRM não disca nem agenda ligações. Aqui você só registra uma que já
 * aconteceu." Nothing here dials, and nothing here ever will — half the
 * value of writing it down is that the next person to open the thread knows
 * a phone call happened at all, because on WhatsApp it leaves no trace.
 *
 * THE OTHER HALF CHANGED. This comment used to end "...or creates a task",
 * because there were no tasks: `spec-automacoes-fluxo.md` decided (decision
 * 2) that moving the deal to the Ligação stage WAS the task. Migration 068
 * gives the product a real one, and "ligou, não atendeu, retorna quinta" is
 * the exact case that decision could not express — the stage says somebody
 * should call, and cannot say who, or when, or that it already happened
 * once. So the dialog now offers to book the return call, checked by
 * default on precisely the two outcomes that imply one.
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
  const [followUp, setFollowUp] = useState(false);
  /** A pessoa já mexeu na caixa de retorno neste registro. */
  const [followUpTouched, setFollowUpTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const { hours } = useBusinessHours();

  /**
   * O retorno cai no próximo dia útil, em horário comercial.
   *
   * `presetDue` lê o expediente da conta (066), então "amanhã" numa sexta à
   * noite é segunda às 08:00 — e não sábado à meia-noite, que é o que um
   * `+1 dia` ingênuo marcaria.
   */
  const followUpDue = useMemo(
    () =>
      presetDue(
        'tomorrow',
        hours,
        localParts(new Date(), hours.timezone).dateKey
      ),
    // `open` é dependência de propósito, e não decorativa: uma aba deixada
    // aberta desde ontem calcularia "amanhã" a partir do dia em que foi
    // montada, errando o texto E a data que a tarefa grava.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hours, open]
  );

  /*
   * "9 set 08:00", e não "2026-09-09".
   *
   * `due_on` saía cru na frase, num diálogo que escreve dd/mm/aaaa num
   * campo de data a poucos pixels dali — e a HORA, que o expediente da
   * conta decidiu e que a tarefa vai gravar, não aparecia em lugar nenhum.
   *
   * `fromISO` e não `new Date`: `due_on` é coluna DATE, e o construtor cru
   * sobre ela devolve o dia anterior a oeste de Greenwich.
   */
  const followUpLabel = [
    fromISO(followUpDue.due_on)
      ? formatMonthDay(fromISO(followUpDue.due_on) as Date)
      : followUpDue.due_on,
    followUpDue.due_time?.slice(0, 5),
  ]
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(todayIso());
    setDuration('');
    setOutcome('spoke');
    setNotes('');
    setFollowUp(false);
    setFollowUpTouched(false);
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

    /*
     * `fromISO`, e a data conferida ANTES de virar texto.
     *
     * Dois defeitos moravam nesta linha, e os dois viravam registro
     * permanente: o texto vai para `contact_notes`, que é a linha do tempo
     * do contato, e nada nesta tela reabre uma nota para corrigir.
     *
     * O DIA ERRADO. `date` é `YYYY-MM-DD` vindo do `DateField`, e
     * `new Date('2026-09-08')` é meia-noite UTC — a oeste de Greenwich isso
     * é o dia anterior. Medido em `America/Sao_Paulo`: escolher 08/09
     * gravava "07/09/2026", e escolher 01/01/2026 gravava "31/12/2025", com
     * o ANO errado. É o mesmo off-by-one que o `lib/calendar.ts` documenta e
     * que o `fromISO` existe para evitar.
     *
     * O "INVALID DATE". Apagar a data é um caminho de dois cliques — o botão
     * Limpar do `DateField` e o texto esvaziado —, e `new Date('')` é uma
     * data inválida, cujo `toLocaleDateString` devolve a string literal
     * "Invalid Date". Ela entrava na nota como se fosse uma data. Agora a
     * gravação para antes: a data é o único fato de que um registro de
     * ligação trata, e uma ligação sem quando não é registro nenhum.
     */
    const dia = fromISO(date);
    if (!dia) {
      setSaving(false);
      toast.error(t('dateRequired'));
      return;
    }

    // One line, in the language of the app, so the note reads as a sentence
    // in the timeline rather than as a form dump.
    const when = dia.toLocaleDateString(APP_LOCALE, {
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
    // A tarefa é secundária à nota: se ela falhar, a ligação continua
    // registrada e o aviso diz o que não aconteceu. O contrário — desfazer
    // a nota porque a tarefa falhou — perderia o fato para salvar o plano.
    if (followUp) {
      const created = await createTask(supabase, accountId, userId, {
        title: t('followUpTaskTitle', {
          name: contact.name || contact.phone,
        }),
        kind: 'call',
        contact_id: contact.id,
        assigned_to: userId,
        due_on: followUpDue.due_on,
        due_time: followUpDue.due_time,
      });
      if (!created) toast.error(t('followUpFailed'));
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
                <ChoiceChip
                  key={value}
                  active={outcome === value}
                  onClick={() => {
                    setOutcome(value);
                    // "Não atendeu" e "retornar depois" SÃO um próximo
                    // passo; "falei" e "caixa postal" não são
                    // necessariamente. Pré-marcar os dois primeiros é a
                    // diferença entre a tarefa existir e alguém lembrar de
                    // criá-la.
                    //
                    // …e por isso o palpite só vale enquanto ninguém tocou
                    // na caixa. Ele rodava nos dois sentidos e sem condição,
                    // então marcar o retorno à mão e depois corrigir o
                    // resultado da ligação DESMARCAVA o retorno, em silêncio.
                    if (!followUpTouched) {
                      setFollowUp(value === 'noAnswer' || value === 'callBack');
                    }
                  }}
                >
                  {t(`outcomes.${value}`)}
                </ChoiceChip>
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

          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={followUp}
              onCheckedChange={(next) => {
                setFollowUpTouched(true);
                setFollowUp(Boolean(next));
              }}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="text-foreground block text-sm">
                {t('followUpLabel')}
              </span>
              <span className="text-muted-foreground text-2xs block leading-relaxed">
                {t('followUpHint', { day: followUpLabel })}
              </span>
            </span>
          </label>
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
