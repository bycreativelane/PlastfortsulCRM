'use client';

import { formatDistanceToNow } from 'date-fns';
import {
  AtSign,
  Bell,
  ListChecks,
  MessageSquare,
  ReceiptText,
  UserPlus,
} from 'lucide-react';

import { destinationFor } from '@/lib/notifications/destination';
import { notificationText } from '@/lib/notifications/text';
import { dateFnsOptions } from '@/lib/i18n/dates';
import { IconTile } from '@/components/ui/icon-tile';
import type { Notification } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Uma notificação, numa linha. A ÚNICA.
 *
 * ------------------------------------------------------------------
 * O MESMO OBJETO, DESENHADO DUAS VEZES
 * ------------------------------------------------------------------
 *
 * O painel do sino e a página `/notifications` mostram o mesmo registro, e
 * divergiam em tudo o que se mede:
 *
 *   ladrilho     `IconTile size="xs"` · um quadrado de 40px feito à mão
 *   título       `text-xs`            · `text-sm`
 *   corpo        `text-2xs`           · `text-xs`
 *   carimbo      `text-3xs`           · `text-2xs`
 *   ponto        6px                  · 8px
 *
 * A escada de tipografia é uma decisão de densidade e sobrevive como
 * `density`: o painel do sino é uma lista curta dentro de um popover, a
 * página é a leitura completa. As outras três não eram decisão nenhuma.
 *
 * **O ponto de não-lida, principalmente.** Seis pixels num lugar e oito no
 * outro é o mesmo defeito que o `ui/tag.tsx` documenta ter corrigido: *"um
 * pixel de diferença lê como o mesmo objeto renderizado de forma
 * inconsistente, e não como dois tamanhos."*
 *
 * E o quadrado de 40px da página não estava na escada do `IconTile` — 24,
 * 28, 32 e 36 — nem tinha comentário defendendo o desvio. Vira `md`, os
 * mesmos 32px do aviso de WhatsApp que fica logo acima dele na tela.
 *
 * ------------------------------------------------------------------
 * NÃO-LIDA NÃO É PREENCHIMENTO
 * ------------------------------------------------------------------
 *
 * Três sinais e nenhum deles tinge a linha inteira: a tinta do título fica
 * cheia, o ladrilho toma o tom `primary` e o ponto aparece. Na página, que
 * tem borda, a borda também esquenta. Os dois arquivos já concordavam
 * nisso — e o comentário da página registra que um dia não concordaram
 * (`bg-primary-soft/40` de um lado, `bg-primary/5` do outro).
 *
 * ------------------------------------------------------------------
 * UMA CHAMADA DE `notificationText`, E NÃO DUAS
 * ------------------------------------------------------------------
 *
 * Os dois arquivos chamavam a função uma vez para o título e outra, dentro
 * de uma IIFE no meio do JSX, para o corpo — montando as duas frases
 * inteiras a cada vez e jogando metade fora. Ela devolve o par.
 */

export type NotificationRecord = Notification & {
  contact?: { name: string | null; phone: string | null } | null;
};

/** Um ícone por tipo. Uma linha por tipo. */
const TYPE_ICON: Record<Notification['type'], typeof Bell> = {
  conversation_assigned: UserPlus,
  new_message: MessageSquare,
  task_due: ListChecks,
  team_mention: AtSign,
  bling_order: ReceiptText,
};

type Translator = (key: string, values?: Record<string, string>) => string;

export interface NotificationRowProps {
  notification: NotificationRecord;
  /** Nome do autor, quando `actor_user_id` resolve para um colega. */
  actorName: string | null;
  /**
   * `compact` no painel do sino, que é uma lista curta dentro de um popover;
   * `comfortable` em `/notifications`, onde a linha é o conteúdo.
   */
  density?: 'compact' | 'comfortable';
  onOpen: () => void;
  t: Translator;
}

export function NotificationRow({
  notification: n,
  actorName,
  density = 'compact',
  onOpen,
  t,
}: NotificationRowProps) {
  const Icon = TYPE_ICON[n.type] ?? Bell;
  const unread = !n.read_at;
  const roomy = density === 'comfortable';

  /*
   * A linha é um CONTROLE só quando clicá-la faz alguma coisa — ir a algum
   * lugar, ou marcar-se como lida. Era um `<button>` com cursor e hover
   * qualquer que fosse o conteúdo, e o clique não fazia nada em metade
   * delas.
   */
  const clickable = destinationFor(n) !== null || unread;
  const Row = clickable ? 'button' : 'div';

  const { title, body } = notificationText(n, t, {
    actor: actorName,
    contact: n.contact?.name || n.contact?.phone,
  });

  return (
    <Row
      {...(clickable ? { type: 'button' as const, onClick: onOpen } : {})}
      className={cn(
        'flex w-full items-start text-left',
        roomy
          ? cn(
              'surface-interactive bg-card gap-3 rounded-lg border p-4',
              unread ? 'border-primary/30' : 'border-border'
            )
          : cn(
              'gap-2.5 px-3 py-2 transition-colors',
              clickable && 'hover:bg-muted'
            )
      )}
    >
      <IconTile
        size={roomy ? 'md' : 'xs'}
        tone={unread ? 'primary' : 'neutral'}
        className="mt-0.5"
      >
        <Icon />
      </IconTile>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate font-semibold',
              roomy ? 'text-sm' : 'text-xs',
              unread ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {title}
          </span>
          {unread ? (
            <span
              aria-label={t('unreadAria')}
              className="bg-primary size-1.5 shrink-0 rounded-full"
            />
          ) : null}
        </span>

        {body ? (
          <span
            className={cn(
              'text-muted-foreground mt-0.5 block truncate',
              roomy ? 'text-xs' : 'text-2xs'
            )}
          >
            {body}
          </span>
        ) : null}

        <span
          className={cn(
            'text-muted-foreground/70 mt-0.5 block',
            roomy ? 'text-2xs' : 'text-3xs'
          )}
        >
          {formatDistanceToNow(new Date(n.created_at), {
            addSuffix: true,
            ...dateFnsOptions,
          })}
        </span>
      </span>
    </Row>
  );
}
