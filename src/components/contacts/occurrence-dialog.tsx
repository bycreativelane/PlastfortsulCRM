'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Inbox, Loader2, Plus } from 'lucide-react';
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
import { StatePanel } from '@/components/ui/state-panel';
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
import { fromISO } from '@/lib/calendar';

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
 * A 042 JÁ FOI APLICADA no banco de `.env.local` — a nota de `kinds.ts`
 * mediu isso, e a barra lateral da caixa de entrada já trata a coluna
 * `contacts.occurrence_count` como existente. Este comentário dizia o
 * contrário, e dois comentários do mesmo assunto discordando é pior que
 * nenhum: o leitor não sabe qual acreditar.
 *
 * O tratamento de tabela ausente FICA, e não por cautela: migrações são
 * aplicadas à mão, um banco por vez, então "aplicada aqui" não diz nada
 * sobre a próxima conta que rodar este build. Quem estiver com o banco
 * atrasado merece "isto depende de uma migração" e não um erro cru — nem
 * um histórico vazio, que parece boa notícia.
 */
export function OccurrenceDialog({
  open,
  onOpenChange,
  contact,
  startAdding,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Abre já no formulário.
   *
   * "Registrar ocorrência" na ficha abria o HISTÓRICO e pedia o mesmo
   * clique de novo, num botão com o texto idêntico — dois cliques com o
   * mesmo rótulo para uma coisa só.
   */
  startAdding?: boolean;
  contact: Contact | null;
  onChanged: () => void;
}) {
  const t = useTranslations('Contacts.occurrences');
  /*
   * `user` para gravar QUEM resolveu.
   *
   * `handled_by` foi defendido linha a linha na migração 042 — inclusive
   * a escolha de apontar para `auth.users(id)` e não para `profiles(id)` —
   * e nasceu sem escritor nenhum. O contexto já expõe o auth user, então
   * não é preciso ir ao `getSession()`.
   */
  const { accountId, user } = useAuth();

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
    setAdding(Boolean(startAdding));
    /*
     * AS LINHAS VOLTAM A SER `null`, e isto é o conserto de um defeito.
     *
     * `load()` é assíncrono. Sem esta linha, abrir o histórico do contato B
     * logo depois de fechar o do contato A mostrava as OCORRÊNCIAS DE A até a
     * consulta voltar — o histórico de problemas de um cliente na ficha de
     * outro, que num CRM é pior do que uma tela em branco.
     *
     * `null` e não `[]`: o componente distingue "ainda carregando" de "não
     * tem nenhuma", e `[]` piscaria "Sem ocorrências registradas" para um
     * contato que tem seis.
     */
    setRows(null);
    setKind(OCCURRENCE_KINDS[0]);
    setOccurredOn(todayIso());
    setDescription('');
    load();
  }, [open, load]);

  async function register() {
    if (!contact || !accountId || !description.trim()) return;
    setSaving(true);
    const { error } = await createClient()
      .from('contact_occurrences')
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        kind,
        occurred_on: occurredOn,
        description: description.trim(),
        status: 'open',
        handled_by: user?.id ?? null,
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
        handled_by: user?.id ?? null,
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
              // O mesmo vazio do irmão desta pasta
              // (`custom-fields-manager.tsx`): sem descrição, sem moldura.
              // Um parágrafo solto e alinhado à esquerda não parecia um
              // estado, parecia um texto que ficou faltando.
              <StatePanel icon={Inbox} title={t('empty')} />
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
                      {/* `fromISO`: `occurred_on` é DATE, e `new Date`
                          sobre ela devolve o dia anterior no Brasil. */}
                      {(
                        fromISO(row.occurred_on) ?? new Date()
                      ).toLocaleDateString(APP_LOCALE, {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                      {/* QUANDO foi resolvida. O `resolved_at` era gravado e
                          nunca lido — e sem ele "Resolvida" não distingue
                          ontem de março. Aqui `new Date()` está certo:
                          `resolved_at` é TIMESTAMPTZ, ao contrário do
                          `occurred_on` logo acima, que é DATE. A CHECK
                          `contact_occurrences_resolved_has_date` garante que
                          toda linha resolvida tem a coluna preenchida. */}
                      {row.status === 'resolved' && row.resolved_at && (
                        <>
                          {' · '}
                          {t('resolvedOn', {
                            date: new Date(row.resolved_at).toLocaleDateString(
                              APP_LOCALE,
                              {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                              }
                            ),
                          })}
                        </>
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
              <OptionSelect id="oc-kind" value={kind} onValueChange={setKind}>
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
                // O formulário abre por causa de um clique que já disse o
                // que a pessoa quer fazer; o cursor tem de estar no campo
                // que ela veio preencher.
                autoFocus
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {/* Cancelar enquanto o formulário está aberto. A única saída
              era "Fechar", que descartava o texto digitado sem dizer que
              descartava. */}
          <Button
            variant="outline"
            onClick={() => (adding ? setAdding(false) : onOpenChange(false))}
          >
            {adding ? t('cancelAdd') : t('close')}
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
