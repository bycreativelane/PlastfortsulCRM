'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
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
  REASON_ICONS,
  useDealOutcome,
} from '@/components/pipelines/deal-outcome';
import { LOSS_REASONS, type LossReason } from '@/lib/deals/outcome';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessHours } from '@/hooks/use-business-hours';
import { localParts } from '@/lib/automations/local-time';
import { DateField } from '@/components/ui/date-field';
import { OptionSelect } from '@/components/ui/option-select';
import { PlaybookChecklist } from './playbook-checklist';
import { TaskList } from '@/components/tasks/task-list';
import { FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

/**
 * Os motivos de perda que ainda sabemos escrever.
 *
 * `noReply` saiu de `LOSS_REASONS` quando o fluxo oficial mandou o cliente
 * que não responde para a Geladeira, e continua no catálogo por causa das
 * perdas antigas. Uma linha gravada com chave fora deste conjunto faria
 * `t()` estourar, então ela simplesmente não é desenhada.
 */
const KNOWN_LOSS_REASONS = new Set<string>([...LOSS_REASONS, 'noReply']);

/**
 * A opção que segura o valor enquanto a lista dele não chegou.
 *
 * O ITEM 12 DO PACOTE, e o mecanismo por trás dele. `OptionSelect` é o
 * `Select` do base-ui: o `Select.Value` resolve o rótulo procurando o valor
 * entre os `items`, e **quando não acha, desenha o valor**. Num campo cujo
 * valor é um UUID, isso é o UUID na cara do vendedor:
 *
 *     Contato    eb8d692a-4f2e-4229-beb0-a2c33985b569
 *
 * — enquanto a lista aberta mostra os nomes certinhos, que foi exatamente o
 * print do pacote. E o caminho é banal: `contactId` vem do `deal` no
 * primeiro render, `contacts` só chega no efeito, então TODA edição desenha
 * um quadro sem nenhuma opção que case.
 *
 * O conserto é uma opção que sempre existe para o valor que existe. O
 * pacote é literal sobre a regra — "nunca mostrar UUID ao usuário como
 * label normal" — e pede o mesmo padrão em qualquer outro select que
 * exponha id interno; aqui são dois, contato e responsável.
 */
function espera(
  id: string,
  lista: { id: string }[],
  rotulo: string
): React.ReactElement | null {
  if (!id || lista.some((item) => item.id === id)) return null;
  return <option value={id}>{rotulo}</option>;
}

/**
 * O ícone do motivo, quando existe um.
 *
 * `noReply` está em `KNOWN_LOSS_REASONS` e não em `REASON_ICONS` — o mapa
 * é indexado por `LossReason`, de onde a chave saiu. Sem esta guarda, uma
 * perda antiga renderizaria `undefined` como componente.
 */
function LossReasonIcon({ reason }: { reason: string }) {
  const Icon = REASON_ICONS[reason as LossReason];
  return Icon ? <Icon className="size-3.5 shrink-0" /> : null;
}

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
  const tMenu = useTranslations('Pipelines.menu');
  // O selo Ganho/Perdido e o motivo da perda falam o mesmo vocabulário do
  // cartão e do diálogo de desfecho. Nenhuma chave nova nos dois.
  const tCard = useTranslations('Pipelines.card');
  const tOutcome = useTranslations('Pipelines.outcome');
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  /*
   * HOJE no fuso da CONTA, para saber se a previsão de fechamento venceu.
   *
   * Cópia literal de `task-list.tsx`, que é o mesmo "hoje" da lista de
   * tarefas renderizada a poucos pixels daqui dentro desta mesma sheet —
   * duas noções de hoje na mesma tela seria o defeito.
   *
   * NÃO é o `todayIso()` de `deal-card.tsx`: aquele é o dia do
   * DISPOSITIVO, e promovê-lo consagraria o segundo hoje.
   */
  const { hours } = useBusinessHours();
  const todayIso = useMemo(
    () => localParts(new Date(), hours.timezone).dateKey,
    [hours.timezone]
  );
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
  /**
   * A lista já respondeu — que não é o mesmo que a lista estar vazia.
   *
   * A distinção é o item 12 do pacote inteiro: sem ela, "ainda não carregou"
   * e "não existe" dão a mesma resposta, e o `OptionSelect` desenha o valor
   * cru quando não acha uma opção para ele. Era o mesmo defeito do item 30,
   * que foi corrigido no seletor de etapa com uma flag igual a esta.
   */
  const [listsLoaded, setListsLoaded] = useState(false);
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
      setListsLoaded(true);
    })();
    return () => {
      cancelled = true;
      setListsLoaded(false);
    };
  }, [open, supabase]);

  /**
   * O contato desta oportunidade, quando ele não veio na lista.
   *
   * O SEGUNDO FLANCO DO ITEM 12, e o pior dos dois. A consulta acima não
   * tem `limit`, o que não quer dizer "todos": quer dizer o teto do
   * PostgREST. Numa base que passe dele, o contato de uma oportunidade
   * antiga simplesmente não está entre as opções — e aí não é um quadro de
   * UUID no começo, é UUID **para sempre**, naquela ficha, toda vez que
   * alguém a abrir.
   *
   * Uma consulta a mais, só quando falta, e ela vem por id. O contato entra
   * na lista como qualquer outro: o `<option>` sai do mesmo `map`, então
   * nada mais no formulário precisa saber que ele chegou por outro caminho.
   */
  useEffect(() => {
    if (!open || !listsLoaded || !contactId) return;
    if (contacts.some((c) => c.id === contactId)) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .maybeSingle();
      if (cancelled || !data) return;
      setContacts((atuais) =>
        atuais.some((c) => c.id === data.id)
          ? atuais
          : [...atuais, data as Contact]
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, listsLoaded, contactId, contacts, supabase]);

  // A conversa do contato — UMA só, pela UNIQUE (account_id, contact_id)
  // da migração 036; o argumento está escrito em `lib/inbox/conversations`.
  // NÃO filtra status de propósito: uma thread encerrada continua sendo a
  // thread deste contato, e escondê-la deixaria o link sem destino. O
  // `.order()/.limit(1)` é vestigial, e fica como cinto de segurança para
  // bancos anteriores à 036.
  //
  // (Este comentário dizia "newest OPEN one", que a consulta nunca fez.)
  //
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

  // The lines decide the value when there are lines. The trigger in 054 does
  // this again server-side — this is only so the row is right in the same
  // statement rather than a beat later, which is what the board reads when it
  // refreshes.
  const lineTotalSum = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const hasLines = items.length > 0;

  /**
   * Grava o que está no formulário. Devolve `false` quando não deu.
   *
   * Separado do `handleSave` porque o DESFECHO também precisa dele: marcar
   * como ganho tem de levar junto o que a pessoa acabou de digitar. Com
   * `silent`, não avisa nem fecha a ficha — quem chamou continua a conversa.
   */
  async function persist({ silent = false } = {}): Promise<boolean> {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t('toastRequired'));
      return false;
    }
    setSaving(true);

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
        return false;
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
        return false;
      }
      if (!accountId) {
        toast.error(t('toastNotLinked'));
        setSaving(false);
        return false;
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
        return false;
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
    if (!silent) {
      toast.success(deal ? t('toastUpdated') : t('toastCreated'));
      onOpenChange(false);
      onSaved();
    }
    return true;
  }

  async function handleSave() {
    await persist();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;

    /*
     * O QUE ESTÁ NO FORMULÁRIO É GRAVADO ANTES.
     *
     * Este caminho escrevia só `{ status }` e fechava a ficha. Quem corrigia
     * o valor para R$ 12.000 e clicava em "Marcar como ganho" perdia a
     * correção em silêncio: o negócio virava ganho pelo valor velho — e é
     * exatamente na hora de fechar que alguém arruma o número.
     *
     * A ordem importa. Gravar PRIMEIRO e só então pedir o desfecho, porque o
     * portão lê o valor do negócio para decidir se pergunta; lendo a versão
     * antiga, ele pergunta o que a pessoa acabou de responder no campo ao
     * lado.
     */
    if (!(await persist({ silent: true }))) return;

    // Won and lost go through the gates: a sale with no value and a loss
    // with no reason are the two records nobody can reconstruct afterwards.
    // `request` returns true when it took the move; reopening never gates.
    if (status !== 'open') {
      const gated = outcome.request(
        // O negócio COM o que acabou de ser gravado. `deal` é a prop, e ela
        // só é reidratada no próximo `onSaved()`.
        { ...deal, value: hasLines ? lineTotalSum : (value ?? 0) },
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

          {/*
            A FRASE, e nao so os campos cinzas.

            Dez controles ficam `disabled` para quem so le, e uma ficha
            inteira apagada sem explicacao le como defeito. O motivo mora no
            `Pipelines.menu.readOnly`, que o menu de contexto do quadro ja
            usa — a mesma frase para a mesma recusa.
          */}
          {!canWrite && (
            <p className="text-muted-foreground border-border bg-muted mx-4 mt-3 rounded-lg border px-3 py-2 text-xs">
              {tMenu('readOnly')}
            </p>
          )}

          {/* `overflow-y-auto` alone computes `overflow-x` to `auto` as
              well, so anything a pixel too wide inside adds a horizontal
              scrollbar across the bottom of the form. Nothing in a
              single-column form should ever scroll sideways. */}
          <div className="@container flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-4">
            <div className="grid gap-2">
              <FieldLabel htmlFor="deal-title">{t('title')}</FieldLabel>
              <Input
                id="deal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                disabled={!canWrite}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <FieldLabel htmlFor="deal-contact">{t('contact')}</FieldLabel>
              <OptionSelect
                id="deal-contact"
                value={contactId}
                onValueChange={setContactId}
                disabled={!canWrite}
                className="border-border bg-muted text-foreground"
              >
                <option value="">{t('selectContact')}</option>
                {espera(contactId, contacts, t('loadingLists'))}
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </OptionSelect>

              {linkedConversation && (
                /*
                 * O LINK LEVA À CONVERSA, e não à caixa de entrada.
                 *
                 * Era `href="/inbox"` seco: um link que diz "abrir a conversa
                 * deste negócio" e larga a pessoa na lista, para procurar à
                 * mão a conversa que o próprio link acabou de identificar.
                 *
                 * O resto do app já faz certo em cinco lugares, incluindo o
                 * menu de contexto DESTE MESMO cartão — clicar com o botão
                 * direito chegava na conversa e clicar no link dentro da
                 * ficha não. A linha inteira já está carregada aqui.
                 */
                <Link
                  href={`/inbox?c=${linkedConversation.id}`}
                  // `w-fit`, e não `self-start`. O pai é uma GRADE: ali
                  // `self-start` alinha no eixo do bloco e não encolhe a
                  // largura, então o link esticava de ponta a ponta e virava
                  // uma faixa azul de largura cheia — lia como aviso, não
                  // como link. `justify-self-start` também serviria; `w-fit`
                  // vale em grade e em flex, que é o que sobrevive a mexer
                  // no pai.
                  className="bg-primary/10 text-primary hover:bg-primary/20 mt-1 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs"
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
                  <FieldLabel htmlFor="deal-value">{t('value')}</FieldLabel>
                  {/* Read-only once there are lines. The number is what
                      they add up to, and a field somebody can type over
                      an arithmetic result is a field that makes the
                      total a lie again — which is the whole thing line
                      items were added to stop. */}
                  <CurrencyInput
                    id="deal-value"
                    value={
                      items.length > 0
                        ? items.reduce((sum, i) => sum + lineTotal(i), 0)
                        : value
                    }
                    onValueChange={setValue}
                    currency={currency}
                    placeholder="0"
                    disabled={!canWrite || items.length > 0}
                    className="border-border bg-muted text-foreground"
                  />
                  {items.length > 0 ? (
                    <p className="text-muted-foreground text-2xs">
                      {t('valueFromItems')}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="deal-currency">
                    {t('currency')}
                  </FieldLabel>
                  <OptionSelect
                    id="deal-currency"
                    value={currency}
                    onValueChange={setCurrency}
                    disabled={!canWrite}
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
                {/* O SELO AO LADO DO RÓTULO, e não pendurado sob o campo.

                    Era eu quem tinha posto embaixo, e ele ficava órfão: uma
                    pílula vermelha sozinha entre campos cinzas, sem encostar
                    no que qualifica — e a coisa mais pesada da linha, para
                    dizer uma informação, não um alarme.

                    Pior: dentro de uma GRADE de duas colunas, ele crescia
                    só a célula da direita. A linha inteira acompanhava, e a
                    coluna da esquerda (Valor/Moeda) ficava com um buraco
                    embaixo que não existia do outro lado.

                    O diálogo de tarefa já resolve isto do jeito certo, com
                    o "Atrasada" colado no rótulo "Prazo". Duas telas dizendo
                    a mesma coisa de duas formas era a divergência. */}
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor="deal-close-date" className="mb-0">
                    {t('expectedCloseDate')}
                  </FieldLabel>
                  {deal?.status === 'open' &&
                    expectedCloseDate &&
                    expectedCloseDate < todayIso && (
                      <StatusBadge variant="danger" size="sm">
                        {t('expectedCloseOverdue')}
                      </StatusBadge>
                    )}
                </div>
                <DateField
                  id="deal-close-date"
                  value={expectedCloseDate}
                  onValueChange={setExpectedCloseDate}
                  disabled={!canWrite}
                  className="[&_input]:border-border [&_input]:bg-muted [&_input]:text-foreground"
                />
              </div>
            </div>

            {/* `@lg`, o MESMO da linha acima. Eram dois limiares para duas
                linhas que se leem como uma grade só: entre 24rem e 32rem de
                gaveta, Etapa/Responsável já estavam lado a lado enquanto
                Valor/Moeda/Previsão ainda estavam empilhados, e as colunas
                do formulário deixavam de se alinhar nessa faixa. */}
            <div className="grid gap-4 @lg:grid-cols-2">
              <div className="grid gap-2">
                <FieldLabel htmlFor="deal-stage">{t('stage')}</FieldLabel>
                <OptionSelect
                  id="deal-stage"
                  value={stageId}
                  onValueChange={setStageId}
                  disabled={!canWrite}
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
                <FieldLabel htmlFor="deal-assignee">
                  {t('assignedTo')}
                </FieldLabel>
                <OptionSelect
                  id="deal-assignee"
                  value={assignedTo}
                  onValueChange={setAssignedTo}
                  disabled={!canWrite}
                  className="border-border bg-muted text-foreground"
                >
                  <option value="">{t('unassigned')}</option>
                  {espera(assignedTo, profiles, t('loadingLists'))}
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
              <FieldLabel htmlFor="deal-notes">{t('notes')}</FieldLabel>
              <Textarea
                id="deal-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('notesPlaceholder')}
                disabled={!canWrite}
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

            {/* As tarefas desta oportunidade, logo abaixo do roteiro da
                etapa — e a distinção entre as duas é o que justifica as
                duas existirem. O roteiro é o que SEMPRE se faz nesta etapa,
                igual para toda oportunidade que passa por ela; a tarefa é o
                que se combinou com ESTA pessoa, com dia, hora e dono.
                Só numa oportunidade que já existe: uma tarefa precisa de um
                `deal_id` para pendurar. */}
            {deal && (
              <TaskList
                target={{ deal_id: deal.id, contact_id: deal.contact_id }}
              />
            )}

            {deal && (
              <div className="border-border bg-muted/50 space-y-2 rounded-lg border p-3">
                {/* O DESFECHO EM PALAVRA.

                    A ficha dizia "ganho" e "perdido" só desabilitando
                    botões — que é o mesmo desenho de "você não pode
                    editar". Nada quando aberto: o estado normal não é
                    notícia. Mesmo par que o cartão do quadro desenha. */}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-muted-foreground eyebrow">{t('status')}</p>
                  {deal.status && deal.status !== 'open' && (
                    <StatusBadge
                      variant={deal.status === 'won' ? 'ok' : 'danger'}
                      size="sm"
                    >
                      {tCard(deal.status === 'won' ? 'won' : 'lost')}
                    </StatusBadge>
                  )}
                </div>

                {/* O MOTIVO DA PERDA.

                    Marcar como perdido EXIGE um motivo, e ele não
                    aparecia depois em superfície nenhuma do produto — nem
                    aqui, nem no cartão, nem em relatório. Um campo
                    obrigatório que ninguém relê é um formulário cobrando
                    trabalho que não usa.

                    O guard existe porque `noReply` saiu de `LOSS_REASONS`
                    com o fluxo oficial e segue no catálogo, justamente
                    para as perdas antigas: sem ele uma linha com chave
                    desconhecida faz `t()` estourar. O ícone dessa mesma
                    chave não existe mais, e por isso é opcional. */}
                {deal.status === 'lost' &&
                  (deal.lost_reason || deal.lost_note) && (
                    <div className="text-secondary-foreground space-y-1 text-xs">
                      {deal.lost_reason &&
                        KNOWN_LOSS_REASONS.has(deal.lost_reason) && (
                          <span className="flex items-center gap-1.5">
                            <LossReasonIcon reason={deal.lost_reason} />
                            {tOutcome(`reasons.${deal.lost_reason}`)}
                          </span>
                        )}
                      {deal.lost_note && (
                        <p className="text-muted-foreground whitespace-pre-wrap">
                          {deal.lost_note}
                        </p>
                      )}
                    </div>
                  )}
                {/*
                  UMA LINHA, e não três barras de largura cheia.

                  Eram três botões esticados e empilhados — verde, vermelho e
                  o de reabrir — num bloco que a pessoa abre para ver o
                  negócio, não para encerrá-lo. Dois retângulos tingidos de
                  ponta a ponta são a coisa mais pesada da gaveta, para uma
                  decisão que se toma uma vez na vida do negócio.

                  A NOTA ANTIGA ESTAVA CERTA E RESOLVIA O SINTOMA ERRADO. Ela
                  dizia que "Marcar como perdido" não cabe em meia coluna,
                  porque o `Button` é `whitespace-nowrap`, e concluía que a
                  saída era empilhar em largura cheia. A saída era o RÓTULO:
                  sob uma sobrancelha que já diz SITUAÇÃO, e com o ✓ e o ✕ ao
                  lado, "Ganho" e "Perdido" dizem a mesma coisa em um quarto
                  do espaço. São as chaves que o cartão do quadro já usa —
                  nenhuma nova, e o mesmo vocabulário nas duas superfícies.

                  `flex-wrap` responde ao medo original sem largura cheia: se
                  a gaveta apertar, eles quebram para a linha de baixo em vez
                  de vazar. `size="sm"` os põe na altura de ação secundária,
                  que é o que eles são ao lado do Salvar.
                */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    // Verde tingido, e não azul cheio. Ganho e perdido são
                    // duas saídas simétricas; com um azul sólido ao lado de
                    // um vermelho tingido, o par lia como ação principal e
                    // secundária — e o azul cheio disputava com o Salvar,
                    // que é o único "aperte aqui" desta sheet.
                    variant="ok"
                    onClick={() => handleStatusChange('won')}
                    disabled={
                      !canWrite || !!statusAction || deal.status === 'won'
                    }
                  >
                    {statusAction === 'won' ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Check />
                    )}
                    {tCard('won')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => handleStatusChange('lost')}
                    disabled={
                      !canWrite || !!statusAction || deal.status === 'lost'
                    }
                  >
                    {statusAction === 'lost' ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <X />
                    )}
                    {tCard('lost')}
                  </Button>
                  {deal.status && deal.status !== 'open' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleStatusChange('open')}
                      disabled={!canWrite || !!statusAction}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {t('reopenDeal')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-border/50 bg-popover/80 border-t p-4">
            {/* LARGURA NATURAL, à direita — o mesmo rodapé do diálogo de
                tarefa. Os dois eram `flex-1`, então dividiam a gaveta ao
                meio: um "Cancelar" de 330px ao lado de um "Salvar" de
                330px, com o mesmo peso visual e nenhuma hierarquia. */}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted bg-transparent"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  !canWrite || saving || !title.trim() || !contactId || !stageId
                }
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
                  // `w-full` NUM BOTÃO QUE EXCLUI. Ele ficava com a largura
                  // inteira da gaveta, logo abaixo do Salvar e com o mesmo
                  // tamanho dele — o alvo mais fácil do rodapé era a ação
                  // sem volta. Mesmo conserto do diálogo de tarefa, que já
                  // passou por aqui: largura natural, encostado à esquerda.
                  //
                  // A faixa de confirmação acima continua ocupando a largura
                  // toda, e ali está certo: ela é um aviso, não um alvo.
                  className="text-muted-foreground hover:text-destructive mt-3 self-start font-semibold"
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
