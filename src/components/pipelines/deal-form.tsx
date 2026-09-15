'use client';

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { CURRENCIES, formatCurrencyExact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { fromCents, linesTotalCents, toCents } from '@/lib/money';
import {
  FREIGHT_LABEL_KEY,
  FREIGHT_PAYER_CODES,
  freightCode,
  freightLabelKey,
} from '@/lib/deals/freight';
import {
  discountExceedsOrder,
  discountUnit,
  orderTotals,
  shippingCountedTwice,
  type DiscountUnit,
} from '@/lib/deals/totals';
import { replaceDealItems, type DealItemDraft } from '@/lib/products/catalog';
import { DealItemsEditor } from './deal-items';
import { DealInstallments } from './deal-installments';
import {
  hasOrderShape,
  loadInstallments,
  replaceInstallments,
  type InstallmentDraft,
} from '@/lib/deals/installments';
import { saveDealOrder } from '@/lib/deals/save';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import {
  dealRow,
  EMPTY_ORDER_FIELDS,
  hasOrderFields,
  hasOrderTotals,
  type DealOrderFields,
} from '@/lib/deals/row';
import {
  isColumnFree,
  isOrderLockedError,
  pickFreeColumns,
} from '@/lib/deals/order-lock';
import {
  currentOrder,
  remoteOrderState,
  watchOperation,
  type RemoteOrderState,
} from '@/lib/deals/order-state';
import { orderReadiness } from '@/lib/deals/order-rules';
import {
  EMPTY_ORDER_CONTEXT,
  loadOrderContext,
  type OrderContext,
} from '@/lib/deals/order-context';
import { productFacts, type Product } from '@/lib/products/catalog';
import { dragAllowed } from '@/lib/bling/transitions';
import { DealOrderSection, describeSyncError } from './deal-order-section';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { OrderStatus } from '@/lib/deals/order-lock';
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
import { MoneyInput } from '@/components/ui/money-input';
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
import { buildQuote, quoteFileName } from '@/lib/quotes/quote';
import type { QuoteLabels } from '@/components/quotes/quote-document';
import { sessionWindow, type SessionState } from '@/lib/inbox/session-window';
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
const KNOWN_LOSS_REASONS = new Set<string>([...LOSS_REASONS, 'noReply', 'orderCanceled']);

/**
 * Os dois estados de transporte que não são uma transportadora.
 *
 * Item 48, literal: "permitir também estados como Cliente retira, A
 * definir". Chaves do catálogo e não literais, porque o que vai para a
 * coluna é o texto que a pessoa vê — e o orçamento imprime esse texto.
 */
const CARRIER_STATES = ['carrierPickup', 'carrierTbd'] as const;

/*
 * "Frete por conta", com as opções do Bling: `FREIGHT_PAYER_CODES`.
 *
 * O que vai para a coluna é o CÓDIGO (0, 1, 2, 3, 4 ou 9) desde a 078. O
 * comentário que morava aqui dizia que ia "o TEXTO", e o que ia de fato
 * era a chave do catálogo de tradução — nem um nem outro. O rótulo é
 * traduzido na hora de desenhar e de imprimir; ver `lib/deals/freight.ts`.
 *
 * A lista é fechada porque esta, ao contrário do transportador e da forma
 * de pagamento, é um padrão fiscal e não um cadastro da conta.
 */

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

/** A pausa entre duas consultas à fila. */
const aguardar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const tOrder = useTranslations('Pipelines.order');
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
  // A exceção de peso é uma autorização, e não um campo de digitação: só
  // admin assina (o nome fica em `weight_exception_by`).
  const canAuthorize = useCan('edit-settings');
  const { confirm } = useConfirm();

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
  /**
   * A 075 ainda não rodou.
   *
   * Três coisas dependem disto, e as três existem para a mesma regra — não
   * oferecer um campo que não tem onde gravar: o bloco de pagamento some,
   * os três campos novos de transporte somem, e o `payload` de `persist`
   * deixa de citar as colunas. A terceira é a que importa: um `update` com
   * uma coluna inexistente é recusado INTEIRO, e sem ela nenhuma
   * oportunidade salvava. Ver `hasOrderShape`.
   *
   * Começa `false` — quer dizer, "a estrutura está lá" — porque esse é o
   * estado permanente. O contrário faria os campos surgirem um instante
   * depois em toda abertura da gaveta, para sempre, por causa de uma
   * janela que dura até alguém rodar a migração.
   */
  const [installmentsPending, setInstallmentsPending] = useState(false);
  /**
   * OUTRAS DESPESAS E DESCONTO GERAL (078) — os dois termos que faltavam
   * na conta do pedido de venda. Ver `lib/deals/totals.ts`.
   *
   * `totalsPending` segue a mesma regra de `installmentsPending`: sem a
   * 078 os campos não aparecem e o `update` não cita as colunas.
   */
  const [otherExpenses, setOtherExpenses] = useState<number | null>(null);
  const [generalDiscount, setGeneralDiscount] = useState<number | null>(null);
  const [generalDiscountUnit, setGeneralDiscountUnit] =
    useState<DiscountUnit>('REAL');
  const [totalsPending, setTotalsPending] = useState(false);
  /** Transporte, o resto do que a transportadora pergunta (075). */
  const [freightMode, setFreightMode] = useState('');
  const [freightVolumes, setFreightVolumes] = useState<number | null>(null);
  const [grossWeight, setGrossWeight] = useState<number | null>(null);
  /**
   * O PEDIDO COMPLETO (085) — datas, transportadora do cadastro, categoria
   * do misto, volumes confirmados, exceção de peso e observações internas.
   *
   * `orderFieldsPending` segue a regra das outras duas: sem a 085 a área
   * Pedido não aparece e o `update` não cita as colunas.
   */
  const [orderFields, setOrderFields] =
    useState<DealOrderFields>(EMPTY_ORDER_FIELDS);
  const [orderFieldsPending, setOrderFieldsPending] = useState(false);
  const [orderContext, setOrderContext] =
    useState<OrderContext>(EMPTY_ORDER_CONTEXT);
  /** O catálogo ativo, que o editor de itens já carrega. */
  const [catalog, setCatalog] = useState<Product[]>([]);
  /**
   * O pedido no Bling como a fila deixou (086) — sobrepõe o `deal` da prop,
   * que só é relido quando o quadro recarrega. Leva também a trava (vínculo,
   * contas lançadas), a etapa e o ganho/perdido: a gaveta continua aberta
   * depois de mudar a situação, e ler isso da prop fazia o próximo "Salvar"
   * mandar itens a um pedido já travado, ou devolver a etapa que o pedido
   * acabou de mudar (auditoria da 0.11.0).
   */
  const [remoto, setRemoto] = useState<RemoteOrderState | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  /**
   * Um registro/mudança por vez, e já no clique: o estado `sincronizando`
   * só vale no próximo render, e dois cliques no mesmo quadro gravavam a
   * oportunidade nova duas vezes.
   */
  const ocupado = useRef(false);
  /**
   * A abertura da gaveta. Os laços que acompanham a fila conferem a cada
   * volta: fechar a gaveta, ou abrir outra oportunidade, encerra o laço em
   * silêncio — em vez de o toast e o estado de uma cair na outra.
   */
  const geracao = useRef(0);
  /** O número do pedido que a última sincronização desta gaveta devolveu. */
  const ultimoNumero = useRef<string | null>(null);
  useEffect(() => {
    geracao.current += 1;
    ultimoNumero.current = null;
  }, [open, deal?.id]);
  const handleItems = useCallback(
    (state: {
      items: DealItemDraft[];
      pending: boolean;
      products: Product[];
    }) => {
      setItems(state.items);
      setItemsPending(state.pending);
      setCatalog(state.products);
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

  /**
   * A janela de 24h da conversa deste contato, medida quando o ORÇAMENTO
   * abre — e não quando a gaveta abre.
   *
   * Uma gaveta fica aberta por muito tempo enquanto alguém monta um
   * pedido; a janela é uma contagem regressiva. Medir no momento em que a
   * pessoa vai mandar é medir o que importa. `null` enquanto não se sabe,
   * e aí o envio é oferecido: se a janela tiver fechado de verdade, a Meta
   * recusa com 131047 e `enviarOrcamento` diz isso em vez de um erro cru.
   */
  const [janela, setJanela] = useState<SessionState | null>(null);

  const [saving, setSaving] = useState(false);
  /**
   * A oportunidade que ESTA gaveta criou sem fechar — ao gerar o orçamento
   * de um negócio novo.
   *
   * O documento sai do pedido gravado (`lib/quotes/from-deal.ts`), então
   * gerar um orçamento numa oportunidade nova grava ela antes. Sem guardar
   * o id, o próximo "Salvar" — ou o segundo orçamento — faria um segundo
   * INSERT, e o quadro ganharia duas oportunidades iguais.
   */
  const [criadaId, setCriadaId] = useState<string | null>(null);
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
    setCriadaId(null);
    setRemoto(null);
    if (deal) {
      setSalesOrder(deal.sales_order_number ?? '');
      setValue(deal.value ?? null);
      setShipping(deal.shipping_cost ?? null);
      setCarrier(deal.carrier ?? '');
      setPaymentTerms(deal.payment_terms ?? '');
      // Código ou chave antiga (antes da 078) — os dois viram o código.
      setFreightMode(freightCode(deal.freight_mode) ?? '');
      setFreightVolumes(deal.freight_volumes ?? null);
      setGrossWeight(deal.gross_weight ?? null);
      setOtherExpenses(
        deal.other_expenses === null || deal.other_expenses === undefined
          ? null
          : Number(deal.other_expenses)
      );
      setGeneralDiscount(
        deal.general_discount === null || deal.general_discount === undefined
          ? null
          : Number(deal.general_discount)
      );
      setGeneralDiscountUnit(discountUnit(deal.general_discount_unit));
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? '');
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? '');
      setExpectedCloseDate(deal.expected_close_date ?? '');
      setNotes(deal.notes ?? '');
      setOrderFields({
        carrierId: deal.carrier_id ?? '',
        saleDate: deal.sale_date ?? '',
        departureDate: deal.departure_date ?? '',
        expectedDate: deal.expected_date ?? '',
        deliveryDays: deal.delivery_days ?? null,
        validUntil: deal.valid_until ?? '',
        internalNotes: deal.internal_notes ?? '',
        revenueCategoryBlingId: deal.revenue_category_bling_id ?? '',
        revenueCategoryChosenBy: deal.revenue_category_chosen_by ?? null,
        revenueCategoryNote: deal.revenue_category_note ?? '',
        freightVolumesConfirmed: deal.freight_volumes_confirmed === true,
        weightExceptionNote: deal.weight_exception_note ?? '',
        weightExceptionBy: deal.weight_exception_by ?? null,
      });
    } else {
      setOrderFields(EMPTY_ORDER_FIELDS);
      setSalesOrder('');
      setValue(null);
      setShipping(null);
      setCarrier('');
      setPaymentTerms('');
      setInstallments([]);
      setFreightMode('');
      setFreightVolumes(null);
      setGrossWeight(null);
      setOtherExpenses(null);
      setGeneralDiscount(null);
      setGeneralDiscountUnit('REAL');
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
   * A 078 está no banco? Uma pergunta por abertura da gaveta, pela mesma
   * razão da pergunta sobre a 075: um `update` que cite uma coluna que não
   * existe não grava nada.
   */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void hasOrderTotals(supabase).then((existe) => {
      if (!cancelled) setTotalsPending(!existe);
    });
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  /**
   * A 085 está no banco? E o que a área Pedido precisa saber da conta —
   * transportadoras, formas confirmadas, categorias —, na mesma abertura.
   */
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    void hasOrderFields(supabase).then((existe) => {
      if (!cancelled) setOrderFieldsPending(!existe);
    });
    void loadOrderContext(supabase, accountId).then((contexto) => {
      if (!cancelled) setOrderContext(contexto);
    });
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);

  /**
   * As parcelas desta oportunidade.
   *
   * Separado do efeito de reidratação acima porque elas moram em OUTRA
   * tabela — `deals` não as traz junto, e uma consulta a mais só quando a
   * gaveta abre é o mesmo custo que o editor de produtos já paga.
   */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Num negócio NOVO não há parcela para carregar, mas a pergunta sobre
    // o esquema continua valendo: é na criação que o `insert` citaria as
    // colunas da 075 e seria recusado.
    if (!deal?.id) {
      void hasOrderShape(supabase).then((existe) => {
        if (!cancelled) setInstallmentsPending(!existe);
      });
      return () => {
        cancelled = true;
      };
    }
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
          paymentMethodBlingId: linha.payment_method_bling_id ?? null,
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

  useEffect(() => {
    if (!quoteOpen || !linkedConversation?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJanela(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // A MESMA regra da conversa: a janela conta da última mensagem do
      // CLIENTE, e `sessionWindow` é quem decide os três estados. Uma
      // segunda conta aqui seria a gaveta e a caixa de entrada discordando
      // sobre se dá para responder a mesma pessoa.
      const { data } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', linkedConversation.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setJanela(
        sessionWindow((data as { created_at: string } | null)?.created_at).state
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [quoteOpen, linkedConversation?.id, supabase]);

  // The lines decide the value when there are lines. The trigger in 054 does
  // this again server-side — this is only so the row is right in the same
  // statement rather than a beat later, which is what the board reads when it
  // refreshes.
  //
  // Em CENTAVOS (`lib/money.ts`): somar os totais em float e deixar para
  // arredondar no fim fazia esta gaveta mostrar R$ 0,52 numa linha que o
  // banco grava como R$ 0,53, e o total que as parcelas dividem sair um
  // centavo diferente do `deals.value`.
  const lineTotalSum = fromCents(linesTotalCents(items));
  const hasLines = items.length > 0;
  const produtos = hasLines ? lineTotalSum : (value ?? 0);
  /**
   * O TOTAL DO PEDIDO — `Σ itens + outras despesas + frete − desconto
   * geral`, a conta do Bling (`lib/deals/totals.ts`).
   *
   * Era "produtos + frete". Sem a 078 os dois termos novos simplesmente não
   * entram: eles não aparecem na tela e não teriam onde gravar, e contar
   * com eles aqui faria o total da gaveta discordar do que salva.
   */
  const totais = orderTotals({
    productsCents: toCents(produtos),
    otherExpenses: totalsPending ? null : otherExpenses,
    shipping,
    generalDiscount: totalsPending ? null : generalDiscount,
    generalDiscountUnit,
  });
  const totalGeral = fromCents(totais.totalCents);
  const descontoInvalido = discountExceedsOrder(totais);
  const freteEmDobro = shippingCountedTwice(items, shipping);

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
   * O PEDIDO COMO ESTÁ AGORA — a prop com o que a fila deixou por cima
   * (`lib/deals/order-state.ts`).
   */
  const pedido = currentOrder(deal, remoto);
  /**
   * A TRAVA DA SITUAÇÃO (085) — a mesma regra do gatilho, lida do pedido
   * GRAVADO. O que ela segura aparece apagado e não vai no `update`; ver
   * `lib/deals/order-lock.ts`.
   */
  const trava = pedido.lock;
  /**
   * D1 = B: com o pedido no Bling, ganho e perdido vêm da SITUAÇÃO (Em
   * andamento ganha; Cancelado perde com "Pedido cancelado"). Os botões do
   * topo mudariam só o funil e deixariam o Bling dizendo outra coisa.
   */
  const desfechoPeloPedido = orderContext.ordersEnabled && !!pedido.blingOrderId;
  const livre = (coluna: string) => canWrite && isColumnFree(coluna, trava);
  const pedidoAberto = trava === 'open';

  /** A transportadora do cadastro escolhida, quando há cadastro. */
  const transportadoraAtual =
    orderContext.carriers.find((c) => c.id === orderFields.carrierId) ?? null;
  const usaCadastroDeTransportadora =
    !orderFieldsPending && orderContext.available && orderContext.carriers.length > 0;

  /**
   * "PRONTO PARA O BLING" — calculado a cada quadro, sobre o que está na
   * tela. É barato: meia dúzia de somas sobre as linhas que já estão aqui.
   */
  const prontidao = orderReadiness({
    contact: contatoAtual ?? null,
    lines: items,
    activeProductIds: catalog.length ? new Set(catalog.map((p) => p.id)) : null,
    // O mesmo confronto do servidor: a linha montada antes de o produto
    // mudar no Bling aparece como sem vínculo, com o botão na linha.
    currentProducts: catalog.length
      ? new Map(catalog.map((p) => [p.id, productFacts(p, orderContext.resolveCategory)]))
      : null,
    weightExceptionNote: orderFields.weightExceptionNote,
    chosenCategoryId: orderFields.revenueCategoryBlingId || null,
    installments,
    totalCents: totais.totalCents,
    allowedPaymentMethods: orderContext.paymentMethods.length
      ? new Set(orderContext.paymentMethods.map((f) => f.id))
      : null,
    carrier: transportadoraAtual,
  });

  /**
   * Muda um campo do pedido carimbando quem, quando o campo é uma decisão:
   * a categoria escolhida no misto e a exceção de peso guardam o autor.
   */
  const mudarPedido = (patch: Partial<DealOrderFields>) => {
    setOrderFields((atual) => {
      const proximo = { ...atual, ...patch };
      if ('revenueCategoryBlingId' in patch) {
        proximo.revenueCategoryChosenBy = patch.revenueCategoryBlingId
          ? (user?.id ?? null)
          : null;
      }
      if ('weightExceptionNote' in patch) {
        proximo.weightExceptionBy = patch.weightExceptionNote?.trim()
          ? (user?.id ?? atual.weightExceptionBy)
          : null;
      }
      return proximo;
    });
  };

  /** O rótulo do frete por conta, que o documento imprime — do código. */
  const chaveFrete = freightLabelKey(freightMode);
  const rotuloFrete = chaveFrete ? t(chaveFrete) : null;

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
    // Com o pedido registrado, o número é o do Bling — o mesmo do PDF que o
    // servidor gera e do nome do arquivo.
    orderNumber: pedido.blingOrderNumber || salesOrder,
    issuedOn: hojeIso,
    company: account?.name,
    customerName: contatoAtual?.name || contatoAtual?.phone,
    customerCompany: contatoAtual?.company,
    customerPhone: contatoAtual?.phone,
    items,
    value,
    currency,
    shipping,
    otherExpenses: totalsPending ? null : otherExpenses,
    generalDiscount: totalsPending ? null : generalDiscount,
    generalDiscountUnit,
    paymentTerms,
    installments,
    carrier,
    freightMode: rotuloFrete,
    freightVolumes,
    grossWeight,
    owner: profiles.find((pf) => pf.id === assignedTo)?.full_name,
    notes,
    // As observações INTERNAS ficam fora, e não por esquecimento: o
    // documento vai ao cliente (Fase 3: "nunca entram").
    validUntil: orderFieldsPending ? null : orderFields.validUntil,
    deliveryDays: orderFieldsPending ? null : orderFields.deliveryDays,
  });
  const tituloDerivado =
    deal?.title?.trim() ||
    contatoAtual?.name?.trim() ||
    contatoAtual?.phone?.trim() ||
    t('newDeal');

  /**
   * Grava o que está no formulário. Devolve o id da oportunidade gravada,
   * ou `null` quando não deu.
   *
   * O id, e não mais `true`: quem gera o orçamento precisa dele para a rota
   * ler o pedido do BANCO, inclusive numa oportunidade que acabou de nascer.
   *
   * Separado do `handleSave` porque o DESFECHO também precisa dele: marcar
   * como ganho tem de levar junto o que a pessoa acabou de digitar. Com
   * `silent`, não avisa nem fecha a ficha — quem chamou continua a conversa.
   */
  async function persist({ silent = false } = {}): Promise<string | null> {
    // O título saiu da lista de obrigatórios porque saiu da tela: quem
    // o preenche agora é `tituloDerivado`, e ele nunca é vazio quando
    // há contato. Contato e etapa continuam sendo o mínimo.
    if (!contactId || !stageId) {
      toast.error(t('toastRequired'));
      return null;
    }
    // Um desconto maior que o pedido é erro de digitação, e gravá-lo
    // mandaria um total negativo para o documento e para as parcelas.
    // Ver `discountExceedsOrder`.
    if (descontoInvalido) {
      toast.error(t('discountTooLarge'));
      return null;
    }
    setSaving(true);

    const {
      base,
      orderShape,
      orderTotals: totaisDaLinha,
      orderFields: camposDoPedido,
    } = dealRow({
      title: tituloDerivado,
      salesOrder,
      value: hasLines ? lineTotalSum : (value ?? 0),
      shipping,
      carrier,
      currency,
      contactId,
      pipelineId,
      stageId,
      assignedTo,
      notes,
      expectedCloseDate,
      freightMode,
      freightVolumes,
      grossWeight,
      paymentTerms,
      otherExpenses,
      generalDiscount,
      generalDiscountUnit,
      order: {
        ...orderFields,
        // A escolha do misto só vale enquanto o misto existe: tirar o item
        // que trazia a segunda categoria derruba a escolha, e gravá-la
        // deixaria o pedido com uma categoria que nenhum item tem.
        revenueCategoryBlingId:
          prontidao.category.status === 'chosen'
            ? prontidao.category.categoryId
            : '',
      },
    });

    /*
     * AS COLUNAS DE CADA MIGRAÇÃO SÓ ENTRAM QUANDO EXISTEM — em camadas.
     *
     * Um `update` que cite uma coluna inexistente é recusado INTEIRO pelo
     * PostgREST (`PGRST204`) — não grava as outras e ignora a que falta.
     * Com as colunas sempre no corpo, nenhuma oportunidade salvava num
     * banco anterior à 075, inclusive as que ninguém tinha tocado nos
     * campos novos. Medido contra o banco de teste em 14 de setembro; o
     * argumento inteiro está em `lib/deals/row.ts`.
     *
     * Três camadas, da mais nova para a mais velha: 078 (despesas e
     * desconto), 075 (pagamento e transporte), base. As sondas decidem por
     * onde começar; o erro de coluna ausente decide descer — e desce UMA
     * camada por vez, para uma falha da 078 não derrubar junto os campos
     * da 075, que existem.
     */
    /*
     * A TRAVA DA SITUAÇÃO reduz cada camada ao que pode mudar (085). Com o
     * pedido travado, itens e parcelas nem vão: a gravação atômica apaga e
     * reinsere as duas, e o gatilho recusa isso em qualquer situação que
     * não seja Em aberto.
     */
    const livres = <T extends Record<string, unknown>>(corpo: T) =>
      (pedidoAberto ? corpo : pickFreeColumns(corpo, trava)) as T;

    const camadas: Array<{
      corpo: Record<string, unknown>;
      sem075: boolean;
      sem078: boolean;
      sem085: boolean;
    }> = [];
    if (!installmentsPending && !totalsPending && !orderFieldsPending) {
      camadas.push({
        corpo: livres({ ...base, ...orderShape, ...totaisDaLinha, ...camposDoPedido }),
        sem075: false,
        sem078: false,
        sem085: false,
      });
    }
    if (!installmentsPending && !totalsPending) {
      camadas.push({
        corpo: livres({ ...base, ...orderShape, ...totaisDaLinha }),
        sem075: false,
        sem078: false,
        sem085: true,
      });
    }
    if (!installmentsPending) {
      camadas.push({
        corpo: livres({ ...base, ...orderShape }),
        sem075: false,
        sem078: true,
        sem085: true,
      });
    }
    camadas.push({ corpo: livres(base), sem075: true, sem078: true, sem085: true });

    /*
     * O CINTO, para quando a sonda acertou e a escrita não.
     *
     * Acontece nos segundos logo depois de a migração rodar, antes de o
     * PostgREST recarregar o esquema — o comentário de `pg-errors.ts` fala
     * dessa janela. Grava-se o resto e AVISA-SE: calar seria perder em
     * silêncio o peso bruto ou o desconto que a pessoa acabou de digitar.
     */
    const aoDescer = (camada: (typeof camadas)[number]) => {
      if (camada.sem085 && !orderFieldsPending) setOrderFieldsPending(true);
      if (camada.sem078 && !totalsPending) setTotalsPending(true);
      if (camada.sem075 && !installmentsPending) setInstallmentsPending(true);
      toast.error(t('toastOrderShapeFailed'));
    };

    /** A trava recusou: a frase diz qual é a saída (mudar a situação). */
    const recusaDaTrava = (erro: { code?: string; message?: string; hint?: string } | null) => {
      if (!isOrderLockedError(erro)) return false;
      toast.error(t('toastOrderLocked'));
      return true;
    };

    /*
     * NUMA TRANSAÇÃO SÓ, quando a 078 está no banco.
     *
     * `save_deal_order` grava a oportunidade, as linhas e as parcelas de
     * uma vez; qualquer falha desfaz tudo. Ver `lib/deals/save.ts` para a
     * classificação do erro — e principalmente para por que um defeito na
     * função cai no caminho antigo em vez de impedir de salvar.
     */
    // O id em que se grava: o da oportunidade aberta, ou o da que esta
    // mesma gaveta criou ao gerar um orçamento (`criadaId`).
    const existente = deal?.id ?? criadaId;

    if (!totalsPending && !installmentsPending && accountId) {
      const resultado = await saveDealOrder(supabase, {
        dealId: existente,
        deal: existente
          ? camadas[0].corpo
          : { ...camadas[0].corpo, account_id: accountId },
        items: itemsPending || !pedidoAberto ? null : items,
        installments: pedidoAberto ? installments : null,
      });

      if (resultado.status === 'saved') {
        if (!existente) setCriadaId(resultado.dealId);
        setSaving(false);
        if (!silent) {
          toast.success(existente ? t('toastUpdated') : t('toastCreated'));
          onOpenChange(false);
          onSaved();
        }
        return resultado.dealId;
      }

      if (resultado.status === 'rejected') {
        if (!recusaDaTrava({ code: '42501', message: resultado.error })) {
          toast.error(existente ? t('toastFailedSave') : t('toastFailedCreate'));
        }
        setSaving(false);
        return null;
      }

      if (resultado.status === 'broken') {
        // Alto, no console: a gravação ainda vai acontecer pelo caminho
        // antigo, e sem esta linha ninguém saberia que a transação não
        // está sendo usada.
        console.error(
          '[deals] save_deal_order falhou; gravando pelo caminho antigo:',
          resultado.error
        );
      }
    }

    if (existente) {
      let error: { code?: string; message?: string } | null = null;
      for (const [i, camada] of camadas.entries()) {
        ({ error } = await supabase
          .from('deals')
          .update(camada.corpo)
          .eq('id', existente));
        if (!error) {
          if (i > 0) aoDescer(camada);
          break;
        }
        if (!isUnknownColumn(error)) break;
      }
      if (error) {
        if (!recusaDaTrava(error)) toast.error(t('toastFailedSave'));
        setSaving(false);
        return null;
      }
      if (!itemsPending && accountId && pedidoAberto) {
        const { error: itemsError } = await replaceDealItems(supabase, {
          accountId,
          dealId: existente,
          items,
        });
        // The deal saved. Saying so and naming the part that did not is
        // better than a rollback the user did not ask for — the value is
        // already correct on the row above.
        if (itemsError) toast.error(t('toastItemsFailed'));
      }
      if (!installmentsPending && accountId && pedidoAberto) {
        const { error: erroParcelas } = await replaceInstallments(supabase, {
          accountId,
          dealId: existente,
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
        return null;
      }
      if (!accountId) {
        toast.error(t('toastNotLinked'));
        setSaving(false);
        return null;
      }
      const criar = (corpo: Record<string, unknown>) =>
        supabase
          .from('deals')
          .insert({
            ...corpo,
            user_id: user.id,
            account_id: accountId,
            status: 'open',
          })
          // The id, so the lines have something to attach to. `.select()`
          // on an insert is one round trip either way.
          .select('id')
          .single();
      let created: unknown = null;
      let error: { code?: string; message?: string } | null = null;
      for (const [i, camada] of camadas.entries()) {
        ({ data: created, error } = await criar(camada.corpo));
        if (!error) {
          if (i > 0) aoDescer(camada);
          break;
        }
        if (!isUnknownColumn(error)) break;
      }
      if (error || !created) {
        toast.error(t('toastFailedCreate'));
        setSaving(false);
        return null;
      }
      const novoId = (created as { id: string }).id;
      setCriadaId(novoId);
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
      setSaving(false);
      if (!silent) {
        toast.success(t('toastCreated'));
        onOpenChange(false);
        onSaved();
      }
      return novoId;
    }

    setSaving(false);
    if (!silent) {
      toast.success(t('toastUpdated'));
      onOpenChange(false);
      onSaved();
    }
    return existente;
  }

  async function handleSave() {
    await persist();
  }

  /**
   * REGISTRAR OU ATUALIZAR O PEDIDO NO BLING (Fase 4, D2).
   *
   * Grava primeiro — o pedido que vai é o GRAVADO —, pede à rota, e acompanha
   * a oportunidade até a fila terminar. Devolve se o pedido ficou
   * sincronizado: o envio do orçamento só segue com ele.
   */
  async function sincronizarPedido(): Promise<boolean> {
    // Um por vez, decidido no clique (ver `ocupado`).
    if (ocupado.current) return false;
    ocupado.current = true;
    setSincronizando(true);
    // Sem `try/finally`: a análise do React Compiler (a regra de hooks do
    // lint) não entende `finally` e desistiria da gaveta inteira.
    const ok = await registrarNoBling(geracao.current);
    ocupado.current = false;
    setSincronizando(false);
    return ok;
  }

  /** Grava e registra/atualiza — para quem já está com a vez (`ocupado`). */
  async function registrarNoBling(minha: number): Promise<boolean> {
    const dealId = await persist({ silent: true });
    if (!dealId) return false;
    return acompanharPedido(dealId, minha).catch(() => {
      if (geracao.current === minha) toast.error(tOrder('syncFailed'));
      return false;
    });
  }

  /** O que a rota recusou, em frase — nunca o código cru. */
  function recusaDaRota(corpo: { error?: string; missing?: string[] }, status: number): string {
    if (corpo.error === 'not_ready') {
      return tOrder('syncNotReady', {
        items: (corpo.missing ?? []).map((k) => tOrder(`ready.${k}`)).join(', '),
      });
    }
    return describeSyncError(corpo.error ?? `http_${status}`, tOrder);
  }

  /**
   * MUDAR A SITUAÇÃO DO PEDIDO (Fase 5, D1 = B) — confirmação que diz o
   * efeito financeiro, e acompanhamento até a fila terminar.
   *
   * Em andamento lança as contas do pedido que o Bling tem. Por isso, com o
   * pedido Em aberto: o que está na tela vai ao banco antes (o total da
   * confirmação é o da tela), a rota confere se o gravado é o que o Bling
   * recebeu, e só quando não é a gaveta atualiza no Bling e pede de novo.
   * Sincronizar antes de toda mudança exigia a lista "Pronto para o Bling"
   * completa até para Compra futura — e um produto desativado depois do
   * registro prendia o pedido (revisão da 090).
   */
  async function mudarSituacao(destino: OrderStatus) {
    const dealId = deal?.id ?? criadaId;
    if (!dealId || ocupado.current) return;
    const ok = await confirm({
      title: tOrder('statusConfirmTitle', { status: tOrder(`status.${destino}`) }),
      description: tOrder(`statusEffect.${destino}`, {
        total: formatCurrencyExact(totalGeral, currency),
      }),
      confirmLabel: tOrder('statusConfirm'),
      destructive: destino === 'cancelado',
    });
    if (!ok || ocupado.current) return;

    ocupado.current = true;
    setSincronizando(true);
    const minha = geracao.current;
    const concluiu = await executarMudanca(dealId, destino, minha).catch(() => false);
    ocupado.current = false;
    setSincronizando(false);
    if (concluiu) onSaved();
  }

  async function executarMudanca(dealId: string, destino: OrderStatus, minha: number): Promise<boolean> {
    const lancaDoPedido = destino === 'em_andamento' && pedido.syncable;
    if (lancaDoPedido && !(await persist({ silent: true }))) return false;

    let resposta = await pedirSituacao(dealId, destino);
    if ('error' in resposta && resposta.error === 'order_not_synced' && lancaDoPedido) {
      if (geracao.current !== minha) return false;
      // O gravado não é o que o Bling tem: atualiza lá e pede de novo.
      if (!(await registrarNoBling(minha))) return false;
      resposta = await pedirSituacao(dealId, destino);
    }
    if ('error' in resposta) {
      if (geracao.current === minha) toast.error(recusaDaRota(resposta, resposta.httpStatus));
      return false;
    }
    return acompanharSituacao(dealId, resposta.operationId, destino, minha);
  }

  async function pedirSituacao(
    dealId: string,
    destino: OrderStatus
  ): Promise<{ operationId: string } | { error: string; missing?: string[]; httpStatus: number }> {
    const res = await fetch(`/api/bling/orders/${dealId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: destino }),
    });
    const corpo = (await res.json().catch(() => ({}))) as { error?: string; operationId?: string };
    if (!res.ok || !corpo.operationId) {
      return { error: corpo.error ?? `http_${res.status}`, httpStatus: res.status };
    }
    return { operationId: corpo.operationId };
  }

  async function acompanharSituacao(
    dealId: string,
    operationId: string,
    destino: OrderStatus,
    minha: number
  ): Promise<boolean> {
    for (let volta = 0; volta < 60; volta++) {
      await aguardar(1500);
      // A gaveta fechou, ou é outra oportunidade: para em silêncio.
      if (geracao.current !== minha) return false;
      const estado = await fetch(`/api/bling/orders/${dealId}?operationId=${operationId}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (geracao.current !== minha) return false;
      const lido = remoteOrderState(estado?.deal);
      if (lido) setRemoto(lido);
      const passo = watchOperation(operationId, estado);
      if (passo.kind === 'wait') continue;
      if (passo.ok) {
        // A etapa que o pedido levou: o próximo "Salvar" não a desfaz.
        if (lido?.stageId) setStageId(lido.stageId);
        toast.success(tOrder('statusChanged', { status: tOrder(`status.${destino}`) }));
        return true;
      }
      toast.error(passo.error ? describeSyncError(passo.error, tOrder) : tOrder('syncFailed'));
      return false;
    }
    toast.error(tOrder('syncSlow'));
    return false;
  }

  async function acompanharPedido(dealId: string, minha: number): Promise<boolean> {
    const res = await fetch(`/api/bling/orders/${dealId}/sync`, { method: 'POST' });
    const corpo = (await res.json().catch(() => ({}))) as {
      error?: string;
      missing?: string[];
      operationId?: string;
      status?: string;
    };
    if (!res.ok || !corpo.operationId) {
      if (geracao.current === minha) toast.error(recusaDaRota(corpo, res.status));
      return false;
    }
    // A fila roda depois da resposta; a OPERAÇÃO pedida diz quando terminou.
    // Uma já concluída (o mesmo pedido pedido de novo) responde na hora.
    for (let volta = 0; volta < 40; volta++) {
      if (volta > 0 || corpo.status !== 'succeeded') await aguardar(1500);
      if (geracao.current !== minha) return false;
      const estado = await fetch(`/api/bling/orders/${dealId}?operationId=${corpo.operationId}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (geracao.current !== minha) return false;
      const lido = remoteOrderState(estado?.deal);
      if (lido) setRemoto(lido);
      const passo = watchOperation(corpo.operationId, estado);
      if (passo.kind === 'wait') continue;
      if (passo.ok) {
        if (lido?.blingOrderNumber) ultimoNumero.current = lido.blingOrderNumber;
        toast.success(tOrder('synced', { number: lido?.blingOrderNumber ?? '' }));
        return true;
      }
      toast.error(
        passo.outcome === 'divergent'
          ? tOrder('syncDivergent')
          : passo.error
            ? describeSyncError(passo.error, tOrder)
            : tOrder('syncFailed')
      );
      return false;
    }
    toast.error(tOrder('syncSlow'));
    return false;
  }

  /**
   * Fechar a gaveta — avisando o quadro quando ela criou uma oportunidade.
   *
   * Gerar o orçamento de um negócio novo grava a oportunidade em silêncio
   * (ver `criadaId`). Quem fecha depois com "Cancelar", ou clicando fora,
   * não apertou Salvar — e sem este aviso a oportunidade existiria no banco
   * e não apareceria no quadro até alguém recarregar a página.
   */
  function fecharOuAbrir(aberta: boolean) {
    if (!aberta && criadaId && !deal) onSaved();
    onOpenChange(aberta);
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

  /**
   * Pede ao servidor o PDF e a imagem deste orçamento.
   *
   * Uma função, e não mais o corpo do `onGenerate`, porque agora são DUAS
   * portas para ela: gerar para conferir e gerar para mandar. A impressão
   * digital da 074 é o que torna a segunda barata — apertar "Enviar" logo
   * depois de "Gerar PDF" devolve os mesmos arquivos, sem Chromium de novo.
   *
   * SALVA ANTES, E MANDA SÓ O ID. O corpo carregava as linhas, as parcelas,
   * o frete e o cliente, e o documento arquivado podia dizer o que o banco
   * não dizia — o que estava na tela e não tinha sido gravado, uma linha
   * sem nome que a gravação descarta. Agora a rota lê o pedido gravado
   * (`lib/quotes/from-deal.ts`); daqui só sobe tradução.
   */
  async function gerarArquivos(
    labels: QuoteLabels
  ): Promise<
    { pdfUrl: string | null; imageUrl: string | null } | 'no_browser' | null
  > {
    // O mesmo portão do Salvar: um orçamento com total negativo não sai.
    // `persist` também recusa, mas avisar antes poupa uma ida ao banco.
    if (descontoInvalido) {
      toast.error(t('discountTooLarge'));
      return null;
    }

    // `persist` já avisa quando não grava; aqui só não se segue adiante.
    const dealId = await persist({ silent: true });
    if (!dealId) return null;

    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dealId,
        labels,
        // Traduzido AQUI, onde existe o provider de i18n: a rota lê o
        // CÓDIGO do banco e escolhe o rótulo neste mapa.
        freightModeLabels: Object.fromEntries(
          FREIGHT_PAYER_CODES.map((codigo) => [
            codigo,
            t(FREIGHT_LABEL_KEY[codigo]),
          ])
        ),
      }),
    });
    const dados = await res.json().catch(() => ({}));
    if (res.ok && (dados.pdfUrl || dados.imageUrl)) {
      return { pdfUrl: dados.pdfUrl ?? null, imageUrl: dados.imageUrl ?? null };
    }
    if (dados.error === 'no_browser') return 'no_browser';
    return null;
  }

  /**
   * MANDA O ORÇAMENTO PARA A CONVERSA — como imagem ou como PDF.
   *
   * Pelo MESMO caminho de qualquer mensagem da equipe, `/api/whatsapp/send`,
   * e não por uma rota nova: ele já confere o papel, grava a mensagem na
   * conversa com o nome de quem mandou, e dispara `team_message_sent` —
   * que é o gatilho que move oportunidade. Um orçamento que chegasse ao
   * cliente por fora dele seria invisível para o funil.
   *
   * A legenda leva o número do pedido e o total. Quem recebe uma imagem no
   * meio de uma conversa precisa saber o que é sem abrir; e é essa linha
   * que aparece na prévia da lista de conversas dos dois lados.
   */
  async function enviarOrcamento(
    labels: QuoteLabels,
    como: 'image' | 'document'
  ): Promise<boolean> {
    if (!linkedConversation) return false;

    /*
     * D2: COM OS PEDIDOS NO BLING LIGADOS, o envio registra (ou atualiza) o
     * pedido ANTES de gerar o arquivo — e o PDF sai com o número que o Bling
     * devolveu (`from-deal.ts` prefere `bling_order_number`). Sem pedido
     * sincronizado, nada é enviado: um orçamento na mão do cliente que não
     * existe no Bling é o processo paralelo que a integração veio encerrar.
     */
    const comPedido = orderContext.ordersEnabled && !orderFieldsPending;
    /*
     * Só registra/atualiza o que o Bling aceita atualizar: Em aberto, sem
     * trava. Com o pedido em Compra futura, Em andamento ou fechado, o
     * orçamento sai como está — o cliente que confirmou precisa receber o
     * documento, e sincronizar ali era recusa certa, e o envio cancelado.
     */
    if (comPedido && pedido.syncable) {
      if (!prontidao.ready) {
        toast.error(tOrder('sendNeedsReady'));
        return false;
      }
      if (!(await sincronizarPedido())) return false;
    }
    const marcarEnvio = (evento: 'sent' | 'send_failed') => {
      const id = deal?.id ?? criadaId;
      if (!comPedido || !id) return;
      void fetch(`/api/bling/orders/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: evento }),
      })
        .catch(() => undefined)
        // O quadro relê: o cartão passa a mostrar o pedido (e o envio pendente).
        .then(() => onSaved());
    };

    const arquivos = await gerarArquivos(labels);
    if (arquivos === 'no_browser') {
      toast.error(tQuote('noBrowser'));
      marcarEnvio('send_failed');
      return false;
    }
    const link = como === 'image' ? arquivos?.imageUrl : arquivos?.pdfUrl;
    if (!link) {
      toast.error(tQuote('generateFailed'));
      marcarEnvio('send_failed');
      return false;
    }

    const total = formatCurrencyExact(orcamento.total, orcamento.currency);
    // Com o pedido registrado, o número na legenda e no nome do arquivo é o
    // do Bling — o mesmo que o PDF imprime. O `orcamento` desta função é o
    // do render do clique: um pedido que acabou de nascer na sincronização
    // acima ainda não está nele, e o número vem de `ultimoNumero`.
    const documento = {
      ...orcamento,
      orderNumber: ultimoNumero.current || orcamento.orderNumber,
    };
    const numeroDoPedido = documento.orderNumber;
    const legenda = numeroDoPedido
      ? tQuote('caption', { order: numeroDoPedido, total })
      : tQuote('captionNoOrder', { total });

    const res = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: linkedConversation.id,
        message_type: como,
        media_url: link,
        content_text: legenda,
        // Só o documento tem nome de arquivo — é o que aparece no cartão
        // do lado de lá, e "orcamento-14350.pdf" diz o que é antes de
        // alguém tocar.
        filename:
          como === 'document' ? `${quoteFileName(documento)}.pdf` : undefined,
      }),
    });
    if (res.ok) {
      toast.success(tQuote('sent'));
      marcarEnvio('sent');
      return true;
    }

    // "Envio pendente": o pedido existe no Bling e o cliente não recebeu.
    // Reenviar depois atualiza o mesmo pedido — nunca cria outro.
    marcarEnvio('send_failed');
    const dados = await res.json().catch(() => ({}));
    const motivo = String(dados?.error ?? `HTTP ${res.status}`);
    // 131047 é a Meta dizendo que a janela fechou. Acontece quando ela
    // venceu com o diálogo aberto — a medição acima é de quando ele abriu.
    if (motivo.includes('131047')) {
      setJanela('expired');
      toast.error(tQuote('sendWindowClosed'));
      return false;
    }
    toast.error(tQuote('sendFailed', { reason: motivo }));
    return false;
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
    <Sheet open={open} onOpenChange={fecharOuAbrir}>
      <SheetContent
        side="right"
        size="record"
        className="bg-popover border-border text-popover-foreground w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-border/50 border-b p-4">
            {/*
              O DESFECHO SUBIU PARA A BARRA DE CIMA.

              Pedido do Gabriel em 14 de setembro, com print: "não faz
              sentido ficar lá embaixo sozinha, tem que subir a opção para a
              barra superior que tem espaço sobrando". Ele está certo nos
              dois pontos. Marcar ganho ou perdido é uma decisão sobre a
              oportunidade INTEIRA — não sobre o último campo dela —, e um
              bloco solto depois das tarefas obrigava a rolar até o fim para
              tomá-la. A barra tinha um título de 140px numa gaveta de
              672px.

              `pr-8` abre espaço para o X da sheet, que é absoluto no canto.
              `flex-wrap` porque numa tela estreita o par desce para a linha
              de baixo em vez de espremer o título.
            */}
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <SheetTitle className="text-popover-foreground min-w-0 flex-1 truncate">
                {deal ? t('editDeal') : t('newDeal')}
              </SheetTitle>

              {deal && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {/* O SELO primeiro, e só quando há desfecho: ele diz o
                      estado, os botões mudam o estado. O estado normal —
                      em aberto — não é notícia e não desenha nada. */}
                  {deal.status && deal.status !== 'open' && (
                    <StatusBadge
                      variant={deal.status === 'won' ? 'ok' : 'danger'}
                      size="sm"
                    >
                      {tCard(deal.status === 'won' ? 'won' : 'lost')}
                    </StatusBadge>
                  )}

                  {/* FECHADO, SÓ REABRIR. Antes os três conviviam: um
                      negócio ganho mostrava "Ganho" apagado, "Perdido"
                      aceso e "Reabrir" — três controles para um estado que
                      só tem uma saída. */}
                  {deal.status && deal.status !== 'open' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleStatusChange('open')}
                      disabled={!canWrite || !!statusAction || desfechoPeloPedido}
                      title={desfechoPeloPedido ? tOrder('outcomeViaOrder') : undefined}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {t('reopenDeal')}
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        // Verde tingido, e não azul cheio. Ganho e perdido
                        // são duas saídas simétricas; com um azul sólido ao
                        // lado de um vermelho tingido, o par leria como ação
                        // principal e secundária — e o azul cheio disputaria
                        // com o Salvar, que é o único "aperte aqui" daqui.
                        variant="ok"
                        onClick={() => handleStatusChange('won')}
                        disabled={!canWrite || !!statusAction || desfechoPeloPedido}
                        title={desfechoPeloPedido ? tOrder('outcomeViaOrder') : undefined}
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
                        disabled={!canWrite || !!statusAction || desfechoPeloPedido}
                        title={desfechoPeloPedido ? tOrder('outcomeViaOrder') : undefined}
                      >
                        {statusAction === 'lost' ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <X />
                        )}
                        {tCard('lost')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
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
                disabled={!livre('sales_order_number')}
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
                  disabled={!livre('contact_id')}
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
                  disabled={!livre('assigned_to')}
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
              disabled={!canWrite || !pedidoAberto}
              onChange={handleItems}
              resolveCategory={orderContext.resolveCategory}
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
              {/* COM LINHAS, O VALOR TEM CENTAVOS — é a soma exata delas, e
                  o campo de reais inteiros mostrava R$ 28.009.432 para
                  R$ 28.009.431,52. Desabilitado de qualquer jeito; o que
                  muda é o número não mentir. Sem linhas, o valor digitado
                  continua sendo de reais inteiros, como no resto do app. */}
              {hasLines ? (
                <MoneyInput
                  id="deal-value"
                  value={lineTotalSum}
                  onValueChange={() => {}}
                  currency={currency}
                  disabled
                  className="border-border bg-muted text-foreground"
                />
              ) : (
                <CurrencyInput
                  id="deal-value"
                  value={value}
                  onValueChange={setValue}
                  currency={currency}
                  placeholder="0"
                  disabled={!livre('value')}
                  className="border-border bg-muted text-foreground"
                />
              )}
              {hasLines ? (
                <p className="text-muted-foreground text-2xs">
                  {t('valueFromItems')}
                </p>
              ) : null}
            </div>

            {/*
              OUTRAS DESPESAS E DESCONTO GERAL (078) — os dois termos que a
              conta do pedido de venda tem e esta gaveta não tinha.

              Aqui, logo depois do Valor, e não no bloco de transporte:
              os dois mexem no TOTAL, e é embaixo deles que o total aparece.
              Somem inteiros num banco anterior à 078.

              O desconto tem unidade, como no Bling. Os dois atalhos são
              `ChoiceChip`, a mesma escrita dos estados de transportadora, e
              a dica diz o que mais confunde: o desconto de cada item já
              está na linha dele, e este aqui é outro.
            */}
            {!totalsPending && (
              <div className="grid gap-4 @lg:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel htmlFor="deal-other-expenses">
                    {t('otherExpenses')}
                  </FieldLabel>
                  <MoneyInput
                    id="deal-other-expenses"
                    value={otherExpenses}
                    onValueChange={setOtherExpenses}
                    currency={currency}
                    placeholder="0"
                    disabled={!livre('other_expenses')}
                    className="border-border bg-muted text-foreground"
                  />
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="deal-general-discount">
                      {t('generalDiscount')}
                    </FieldLabel>
                    <div className="flex gap-1">
                      {(['REAL', 'PERCENTUAL'] as const).map((unidade) => (
                        <ChoiceChip
                          key={unidade}
                          active={generalDiscountUnit === unidade}
                          disabled={!livre('general_discount_unit')}
                          onClick={() => setGeneralDiscountUnit(unidade)}
                        >
                          {/* O símbolo da moeda do pedido, o mesmo que o
                              campo de valor desenha, e não um "R$" fixo:
                              a unidade REAL do Bling é "em dinheiro". */}
                          {unidade === 'REAL'
                            ? (CURRENCIES.find((c) => c.code === currency)
                                ?.symbol ?? currency)
                            : '%'}
                        </ChoiceChip>
                      ))}
                    </div>
                  </div>
                  {generalDiscountUnit === 'REAL' ? (
                    <MoneyInput
                      id="deal-general-discount"
                      value={generalDiscount}
                      onValueChange={setGeneralDiscount}
                      currency={currency}
                      placeholder="0"
                      disabled={!livre('general_discount')}
                      aria-invalid={descontoInvalido || undefined}
                      className="border-border bg-muted text-foreground"
                    />
                  ) : (
                    <Input
                      id="deal-general-discount"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.01"
                      value={generalDiscount ?? ''}
                      onChange={(e) =>
                        setGeneralDiscount(
                          e.target.value === '' ? null : Number(e.target.value)
                        )
                      }
                      disabled={!livre('general_discount')}
                      aria-invalid={descontoInvalido || undefined}
                      className="border-border bg-muted text-foreground tabular-nums"
                    />
                  )}
                  <p
                    className={cn(
                      'text-2xs',
                      descontoInvalido
                        ? 'text-danger-ink'
                        : 'text-muted-foreground'
                    )}
                  >
                    {descontoInvalido
                      ? t('discountTooLarge')
                      : t('generalDiscountHint')}
                  </p>
                </div>
              </div>
            )}

            {/*
              A CONTA QUE O ORÇAMENTO VAI IMPRIMIR — produtos, outras
              despesas, frete, desconto, total.

              Só aparece quando há algo além dos produtos: sem nada disso o
              total É o valor, e uma linha repetindo o número que está dois
              campos acima seria ruído. É a mesma soma que o orçamento faz —
              `orderTotals`, feita uma vez, para não existirem dois cálculos
              que podem discordar, que é o que o item 55 proíbe em outras
              palavras.

              Fica ANTES da condição de pagamento de propósito: é este total
              que as parcelas dividem, e vê-lo na linha de cima é o que faz
              "gerar parcelas" ser conferível.
            */}
            {(totais.shippingCents > 0 ||
              totais.otherExpensesCents > 0 ||
              totais.discountCents > 0) && (
              <p className="text-secondary-foreground border-border bg-muted/50 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {[
                    t('breakdownProducts', {
                      value: formatCurrencyExact(produtos, currency),
                    }),
                    totais.otherExpensesCents > 0
                      ? t('breakdownOther', {
                          value: formatCurrencyExact(
                            fromCents(totais.otherExpensesCents),
                            currency
                          ),
                        })
                      : null,
                    totais.shippingCents > 0
                      ? t('breakdownShipping', {
                          value: formatCurrencyExact(
                            fromCents(totais.shippingCents),
                            currency
                          ),
                        })
                      : null,
                    totais.discountCents > 0
                      ? t('breakdownDiscount', {
                          value: formatCurrencyExact(
                            fromCents(totais.discountCents),
                            currency
                          ),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span
                  className={cn(
                    'font-semibold',
                    descontoInvalido ? 'text-danger-ink' : 'text-foreground'
                  )}
                >
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
                // A prazo = data base + dias. A base é a data da venda
                // quando ela foi preenchida (085), e hoje quando não.
                issuedOn={orderFields.saleDate || hojeIso}
                disabled={!canWrite || !pedidoAberto}
                paymentMethods={
                  orderFieldsPending ? undefined : orderContext.paymentMethods
                }
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

              {/*
                COM O CADASTRO (085, D8), a transportadora é uma seleção por
                id — "A definir" é não escolher. O nome continua indo para
                `carrier`, congelado, porque é o que o documento imprime e o
                que o histórico mostra se o cadastro mudar de nome.

                Escolher uma transportadora com frete-por-conta padrão
                preenche o frete por conta, se ele estiver vazio.

                Sem cadastro — banco sem a 085, ou conta que ainda não
                cadastrou nenhuma — continua o texto livre com os dois
                atalhos, como antes.
              */}
              {usaCadastroDeTransportadora ? (
                <div className="grid gap-2">
                  <FieldLabel htmlFor="deal-carrier">{t('carrier')}</FieldLabel>
                  <OptionSelect
                    id="deal-carrier"
                    value={orderFields.carrierId}
                    onValueChange={(id) => {
                      const escolhida =
                        orderContext.carriers.find((c) => c.id === id) ?? null;
                      mudarPedido({ carrierId: id });
                      setCarrier(escolhida?.name ?? '');
                      if (
                        escolhida?.default_freight_payer_code &&
                        !freightMode &&
                        livre('freight_mode')
                      ) {
                        setFreightMode(escolhida.default_freight_payer_code);
                      }
                    }}
                    disabled={!livre('carrier_id')}
                    className="border-border bg-muted text-foreground"
                  >
                    <option value="">{t('carrierTbd')}</option>
                    {orderContext.carriers
                      .filter((c) => c.active || c.id === orderFields.carrierId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </OptionSelect>
                  {transportadoraAtual &&
                    !transportadoraAtual.is_customer_pickup &&
                    !transportadoraAtual.bling_contact_id && (
                      <p className="text-human-ink text-2xs">
                        {t('carrierNotMapped')}
                      </p>
                    )}
                </div>
              ) : (
              <div className="grid gap-2">
                <FieldLabel htmlFor="deal-carrier">{t('carrier')}</FieldLabel>
                <Input
                  id="deal-carrier"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder={t('carrierPlaceholder')}
                  disabled={!livre('carrier')}
                  className="border-border bg-muted text-foreground"
                />
                <div className="flex flex-wrap gap-1.5">
                  {CARRIER_STATES.map((chave) => {
                    const rotulo = t(chave);
                    return (
                      <ChoiceChip
                        key={chave}
                        active={carrier === rotulo}
                        disabled={!livre('carrier')}
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
              )}

              {/* Os três campos da 075 somem juntos quando ela não rodou —
                  frete por conta, volumes e peso bruto. O valor do frete e
                  a transportadora são da 070 e ficam. */}
              <div className="grid gap-4 @lg:grid-cols-2">
                {!installmentsPending && (
                  <div className="grid gap-2">
                    <FieldLabel htmlFor="deal-freight-mode">
                      {t('freightMode')}
                    </FieldLabel>
                    <OptionSelect
                      id="deal-freight-mode"
                      value={freightMode}
                      onValueChange={setFreightMode}
                      disabled={!livre('freight_mode')}
                      className="border-border bg-muted text-foreground"
                    >
                      <option value="">{t('freightModeNone')}</option>
                      {/* O NÚMERO NA FRENTE, como o Bling mostra: quem
                          confere o pedido lá procura "0 - …", e o mesmo
                          número aqui é o que faz as duas telas se lerem
                          lado a lado. O documento do cliente leva só o
                          rótulo. */}
                      {FREIGHT_PAYER_CODES.map((codigo) => (
                        <option key={codigo} value={codigo}>
                          {`${codigo} · ${t(FREIGHT_LABEL_KEY[codigo])}`}
                        </option>
                      ))}
                    </OptionSelect>
                  </div>
                )}

                <div className="grid gap-2">
                  <FieldLabel htmlFor="deal-shipping">
                    {t('shipping')}
                  </FieldLabel>
                  <MoneyInput
                    id="deal-shipping"
                    value={shipping}
                    onValueChange={setShipping}
                    currency={currency}
                    placeholder="0"
                    disabled={!livre('shipping_cost')}
                    aria-describedby={
                      freteEmDobro ? 'deal-shipping-twice' : undefined
                    }
                    className="border-border bg-muted text-foreground"
                  />
                  {/* ÂMBAR, e não vermelho: não é erro, é algo que só quem
                      monta o pedido sabe resolver — a regra de cor da casa
                      para "uma pessoa precisa agir". Ver
                      `shippingCountedTwice`. */}
                  {freteEmDobro ? (
                    <p
                      id="deal-shipping-twice"
                      className="text-human-ink text-2xs"
                    >
                      {t('shippingCountedTwice')}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Volumes e peso bruto: o que a transportadora pergunta ao
                  cotar. Vazios num orçamento que sai antes de alguém pesar
                  nada, e o documento omite o que está vazio. */}
              {!installmentsPending && (
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
                      disabled={!livre('freight_volumes')}
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
                      disabled={!livre('gross_weight')}
                      className="border-border bg-muted text-foreground tabular-nums"
                    />
                  </div>
                </div>
              )}
            </div>

            {/*
              A ÁREA PEDIDO (085) — depois do transporte, porque ela resume
              tudo o que veio antes: a lista "Pronto para o Bling" aponta
              para o cliente, os produtos, as parcelas e a transportadora lá
              em cima. Some inteira num banco sem a 085.
            */}
            {!orderFieldsPending && !installmentsPending && !totalsPending && (
              <DealOrderSection
                orderStatus={pedido.orderStatus}
                syncStatus={pedido.syncStatus}
                syncError={pedido.syncError}
                blingOrderNumber={pedido.blingOrderNumber}
                ordersEnabled={orderContext.ordersEnabled}
                hasBlingOrder={!!pedido.blingOrderId}
                onChangeStatus={(destino) => void mudarSituacao(destino)}
                // Salvando também: registrar no meio de um "Salvar" gravaria
                // duas vezes a oportunidade nova.
                syncBusy={sincronizando || saving}
                canSync={pedido.open}
                // O quadro relê depois: a oportunidade agora é pedido, e o
                // cartão (e a próxima abertura da gaveta) precisa saber.
                onSync={() => void sincronizarPedido().then(() => onSaved())}
                lock={trava}
                disabled={!canWrite}
                canAuthorizeWeight={canAuthorize}
                fields={orderFields}
                onChange={mudarPedido}
                readiness={prontidao}
                lines={items}
                categoryLabels={orderContext.categoryLabels}
                grossWeight={grossWeight}
                onUseWeight={(kg) => setGrossWeight(kg)}
                currency={currency}
                showReadiness={orderContext.blingConfigured}
              />
            )}

            <div className="grid gap-2">
              <FieldLabel htmlFor="deal-notes">{t('notes')}</FieldLabel>
              <Textarea
                id="deal-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('notesPlaceholder')}
                disabled={!livre('notes')}
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
                  disabled={!livre('stage_id') || sincronizando}
                  className="border-border bg-muted text-foreground"
                >
                  {stages.map((s) => (
                    // A regra do arrasto no quadro vale aqui: com contas
                    // lançadas, só a etapa da situação do pedido. O seletor
                    // era a porta que o quadro fechou.
                    <option
                      key={s.id}
                      value={s.id}
                      disabled={
                        s.id !== stageId &&
                        !dragAllowed({
                          orderStatus: pedido.orderStatus,
                          accountsLaunchedAt: pedido.accountsLaunchedAt,
                          targetStageName: s.name,
                        })
                      }
                    >
                      {s.name}
                    </option>
                  ))}
                </OptionSelect>
                {pedido.accountsLaunchedAt && (
                  <p className="text-muted-foreground text-2xs">
                    {t('stageFollowsOrder')}
                  </p>
                )}
              </div>
            ) : (
              // Uma frase e não um campo. Onde a oportunidade vai cair não é
              // uma escolha aqui, mas continua sendo uma informação — e um
              // negócio que aparece numa coluna que ninguém nomeou é o tipo
              // de surpresa que faz procurar no quadro inteiro.
              stages.find((st) => st.id === stageId) && (
                <p className="text-muted-foreground text-2xs">
                  {t('stageOnCreate', {
                    stage: stages.find((st) => st.id === stageId)?.name ?? '',
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

            {/*
              O QUE SOBROU AQUI EMBAIXO: o MOTIVO da perda, que é
              informação, não ação.

              Os botões subiram para a barra (ver o cabeçalho). O motivo
              fica, e fica aqui, porque ele se lê junto com o resto da
              ficha — e porque marcar como perdido EXIGE um motivo que
              antes não aparecia em superfície nenhuma depois de gravado.

              O guard existe porque `noReply` saiu de `LOSS_REASONS` com o
              fluxo oficial e segue no catálogo, justamente para as perdas
              antigas: sem ele uma linha com chave desconhecida faz `t()`
              estourar. O ícone dessa mesma chave não existe mais, e por
              isso é opcional.
            */}
            {deal?.status === 'lost' &&
              (deal.lost_reason || deal.lost_note) && (
                <div className="border-border bg-muted/50 space-y-1.5 rounded-lg border p-3">
                  <p className="text-muted-foreground eyebrow">
                    {tOutcome('reasonLabel')}
                  </p>
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
                onClick={() => fecharOuAbrir(false)}
                className="border-border text-muted-foreground hover:bg-muted bg-transparent"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleSave}
                // O título saiu daqui junto com o campo (item 39): quem o
                // preenche é `tituloDerivado`, e ele nunca é vazio quando
                // há contato — que é a condição ao lado.
                disabled={
                  !canWrite ||
                  saving ||
                  // Enquanto a fila trabalha, a trava e a etapa podem estar
                  // mudando por baixo: salvar agora reescreveria itens de um
                  // pedido que o Bling acabou de lançar.
                  sincronizando ||
                  !contactId ||
                  !stageId ||
                  descontoInvalido
                }
              >
                {saving
                  ? t('saving')
                  : deal
                    ? t('saveChanges')
                    : t('createDeal')}
              </Button>
            </div>

            {/* Oportunidade que já é pedido no Bling não se apaga — o
                gatilho da 085 recusa, e o pedido ficaria órfão lá. A frase
                no lugar do botão diz por quê. */}
            {deal && canWrite && pedido.isOrder && (
              <p className="text-muted-foreground text-2xs mt-3">
                {t('deleteBlockedOrder')}
              </p>
            )}
            {deal &&
              canWrite &&
              !pedido.isOrder &&
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
         * ARQUIVAR E RENDERIZAR VIRARAM A MESMA CHAMADA — `gerarArquivos`.
         *
         * A rota grava, desenha e sobe os arquivos, na ordem certa, porque
         * só ela pode: o Chromium é do servidor, e os totais precisam ser
         * refeitos longe de quem os enviou.
         */
        onGenerate={async (labels) => {
          const arquivos = await gerarArquivos(labels);
          if (arquivos === 'no_browser') return false;
          if (arquivos?.pdfUrl) {
            // Uma aba nova e não um download forçado: quem gerou quer
            // CONFERIR antes de mandar, e o visualizador do navegador é
            // onde isso acontece sem baixar nada.
            window.open(arquivos.pdfUrl, '_blank', 'noopener');
            toast.success(tQuote('generated'));
            return true;
          }
          toast.error(tQuote('generateFailed'));
          return true;
        }}
        send={
          // Só para quem pode mandar mensagem, e só com um contato escolhido
          // — sem os dois não há para quem, nem quem.
          canWrite && contactId
            ? {
                recipient: contatoAtual?.name || contatoAtual?.phone || '',
                blocked: !linkedConversation
                  ? 'noConversation'
                  : janela === 'expired'
                    ? 'window'
                    : janela === 'none'
                      ? 'noConversation'
                      : null,
                conversationHref: linkedConversation
                  ? `/inbox?c=${linkedConversation.id}`
                  : null,
                onSend: enviarOrcamento,
              }
            : undefined
        }
      />

      <DealOutcomeDialogs {...outcome.dialogProps} />
    </Sheet>
  );
}
