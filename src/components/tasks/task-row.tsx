'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Clock, Loader2, RotateCcw } from 'lucide-react';

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

  return (
    <div
      className={cn(
        'row-interactive group flex items-start gap-2 rounded-lg',
        density === 'compact' ? 'px-1.5 py-1.5' : 'px-3 py-2'
      )}
    >
      {/*
        A caixa é um botão de verdade e fica FORA do alvo que abre a gaveta.
        Aninhar os dois faria cada tentativa de marcar como feita abrir o
        diálogo por engano — o erro mais irritante que uma lista de tarefas
        pode ter, porque acontece na ação mais frequente.
      */}
      <button
        type="button"
        disabled={!canWrite || busy}
        onClick={onToggle}
        aria-label={done ? t('reopen') : t('complete')}
        className={cn(
          'border-control mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-(--dur-1)',
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

      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p
          className={cn(
            'truncate text-sm',
            done ? 'text-muted-foreground line-through' : 'text-foreground'
          )}
        >
          {task.title}
        </p>

        <span className="text-muted-foreground text-2xs mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{kindLabel(task.kind, t)}</span>

          {due ? (
            overdue ? (
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
          ) : null}
        </span>
      </button>

      {contact ? (
        <Link
          href={contact.href}
          className="text-muted-foreground hover:text-foreground text-2xs mt-1 shrink-0 underline-offset-2 hover:underline"
        >
          {contact.label}
        </Link>
      ) : null}

      {assignee ? (
        <MemberAvatar
          name={assignee.full_name}
          avatarUrl={assignee.avatar_url}
          size="2xs"
          className="mt-0.5 shrink-0"
        />
      ) : null}
    </div>
  );
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
  const time = task.due_time ? formatTime(task.due_time.slice(0, 5), locale) : '';

  if (task.due_on === todayIso) {
    return time ? t('dueTodayAt', { time }) : t('dueToday');
  }

  const date = fromISO(task.due_on);
  const day = date
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
        date
      )
    : task.due_on;

  // A hora acompanha o dia quando existe: "8 set 14:30". Perdê-la aqui
  // faria uma tarefa marcada para a tarde de quinta parecer uma tarefa de
  // quinta, e a diferença entre as duas é o motivo de a 068 guardar hora.
  const label = time ? `${day} ${time}` : day;
  return isOverdue(task, todayIso) ? t('dueOverdue', { day: label }) : label;
}
