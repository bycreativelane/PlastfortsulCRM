'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { formatCurrencyExact } from '@/lib/currency';
import {
  lineTotal,
  replaceDealItems,
  type DealItemDraft,
} from '@/lib/products/catalog';
import { DealItemsEditor } from './deal-items';
import { DealInstallments } from './deal-installments';
import {
  loadInstallments,
  replaceInstallments,
  type InstallmentDraft,
} from '@/lib/deals/installments';
import { loadLastOrderNumber, nextOrderNumber } from '@/lib/deals/order-number';
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
import {
  LOSS_REASONS,
  entryStage,
  isLostStage,
  isWonStage,
  type LossReason,
} from '@/lib/deals/outcome';
import { StatusBadge } from '@/components/ui/status-badge';
import { OptionSelect } from '@/components/ui/option-select';
import { useBusinessHours } from '@/hooks/use-business-hours';
import { localParts } from '@/lib/automations/local-time';
import { buildQuote } from '@/lib/quotes/quote';
import { brandFromAccount } from '@/lib/quotes/brand';
import { DealQuote } from './deal-quote';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { PlaybookChecklist } from './playbook-checklist';
import { TaskList } from '@/components/tasks/task-list';
import { FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  FileText,
  Loader2,
} from 'lucide-react';
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
 * Os dois estados de transporte que não são uma transportadora.
 *
 * Item 48, literal: "permitir também estados como Cliente retira, A
 * definir". Chaves do catálogo e não literais, porque o que vai para a
 * coluna é o texto que a pessoa vê — e o orçamento imprime esse texto.
 */
const CARRIER_STATES = ['carrierPickup', 'carrierTbd'] as const;

/**
 * "Frete por conta", com as opções do Bling.
 *
 * São seis códigos de domínio de lá — 0 CIF, 1 FOB, 2 terceiros, 3 e 4
 * próprio, 9 sem frete. O que vai para a coluna é o TEXTO, e não o
 * número, pela mesma razão escrita na 075: um código sozinho não se lê,
 * e o documento imprime o que está guardado.
 *
 * A lista é fechada porque esta, ao contrário do transportador e da forma
 * de pagamento, é um padrão fiscal e não um cadastro da conta.
 */
const FREIGHT_MODES = [
  'freightCif',
  'freightFob',
  'freightThird',
  'freightOwnSender',
  'freightOwnReceiver',
  'freightNone',
] as const;

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
  const tQuote = useTranslations('Quote');
  const supabase = createClient();
  const { account, accountId, defaultCurrency, user } = useAuth();

  /*
   * O "hoje" da conta saiu junto com a Previsão de fechamento.
   *
   * Ele existia para uma coisa só: saber se a data de fechamento tinha
   * vencido, e desenhar o selo "Prazo vencido" ao lado do rótulo. O item
   * 41 tirou o campo da interface, e um relógio sem nada para medir é
   * peso morto — `useBusinessHours` é uma consulta por abertura da
   * gaveta.
   *
   * A `expected_close_date` continua no banco e continua sendo gravada
   * (item 59). Se ela voltar para a tela, o padrão está em
   * `task-list.tsx`, que é de onde este veio.
   */
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

  /**
   * A data que o orçamento carimba: hoje, no fuso da CONTA.
   *
   * `localParts` e não `toISOString().slice(0, 10)`: meia-noite UTC é o
   * dia anterior a oeste de Greenwich, e um orçamento datado de ontem é
   * a única data que ninguém consegue explicar ao cliente. É a mesma
   * razão do topo de `lib/calendar.ts`.
   */
  const { hours } = useBusinessHours();
  const hojeIso = useMemo(
    () => localParts(new Date(), hours.timezone).dateKey,
    [hours.timezone]
  );

  /**
   * O TÍTULO NÃO É MAIS UM CAMPO, e continua sendo uma coluna.
   *
   * Item 39: o que a pessoa preenche aqui é o PEDIDO DE VENDA, o número
   * que a operação controla no Bling. `deals.title` é NOT NULL desde a
   * 001, então ele continua existindo — preenchido do jeito que a
   * automação já preenche desde a correção do item 3, com o nome do
   * contato. Ver `tituloDerivado` abaixo.
   */
  const [salesOrder, setSalesOrder] = useState('');
  /** A prévia do orçamento (item 51). Não grava nada — só desenha. */
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [value, setValue] = useState<number | null>(null);
  /** Frete, separado dos produtos (item 47). `null` é 'não definido'. */
  const [shipping, setShipping] = useState<number | null>(null);
  /** Transportadora, ou um dos dois estados do item 48. */
  const [carrier, setCarrier] = useState('');
  /**
   * The opportunity's line items (spec §10, migration 054).
   *
   * Held here rather than inside the editor because they are saved
   * AFTER the deal exists — on a new deal there is no id to attach them
   * to until the insert returns one.
   */
  const [items, setItems] = useState<DealItemDraft[]>([]);
  const [itemsPending, setItemsPending] = useState(false);
  /**
   * CONDIÇÃO DE PAGAMENTO e as parcelas que ela descreve (075).
   *
   * As duas coisas, e não uma: o atalho é o que a pessoa digita e o que o
   * Bling vai querer de volta; as parcelas são linhas editáveis. O
   * argumento inteiro está no topo de `lib/deals/installments.ts`.
   */
  const [paymentTerms, setPaymentTerms] = useState('');
  const [installments, setInstallments] = useState<InstallmentDraft[]>([]);
  /** A 075 ainda não rodou — o bloco inteiro não é desenhado. */
  const [installmentsPending, setInstallmentsPending] = useState(false);
  /** Transporte, o resto do que a transportadora pergunta (075). */
  const [freightMode, setFreightMode] = useState('');
  const [freightVolumes, setFreightVolumes] = useState<number | null>(null);
  const [grossWeight, setGrossWeight] = useState<number | null>(null);
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
      setSalesOrder(deal.sales_order_number ?? '');
      setValue(deal.value ?? null);
      setShipping(deal.shipping_cost ?? null);
      setCarrier(deal.carrier ?? '');
      setPaymentTerms(deal.payment_terms ?? '');
      setFreightMode(deal.freight_mode ?? '');
      setFreightVolumes(deal.freight_volumes ?? null);
      setGrossWeight(deal.gross_weight ?? null);
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? '');
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? '');
      setExpectedCloseDate(deal.expected_close_date ?? '');
      setNotes(deal.notes ?? '');
    } else {
      setSalesOrder('');
      setValue(null);
      setShipping(null);
      setCarrier('');
      setPaymentTerms('');
      setInstallments([]);
      setFreightMode('');
      setFreightVolumes(null);
      setGrossWeight(null);
      setCurrency(defaultCurrency);
      setContactId(defaultContactId ?? '');
      /*
       * EM ABERTO, SEM PERGUNTAR — pedido do Gabriel de 8 de setembro:
       * "se estamos criando oportunidade já vai automático para em
       * aberto, não precisa escolher". No Bling é a situação padrão de
       * todo pedido novo, e ninguém a escolhe.
       *
       * `defaultStageId` ainda ganha, e tem de ganhar: ele vem do "+" de
       * uma COLUNA do quadro, quer dizer, de alguém que já apontou para
       * onde quer. `entryStage` só decide quando ninguém apontou.
       */
      setStageId(defaultStageId || entryStage(stages)?.id || '');
      setAssignedTo('');
      setExpectedCloseDate('');
      setNotes('');
    }
  }, [open, deal, defaultStageId, defaultContactId, stages, defaultCurrency]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * As parcelas desta oportunidade.
   *
   * Separado do efeito de reidratação acima porque elas moram em OUTRA
   * tabela — `deals` não as traz junto, e uma consulta a mais só quando a
   * gaveta abre é o mesmo custo que o editor de produtos já paga.
   */
  useEffect(() => {
    if (!open || !deal?.id) return;
    let cancelled = false;
    void loadInstallments(supabase, deal.id).then((r) => {
      if (cancelled) return;
      if (r === 'missing-table') {
        setInstallmentsPending(true);
        return;
      }
      setInstallmentsPending(false);
      setInstallments(
        r.map((linha) => ({
          days: Number(linha.days),
          dueOn: linha.due_on,
          amount: Number(linha.amount),
          method: linha.method,
          note: linha.note,
        }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, deal?.id, supabase]);

  /**
   * O PRÓXIMO NÚMERO DE PEDIDO, num negócio novo.
   *
   * "pedido de venda puxando do último que foi criado" — e é uma
   * SUGESTÃO: quem numera de verdade é o Bling, do outro lado, e este CRM
   * não controla aquela sequência. Por isso ela é digitável por cima e
   * some em silêncio quando não dá para adivinhar.
   *
   * Só ao criar. Numa oportunidade que já existe, o número dela é o
   * número dela.
   */
  useEffect(() => {
    if (!open || deal || !accountId) return;
    let cancelled = false;
    void loadLastOrderNumber(supabase, accountId).then((ultimo) => {
      const sugestao = nextOrderNumber(ultimo);
      if (cancelled || !sugestao) return;
      // Não escreve por cima de quem já começou a digitar: a consulta
      // volta depois do primeiro quadro, e apagar o que a pessoa digitou
      // enquanto ela esperava seria pior do que não sugerir nada.
      setSalesOrder((atual) => (atual === '' ? sugestao : atual));
    });
    return () => {
      cancelled = true;
    };
  }, [open, deal, accountId, supabase]);

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
  /** Produtos + frete, que é o que o item 47 manda o orçamento mostrar. */
  const produtos = hasLines ? lineTotalSum : (value ?? 0);
  const totalGeral = produtos + (shipping ?? 0);

  /**
   * O que vai em `deals.title` agora que ele não é mais um campo.
   *
   * A MESMA REGRA DO MOTOR, de propósito: `resolveDealTitle` usa o nome
   * do contato e cai no telefone, e nunca num UUID. Duas regras para o
   * mesmo campo — uma para a oportunidade que a automação abre e outra
   * para a que o vendedor abre — seriam duas listas de negócio com
   * nomes diferentes na mesma coluna do Kanban.
   *
   * Editando, o título que já existe é preservado: ele pode ter sido
   * escrito à mão antes de o item 39 mudar esta tela, e reescrevê-lo
   * seria apagar o que alguém digitou por causa de um redesenho.
   */
  const contatoAtual = contacts.find((c) => c.id === contactId);

  /**
   * O orçamento a partir do que está NA TELA, e não do que está gravado.
   *
   * Item 51: "conseguir montar o documento a partir dos dados já
   * preenchidos na oportunidade". Preenchidos, não salvos — quem acabou
   * de digitar o frete quer ver o documento com ele, e mandar salvar
   * antes de olhar seria o formulário cobrando um passo para mostrar
   * uma prévia.
   *
   * A conta é feita uma vez, em `buildQuote`, e o desenho não soma nada
   * — a condição que o item 55 impõe para as duas saídas do documento.
   */
  const orcamento = buildQuote({
    orderNumber: salesOrder,
    issuedOn: hojeIso,
    company: account?.name,
    customerName: contatoAtual?.name || contatoAtual?.phone,
    customerCompany: contatoAtual?.company,
    customerPhone: contatoAtual?.phone,
    items,
    value,
    currency,
    shipping,
    paymentTerms,
    installments,
    carrier,
    freightMode: freightMode ? t(freightMode) : null,
    freightVolumes,
    grossWeight,
    owner: profiles.find((pf) => pf.id === assignedTo)?.full_name,
    notes,
  });
  const tituloDerivado =
    deal?.title?.trim() ||
    contatoAtual?.name?.trim() ||
    contatoAtual?.phone?.trim() ||
    t('newDeal');

  /**
   * Grava o que está no formulário. Devolve `false` quando não deu.
   *
   * Separado do `handleSave` porque o DESFECHO também precisa dele: marcar
   * como ganho tem de levar junto o que a pessoa acabou de digitar. Com
   * `silent`, não avisa nem fecha a ficha — quem chamou continua a conversa.
   */
  async function persist({ silent = false } = {}): Promise<boolean> {
    // O título saiu da lista de obrigatórios porque saiu da tela: quem
    // o preenche agora é `tituloDerivado`, e ele nunca é vazio quando
    // há contato. Contato e etapa continuam sendo o mínimo.
    if (!contactId || !stageId) {
      toast.error(t('toastRequired'));
      return false;
    }
    setSaving(true);

    const payload = {
      title: tituloDerivado,
      sales_order_number: salesOrder.trim() || null,
      value: hasLines ? lineTotalSum : (value ?? 0),
      shipping_cost: shipping,
      carrier: carrier.trim() || null,
      // A CHAVE, e não o rótulo traduzido: `freight_mode` é código de
      // domínio de outro sistema, e guardar "Frete por conta do
      // remetente" faria a coluna mudar de conteúdo com o idioma da
      // interface. O documento traduz na hora de imprimir.
      freight_mode: freightMode || null,
      freight_volumes: freightVolumes,
      gross_weight: grossWeight,
      payment_terms: paymentTerms.trim() || null,
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
      if (!installmentsPending && accountId) {
        const { error: erroParcelas } = await replaceInstallments(supabase, {
          accountId,
          dealId: deal.id,
          items: installments,
        });
        if (erroParcelas) toast.error(t('toastInstallmentsFailed'));
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
      const novoId = (created as { id: string }).id;
      if (!itemsPending && items.length > 0) {
        const { error: itemsError } = await replaceDealItems(supabase, {
          accountId,
          dealId: novoId,
          items,
        });
        if (itemsError) toast.error(t('toastItemsFailed'));
      }
      if (!installmentsPending && installments.length > 0) {
        const { error: erroParcelas } = await replaceInstallments(supabase, {
          accountId,
          dealId: novoId,
          items: installments,
        });
        if (erroParcelas) toast.error(t('toastInstallmentsFailed'));
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

  /**
   * PARA ONDE O DESFECHO MANDA A OPORTUNIDADE.
   *
   * Marcar Ganho gravava `{ status }` e mais nada. O cartão continuava na
   * coluna em que estava — um negócio "Ganho" parado em Em Negociação, no
   * quadro, para sempre. Ganho e perdido ficavam MARCADOS e não
   * ENCAMINHADOS, que foi como o Gabriel descreveu.
   *
   * E o custo maior não está no quadro. As automações do funil cancelam
   * por `cancel_when_stage_in`, quer dizer, ao ENTRAR na etapa Venda
   * Perdida — não pelo `status`. Uma perda marcada por aqui deixava o
   * follow-up de pé: D1, D2, D3 e D30 seguiam saindo para um cliente que
   * a empresa já tinha dado como perdido.
   *
   * O quadro sempre fez certo: arrastar para a coluna passa o DESTINO ao
   * portão, que grava `stage_id` junto com o status. Esta gaveta passava
   * a etapa ATUAL, e escrever a etapa em que já se está é não escrever
   * nada. A assimetria era entre dois caminhos para a mesma decisão.
   *
   * Devolve `null` — e nada se move — em três casos: reabrir (para onde?),
   * já estar numa etapa de desfecho (marcar Ganho em Atendido não pode
   * puxar de volta para Em Andamento), e o funil não ter a etapa. Este
   * último não é hipotético: quem monta o quadro à mão escolhe os nomes,
   * e inventar um destino seria pior do que não mover.
   */
  function outcomeStage(status: DealStatus): PipelineStage | null {
    const atual = stages.find((st) => st.id === stageId) ?? null;
    if (status === 'won') {
      if (atual && isWonStage(atual.name)) return null;
      return stages.find((st) => isWonStage(st.name)) ?? null;
    }
    if (status === 'lost') {
      if (atual && isLostStage(atual.name)) return null;
      return stages.find((st) => isLostStage(st.name)) ?? null;
    }
    return null;
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

    const destino = outcomeStage(status);

    // Won and lost go through the gates: a sale with no value and a loss
    // with no reason are the two records nobody can reconstruct afterwards.
    // `request` returns true when it took the move; reopening never gates.
    if (status !== 'open') {
      const gated = outcome.request(
        // O negócio COM o que acabou de ser gravado. `deal` é a prop, e ela
        // só é reidratada no próximo `onSaved()`.
        { ...deal, value: hasLines ? lineTotalSum : (value ?? 0) },
        // O DESTINO. Era a etapa atual, e o portão grava
        // `stage_id = pending.stage.id` — quer dizer, gravava a etapa em que
        // a oportunidade já estava.
        destino,
        status
      );
      if (gated) return;
    }

    setStatusAction(status);
    // Sem portão — um ganho que já tem valor não pergunta nada — e mesmo
    // assim a etapa tem de andar. Este era o segundo caminho pelo qual um
    // negócio ganho ficava parado na coluna de negociação.
    const { error } = await supabase
      .from('deals')
      .update(destino ? { status, stage_id: destino.id } : { status })
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
            {/*
              A ORDEM DESTA GAVETA É A DO PEDIDO DE VENDA DO BLING.

              Pedido do Gabriel em 8 de setembro de 2026, com quatro prints
              do Bling ao lado da gaveta antiga, e ele terminou a lista com
              "nesta ordem":

                  pedido de venda → cliente e, do lado, o responsável →
                  produto com descrição, quantidade, preço e preço total →
                  condição de pagamento → transportadora, quantidade, peso
                  bruto e valor do frete

              A ordem não é gosto: é a sequência em que a operação já
              preenche o pedido do outro lado. Enquanto a integração não
              existe (item 59 do pacote a proíbe agora), alguém vai
              transcrever esta tela naquela — e transcrever fora de ordem é
              onde se troca um campo por outro.

              O QUE MUDOU DE LUGAR em relação à versão do item 44:
              o Responsável subiu para o lado do Cliente (no Bling ele é o
              VENDEDOR do pedido, e é a segunda parte do negócio, não uma
              assinatura de rodapé); o Frete desceu para o bloco de
              transporte, junto do que ele paga; e a Etapa saiu da criação
              — ver o bloco dela lá embaixo.
            */}

            {/*
              PEDIDO DE VENDA, e não "Título" — item 39.

              É o número que a operação já controla no Bling (14349), e nesta
              fase ele é digitado à mão; a integração é etapa futura e o item
              58 pede explicitamente que ela NÃO entre agora.

              O campo antigo dizia "Título da oportunidade" e não recebia
              nada útil: desde a correção do item 3 o título é preenchido
              por automação com o nome do contato, e desde o item 17 é assim
              que toda oportunidade nasce. Um campo cujo valor é sempre o
              nome que está no campo de baixo não é um campo.

              Opcional de propósito: a oportunidade existe antes do pedido.
              Ela nasce no primeiro "oi" e só ganha número quando alguém
              monta o orçamento. Num negócio NOVO ele já vem com o próximo
              número da sequência — "puxando do último que foi criado" —, e
              isso é uma sugestão digitável por cima: quem numera de verdade
              é o Bling, e o comentário de `lib/deals/order-number.ts` diz
              por que este CRM não pode fingir que numera.
            */}
            <div className="grid gap-2">
              <FieldLabel htmlFor="deal-order">{t('salesOrder')}</FieldLabel>
              <Input
                id="deal-order"
                value={salesOrder}
                onChange={(e) => setSalesOrder(e.target.value)}
                placeholder={t('salesOrderPlaceholder')}
                inputMode="numeric"
                disabled={!canWrite}
                className="border-border bg-muted text-foreground"
              />
            </div>

            {/*
              CLIENTE E, DO LADO, O RESPONSÁVEL.

              As duas partes do negócio na mesma linha, como no pedido de
              venda. `@lg`, o mesmo ponto de virada das outras duplas desta
              gaveta: abaixo dele a sheet tem 24rem e dois selects lado a
              lado viram dois campos de 11rem com nomes cortados.
            */}
            <div className="grid gap-4 @lg:grid-cols-2">
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
                   * Era `href="/inbox"` seco: um link que diz "abrir a
                   * conversa deste negócio" e larga a pessoa na lista, para
                   * procurar à mão a conversa que o próprio link acabou de
                   * identificar.
                   *
                   * O resto do app já faz certo em cinco lugares, incluindo
                   * o menu de contexto DESTE MESMO cartão — clicar com o
                   * botão direito chegava na conversa e clicar no link
                   * dentro da ficha não. A linha inteira já está carregada
                   * aqui.
                   */
                  <Link
                    href={`/inbox?c=${linkedConversation.id}`}
                    // `w-fit`, e não `self-start`. O pai é uma GRADE: ali
                    // `self-start` alinha no eixo do bloco e não encolhe a
                    // largura, então o link esticava de ponta a ponta e
                    // virava uma faixa azul de largura cheia — lia como
                    // aviso, não como link. `justify-self-start` também
                    // serviria; `w-fit` vale em grade e em flex, que é o
                    // que sobrevive a mexer no pai.
                    className="bg-primary/10 text-primary hover:bg-primary/20 mt-1 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                  >
                    <MessageSquare className="h-3 w-3" />
                    {t('linkToConversation')}
                  </Link>
                )}
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

            {/*
              PRODUTO — itens 43, 44, 45 e 46, e eles se resolvem juntos.

              O item 43 manda remover "O que tem nesta oportunidade" e
              "Adicionar linha"; o 45 manda criar um campo Produto que
              reutilize os produtos cadastrados e guarde produto, SKU,
              quantidade, valor unitário e subtotal; o 46 manda o Valor sair
              dos itens. Lidos juntos, o 45 pede coluna por coluna o que o 43
              manda apagar — e o próprio 43 nomeia o risco disso: "não deixar
              dois sistemas diferentes de itens dentro da mesma oportunidade".

              `deal_items` (migração 054) já é o que o 45 descreve:
              `product_id` apontando para `products`, o nome congelado no
              momento da linha, quantidade, preço unitário, desconto e um
              `total` GENERATED. A 075 acrescentou o CÓDIGO e a UNIDADE, que
              são as duas colunas que faltavam para a linha caber no pedido
              de venda — congeladas pelo mesmo motivo que o nome.
            */}
            <DealItemsEditor
              accountId={accountId}
              dealId={deal?.id ?? null}
              currency={currency}
              disabled={!canWrite}
              onChange={handleItems}
            />

            {/*
              VALOR — item 46.

              Sozinho na linha agora: o Frete desceu para o bloco de
              transporte, que é onde ele é combinado e onde o Gabriel pediu
              que ele aparecesse. Continuam fora daqui a MOEDA e a PREVISÃO
              DE FECHAMENTO, que o item 41 manda tirar da interface e que o
              item 59 proíbe apagar do banco — as duas seguem sendo
              gravadas.
            */}
            <div className="grid gap-2">
              <FieldLabel htmlFor="deal-value">{t('value')}</FieldLabel>
              {/* Read-only once there are lines. The number is what
                  they add up to, and a field somebody can type over
                  an arithmetic result is a field that makes the
                  total a lie again — which is the whole thing line
                  items were added to stop. */}
              <CurrencyInput
                id="deal-value"
                value={hasLines ? lineTotalSum : value}
                onValueChange={setValue}
                currency={currency}
                placeholder="0"
                disabled={!canWrite || hasLines}
                className="border-border bg-muted text-foreground"
              />
              {hasLines ? (
                <p className="text-muted-foreground text-2xs">
                  {t('valueFromItems')}
                </p>
              ) : null}
            </div>

            {/*
              PRODUTOS · FRETE · TOTAL, a conta que o orçamento vai imprimir.

              Só aparece quando há frete: sem ele o total É o valor, e uma
              linha repetindo o número que está dois campos acima seria ruído.
              É a mesma soma que o orçamento faz — feita aqui uma vez, para
              não existirem dois cálculos que podem discordar, que é o que o
              item 55 proíbe em outras palavras.

              Fica ANTES da condição de pagamento de propósito: é este total
              que as parcelas dividem, e vê-lo na linha de cima é o que faz
              "gerar parcelas" ser conferível.
            */}
            {shipping !== null && shipping > 0 && (
              <p className="text-secondary-foreground border-border bg-muted/50 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {t('breakdown', {
                    products: formatCurrencyExact(produtos, currency),
                    shipping: formatCurrencyExact(shipping, currency),
                  })}
                </span>
                <span className="text-foreground font-semibold">
                  {t('total', {
                    total: formatCurrencyExact(totalGeral, currency),
                  })}
                </span>
              </p>
            )}

            {/*
              CONDIÇÃO DE PAGAMENTO — o bloco novo (migração 075).

              Some inteiro num banco anterior a ela, como o editor de
              produtos some num anterior à 054: uma seção que não tem onde
              gravar é pior do que uma seção ausente.
            */}
            {!installmentsPending && (
              <DealInstallments
                terms={paymentTerms}
                onTermsChange={setPaymentTerms}
                value={installments}
                onChange={setInstallments}
                total={totalGeral}
                currency={currency}
                issuedOn={hojeIso}
                disabled={!canWrite}
              />
            )}

            {/*
              TRANSPORTE — item 48 e o que a 075 acrescentou.

              O TRANSPORTADOR é texto porque não há tabela de
              transportadoras neste banco: o item 48 manda reutilizar
              "contatos/cadastros classificados como Transportadora, CASO
              essa estrutura já exista", e ela não existe. Então o mínimo
              honesto é guardar o nome. Os dois atalhos são os estados que o
              próprio item pede, como `ChoiceChip` e não como opções de um
              select: eles não são uma lista fechada de onde se escolhe, são
              dois valores frequentes ao lado de um campo que aceita
              qualquer nome.

              O FRETE POR CONTA é o oposto e por isso é um select: seis
              códigos de um padrão fiscal, iguais em toda empresa do país.

              O VALOR DO FRETE terminou aqui, e não junto do Valor, porque
              foi assim que o Gabriel agrupou: "transportadora, quantidade e
              peso bruto e o valor do frete". É o mesmo campo de antes —
              `shipping_cost`, fora do valor dos produtos desde o item 47,
              justamente para o orçamento poder imprimir as três linhas.
            */}
            <div className="space-y-4">
              <p className="text-muted-foreground eyebrow">{t('transport')}</p>

              <div className="grid gap-2">
                <FieldLabel htmlFor="deal-carrier">{t('carrier')}</FieldLabel>
                <Input
                  id="deal-carrier"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder={t('carrierPlaceholder')}
                  disabled={!canWrite}
                  className="border-border bg-muted text-foreground"
                />
                <div className="flex flex-wrap gap-1.5">
                  {CARRIER_STATES.map((chave) => {
                    const rotulo = t(chave);
                    return (
                      <ChoiceChip
                        key={chave}
                        active={carrier === rotulo}
                        disabled={!canWrite}
                        onClick={() =>
                          setCarrier(carrier === rotulo ? '' : rotulo)
                        }
                      >
                        {rotulo}
                      </ChoiceChip>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 @lg:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel htmlFor="deal-freight-mode">
                    {t('freightMode')}
                  </FieldLabel>
                  <OptionSelect
                    id="deal-freight-mode"
                    value={freightMode}
                    onValueChange={setFreightMode}
                    disabled={!canWrite}
                    className="border-border bg-muted text-foreground"
                  >
                    <option value="">{t('freightModeNone')}</option>
                    {FREIGHT_MODES.map((chave) => (
                      <option key={chave} value={chave}>
                        {t(chave)}
                      </option>
                    ))}
                  </OptionSelect>
                </div>

                <div className="grid gap-2">
                  <FieldLabel htmlFor="deal-shipping">
                    {t('shipping')}
                  </FieldLabel>
                  <CurrencyInput
                    id="deal-shipping"
                    value={shipping}
                    onValueChange={setShipping}
                    currency={currency}
                    placeholder="0"
                    disabled={!canWrite}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>

              {/* Volumes e peso bruto: o que a transportadora pergunta ao
                  cotar. Vazios num orçamento que sai antes de alguém pesar
                  nada, e o documento omite o que está vazio. */}
              <div className="grid gap-4 @lg:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel htmlFor="deal-volumes">
                    {t('freightVolumes')}
                  </FieldLabel>
                  <Input
                    id="deal-volumes"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="1"
                    value={freightVolumes ?? ''}
                    onChange={(e) =>
                      setFreightVolumes(
                        e.target.value === '' ? null : Number(e.target.value)
                      )
                    }
                    disabled={!canWrite}
                    className="border-border bg-muted text-foreground tabular-nums"
                  />
                </div>

                <div className="grid gap-2">
                  <FieldLabel htmlFor="deal-weight">
                    {t('grossWeight')}
                  </FieldLabel>
                  <Input
                    id="deal-weight"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.001"
                    value={grossWeight ?? ''}
                    onChange={(e) =>
                      setGrossWeight(
                        e.target.value === '' ? null : Number(e.target.value)
                      )
                    }
                    disabled={!canWrite}
                    className="border-border bg-muted text-foreground tabular-nums"
                  />
                </div>
              </div>
            </div>

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

            {/*
              A ETAPA, e por que ela não aparece ao CRIAR.

              "se estamos criando oportunidade já vai automático para em
              aberto, não precisa escolher" — e no Bling é assim: todo
              pedido novo nasce Em aberto, e ninguém escolhe a situação de
              um pedido que ainda não existe.

              ISTO CONTRADIZ O ITEM 42 DO PACOTE, que pedia `Novo lead` como
              padrão, e a contradição é deliberada: `Novo Lead` é onde a
              AUTOMAÇÃO põe quem mandou o primeiro "oi" (§1 do fluxo
              oficial); quem um vendedor abre à mão já falou com alguém.
              `entryStage` acha a etapa pelo nome e cai para a primeira do
              funil quando o quadro foi montado à mão.

              EDITANDO ela fica, e o item 42 já dizia por quê — "se a
              arquitetura exigir o campo, mantê-lo de forma discreta". Mover
              de etapa é o trabalho central do funil e o quadro não é a
              única porta para isso.
            */}
            {deal ? (
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
            ) : (
              // Uma frase e não um campo. Onde a oportunidade vai cair não é
              // uma escolha aqui, mas continua sendo uma informação — e um
              // negócio que aparece numa coluna que ninguém nomeou é o tipo
              // de surpresa que faz procurar no quadro inteiro.
              stages.find((st) => st.id === stageId) && (
                <p className="text-muted-foreground text-2xs">
                  {t('stageOnCreate', {
                    stage:
                      stages.find((st) => st.id === stageId)?.name ?? '',
                  })}
                </p>
              )
            )}

            {/*
              GERAR ORÇAMENTO — item 51.

              Depois de tudo porque é aqui que tudo que o documento imprime
              já foi preenchido: produto, valor, condição de pagamento,
              transporte, responsável e a observação. Antes disto o botão
              abriria um documento pela metade.

              `outline` e não sólido: o azul cheio desta gaveta é do Salvar,
              e ver o orçamento não grava nada. É uma prévia — o item 51 diz
              que o objetivo da fase é "conseguir montar o documento", e
              montar não é enviar.

              Sem Bling, que o item 51 dispensa em uma frase e o 59 proíbe.
            */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setQuoteOpen(true)}
              className="w-fit"
            >
              <FileText className="size-4" />
              {tQuote('open')}
            </Button>

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
                // O título saiu daqui junto com o campo (item 39): quem o
                // preenche é `tituloDerivado`, e ele nunca é vazio quando
                // há contato — que é a condição ao lado.
                disabled={!canWrite || saving || !contactId || !stageId}
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
      <DealQuote
        open={quoteOpen}
        onOpenChange={setQuoteOpen}
        quote={orcamento}
        brand={brandFromAccount(account)}
        archiveHref="/documentos/orcamentos"
        /*
         * ARQUIVAR E RENDERIZAR VIRARAM A MESMA CHAMADA.
         *
         * Antes esta gaveta gravava a linha por conta própria e mandava o
         * navegador imprimir. Agora a rota faz as duas coisas na ordem
         * certa — grava, desenha, sobe os arquivos — porque só ela pode:
         * o Chromium é do servidor, e os totais precisam ser refeitos
         * longe de quem os enviou.
         *
         * O que sobe é INSUMO e não resultado: linhas, valor digitado,
         * frete. A conta é refeita lá pelo mesmo `buildQuote`.
         */
        onGenerate={async (labels) => {
          const res = await fetch('/api/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dealId: deal?.id ?? null,
              orderNumber: salesOrder,
              issuedOn: hojeIso,
              customerName: contatoAtual?.name || contatoAtual?.phone,
              customerCompany: contatoAtual?.company,
              customerPhone: contatoAtual?.phone,
              items,
              value,
              currency,
              shipping,
              paymentTerms,
              installments,
              carrier,
              // Traduzido AQUI, onde existe o provider de i18n: a rota
              // desenha o documento longe dele e recebe o rótulo pronto,
              // como já recebe todos os outros.
              freightMode: freightMode ? t(freightMode) : null,
              freightVolumes,
              grossWeight,
              owner: profiles.find((pf) => pf.id === assignedTo)?.full_name,
              notes,
              labels,
            }),
          });
          const dados = await res.json().catch(() => ({}));
          if (res.ok && dados.pdfUrl) {
            // Uma aba nova e não um download forçado: quem gerou quer
            // CONFERIR antes de mandar, e o visualizador do navegador é
            // onde isso acontece sem baixar nada.
            window.open(dados.pdfUrl, '_blank', 'noopener');
            toast.success(tQuote('generated'));
            return true;
          }
          if (dados.error === 'no_browser') return false;
          toast.error(tQuote('generateFailed'));
          return true;
        }}
      />

      <DealOutcomeDialogs {...outcome.dialogProps} />
    </Sheet>
  );
}
