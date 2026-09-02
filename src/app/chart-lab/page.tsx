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
