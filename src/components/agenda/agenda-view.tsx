'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useBusinessHours } from '@/hooks/use-business-hours';
import { useMemberDirectory } from '@/hooks/use-member-directory';
import { createClient } from '@/lib/supabase/client';
import { addDays, addMonths, fromISO, toISO } from '@/lib/calendar';
import {
  AGENDA_KINDS,
  AGENDA_TONE,
  loadAgenda,
  type AgendaItem,
  type AgendaKind,
} from '@/lib/dashboard/agenda';
import { loadTask } from '@/lib/tasks/queries';
import type { Task } from '@/types';
import {
  filterAgenda,
  isAgendaView,
  rangeFor,
  type AgendaView as ViewMode,
} from '@/lib/agenda/view';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TaskDialog } from '@/components/tasks/task-dialog';

import { DayView } from './day-view';
import { MonthView } from './month-view';
import { WeekView } from './week-view';
import { KIND_ICON, TONE_DOT } from './tokens';

/**
 * A agenda como LUGAR, e não como painel.
 *
 * O produto já tinha um calendário em dois cantos — o bloco do dashboard e
 * a faixa do cabeçalho — e os dois respondem à mesma pergunta estreita:
 * "o que tem hoje". Nenhum responde "o que tem quinta às 15h", "a semana do
 * Paulo está cheia?" ou "o que sobrou de setembro", porque um painel não
 * tem para onde navegar e uma faixa não tem eixo.
 *
 * ------------------------------------------------------------------
 * O ESTADO QUE MORA NA URL, E O QUE NÃO MORA
 * ------------------------------------------------------------------
 *
 * `?d=` (o dia), `?v=` (o modo) e `?task=` (a gaveta aberta) vão para a
 * URL. São as três coisas que alguém manda para um colega — "olha a quinta"
 * é um endereço, não um clique — e as três que uma notificação de lembrete
 * precisa saber apontar.
 *
 * Os FILTROS não vão. Tipo e responsável são preferências de quem olha, e
 * pô-las no endereço faria "olha a quinta" carregar junto os tipos que EU
 * escondi — que é a forma mais silenciosa de mandar a alguém uma tela
 * vazia. O padrão "Minhas" é o mesmo raciocínio do outro lado: a pergunta
 * que se faz ao abrir a própria agenda é sobre o próprio dia.
 */
export function AgendaPage() {
  const t = useTranslations('Agenda');
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const { hours } = useBusinessHours();
  const members = useMemberDirectory();

  const me = user?.id ?? null;

  const viewParam = params.get('v');
  const view: ViewMode = isAgendaView(viewParam) ? viewParam : 'week';
  const dayParam = params.get('d');
  const cursor = React.useMemo(
    () => fromISO(dayParam ?? '') ?? new Date(),
    [dayParam]
  );
  const openTaskId = params.get('task');

  const [items, setItems] = React.useState<AgendaItem[] | null>(null);
  const [hidden, setHidden] = React.useState<ReadonlySet<AgendaKind>>(
    () => new Set()
  );
  const [owner, setOwner] = React.useState<'all' | 'mine' | string>('mine');
  const [task, setTask] = React.useState<Task | null>(null);
  const [creating, setCreating] = React.useState(false);

  const range = React.useMemo(
    () => rangeFor(view, cursor, hours.weekStartsOn),
    [view, cursor, hours.weekStartsOn]
  );
  // `range.days` é um array novo a cada cálculo, então efeitos que dependem
  // dele por identidade rodariam para sempre. A chave estável é a string.
  const daysKey = range.days.join(',');
  const { from, to } = range;

  const reload = React.useCallback(() => {
    let cancelled = false;
    loadAgenda(createClient(), from, to, hours.timezone).then((data) => {
      if (!cancelled) setItems(data);
    });
    return () => {
      cancelled = true;
    };
    // `from`/`to` derivam de `daysKey`, que é o que decide de verdade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysKey, hours.timezone]);

  React.useEffect(() => reload(), [reload]);

  // A gaveta do link profundo. Busca no banco em vez de procurar na janela
  // já carregada — ver a nota em `loadTask`.
  React.useEffect(() => {
    if (!openTaskId) {
      setTask(null);
      return;
    }
    let cancelled = false;
    loadTask(createClient(), openTaskId).then((found) => {
      if (!cancelled) setTask(found);
    });
    return () => {
      cancelled = true;
    };
  }, [openTaskId]);

  const setParam = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      router.replace(`/agenda?${next.toString()}`, { scroll: false });
    },
    [params, router]
  );

  const go = (delta: number) => {
    const next =
      view === 'month'
        ? addMonths(cursor, delta)
        : addDays(cursor, delta * (view === 'week' ? 7 : 1));
    setParam({ d: toISO(next) });
  };

  const todayIso = toISO(new Date());
  const visible = React.useMemo(
    () => filterAgenda(items ?? [], { hidden, owner, me }),
    [items, hidden, owner, me]
  );

  const toggleKind = (kind: AgendaKind) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const onSelectTask = (item: AgendaItem) => setParam({ task: item.rowId });

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => go(-1)}
            aria-label={t('previous')}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => go(1)}
            aria-label={t('next')}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setParam({ d: todayIso })}
          >
            {t('today')}
          </Button>
        </div>

        <h1 className="text-lg font-semibold">
          {periodLabel(view, cursor, range.days)}
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="bg-muted flex rounded-md p-0.5">
            {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setParam({ v: mode })}
                aria-pressed={view === mode}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium',
                  view === mode
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground'
                )}
              >
                {t(`view.${mode}`)}
              </button>
            ))}
          </div>

          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            aria-label={t('ownerLabel')}
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          >
            <option value="mine">{t('ownerMine')}</option>
            <option value="all">{t('ownerAll')}</option>
            {[...members.values()].map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name}
              </option>
            ))}
          </select>

          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t('newTask')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {AGENDA_KINDS.map((kind) => {
          const on = !hidden.has(kind);
          const Icon = KIND_ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              aria-pressed={on}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                on ? 'bg-background' : 'text-muted-foreground opacity-60'
              )}
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  on ? TONE_DOT[AGENDA_TONE[kind]] : 'bg-muted-foreground/40'
                )}
              />
              <Icon className="size-3.5" />
              {t(`kind.${kind}`)}
            </button>
          );
        })}
      </div>

      {items === null ? (
        <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
          <CalendarDays className="size-4 animate-pulse" />
          {t('loading')}
        </div>
      ) : view === 'month' ? (
        <MonthView
          cursor={cursor}
          items={visible}
          onPickDay={(date) => setParam({ d: toISO(date), v: 'day' })}
          onSelectTask={onSelectTask}
        />
      ) : view === 'week' ? (
        <WeekView
          days={range.days}
          items={visible}
          hours={hours}
          todayIso={todayIso}
          onSelectTask={onSelectTask}
        />
      ) : (
        <DayView
          iso={range.days[0]}
          items={visible}
          hours={hours}
          onSelectTask={onSelectTask}
        />
      )}

      <TaskDialog
        open={Boolean(task) || creating}
        onOpenChange={(next) => {
          if (next) return;
          setCreating(false);
          setParam({ task: null });
        }}
        task={task}
        onSaved={() => {
          setCreating(false);
          setParam({ task: null });
          reload();
        }}
      />
    </div>
  );
}

/** O rótulo do período — o que a pessoa lê para saber onde está. */
function periodLabel(view: ViewMode, cursor: Date, days: string[]): string {
  const options: Intl.DateTimeFormatOptions =
    view === 'month'
      ? { month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'long' };

  if (view !== 'week') {
    return new Intl.DateTimeFormat(undefined, options).format(cursor);
  }

  const first = fromISO(days[0]);
  const last = fromISO(days[days.length - 1]);
  if (!first || !last) return '';
  const format = new Intl.DateTimeFormat(undefined, options);
  return `${format.format(first)} – ${format.format(last)}`;
}
