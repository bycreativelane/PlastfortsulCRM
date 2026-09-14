'use client';

import { useEffect, useState } from 'react';

import type {
  ConversationsSeriesPoint,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types';
import {
  AlertTriangle,
  Clock,
  Inbox,
  MessagesSquare,
  Send,
  UserPlus,
  Wallet,
  Zap,
} from 'lucide-react';

import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { MetricStrip } from '@/components/dashboard/metric-strip';
import { PipelineFunnel } from '@/components/dashboard/pipeline-funnel';
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader, PanelSub } from '@/components/ui/panel';
import { SectionTitle } from '@/components/ui/section-title';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AttentionRow } from '@/components/dashboard/attention-row';
import { StatTile } from '@/components/ui/stat-tile';
import { BoardLane } from '@/components/pipelines/board-lane';
import { DealCard } from '@/components/pipelines/deal-card';
import { TasksBoard } from '@/components/tasks/tasks-board';
import { DealQuote } from '@/components/pipelines/deal-quote';
import { PreviewCard } from '@base-ui/react/preview-card';
import {
  TeamRoomPreviewList,
  TeamRoomPreviewPopup,
} from '@/components/layout/team-room-preview';
import type { TeamMessage } from '@/lib/team/messages';
import { MentionPanel, MentionText } from '@/components/inbox/team-mentions';
import { cn } from '@/lib/utils';
import { playNotificationSound } from '@/lib/notifications/sound';
import { NotificationsPanel } from '@/components/settings/notifications-panel';
import type { TeamRoom } from '@/lib/team/rooms';
import { buildQuote } from '@/lib/quotes/quote';
import { TaskDialog } from '@/components/tasks/task-dialog';
import { TaskColumnsHeader, TaskRow } from '@/components/tasks/task-row';
import { TasksCalendar } from '@/components/tasks/tasks-calendar';
import { FilterChip } from '@/components/ui/filter-chip';
import { PeriodPicker } from '@/components/dashboard/period-picker';
import { periodFromPreset } from '@/lib/dashboard/period';
import { CurrencyInput } from '@/components/ui/currency-input';
import { PhoneInput } from '@/components/ui/phone-input';
import { SegBar } from '@/components/ui/seg-bar';
import { useTranslations } from 'next-intl';
import type { Deal, PipelineStage, Task } from '@/types';

/**
 * A bench for the chart components, outside the login wall.
 *
 * ------------------------------------------------------------------
 * WHY THIS EXISTS
 * ------------------------------------------------------------------
 *
 * Every screen these components appear on lives under `(dashboard)`,
 * which `proxy.ts` guards. That is correct for the product and it makes
 * the charts unreviewable by anyone who is not already signed in — so a
 * design pass on them had been running on hand-built HTML mock-ups
 * instead. A mock-up reproduces the markup its author already believes
 * in. It cannot show a defect that comes from the real data shape, the
 * real panel width, or what Recharts actually emits, which is exactly
 * the class of defect that kept surviving review.
 *
 * This route mounts the REAL components against fixtures that match the
 * real result shapes, at the real widths, in both themes. Same
 * precedent as the `agenda-lab` route that came before it: app root,
 * outside `(dashboard)`, so it is not in `PROTECTED_PATHS` and
 * `middleware.test.ts` does not ask it to be.
 *
 * Fixtures, never a query. Nothing here touches Supabase, so it renders
 * the same on any machine and cannot show anybody else's numbers.
 */

/** Eight stages with the board's own colours — the real spread. */
const PIPELINE: PipelineDonutData = {
  totalValue: 113_201,
  stages: [
    {
      id: '1',
      name: 'Novo Lead',
      color: '#7c5cff',
      dealCount: 4,
      totalValue: 7_300,
    },
    {
      id: '2',
      name: 'Em Aberto',
      color: '#e0a020',
      dealCount: 3,
      totalValue: 9_800,
    },
    {
      id: '3',
      name: 'Em Negociação',
      color: '#1a9fb5',
      dealCount: 3,
      totalValue: 18_430,
    },
    {
      id: '4',
      name: 'Resolvido',
      color: '#22a06b',
      dealCount: 1,
      totalValue: 0,
    },
    {
      id: '5',
      name: 'Em Andamento',
      color: '#2f5fd0',
      dealCount: 2,
      totalValue: 3_120,
    },
    {
      id: '6',
      name: 'Follow-up',
      color: '#12b5a0',
      dealCount: 6,
      totalValue: 42_751,
    },
    {
      id: '7',
      name: 'Geladeira 30 dias',
      color: '#8b93a7',
      dealCount: 5,
      totalValue: 25_100,
    },
    {
      id: '8',
      name: 'Pós-venda',
      color: '#12b58f',
      dealCount: 2,
      totalValue: 6_700,
    },
  ],
};

/** Thirty days with a quiet stretch and a spike — the shape that broke the axis. */
const SERIES: ConversationsSeriesPoint[] = Array.from(
  { length: 30 },
  (_, i) => {
    const day = `2026-08-${String(i + 1).padStart(2, '0')}`;
    if (i < 12) return { day, incoming: 0, outgoing: 0 };
    if (i < 20) return { day, incoming: 4, outgoing: 4 };
    if (i < 25) return { day, incoming: 10, outgoing: 8 };
    return { day, incoming: 0, outgoing: 0 };
  }
);

const RESPONSE: ResponseTimeSummary = {
  buckets: [
    { dow: 0, avgMinutes: 72, samples: 9 },
    { dow: 1, avgMinutes: 132, samples: 6 },
    { dow: 2, avgMinutes: 180, samples: 4 },
    { dow: 3, avgMinutes: 178, samples: 5 },
    { dow: 4, avgMinutes: 176, samples: 7 },
    { dow: 5, avgMinutes: 175, samples: 2 },
    { dow: 6, avgMinutes: 158, samples: 3 },
  ],
  thisWeekAvg: null,
  lastWeekAvg: 72,
};

/**
 * Dev only.
 *
 * The route is not under `(dashboard)` — that is what keeps it outside
 * `proxy.ts` and reviewable without a session, which is the entire point
 * of it — and "outside the auth guard" plus "shipped to production" is
 * not a pair worth having, even for a page that renders nothing but
 * fixtures. It renders nothing at all in a production build.
 */
/**
 * O funil, em fixtures.
 *
 * Cinco cartoes escolhidos para cobrir o que o desenho tem de decidir: nome
 * curto e nome longo, com e sem empresa, titulo de uma e de duas linhas,
 * playbook pela metade e playbook fechado, ganho e perdido, com e sem
 * responsavel, e um negocio parado ha muito tempo — que e a informacao que a
 * 065 guarda no banco e o cartao nunca mostrou.
 */
const LAB_STAGES: PipelineStage[] = [
  {
    id: 'st-1',
    pipeline_id: 'p1',
    name: 'Qualificação',
    color: '#3b82f6',
    position: 0,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'st-2',
    pipeline_id: 'p1',
    name: 'Proposta enviada',
    color: '#f59e0b',
    position: 1,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'st-3',
    pipeline_id: 'p1',
    name: 'Fechamento',
    color: '#10b981',
    position: 2,
    created_at: '2026-01-01T00:00:00Z',
  },
];

function labDeal(deal: Partial<Deal> & { id: string; title: string }): Deal {
  return {
    user_id: 'u1',
    pipeline_id: 'p1',
    stage_id: 'st-1',
    contact_id: 'c1',
    value: 0,
    currency: 'BRL',
    status: 'open',
    created_at: '2026-08-01T00:00:00Z',
    ...deal,
  } as Deal;
}

const labTag = (name: string, color: string) => ({
  id: name,
  user_id: 'u1',
  name,
  color,
  created_at: '2026-01-01T00:00:00Z',
});

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

const LAB_DEALS: Record<string, Deal[]> = {
  'st-1': [
    labDeal({
      id: 'd1',
      title: 'Reposição de caixas plásticas 60L para o CD de Cachoeirinha',
      value: 18400,
      stage_entered_at: daysAgo(3),
      expected_close_date: '2026-09-19',
      contact: {
        name: 'Marcos Andrade',
        company: 'Distribuidora Sul Ltda.',
        tags: [labTag('Cliente antigo', '#10b981')],
      } as Deal['contact'],
      assignee: { full_name: 'Gabriel Spencer' } as Deal['assignee'],
    }),
    labDeal({
      id: 'd2',
      title: 'Pallets PBR',
      value: 6250,
      stage_entered_at: daysAgo(0),
      contact: { name: '+55 51 99812-4471' } as Deal['contact'],
    }),
  ],
  'st-2': [
    labDeal({
      id: 'd3',
      stage_id: 'st-2',
      title: 'Contentor 1000L com dispensador — 12 unidades',
      value: 47900,
      stage_entered_at: daysAgo(41),
      expected_close_date: '2026-08-28',
      contact: {
        name: 'Juliana Prestes',
        company: 'Agroindustrial Vale Verde',
        tags: [
          labTag('Alto volume', '#f59e0b'),
          labTag('Licitacao', '#3b82f6'),
          labTag('Sul', '#8b5cf6'),
        ],
      } as Deal['contact'],
      assignee: { full_name: 'Marina Rocha' } as Deal['assignee'],
    }),
    labDeal({
      id: 'd4',
      stage_id: 'st-2',
      title: 'Bombonas 200L',
      value: 9800,
      stage_entered_at: daysAgo(9),
      contact: {
        name: 'Rafael Kunz',
        company: 'Kunz Transportes',
      } as Deal['contact'],
      assignee: { full_name: 'Gabriel Spencer' } as Deal['assignee'],
    }),
  ],
  'st-3': [
    labDeal({
      id: 'd5',
      stage_id: 'st-3',
      title: 'Engradados retornáveis — contrato anual',
      value: 132000,
      status: 'won',
      stage_entered_at: daysAgo(2),
      contact: {
        name: 'Ana Beatriz Camargo',
        company: 'Bebidas Serra Gaúcha',
      } as Deal['contact'],
      assignee: { full_name: 'Marina Rocha' } as Deal['assignee'],
    }),
  ],
};

const LAB_PLAYBOOK: Record<string, { done: number; total: number }> = {
  d1: { done: 2, total: 5 },
  d3: { done: 1, total: 6 },
  d5: { done: 4, total: 4 },
};

/**
 * As tarefas, em fixtures.
 *
 * O mesmo criterio do funil: uma tarefa por caso que o desenho tem de
 * decidir. Titulo curto e longo, cada tipo do catalogo, atrasada, vencendo
 * hoje, sem prazo, concluida e cancelada.
 */
const LAB_TODAY = new Date().toISOString().slice(0, 10);
const shiftDay = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function labTask(task: Partial<Task> & { id: string; title: string }): Task {
  return {
    account_id: 'a1',
    contact_id: 'c1',
    kind: 'call',
    status: 'open',
    created_by: 'u1',
    created_at: '2026-09-01T00:00:00Z',
    ...task,
  } as Task;
}

const LAB_TASKS: Task[] = [
  labTask({
    id: 't1',
    title: 'Ligar para o Marcos sobre a proposta das caixas 60L',
    kind: 'call',
    due_on: shiftDay(-2),
  }),
  labTask({
    id: 't2',
    title: 'Enviar catálogo atualizado',
    kind: 'followup',
    due_on: LAB_TODAY,
    due_time: '14:30:00',
  }),
  labTask({
    id: 't3',
    title: 'Visita técnica na Agroindustrial Vale Verde',
    kind: 'visit',
    due_on: shiftDay(3),
  }),
  labTask({ id: 't4', title: 'Conferir estoque de bombonas', kind: 'todo' }),
  // TRES NA MESMA HORA, de proposito: e o caso que a grade nao sabia
  // desenhar — os tres ficavam um em cima do outro e so o ultimo aparecia.
  labTask({
    id: 't7',
    title: 'Ligar para a Juliana',
    kind: 'call',
    due_on: LAB_TODAY,
    due_time: '09:00:00',
  }),
  labTask({
    id: 't8',
    title: 'Reuniao de alinhamento',
    kind: 'meeting',
    due_on: LAB_TODAY,
    due_time: '09:00:00',
  }),
  labTask({
    id: 't9',
    title: 'Orcamento Frigorifico Baldi',
    kind: 'quote',
    due_on: LAB_TODAY,
    due_time: '09:15:00',
  }),
  labTask({
    id: 't5',
    title: 'Mandar orçamento dos pallets PBR',
    kind: 'quote',
    status: 'done',
    due_on: LAB_TODAY,
    due_time: '10:00:00',
  }),
  /*
   * NENHUMA CANCELADA, e isso é o fixture fazendo o seu trabalho.
   *
   * O Gabriel fotografou o quadro com "Concluídas · 0" e "Canceladas · 0", e
   * a bancada tinha uma tarefa em cada coluna — então o estado VAZIO, que é o
   * que ele apontou, não aparecia aqui. Com a coluna cancelada vazia o quadro
   * mostra as duas coisas de uma vez: uma coluna com carga e uma sem.
   */
];

const ENABLED = process.env.NODE_ENV !== 'production';

export default function ChartLabPage() {
  const [mode, setMode] = useState<'light' | 'dark'>('light');

  // The lab drives the same attribute the theme boot script writes, so
  // the components resolve their tokens exactly as they do in the app.
  useEffect(() => {
    const previous = document.documentElement.dataset.mode;
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.theme ||= 'plastfortsul';
    return () => {
      if (previous) document.documentElement.dataset.mode = previous;
    };
  }, [mode]);

  if (!ENABLED) return null;

  return (
    <div className="bg-background min-h-screen p-6">
      <div className="max-w-page mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-foreground text-lg font-bold tracking-tight">
            Chart lab
          </h1>
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'light' ? 'dark' : 'light'))}
            className="border-border bg-card text-secondary-foreground hover:bg-muted inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold"
          >
            {mode === 'light' ? 'Ver no escuro' : 'Ver no claro'}
          </button>
        </div>

        {/* THE FORM CONTROLS, for the same reason the charts are here.
            Every field in this product lives behind the login wall, so
            a pass on their border weight and corner radius had nowhere
            to happen. These are the real components with the real
            tokens — a checkbox beside a text field beside a select is
            exactly the comparison that matters, because they share one
            `--input` and it has to work at 16px and at 32px. */}
        <Panel className="p-4">
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="lab-name">Nome de exibição</FieldLabel>
              <Input id="lab-name" defaultValue="Gabriel Spencer" />
            </Field>
            <Field>
              <FieldLabel htmlFor="lab-city">Cidade</FieldLabel>
              <Input id="lab-city" placeholder="Buscar por nome…" />
            </Field>
            <Field>
              <FieldLabel htmlFor="lab-uf">Situação de compra</FieldLabel>
              <Select value="any" onValueChange={() => {}}>
                <SelectTrigger id="lab-uf" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Qualquer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="flex items-center gap-4">
            <label className="text-secondary-foreground flex items-center gap-2 text-xs font-medium">
              <Checkbox defaultChecked />
              Excluir quem não quer receber
            </label>
            <label className="text-secondary-foreground flex items-center gap-2 text-xs font-medium">
              <Checkbox />
              Somente com compra
            </label>
            <Button variant="outline" size="sm">
              Criar campanha
            </Button>
          </div>
        </Panel>

        {/* The top of /relatórios: hero + strip, at the page's real
            width. This is the row the metric redesign is about — a
            fixture here is the only way to see it without a session. */}
        <MetricStrip
          loading={false}
          hero={{
            key: 'openDealsValue',
            label: 'Valor em aberto',
            window: 'agora',
            icon: <Wallet />,
            value: 'R$ 113.201',
            note: '8 oportunidades abertas',
          }}
          readings={[
            {
              key: 'activeConversations',
              label: 'Conversas ativas',
              window: 'agora',
              icon: <MessagesSquare />,
              value: '1',
            },
            {
              key: 'newContacts',
              label: 'Novos contatos',
              window: 'hoje',
              icon: <UserPlus />,
              value: '12',
              delta: 33,
              deltaLabel: 'vs. ontem',
            },
            {
              key: 'messagesSent',
              label: 'Mensagens enviadas',
              window: 'hoje',
              icon: <Send />,
              value: '46',
              delta: -18,
              deltaLabel: 'vs. ontem',
            },
          ]}
        />

        {/* The dashboard's "Precisa de você" column, at the width it
            actually gets — a quarter of the page, beside the agenda.
            The agenda itself queries Supabase so it cannot be mounted
            here; what matters at this width is the ROW, and whether a
            tinted one still reads from across the desk without being
            the loudest thing on screen. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="flex min-w-0 flex-col xl:col-span-1">
            <Panel className="divide-border divide-y overflow-hidden">
              <AttentionRow
                href="#"
                icon={<Inbox />}
                tone="auto"
                value={0}
                label="conversas não lidas aguardando resposta"
              />
              <AttentionRow
                href="#"
                icon={<UserPlus />}
                tone="human"
                value={5}
                label="na fila, sem responsável"
              />
              <AttentionRow
                href="#"
                icon={<Clock />}
                tone="human"
                value={7}
                label="oportunidades paradas há 7 dias"
              />
              <AttentionRow
                href="#"
                icon={<AlertTriangle />}
                tone="danger"
                value={2}
                label="automações falharam hoje"
              />
            </Panel>
            <SectionTitle tone="auto" className="mt-6 shrink-0">
              <Zap />O CRM fez hoje
            </SectionTitle>
            <Panel className="flex min-h-0 flex-1 flex-col">
              <PanelHeader>
                <PanelSub>Informativo — não é lista de tarefas</PanelSub>
              </PanelHeader>
              <PanelBody flush className="min-h-0 flex-1">
                {[
                  { n: 4, label: 'follow-ups enviados' },
                  { n: 2, label: 'contatos criados pela API' },
                  { n: 1, label: 'campanha concluída' },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="border-border flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
                  >
                    <span className="min-w-5 text-base font-bold tabular-nums">
                      {row.n}
                    </span>
                    <span className="text-secondary-foreground min-w-0 flex-1 truncate text-sm">
                      {row.label}
                    </span>
                  </div>
                ))}
              </PanelBody>
            </Panel>
          </div>
          <div className="border-border text-muted-foreground grid min-h-115 place-items-center rounded-xl border border-dashed text-xs xl:col-span-3">
            Agenda ocupa esta faixa (~460px, precisa de sessão)
          </div>
        </div>

        {/* `StatTile` as the broadcast report uses it — the only place
            left, now that the dashboard's states are rows in a column
            beside the agenda. Four tones side by side, because the fill
            is the whole signal and it has to survive both modes. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            tone="auto"
            icon={<Inbox />}
            value={0}
            label="conversas não lidas aguardando resposta"
          />
          <StatTile
            tone="human"
            icon={<UserPlus />}
            value={5}
            label="na fila, sem responsável"
          />
          <StatTile
            tone="auto"
            icon={<Clock />}
            value={0}
            label="oportunidades paradas há 7 dias"
          />
          <StatTile
            tone="danger"
            icon={<AlertTriangle />}
            value={2}
            label="automações falharam hoje"
          />
        </div>

        {/* The real row from /relatórios, INCLUDING the `h-full min-w-0`
            wrappers. They are not decoration: they are what makes the
            row as tall as the funnel, which is the condition
            `ChartSurface fill` exists for. Without them the lab would
            show a 260px plot and the page a 500px one. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-full min-w-0">
            <ConversationsChart
              data={SERIES}
              previous={{ incoming: 124, outgoing: 160 }}
              loading={false}
            />
          </div>
          <div className="h-full min-w-0">
            <PipelineFunnel data={PIPELINE} loading={false} currency="BRL" />
          </div>
        </div>

        {/* O FUNIL, COM AS PECAS REAIS.
            Este quadro e a tela que o Gabriel reprovou, e ela vive atras do
            login — foi por isso que o redesenho dela vinha sendo discutido
            sobre maquetes. `BoardLane` e `DealCard` sao os componentes que a
            producao usa; so os dados sao fixtures. */}
        <SectionTitle>Funil</SectionTitle>
        <div className="bg-background flex gap-3 overflow-x-auto rounded-xl p-3">
          {LAB_STAGES.map((stage) => (
            <BoardLane
              key={stage.id}
              color={stage.color}
              name={stage.name}
              count={(LAB_DEALS[stage.id] ?? []).length}
              subtitle={new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
                maximumFractionDigits: 0,
              }).format(
                (LAB_DEALS[stage.id] ?? []).reduce((n, d) => n + d.value, 0)
              )}
              className="h-100"
              onAdd={() => {}}
              addLabel="Adicionar negócio"
            >
              {(LAB_DEALS[stage.id] ?? []).map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  stage={stage}
                  onEdit={() => {}}
                  playbook={LAB_PLAYBOOK[deal.id]}
                />
              ))}
            </BoardLane>
          ))}
        </div>

        {/* O QUADRO DE TAREFAS, tambem com a peca real. E a tela que abriu
            este redesenho, e ela divide a raia com o funil agora — se as
            duas divergirem de novo, e aqui que aparece, lado a lado. */}
        <SectionTitle>Tarefas</SectionTitle>
        {/* `flex flex-col` pela mesma razão do calendário logo abaixo: o
            trilho do quadro é `min-h-0 flex-1` e precisa de um pai FLEX para
            ter o que dividir. Com um bloco de altura fixa as colunas cresciam
            para caber os cartões e vazavam por cima da seção seguinte — na
            página de tarefas quem dá esse pai é o shell de altura contida. */}
        <div className="bg-background flex h-100 flex-col rounded-xl p-3">
          <TasksBoard
            tasks={LAB_TASKS}
            todayIso={LAB_TODAY}
            busyId={null}
            onChangeStatus={() => {}}
            onOpen={() => {}}
            onCreate={() => {}}
          />
        </div>

        {/* A LISTA, com a linha real. As tres visoes de /tasks mostram a
            mesma tarefa, e e aqui que da para conferir se elas concordam. */}
        <SectionTitle>Tarefas — lista</SectionTitle>
        <TaskListBench />

        {/* O CALENDARIO e a fileira de controles.
            Os dois controles segmentados e os chips de filtro sao os que o
            Gabriel fotografou colados; e aqui que da para conferir sem
            sessao. */}
        <SectionTitle>Tarefas — calendário</SectionTitle>
        <ControlsBench />
        {/* `flex flex-col` e nao so `h-140`: o `flex-1` da raiz do
            calendario precisa de um pai FLEX para ter o que dividir — na
            pagina de tarefas quem da isso e o shell de altura contida. */}
        <div className="flex h-140 flex-col rounded-xl">
          <TasksCalendar tasks={LAB_TASKS} onSelectTask={() => {}} />
        </div>

        {/* OS CAMPOS DA FICHA DO CONTATO.
            O Gabriel fotografou o campo de telefone desalinhado dos irmãos,
            e a ficha é autenticada. Esta é a mesma grade, com os mesmos
            componentes: se o telefone voltar a divergir do nome ao lado, é
            aqui que aparece sem precisar de sessão. */}
        <SectionTitle>Contato — campos</SectionTitle>
        <FieldsBench />

        {/* O SELETOR DE PERÍODO dos relatórios.
            Ele vive em /reports, autenticado, e os dois campos de data dele
            são `<input type="date">` nativos — o controle que o `date-field`
            documenta como proibido. Trocar pelo `DateField` põe um Popover
            dentro de outro, coisa que este repo não faz em lugar nenhum: é
            aqui que dá para ver se o de fora sobrevive ao de dentro. */}
        <SectionTitle>Relatórios — período</SectionTitle>
        <PeriodPickerBench />

        {/* O CAMPO DE DINHEIRO, irmão do telefone.
            Os dois têm a mesma máquina de caret e o mesmo problema em
            potencial: apagar um separador não muda os dígitos. Este aparece
            no negócio, no desfecho, no produto e no ticket médio — quatro
            telas, todas autenticadas. */}
        <SectionTitle>Dinheiro — campo mascarado</SectionTitle>
        <MoneyBench />

        {/* O DIÁLOGO DE TAREFA, que é o popup mais aberto do produto.
            Ele vive em três telas, todas autenticadas, e por isso nunca tinha
            sido olhado de fora. É o que o Gabriel chama de popup. */}
        <SectionTitle>Tarefa — diálogo</SectionTitle>
        <TaskDialogBench />

        <SectionTitle>Orçamento — o documento</SectionTitle>
        <QuoteBench />

        <SectionTitle>Minha equipe — a prévia do card</SectionTitle>
        <TeamPreviewBench />

        <SectionTitle>Minha equipe — @menções</SectionTitle>
        <MentionBench />

        <SectionTitle>Notificações — as preferências do perfil</SectionTitle>
        {/* O painel de verdade, que vive em Configurações › Seu perfil. Ele
            só lê o navegador, então cabe aqui inteiro — inclusive os
            interruptores, que valem para esta máquina. */}
        <div className="max-w-xl">
          <NotificationsPanel />
        </div>

        <SectionTitle>Aviso sonoro</SectionTitle>
        {/* Os dois toques, para OUVIR. Sem fixture nenhuma: o som não lê
            dado, e o que se confere aqui é se ele é um "plim" e não um apito,
            e se a menção se distingue de ouvido. Respeita o botão do sino —
            desligado lá, estes botões ficam mudos também. */}
        <Panel className="flex flex-wrap gap-2 p-4">
          <Button
            variant="outline"
            onClick={() => playNotificationSound('new_message')}
          >
            Tocar — mensagem de cliente
          </Button>
          <Button
            variant="outline"
            onClick={() => playNotificationSound('team_mention')}
          >
            Tocar — menção na equipe
          </Button>
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ResponseTimeChart data={RESPONSE} loading={false} />
          {/* The dashboard's density, at the dashboard's width. */}
          <div className="max-w-sm">
            <PipelineFunnel
              data={PIPELINE}
              loading={false}
              currency="BRL"
              density="compact"
              showTotal
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A grade de campos da ficha do contato, com as peças reais.
 *
 * Quatro campos, e o de telefone é de um componente diferente dos outros
 * três — que é exatamente a razão de esta seção existir. Lado a lado,
 * qualquer divergência de altura, raio, preenchimento ou largura entre o
 * `PhoneInput` e o `Input` da casa fica visível sem abrir a ficha.
 */
function FieldsBench() {
  const [name, setName] = useState('Juliana Prestes');
  const [phone, setPhone] = useState('+555199000002');
  const [email, setEmail] = useState('juliana.prestes@cotrisel.coop.br');
  const [company, setCompany] = useState('Cooperativa Cotrisel');

  return (
    <Panel className="@container p-4">
      <div className="grid gap-3 @sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="lab-name">Nome</FieldLabel>
          <Input
            id="lab-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-muted border-border text-foreground"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="lab-phone">
            Telefone <span className="text-danger-ink">*</span>
          </FieldLabel>
          <PhoneInput
            id="lab-phone"
            value={phone}
            onValueChange={setPhone}
            className="bg-muted border-border text-foreground"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="lab-email">E-mail</FieldLabel>
          <Input
            id="lab-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-muted border-border text-foreground"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="lab-company">Empresa</FieldLabel>
          <Input
            id="lab-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="bg-muted border-border text-foreground"
          />
        </div>
      </div>
    </Panel>
  );
}

function TaskDialogBench() {
  const [novo, setNovo] = useState(false);
  const [edicao, setEdicao] = useState(false);
  return (
    <Panel className="flex flex-wrap gap-2 p-4">
      <Button variant="outline" onClick={() => setNovo(true)}>
        Abrir — tarefa nova
      </Button>
      <Button variant="outline" onClick={() => setEdicao(true)}>
        Abrir — tarefa atrasada
      </Button>
      <TaskDialog open={novo} onOpenChange={setNovo} />
      {/* A atrasada, porque o selo de atraso e os presets de prazo só
          aparecem editando — e é o estado que mais se abre. */}
      <TaskDialog open={edicao} onOpenChange={setEdicao} task={LAB_TASKS[0]} />
    </Panel>
  );
}

/**
 * O ORÇAMENTO, e ele cabe aqui porque é puro.
 *
 * `DealQuote` recebe um objeto `Quote` e desenha — não consulta nada, ao
 * contrário da gaveta da oportunidade que o abre. É a única peça do
 * bloco 38–59 do pacote que dá para olhar sem sessão, e é justamente a
 * que mais precisa ser olhada: o item 53 é inteiro sobre aparência.
 *
 * Dois estados, porque as diferenças são de omissão. O documento omite
 * frete não definido, observação vazia, transportador e responsável — e
 * um orçamento só de valor, sem produto nenhum, é o caminho mais comum
 * hoje, antes de o catálogo estar preenchido.
 *
 * O completo passou a carregar o que a 075 acrescentou — condição de
 * pagamento com parcelas, código e unidade nas linhas, frete por conta,
 * volumes e peso bruto. O enxuto continua sem NADA disso, e é ele que
 * prova que os blocos novos somem em vez de saírem vazios.
 */
/** A identidade que a 072 passou a guardar, para o documento ter o que
 *  imprimir no cabeçalho e no rodapé. */
const MARCA = {
  name: 'PlastfortSul',
  legalName: 'Plastfort Sul Embalagens Ltda.',
  taxId: 'CNPJ 12.345.678/0001-90',
  phone: '+55 (47) 3333-4444',
  email: 'comercial@plastfortsul.com.br',
  site: 'plastfortsul.com.br',
  address: 'Joinville · SC',
  logoUrl: null,
};

function QuoteBench() {
  const [completo, setCompleto] = useState(false);
  const [magro, setMagro] = useState(false);
  const [comEnvio, setComEnvio] = useState(false);
  const [janelaFechada, setJanelaFechada] = useState(false);
  const cheio = buildQuote({
    // TREZE DÍGITOS de propósito, e não os cinco do exemplo do pacote.
    // Foi num número assim que o X de fechar do diálogo passou por cima
    // do último dígito. O caso fácil não guarda o caso difícil.
    orderNumber: '1234123451234',
    issuedOn: '2026-09-08',
    company: 'PlastfortSul',
    customerName: 'Euclides Fernando Goncalves',
    customerCompany: 'Cooperativa Cotrisel',
    customerPhone: '+5547999549247',
    items: [
      {
        productId: 'p-1',
        name: 'Sacos para silagem 51x110 branco',
        sku: 'SIL-51110-BR',
        unit: 'UN',
        quantity: 100,
        unitPrice: 4.25,
        discountPercent: 0,
      },
      {
        productId: 'p-2',
        name: 'Abraçadeira plástica com UV preta',
        sku: 'ABR-UV-PT',
        unit: 'CX',
        quantity: 200,
        unitPrice: 1,
        discountPercent: 10,
      },
    ],
    currency: 'BRL',
    shipping: 120,
    // A CONDIÇÃO DE PAGAMENTO e o TRANSPORTE, que a 075 acrescentou. Com
    // três parcelas porque é onde o centavo sobra: 725 em três não divide,
    // e o bench é onde se vê se a última fecha a conta no papel.
    paymentTerms: '30/60/90',
    installments: [
      {
        days: 30,
        dueOn: '2026-10-08',
        amount: 241.67,
        method: 'AGRO sicredi',
        note: null,
      },
      {
        days: 60,
        dueOn: '2026-11-07',
        amount: 241.67,
        method: 'AGRO sicredi',
        note: null,
      },
      {
        days: 90,
        dueOn: '2026-12-07',
        amount: 241.66,
        method: 'Boleto',
        note: null,
      },
    ],
    carrier: 'Transportadora Rodoexpress',
    freightMode: 'CIF — remetente',
    freightVolumes: 4,
    grossWeight: 128.5,
    owner: 'Juliana Prestes',
    notes: 'Prazo de produção: 10 dias úteis após a confirmação.',
  });
  const enxuto = buildQuote({
    issuedOn: '2026-09-08',
    company: 'PlastfortSul',
    customerName: 'Marcos Beal',
    items: [],
    value: 625,
    currency: 'BRL',
  });
  return (
    <Panel className="flex flex-wrap gap-2 p-4">
      <Button variant="outline" onClick={() => setCompleto(true)}>
        Abrir — orçamento completo
      </Button>
      <Button variant="outline" onClick={() => setMagro(true)}>
        Abrir — só o valor
      </Button>
      <Button variant="outline" onClick={() => setComEnvio(true)}>
        Abrir — com envio pelo WhatsApp
      </Button>
      <Button variant="outline" onClick={() => setJanelaFechada(true)}>
        Abrir — envio com a janela fechada
      </Button>
      <DealQuote
        open={completo}
        onOpenChange={setCompleto}
        quote={cheio}
        brand={MARCA}
      />
      {/* Sem marca nenhuma: é o estado de uma conta que ainda não
          preencheu a identidade, e o documento tem de sair mesmo assim. */}
      <DealQuote
        open={magro}
        onOpenChange={setMagro}
        quote={enxuto}
        brand={{ name: 'PlastfortSul' }}
      />
      {/*
        O ENVIO, nos dois estados que mudam o desenho.

        `onSend` é fixture: espera um instante e responde que foi, sem
        rede nenhuma — o bench continua sendo fixture e nunca uma
        consulta. O que se olha aqui é o menu: a hierarquia dos botões do
        rodapé, as duas formas com a frase do que cada uma faz, e a recusa
        explicada quando a janela de 24h fechou.
      */}
      <DealQuote
        open={comEnvio}
        onOpenChange={setComEnvio}
        quote={cheio}
        brand={MARCA}
        // O link do arquivo junto, como na gaveta: é com ele que o rodapé
        // fica apertado, e o bench tem de medir o caso que existe.
        archiveHref="#"
        onGenerate={async () => true}
        send={{
          recipient: 'Euclides Fernando Goncalves',
          blocked: null,
          onSend: () =>
            new Promise((resolve) => setTimeout(() => resolve(true), 900)),
        }}
      />
      <DealQuote
        open={janelaFechada}
        onOpenChange={setJanelaFechada}
        quote={cheio}
        brand={MARCA}
        archiveHref="#"
        onGenerate={async () => true}
        send={{
          recipient: 'Euclides Fernando Goncalves',
          blocked: 'window',
          conversationHref: '#',
          onSend: async () => false,
        }}
      />
    </Panel>
  );
}

/**
 * A PRÉVIA DO CARD "MINHA EQUIPE", com fixture.
 *
 * O card de verdade vive atrás do login e busca as mensagens quando a
 * prévia abre; aqui a lista recebe as linhas prontas. O gatilho imita o
 * card só o bastante para o popup ter de onde abrir — a posição (à direita,
 * alinhada pelo fim) e a moldura são as MESMAS peças do card.
 *
 * As linhas cobrem o que muda o desenho: o próprio usuário ("Você"), um
 * áudio sem legenda, um documento, uma mensagem longa que tem de parar em
 * duas linhas, e uma de outra sala, que é a única que leva o nome dela.
 */
const EQUIPE_EU = 'u-gabriel';
const EQUIPE_NOMES = new Map([
  ['u-juliana', 'Juliana Prestes'],
  ['u-vitor', 'Vitor Hugo Almeida'],
  [EQUIPE_EU, 'Gabriel Spencer'],
]);
const EQUIPE_SALAS: TeamRoom[] = [
  {
    id: 'r-default',
    account_id: 'a',
    name: null,
    description: null,
    position: 0,
    is_default: true,
    created_at: '2026-09-01T12:00:00Z',
    archived_at: null,
  },
  {
    id: 'r-operacao',
    account_id: 'a',
    name: 'Operação',
    description: null,
    position: 1,
    is_default: false,
    created_at: '2026-09-02T12:00:00Z',
    archived_at: null,
  },
];

function mensagemDeEquipe(
  id: string,
  autor: string,
  minutosAtras: number,
  extra: Partial<TeamMessage>
): TeamMessage {
  return {
    id,
    account_id: 'a',
    author_id: autor,
    body: '',
    conversation_id: null,
    room_id: 'r-default',
    // Relativo a AGORA, e por isso fixture e não snapshot: `formatListTime`
    // mostra hora para hoje e data para o resto, e um carimbo fixo viraria
    // "12 de set." no dia seguinte e deixaria de testar o caso comum.
    created_at: new Date(Date.now() - minutosAtras * 60_000).toISOString(),
    edited_at: null,
    content_type: 'text',
    ...extra,
  };
}

// Em escopo de módulo, como `daysAgo` e `LAB_TODAY` acima: o relógio é
// lido uma vez, quando a bancada carrega, e não a cada render.
const EQUIPE_MENSAGENS: TeamMessage[] = [
  // ONTEM, para a prévia ter dois dias e mostrar o separador.
  mensagemDeEquipe('m1', 'u-vitor', 26 * 60, {
    body: 'O Cleiton ligou, vai buscar a silagem amanhã cedo.',
  }),
  mensagemDeEquipe('m2', 'u-juliana', 41, {
    body:
      'Beleza. Deixa separado no galpão 2, e avisa a portaria que ele vem ' +
      'com a caminhonete da cooperativa, não com a dele — da última vez ' +
      'barraram na entrada e ele ficou meia hora esperando.',
  }),
  mensagemDeEquipe('m3', 'u-vitor', 30, {
    body: null as unknown as string,
    content_type: 'audio',
    media_name: 'gravacao.webm',
  }),
  mensagemDeEquipe('m4', EQUIPE_EU, 22, {
    body: 'Separado. Mandei a nota por e-mail.',
  }),
  mensagemDeEquipe('m5', 'u-juliana', 9, {
    body: null as unknown as string,
    content_type: 'document',
    media_name: 'proposta-cotrisel.pdf',
    room_id: 'r-operacao',
  }),
  mensagemDeEquipe('m6', 'u-vitor', 2, {
    body: 'Alguém viu o pedido 14350?',
  }),
];

/** O print: uma pessoa só, várias mensagens curtas, mesmo dia. */
const EQUIPE_SEGUIDAS: TeamMessage[] = [
  mensagemDeEquipe('s1', EQUIPE_EU, 40, { body: 'J' }),
  mensagemDeEquipe('s2', EQUIPE_EU, 38, { body: 'JLÇ' }),
  mensagemDeEquipe('s3', EQUIPE_EU, 37, { body: 'JLÇ' }),
  mensagemDeEquipe('s4', EQUIPE_EU, 30, { body: 'JLL', room_id: 'r-operacao' }),
  mensagemDeEquipe('s5', EQUIPE_EU, 12, { body: 'teste' }),
  mensagemDeEquipe('s6', EQUIPE_EU, 3, { body: 'khfkfh' }),
];

function TeamPreviewBench() {
  return (
    <Panel className="flex flex-wrap items-end gap-6 p-4">
      <PreviewCard.Root>
        <PreviewCard.Trigger
          delay={150}
          href="#"
          className="bg-primary-soft text-primary inline-flex w-60 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold"
        >
          Passe o mouse — com mensagens
        </PreviewCard.Trigger>
        <TeamRoomPreviewPopup heading="Minha equipe" unreadCount={3}>
          <TeamRoomPreviewList
            messages={EQUIPE_MENSAGENS}
            names={EQUIPE_NOMES}
            userId={EQUIPE_EU}
            rooms={EQUIPE_SALAS}
          />
        </TeamRoomPreviewPopup>
      </PreviewCard.Root>

      {/* O CASO DO PRINT do Gabriel: várias mensagens seguidas da mesma
          pessoa, no mesmo dia. Era isto que virava seis "Você — 8 de set."
          empilhados. */}
      <PreviewCard.Root>
        <PreviewCard.Trigger
          delay={150}
          href="#"
          className="hover:bg-muted text-foreground inline-flex w-60 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold"
        >
          Passe o mouse — só minhas, seguidas
        </PreviewCard.Trigger>
        <TeamRoomPreviewPopup heading="Minha equipe" unreadCount={0}>
          <TeamRoomPreviewList
            messages={EQUIPE_SEGUIDAS}
            names={EQUIPE_NOMES}
            userId={EQUIPE_EU}
            rooms={EQUIPE_SALAS}
          />
        </TeamRoomPreviewPopup>
      </PreviewCard.Root>

      <PreviewCard.Root>
        <PreviewCard.Trigger
          delay={150}
          href="#"
          className="hover:bg-muted text-foreground inline-flex w-60 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold"
        >
          Passe o mouse — carregando
        </PreviewCard.Trigger>
        <TeamRoomPreviewPopup heading="Minha equipe" unreadCount={0}>
          <TeamRoomPreviewList
            messages={null}
            names={EQUIPE_NOMES}
            userId={EQUIPE_EU}
            rooms={EQUIPE_SALAS}
          />
        </TeamRoomPreviewPopup>
      </PreviewCard.Root>

      <PreviewCard.Root>
        <PreviewCard.Trigger
          delay={150}
          href="#"
          className="hover:bg-muted text-foreground inline-flex w-60 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold"
        >
          Passe o mouse — sala vazia
        </PreviewCard.Trigger>
        <TeamRoomPreviewPopup heading="Minha equipe" unreadCount={0}>
          <TeamRoomPreviewList
            messages={[]}
            names={EQUIPE_NOMES}
            userId={EQUIPE_EU}
            rooms={EQUIPE_SALAS}
          />
        </TeamRoomPreviewPopup>
      </PreviewCard.Root>
    </Panel>
  );
}

/**
 * AS MENÇÕES, com fixture.
 *
 * Três bolhas cobrem as três respostas de `mentionSegments`: uma que chama
 * QUEM ESTÁ LENDO (âmbar, o único "venha cá" da casa), uma que chama um
 * colega (azul) e uma com "@Vitor Hugo Almeida" digitado à mão, sem o
 * painel — que não avisou ninguém e por isso fica como texto comum.
 *
 * As bolhas usam as mesmas classes da sala (`bg-wa-in`, `bg-wa-out`),
 * porque o âmbar precisa ser conferido CONTRA o fundo em que ele vai
 * aparecer, nos dois temas.
 */
const MENCAO_DIRETORIO = new Map([
  [
    'u-juliana',
    { user_id: 'u-juliana', full_name: 'Juliana Prestes', avatar_url: null },
  ],
  [
    'u-vitor',
    { user_id: 'u-vitor', full_name: 'Vitor Hugo Almeida', avatar_url: null },
  ],
  [
    'u-gabriel',
    { user_id: 'u-gabriel', full_name: 'Gabriel Spencer', avatar_url: null },
  ],
  [
    'u-ana',
    { user_id: 'u-ana', full_name: 'Ana Paula Rocha', avatar_url: null },
  ],
]);

function MentionBench() {
  const [cursor, setCursor] = useState(1);
  const candidatos = [...MENCAO_DIRETORIO.values()].filter(
    (m) => m.user_id !== 'u-gabriel'
  );
  const bolhas = [
    {
      id: 'b1',
      mine: false,
      body: '@Gabriel Spencer consegue ver o pedido 14350 hoje ainda?',
      mentions: ['u-gabriel'],
    },
    {
      id: 'b2',
      mine: true,
      body: 'Vejo sim. @Juliana Prestes separa a nota pra mim?',
      mentions: ['u-juliana'],
    },
    {
      id: 'b3',
      mine: false,
      body: 'Falei com o @Vitor Hugo Almeida por telefone, ele confirma amanhã.',
      mentions: [],
    },
  ];

  return (
    <Panel className="grid gap-6 p-4 md:grid-cols-2">
      <div className="bg-wa-bg space-y-2 rounded-lg p-3">
        {bolhas.map((b) => (
          <div
            key={b.id}
            className={cn('flex', b.mine ? 'justify-end' : 'justify-start')}
          >
            <p
              className={cn(
                'text-foreground max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-[var(--wa-shadow)]',
                b.mine ? 'bg-wa-out' : 'bg-wa-in'
              )}
            >
              <MentionText
                body={b.body}
                mentions={b.mentions}
                members={MENCAO_DIRETORIO}
                selfId="u-gabriel"
              />
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <MentionPanel
          matches={candidatos}
          cursor={cursor}
          onHover={setCursor}
          onPick={() => {}}
          presenceOf={(id) => (id === 'u-juliana' ? 'online' : 'offline')}
        />
        <MentionPanel
          matches={[]}
          cursor={0}
          onHover={() => {}}
          onPick={() => {}}
          presenceOf={() => 'offline'}
        />
      </div>
    </Panel>
  );
}

function MoneyBench() {
  const [value, setValue] = useState<number | null>(18400);
  const [frete, setFrete] = useState<number | null>(679);
  return (
    <Panel className="space-y-4 p-4">
      {/*
        O CASO QUE QUEBROU, ao lado do que sempre funcionou.

        Duas colunas de um grid, e a da esquerda com um parágrafo a mais
        embaixo. O grid estica as duas à mesma altura, e antes do `h-fit`
        no invólucro o `R$` da direita descia para baixo do número — que
        foi exatamente como o campo de Frete da oportunidade saiu.
      */}
      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <FieldLabel htmlFor="lab-money-a">Valor</FieldLabel>
          <CurrencyInput
            id="lab-money-a"
            value={value}
            onValueChange={setValue}
            currency="BRL"
            className="bg-muted border-border text-foreground"
          />
          <p className="text-muted-foreground text-2xs">
            Somado a partir das linhas abaixo.
          </p>
        </div>
        <div className="grid gap-2">
          <FieldLabel htmlFor="lab-money-b">Frete</FieldLabel>
          <CurrencyInput
            id="lab-money-b"
            value={frete}
            onValueChange={setFrete}
            currency="BRL"
            className="bg-muted border-border text-foreground"
          />
        </div>
      </div>

      <div className="max-w-56 space-y-1.5">
        <FieldLabel htmlFor="lab-money">Valor</FieldLabel>
        <CurrencyInput
          id="lab-money"
          value={value}
          onValueChange={setValue}
          currency="BRL"
          className="bg-muted border-border text-foreground"
        />
      </div>
    </Panel>
  );
}

function PeriodPickerBench() {
  const [period, setPeriod] = useState(() => periodFromPreset(30));
  return (
    <Panel className="p-4">
      <PeriodPicker value={period} onChange={setPeriod} />
    </Panel>
  );
}

function TaskListBench() {
  const t = useTranslations('Tasks');
  /* LARGURA CHEIA, e não `max-w-lg`: a queixa é sobre o que acontece num
     monitor — "sobrando espaço demais" —, e uma bancada estreita esconde
     exatamente o caso relatado. O responsável e o vínculo entram porque
     são duas das colunas. */
  const responsavel = {
    user_id: 'u-ju',
    full_name: 'Juliana Prestes',
    avatar_url: null,
  };
  return (
    <Panel className="overflow-hidden p-0 [&>*:last-child]:border-b-0">
      <TaskColumnsHeader t={t} />
      {LAB_TASKS.filter((task) => task.status === 'open').map((task, i) => (
        <TaskRow
          key={task.id}
          task={task}
          todayIso={LAB_TODAY}
          locale="pt-BR"
          assignee={i % 2 === 0 ? responsavel : null}
          busy={false}
          canWrite
          density="comfortable"
          contact={
            i % 3 === 0
              ? { href: '#', label: 'Euclides Fernando Goncalves' }
              : null
          }
          onToggle={() => {}}
          onEdit={() => {}}
          t={t}
        />
      ))}
    </Panel>
  );
}

function ControlsBench() {
  const [mode, setMode] = useState<'list' | 'board' | 'calendar'>('list');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(['quote'])
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegBar
        label="Visão"
        value={mode}
        onValueChange={setMode}
        segments={[
          { value: 'list' as const, label: 'Lista' },
          { value: 'board' as const, label: 'Quadro' },
          { value: 'calendar' as const, label: 'Calendário' },
        ]}
      />
      <div className="flex flex-wrap gap-1.5">
        {[
          'Ligação',
          'Reunião',
          'Visita',
          'Follow-up',
          'Orçamento',
          'Outro',
        ].map((label) => (
          <FilterChip
            key={label}
            subtle
            active={!hidden.has(label)}
            onClick={() =>
              setHidden((current) => {
                const next = new Set(current);
                if (next.has(label)) next.delete(label);
                else next.add(label);
                return next;
              })
            }
          >
            {label}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}
