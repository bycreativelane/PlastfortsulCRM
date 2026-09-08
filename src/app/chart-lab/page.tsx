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
import { TaskRow } from '@/components/tasks/task-row';
import { TasksCalendar } from '@/components/tasks/tasks-calendar';
import { FilterChip } from '@/components/ui/filter-chip';
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
      contact: { name: 'Rafael Kunz', company: 'Kunz Transportes' } as Deal['contact'],
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
  labTask({
    id: 't5',
    title: 'Mandar orçamento dos pallets PBR',
    kind: 'quote',
    status: 'done',
    due_on: shiftDay(-5),
  }),
  labTask({
    id: 't6',
    title: 'Reagendar reunião de setembro',
    kind: 'meeting',
    status: 'cancelled',
  }),
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
        <div className="bg-background h-100 rounded-xl p-3">
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

function TaskListBench() {
  const t = useTranslations('Tasks');
  return (
    <Panel className="max-w-lg space-y-0.5 p-1">
      {LAB_TASKS.filter((task) => task.status === 'open').map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          todayIso={LAB_TODAY}
          locale="pt-BR"
          assignee={null}
          busy={false}
          canWrite
          density="comfortable"
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
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(['quote']));
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
        {['Ligação', 'Reunião', 'Visita', 'Follow-up', 'Orçamento', 'Outro'].map(
          (label) => (
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
          )
        )}
      </div>
    </div>
  );
}
