'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, ListChecks, Plus, Search } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useMemberDirectory } from '@/hooks/use-member-directory';
import { createClient } from '@/lib/supabase/client';
import { localParts } from '@/lib/automations/local-time';
import { useBusinessHours } from '@/hooks/use-business-hours';
import {
  closedTasks,
  filterTasks,
  groupTasks,
  summarize,
} from '@/lib/tasks/board';
import { loadAllTasks } from '@/lib/tasks/queries';
import { cancelTask, completeTask, reopenTask } from '@/lib/tasks/mutations';
import { notifyTaskCompleted, publishTask } from '@/lib/tasks/notify-client';
import { TASK_KINDS, TASK_STATUSES, type Task, type TaskStatus } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MemberAvatar } from '@/components/presence/member-avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TaskDialog } from '@/components/tasks/task-dialog';
import { TaskRow } from '@/components/tasks/task-row';
import { Skeleton } from '@/components/dashboard/skeleton';
import { TasksBoard } from '@/components/tasks/tasks-board';
import { TasksCalendar } from '@/components/tasks/tasks-calendar';
import { SegBar } from '@/components/ui/seg-bar';
import { FilterChip } from '@/components/ui/filter-chip';
import { Panel } from '@/components/ui/panel';
import { StatePanel } from '@/components/ui/state-panel';

/**
 * Tarefas — a fila, e não o tempo.
 *
 * ------------------------------------------------------------------
 * DUAS TELAS, DOIS RECORTES
 * ------------------------------------------------------------------
 *
 * A `/agenda` desenha o TEMPO: em que dia e a que hora as coisas caem, ao
 * lado de tudo mais que tem data. Esta desenha a FILA: o que eu tenho para
 * fazer, em ordem de urgência, sem nada que não seja trabalho meu.
 *
 * São perguntas diferentes e a mesma tela não responde bem às duas. Um
 * calendário não sabe mostrar "sete atrasadas" sem espalhá-las por sete
 * dias passados; uma lista não sabe mostrar "a quinta está livre".
 *
 * O §C4 do plano tinha recusado esta tela, e o argumento era bom para quem
 * trabalha dentro de um atendimento — a tarefa nasce numa conversa e é lá
 * que ela é lembrada. Ele erra para quem abre o CRM de manhã e pergunta
 * "o que eu tenho hoje?", que é uma pergunta sem cliente e sem conversa.
 *
 * ------------------------------------------------------------------
 * ATRASADAS PRIMEIRO, E EM VERMELHO
 * ------------------------------------------------------------------
 *
 * O que venceu não entra na ordem cronológica junto com o resto. Uma lista
 * ordenada só por data enterra o que venceu na semana passada acima do que
 * vence hoje — visualmente correto e inútil, porque o que venceu é
 * exatamente o que precisa de decisão agora.
 */
/** As três visões, na ordem em que a barra as mostra. */
const MODES = ['list', 'board', 'calendar'] as const;

export function TasksPage() {
  const t = useTranslations('TasksPage');
  const tk = useTranslations('Tasks');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { user, canSendMessages } = useAuth();
  const { hours } = useBusinessHours();
  const members = useMemberDirectory();

  const me = user?.id ?? null;
  const todayIso = React.useMemo(
    () => localParts(new Date(), hours.timezone).dateKey,
    [hours.timezone]
  );

  const [tasks, setTasks] = React.useState<Task[] | null>(null);
  const [owner, setOwner] = React.useState<'all' | 'mine' | string>('mine');
  const [hiddenKinds, setHiddenKinds] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [search, setSearch] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showClosed, setShowClosed] = React.useState(false);
  const [mode, setMode] = React.useState<'list' | 'board' | 'calendar'>('list');
  const [editing, setEditing] = React.useState<Task | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setTasks(await loadAllTasks(createClient()));
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // `?task=<id>` abre a gaveta — o mesmo endereço que a agenda e as
  // notificações de lembrete apontam, para que um link só sirva às duas.
  const openTaskId = params.get('task');
  React.useEffect(() => {
    if (!openTaskId || !tasks) return;
    const found = tasks.find((task) => task.id === openTaskId);
    if (found) setEditing(found);
  }, [openTaskId, tasks]);

  const visible = React.useMemo(
    () => filterTasks(tasks ?? [], { owner, me, hiddenKinds, search }),
    [tasks, owner, me, hiddenKinds, search]
  );
  const groups = React.useMemo(
    () => groupTasks(visible, todayIso),
    [visible, todayIso]
  );
  const closed = React.useMemo(() => closedTasks(visible), [visible]);
  // As mesmas linhas que o painel desenha, na mesma ordem.
  const ownerOptions = React.useMemo(
    () => [
      { value: 'mine', label: t('ownerMine') },
      { value: 'all', label: t('ownerAll') },
      ...[...members.values()].map((m) => ({
        value: m.user_id,
        label: m.full_name,
      })),
    ],
    [t, members]
  );

  const counts = React.useMemo(
    () => summarize(visible, todayIso),
    [visible, todayIso]
  );

  async function toggle(task: Task) {
    setBusy(task.id);
    const db = createClient();
    const ok =
      task.status === 'done'
        ? await reopenTask(db, task.id)
        : await completeTask(db, task.id);
    setBusy(null);
    if (!ok) {
      toast.error(tk('saveFailed'));
      return;
    }
    void publishTask(task.id);
    void notifyTaskCompleted(task.id);
    await load();
  }

  /**
   * Arrastar entre colunas do quadro.
   *
   * Cada destino tem a sua mutação — não é um `update` genérico de
   * `status` — porque cada uma carimba um campo diferente: concluir grava
   * `completed_at`, cancelar não. Um update cru deixaria a tarefa concluída
   * sem data de conclusão, e ela sumiria dos relatórios que contam por
   * período.
   */
  async function changeStatus(task: Task, status: TaskStatus) {
    setBusy(task.id);
    const db = createClient();
    const ok =
      status === 'done'
        ? await completeTask(db, task.id)
        : status === 'cancelled'
          ? await cancelTask(db, task.id)
          : await reopenTask(db, task.id);
    setBusy(null);
    if (!ok) {
      toast.error(tk('saveFailed'));
      return;
    }
    void publishTask(task.id);
    void notifyTaskCompleted(task.id);
    await load();
  }

  function toggleKind(kind: string) {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function closeDialog() {
    setEditing(null);
    setCreating(false);
    if (openTaskId) {
      const next = new URLSearchParams(params.toString());
      next.delete('task');
      router.replace(`/tasks${next.size ? `?${next}` : ''}`, { scroll: false });
    }
  }

  return (
    // UM SHELL CONTIDO, e não fluxo normal.
    //
    // A rota entrou em `APP_SHAPED` (ver `dashboard-shell.tsx`), então o
    // `<main>` para de rolar e esta tela passa a ser dona da própria altura.
    // Sem isso o quadro crescia para baixo e a PÁGINA rolava — que é
    // exatamente o que a doutrina do quadro do funil proíbe: "um Kanban que
    // cresce além da dobra deixou de ser um quadro".
    //
    // As outras duas visões ganham junto o que elas também queriam: o
    // cabeçalho e os filtros ficam parados e só o conteúdo rola, que é como
    // toda lista de trabalho séria se comporta.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-4 md:px-6 md:pt-6">
        <div>
          <h1 className="text-lg font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground text-xs">
            {counts.overdue > 0
              ? t('summaryOverdue', {
                  overdue: counts.overdue,
                  today: counts.today,
                })
              : t('summary', { open: counts.open, today: counts.today })}
            {/* A LEGENDA ENSINA A INTERACAO, e so a que existe agora.
                E o que o Bond CRM faz — "drag a card to change stage" fica na
                linha de resumo, e nao num tour nem num tooltip que ninguem
                abre. So no modo Quadro, porque na lista e no calendario a
                frase seria falsa; e so em ponteiro fino, porque no toque a
                alca de arrasto ja esta desenhada no cartao. */}
            {mode === 'board' ? (
              <span className="hidden pointer-fine:inline">
                {' · '}
                {t('dragHint')}
              </span>
            ) : null}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            {/* O `Input` da casa. O que estava aqui era um `<input>` cru com
                a receita recopiada e errada em três pontos: `rounded-md` onde
                a casa é `rounded-lg`, `text-xs` (12px, e abaixo de 16 o Safari
                do iPhone dá zoom ao focar) e nenhum anel de foco — sobrava o
                contorno do navegador, não o de 3px do app.

                E, principalmente, sem `data-slot="input"`: é por ele que o
                `globals.css` dá 44px no dedo, num campo que fica na barra de
                uma tela feita para ser usada no celular. Mesma escrita da
                busca da caixa de entrada. */}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="w-44 pl-7"
            />
          </div>

          {/*
            As partes do `Select` e não o `OptionSelect`: aqui cada linha
            leva a FOTO do colega, e o atalho só aceita `<option>` de texto.
            A foto não é enfeite — numa equipe, reconhecer quem é pelo rosto
            é mais rápido do que ler o nome, e é o mesmo avatar que a caixa
            de entrada e a sala da equipe já desenham.
          */}
          {/*
            O `Select` pode devolver `null` quando a escolha é limpa. Aqui
            isso não deve virar filtro nenhum: cair em "Minhas" é o padrão
            da tela e o único estado que responde à pergunta que ela faz.
          */}
          <Select
            value={owner}
            onValueChange={(next) => setOwner(next ?? 'mine')}
            // `items` é o que o `<SelectValue>` lê para traduzir o valor
            // guardado de volta no rótulo. Sem ele o campo FECHADO mostra
            // o valor cru — "mine" no lugar de "Minhas" — enquanto a lista
            // aberta continua certa, que é o jeito mais confuso de errar.
            items={ownerOptions}
          >
            <SelectTrigger
              className="h-8 w-auto min-w-36 text-xs"
              aria-label={t('ownerLabel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">{t('ownerMine')}</SelectItem>
              <SelectItem value="all">{t('ownerAll')}</SelectItem>
              {[...members.values()].map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  <span className="flex items-center gap-2">
                    <MemberAvatar
                      name={m.full_name}
                      avatarUrl={m.avatar_url}
                      size="2xs"
                    />
                    {m.full_name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/*
            Três visões, três perguntas sobre a mesma tarefa:
            a LISTA responde "o que eu faço agora", em ordem de urgência;
            o QUADRO responde "em que pé está cada coisa";
            o CALENDÁRIO responde "como está a minha semana".

            Uma lista não mostra que a quinta está livre, um calendário não
            mostra sete atrasadas sem espalhá-las por sete dias passados, e
            nenhum dos dois mostra quantas ficaram pelo caminho.
          */}
          {/* O `SegBar` da casa, e não um controle segmentado escrito à mão.
              O que estava aqui tinha `rounded` (4px, fora da escada), altura
              do `line-height` e nenhum anel de foco — e o calendário lá
              embaixo tinha uma segunda cópia dele, com as mesmas classes. */}
          <SegBar
            label={t('viewLabel')}
            value={mode}
            onValueChange={setMode}
            segments={MODES.map((option) => ({
              value: option,
              label: t(`mode.${option}`),
            }))}
          />

          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t('new')}
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pt-3 md:px-6">
        {TASK_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            // `subtle`: os seis nascem ligados, então o ligado é o repouso e
            // quem tem de aparecer é o desligado. Ver a nota no componente.
            subtle
            active={!hiddenKinds.has(kind)}
            onClick={() => toggleKind(kind)}
          >
            {tk(`kind.${kind}`)}
          </FilterChip>
        ))}
      </div>

      {/*
        A região de conteúdo é a única que rola, e o QUE rola muda com a
        visão: o quadro rola de lado (cada coluna rola por dentro), a lista e
        o calendário rolam para baixo. Um `overflow` só para as três faria o
        quadro ganhar barra vertical e a lista perder a dela.
      */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4 md:px-6 md:pb-6',
          mode === 'board' ? 'overflow-hidden' : 'overflow-y-auto'
        )}
      >
        {tasks === null ? (
          <BoardSkeleton mode={mode} />
        ) : mode === 'board' ? (
          <TasksBoard
            tasks={visible}
            todayIso={todayIso}
            busyId={busy}
            onChangeStatus={changeStatus}
            onOpen={setEditing}
            onCreate={() => setCreating(true)}
          />
        ) : mode === 'calendar' ? (
          <TasksCalendar tasks={visible} onSelectTask={setEditing} />
        ) : groups.length === 0 && closed.length === 0 ? (
          // O frame único de vazio da casa. Este era um `border-dashed` com
          // ícone e dois parágrafos escritos à mão — o mesmo objeto que o
          // `StatePanel` desenha, com um raio e um espaçamento próprios.
          <StatePanel
            framed
            icon={ListChecks}
            title={t('empty')}
            description={t('emptyHint')}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.bucket} className="space-y-1.5">
                {/* O MESMO CABEÇALHO DA COLUNA DO QUADRO: bolinha, nome,
                  contagem. As três visões mostram a mesma tarefa, e não havia
                  razão para o agrupamento da lista ter uma escrita própria.

                  `eyebrow` é o micro-rótulo canônico do `globals.css`, e
                  estava reescrito à mão aqui — com peso 600 em vez de 700 e
                  um passo de tipografia acima. */}
                <h2 className="flex items-center gap-1.5 px-1">
                  <span
                    aria-hidden
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      group.bucket === 'overdue'
                        ? 'bg-danger'
                        : 'bg-muted-foreground/40'
                    )}
                  />
                  <span
                    className={cn(
                      'eyebrow',
                      group.bucket === 'overdue'
                        ? 'text-danger-ink'
                        : 'text-muted-foreground'
                    )}
                  >
                    {t(`bucket.${group.bucket}`)}
                  </span>
                  <span className="text-muted-foreground text-2xs tabular-nums">
                    · {group.tasks.length}
                  </span>
                </h2>
                <Panel className="space-y-0.5 p-1">
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      todayIso={todayIso}
                      locale={locale}
                      assignee={
                        task.assigned_to
                          ? (members.get(task.assigned_to) ?? null)
                          : null
                      }
                      busy={busy === task.id}
                      canWrite={canSendMessages}
                      density="comfortable"
                      contact={
                        task.contact_id
                          ? {
                              href: `/contacts?id=${task.contact_id}`,
                              label: t('contactLink'),
                            }
                          : null
                      }
                      onToggle={() => toggle(task)}
                      onEdit={() => setEditing(task)}
                      t={tk}
                    />
                  ))}
                </Panel>
              </section>
            ))}

            {closed.length > 0 ? (
              <section className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowClosed((v) => !v)}
                  className="text-muted-foreground hover:text-foreground eyebrow flex items-center gap-1 px-1 transition-colors"
                >
                  <ChevronDown
                    className={cn(
                      'size-3 transition-transform duration-(--dur-1)',
                      !showClosed && '-rotate-90'
                    )}
                  />
                  {t('bucket.closed')}
                  <span className="text-2xs font-normal tabular-nums">
                    · {closed.length}
                  </span>
                </button>
                {showClosed ? (
                  <Panel className="space-y-0.5 p-1">
                    {closed.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        todayIso={todayIso}
                        locale={locale}
                        assignee={
                          task.assigned_to
                            ? (members.get(task.assigned_to) ?? null)
                            : null
                        }
                        busy={busy === task.id}
                        canWrite={canSendMessages}
                        density="comfortable"
                        contact={
                          task.contact_id
                            ? {
                                href: `/contacts?id=${task.contact_id}`,
                                label: t('contactLink'),
                              }
                            : null
                        }
                        onToggle={() => toggle(task)}
                        onEdit={() => setEditing(task)}
                        t={tk}
                      />
                    ))}
                  </Panel>
                ) : null}
              </section>
            ) : null}
          </div>
        )}
      </div>

      <TaskDialog
        open={Boolean(editing) || creating}
        onOpenChange={(next) => {
          if (!next) closeDialog();
        }}
        task={editing}
        onSaved={() => {
          closeDialog();
          void load();
        }}
      />
    </div>
  );
}

/**
 * O esqueleto, com a forma da visão que vai chegar.
 *
 * Uma frase "Carregando..." não reserva espaço, então a tela pulava de uma
 * linha de texto para um quadro inteiro. O esqueleto ocupa a mesma geometria
 * que o conteúdo real — três colunas ou uma pilha de linhas — e o que muda
 * quando os dados chegam é o conteúdo, não o layout.
 *
 * A régua de 2px sem cor no topo das colunas é a mesma que o esqueleto do
 * funil desenha, pela mesma razão: é o que o quadro real mantém rente à
 * borda superior.
 */
function BoardSkeleton({ mode }: { mode: 'list' | 'board' | 'calendar' }) {
  if (mode === 'board') {
    return (
      <div className="flex min-h-0 flex-1 gap-3">
        {TASK_STATUSES.map((status) => (
          <div
            key={status}
            className="flex max-w-[320px] min-w-[260px] flex-1 flex-col overflow-hidden rounded-b-lg"
          >
            <div className="bg-muted h-0.5 shrink-0" />
            <div className="bg-muted/50 flex-1 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
