'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Check,
  CircleDot,
  Clock,
  CornerUpRight,
  FileText,
  Loader2,
  MapPin,
  Phone,
  RotateCcw,
  Users,
} from 'lucide-react';

import type { DirectoryMember } from '@/hooks/use-member-directory';
import { MemberAvatar } from '@/components/presence/member-avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { isDueToday, isOverdue } from '@/lib/tasks/queries';
import { fromISO } from '@/lib/calendar';
import { formatTime } from '@/components/ui/time-field';
import { TASK_KINDS, type Task } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Uma tarefa, numa linha. A ÚNICA.
 *
 * ------------------------------------------------------------------
 * POR QUE ISTO VIROU UM ARQUIVO
 * ------------------------------------------------------------------
 *
 * A mesma tarefa era desenhada por três implementações — a lista das fichas
 * (`task-list.tsx`), a página `/tasks` e o cartão do quadro — e elas
 * divergiam em tudo o que importa:
 *
 *   caixa        quadrada de 16px · redonda de 20px · nenhuma
 *   concluída    `bg-primary`      · `bg-human-strong` · risco no título
 *   atrasada     tinta vermelha    · outra tinta vermelha · pílula
 *   responsável  nome em texto     · ícone + nome · foto
 *
 * Nenhuma dessas divergências foi decidida. Um agente que marca uma ligação
 * como feita na ficha do contato e depois em `/tasks` aprende duas
 * interfaces para uma tarefa.
 *
 * ------------------------------------------------------------------
 * AS TRÊS ESCOLHAS, E POR QUE ESTAS
 * ------------------------------------------------------------------
 *
 * **A caixa é a da casa.** `size-4`, quadrada, `border-control` quando vazia
 * e `bg-primary` quando marcada — exatamente o `ui/checkbox.tsx`. A versão
 * de `/tasks` era redonda e âmbar, e âmbar está errado por doutrina: no
 * `globals.css` ele significa "uma pessoa precisa agir", que é o OPOSTO de
 * concluído. E `--control`, não `--input`: um quadrado de 16px sem nada
 * dentro tem a borda como componente inteiro, e é ela que carrega o 3:1 que
 * o `theme-contrast.test.ts` mede.
 *
 * **Atrasada é pílula, não tinta.** Uma cor de texto no meio de uma corrida
 * de metadados cinza compete com o cinza e perde; a pílula não. É o mesmo
 * tratamento que o cartão do quadro já usava.
 *
 * **O responsável é a FOTO.** O `deal-card.tsx` tem um comentário inteiro
 * explicando que essa é a regra da casa, e registra que o mesmo erro já foi
 * corrigido em outras três telas. Numa equipe, reconhecer alguém pelo rosto
 * é mais rápido do que ler o nome.
 */

type Translator = ReturnType<typeof useTranslations<'Tasks'>>;

/**
 * AS COLUNAS DA LISTA — um gabarito, escrito uma vez.
 *
 * ------------------------------------------------------------------
 * POR QUE A LISTA VIROU TABELA
 * ------------------------------------------------------------------
 *
 * Relato do Gabriel em 14 de setembro, com print de `/tasks` num monitor
 * largo: *"a lista de tarefas tá sobrando espaço demais, tem que ter mais
 * distribuição de parâmetros ou conteúdo/informação para preencher de forma
 * útil, como um excel que tem linhas laterais e linhas horizontais"*.
 *
 * Ele está descrevendo o defeito com precisão. Cada linha empilhava título
 * e metadados numa coluna de 400px e deixava 900px vazios à direita, com a
 * foto do responsável sozinha no fim — e como cada linha se desenhava por
 * conta própria, os chips de uma nunca ficavam alinhados com os da outra.
 * Uma lista em que nada se alinha não se lê por coluna: a única forma de
 * comparar prazos era ler tarefa por tarefa.
 *
 * Então em telas largas isto é uma TABELA: mesmas colunas em toda linha,
 * réguas entre elas, e as informações que estavam escondidas — a descrição
 * e o nome do contato — ocupando o espaço que sobrava.
 *
 * ------------------------------------------------------------------
 * E POR QUE NÃO UMA `<table>`
 * ------------------------------------------------------------------
 *
 * Porque abaixo de `md` ela deixa de ser tabela: a mesma tarefa vira o
 * bloco empilhado de sempre, que é o que cabe num telefone. Uma `<table>`
 * de verdade não muda de forma sem duas marcações — e duas marcações para
 * uma linha é exatamente o que este arquivo existe para não ter.
 *
 * O truque que evita isso é `md:contents`: no telefone, tipo, prazo e
 * vínculo moram juntos num bloco embaixo do título; no desktop esse bloco
 * some da caixa e os três viram células da grade. Um DOM, duas formas.
 */
const TASK_GRID =
  'grid items-center gap-x-2 gap-y-1 grid-cols-[1rem_minmax(0,1fr)_auto] md:gap-x-0 md:grid-cols-[2.25rem_minmax(0,1fr)_7rem_11rem_10rem_3rem]';

/** A régua vertical entre colunas, só onde há colunas. */
const TASK_CELL = 'md:border-border md:border-l md:px-3 md:py-2';

/**
 * O ÍCONE DE CADA TIPO.
 *
 * A coluna TIPO era uma pílula cinza por linha — e numa tela com quinze
 * tarefas isso é uma coluna inteira de retângulos que repetem quatro
 * palavras. Pílula é o tratamento certo para uma taxonomia que aparece
 * SOLTA (num cartão, numa ficha); numa coluna de tabela, onde o rótulo já
 * está escrito no cabeçalho, ela só engorda a linha.
 *
 * Ícone à frente do nome resolve os dois lados: dá para varrer a coluna
 * pelo desenho, sem ler, e o nome continua lá para quem não decorou os
 * seis. É o mesmo idioma do calendário, que já desenha tipo como glifo.
 */
const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  meeting: Users,
  visit: MapPin,
  followup: CornerUpRight,
  quote: FileText,
  todo: CircleDot,
};

/**
 * O cabeçalho da tabela. Só existe de `md` para cima — no telefone não há
 * colunas para nomear.
 *
 * `sticky`: em `/tasks` ele é o cabeçalho de UMA tabela, que rola por
 * dezenas de linhas. Antes havia um por grupo — quatro cópias de
 * "TAREFA · TIPO · PRAZO · VÍNCULO · RESP." numa tela só —, e repetir o
 * nome das colunas a cada duas linhas não é redundância inofensiva: some
 * com o que a lista está dizendo. Um cabeçalho, preso no topo, faz o
 * trabalho das quatro cópias.
 */
export function TaskColumnsHeader({
  t,
  sticky = false,
}: {
  t: Translator;
  sticky?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        TASK_GRID,
        'text-muted-foreground border-border hidden border-b md:grid',
        // `bg-card` é obrigatório junto do `sticky`: sem fundo próprio, as
        // linhas passariam por baixo do cabeçalho e apareceriam através
        // dele.
        sticky && 'bg-card sticky top-0 z-10 rounded-t-lg'
      )}
    >
      <span />
      <span className="text-3xs px-3 py-1.5 font-semibold tracking-wide uppercase">
        {t('columnTask')}
      </span>
      <span
        className={cn(
          TASK_CELL,
          'text-3xs py-1.5! font-semibold tracking-wide uppercase'
        )}
      >
        {t('columnKind')}
      </span>
      <span
        className={cn(
          TASK_CELL,
          'text-3xs py-1.5! font-semibold tracking-wide uppercase'
        )}
      >
        {t('columnDue')}
      </span>
      <span
        className={cn(
          TASK_CELL,
          'text-3xs py-1.5! font-semibold tracking-wide uppercase'
        )}
      >
        {t('columnLink')}
      </span>
      <span
        className={cn(
          TASK_CELL,
          'text-3xs py-1.5! font-semibold tracking-wide uppercase'
        )}
      >
        {t('columnOwner')}
      </span>
    </div>
  );
}

/**
 * A FAIXA DE UM GRUPO, dentro da mesma tabela.
 *
 * "Atrasadas", "Hoje", "Amanhã" eram quatro `<section>` com quatro painéis
 * — quatro molduras, quatro cabeçalhos, quatro cantos arredondados —, e a
 * tela lia como quatro listas diferentes que por acaso estavam empilhadas.
 * São uma lista só, ordenada por urgência.
 *
 * Então o grupo vira uma LINHA DE FAIXA dentro do painel, como o
 * agrupamento de uma planilha: a largura inteira, um fundo levemente mais
 * escuro, o nome e a contagem. As colunas continuam alinhadas de ponta a
 * ponta porque nunca deixaram de ser as mesmas.
 *
 * Atrasado é o único que ganha cor. Não por decoração: é o único grupo
 * cuja existência é um problema.
 */
export function TaskGroupBand({
  label,
  count,
  tone = 'neutral',
  children,
}: {
  label: string;
  count: number;
  tone?: 'neutral' | 'danger';
  /** O botão de abrir/fechar, quando o grupo é dobrável (Concluídas). */
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'border-border flex items-center gap-1.5 border-b px-3 py-1.5',
        tone === 'danger' ? 'bg-danger-soft' : 'bg-muted/70'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tone === 'danger' ? 'bg-danger' : 'bg-muted-foreground/40'
        )}
      />
      <span
        className={cn(
          'eyebrow',
          tone === 'danger' ? 'text-danger-ink' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
      <span className="text-muted-foreground text-2xs tabular-nums">
        · {count}
      </span>
      {children}
    </div>
  );
}

export interface TaskRowProps {
  task: Task;
  todayIso: string;
  locale: string;
  assignee: DirectoryMember | null;
  busy: boolean;
  canWrite: boolean;
  /**
   * `compact` dentro de uma ficha, onde a linha divide espaço com o resto;
   * `comfortable` em `/tasks`, onde ela é o conteúdo.
   */
  density?: 'compact' | 'comfortable';
  /** O link para a ficha do contato — só a página `/tasks` o mostra. */
  contact?: { href: string; label: string } | null;
  onToggle: () => void;
  onEdit: () => void;
  t: Translator;
}

export function TaskRow({
  task,
  todayIso,
  locale,
  assignee,
  busy,
  canWrite,
  density = 'compact',
  contact = null,
  onToggle,
  onEdit,
  t,
}: TaskRowProps) {
  const done = task.status !== 'open';
  const overdue = !done && isOverdue(task, todayIso);
  const today = !done && isDueToday(task, todayIso);
  const due = task.due_on ? formatDue(task, todayIso, locale, t) : null;

  const comfortable = density === 'comfortable';

  return (
    <div
      className={cn(
        'group',
        comfortable
          ? // A linha da tabela: régua embaixo, realce no ponteiro, e nada
            // de cantos arredondados — um retângulo arredondado dentro de
            // uma grade de réguas lê como um cartão solto na planilha.
            cn(TASK_GRID, 'border-border hover:bg-muted/40 border-b')
          : 'row-interactive flex items-start gap-2 rounded-lg px-1.5 py-1.5'
      )}
    >
      {/*
        A caixa é um botão de verdade e fica FORA do alvo que abre a gaveta.
        Aninhar os dois faria cada tentativa de marcar como feita abrir o
        diálogo por engano — o erro mais irritante que uma lista de tarefas
        pode ter, porque acontece na ação mais frequente.
      */}
      <span
        className={cn(
          comfortable && 'flex items-center justify-center md:py-2'
        )}
      >
        <button
          type="button"
          disabled={!canWrite || busy}
          onClick={onToggle}
          aria-label={done ? t('reopen') : t('complete')}
          className={cn(
            'border-control grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-(--dur-1)',
            !comfortable && 'mt-0.5',
            done
              ? 'border-primary bg-primary text-primary-foreground'
              : 'bg-card hover:border-primary',
            !canWrite && 'cursor-not-allowed opacity-50'
          )}
        >
          {busy ? (
            <Loader2 className="size-2.5 animate-spin" />
          ) : done ? (
            task.status === 'done' ? (
              <Check className="size-3" />
            ) : (
              <RotateCcw className="size-2.5" />
            )
          ) : null}
        </button>
      </span>

      <button
        type="button"
        onClick={onEdit}
        className={cn(
          'min-w-0 text-left',
          comfortable ? 'md:px-3 md:py-2' : 'flex-1'
        )}
      >
        <p
          className={cn(
            'truncate text-sm',
            done ? 'text-muted-foreground line-through' : 'text-foreground'
          )}
        >
          {task.title}
        </p>
        {/* A DESCRIÇÃO, que existia no banco e não aparecia em lugar
            nenhum da lista. É ela que preenche a coluna larga com algo
            útil — "o que é esta tarefa" — em vez de ar. Uma linha só: quem
            quer o resto abre. */}
        {comfortable && task.description ? (
          <p className="text-muted-foreground mt-0.5 hidden truncate text-xs md:block">
            {task.description}
          </p>
        ) : null}
      </button>

      {/*
        NO TELEFONE um bloco embaixo do título; no desktop, `md:contents`
        dissolve a caixa e tipo, prazo e vínculo viram três células da
        grade. Ver a nota em `TASK_GRID`.
      */}
      <div
        className={cn(
          'col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1',
          comfortable && 'md:contents'
        )}
      >
        {/* O TIPO: ícone + nome. Ver `KIND_ICON` para por que não é mais
            uma pílula. O glifo é `text-muted-foreground` e não colorido —
            seis cores de tipo brigariam com as três que a tela já usa
            para dizer atrasada, hoje e concluída, que é a informação que
            de fato muda o que você faz agora. */}
        <span
          className={cn(
            'text-muted-foreground flex min-w-0 items-center gap-1.5 text-2xs',
            comfortable && TASK_CELL
          )}
        >
          <KindIcon kind={task.kind} />
          <span className="truncate">{kindLabel(task.kind, t)}</span>
        </span>

        <span
          className={cn(
            'text-muted-foreground text-2xs',
            comfortable && TASK_CELL
          )}
        >
          {due ? (
            overdue ? (
              // Atrasada é PÍLULA, não tinta: uma cor de texto no meio de
              // uma corrida de metadados cinza compete com o cinza e perde.
              <StatusBadge variant="danger" size="sm">
                {due}
              </StatusBadge>
            ) : (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  today && 'text-human-ink font-medium'
                )}
              >
                <Clock className="size-3" />
                {due}
              </span>
            )
          ) : (
            // Um travessão, e não uma célula vazia: numa tabela, vazio é
            // "não carregou" e travessão é "não tem".
            comfortable && <span className="hidden md:inline">—</span>
          )}
        </span>

        {/* O VÍNCULO — e agora com o NOME de quem, não a palavra
            "contato". O nome é o que responde "de quem é esta ligação"
            sem abrir nada. */}
        <span className={cn('min-w-0', comfortable && TASK_CELL)}>
          {contact ? (
            <Link
              href={contact.href}
              className="text-muted-foreground hover:text-foreground text-2xs block truncate underline-offset-2 hover:underline"
            >
              {contact.label}
            </Link>
          ) : (
            comfortable && (
              <span className="text-muted-foreground text-2xs hidden md:inline">
                —
              </span>
            )
          )}
        </span>
      </div>

      {/* O RESPONSÁVEL É A FOTO: numa equipe, reconhecer alguém pelo rosto
          é mais rápido do que ler o nome. Mesma regra do cartão do funil. */}
      <span
        className={cn(
          'flex items-center justify-center',
          comfortable && TASK_CELL,
          comfortable && 'md:py-2'
        )}
      >
        {assignee ? (
          <MemberAvatar
            name={assignee.full_name}
            avatarUrl={assignee.avatar_url}
            size="2xs"
            className="shrink-0"
          />
        ) : comfortable ? (
          <span className="text-muted-foreground text-2xs hidden md:inline">
            —
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * O glifo do tipo — e nada quando a conta inventou um tipo próprio.
 *
 * `tasks.kind` é TEXT e a 068 aceita o que a conta escrever. Um ícone
 * padrão para o desconhecido diria "é isto aqui" sobre algo que ninguém
 * classificou; o espaço vazio ao lado do nome é mais honesto, e o nome
 * continua sendo escrito por extenso.
 */
function KindIcon({ kind }: { kind: string }) {
  const Icon = KIND_ICON[kind];
  return Icon ? <Icon className="size-3.5 shrink-0" /> : null;
}

/**
 * O nome do tipo, ou o próprio tipo.
 *
 * `tasks.kind` é TEXT e a 068 aceita o que a conta escrever — mesma doutrina
 * da 042 para tipos de ocorrência. Traduzir só o que está no catálogo e
 * devolver o resto como veio é o que evita imprimir uma chave na tela.
 */
function kindLabel(kind: string, t: Translator): string {
  return (TASK_KINDS as readonly string[]).includes(kind)
    ? t(`kind.${kind}` as 'kind.call')
    : kind;
}

/** "Hoje 14:00", "Atrasada · 8 set", "12 set" — o mínimo que responde. */
export function formatDue(
  task: Task,
  todayIso: string,
  locale: string,
  t: Translator
): string {
  if (!task.due_on) return '';
  const time = task.due_time
    ? formatTime(task.due_time.slice(0, 5), locale)
    : '';

  if (task.due_on === todayIso) {
    return time ? t('dueTodayAt', { time }) : t('dueToday');
  }

  const date = fromISO(task.due_on);
  const day = date
    ? new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
      }).format(date)
    : task.due_on;

  // A hora acompanha o dia quando existe: "8 set 14:30". Perdê-la aqui
  // faria uma tarefa marcada para a tarde de quinta parecer uma tarefa de
  // quinta, e a diferença entre as duas é o motivo de a 068 guardar hora.
  const label = time ? `${day} ${time}` : day;
  return isOverdue(task, todayIso) ? t('dueOverdue', { day: label }) : label;
}
