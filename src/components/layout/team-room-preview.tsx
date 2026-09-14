'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PreviewCard } from '@base-ui/react/preview-card';
import { FileText, Image as ImageIcon, Mic, Users, Video } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useMemberNames } from '@/hooks/use-member-names';
import { formatListTime } from '@/lib/i18n/dates';
import { loadTeamPreview, previewText } from '@/lib/team/preview';
import type { TeamMessage } from '@/lib/team/messages';
import { roomName, type TeamRoom } from '@/lib/team/rooms';
import { cn } from '@/lib/utils';
import { CountBadge } from '@/components/ui/count-badge';

/**
 * A PRÉ-VISUALIZAÇÃO do card "Minha equipe", em três peças.
 *
 *   `TeamRoomPreviewPopup`  a moldura: posição, vidro, cabeçalho
 *   `TeamRoomPreviewList`   a lista, PURA — recebe mensagens e nomes
 *   `TeamRoomPreview`       quem busca, e só existe com o popup aberto
 *
 * A separação existe para o `/chart-lab`. O card vive atrás do login e
 * busca dados; sem as duas primeiras peças puras, a única forma de olhar a
 * prévia seria entrar no app — e é justamente a peça que mais precisa ser
 * olhada, porque ela é inteira sobre aparência.
 */

const MEDIA_ICON = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
} as const;

/**
 * A moldura: à DIREITA do trilho e alinhada pelo FIM.
 *
 * O card fica perto do pé da barra lateral, e uma prévia alinhada pelo
 * começo desceria para fora da janela num notebook.
 */
export function TeamRoomPreviewPopup({
  heading,
  unreadCount,
  mentioned = false,
  children,
}: {
  heading: string;
  unreadCount: number;
  /** Alguma não lida chama quem está lendo — o número fica âmbar (077). */
  mentioned?: boolean;
  children: ReactNode;
}) {
  return (
    <PreviewCard.Portal>
      <PreviewCard.Positioner
        side="right"
        align="end"
        sideOffset={12}
        className="isolate z-50"
      >
        <PreviewCard.Popup className="glass text-popover-foreground data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 w-72 origin-(--transform-origin) rounded-lg p-3 duration-100">
          <p className="text-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold">
            <Users className="text-primary size-3.5" />
            <span className="min-w-0 flex-1 truncate">{heading}</span>
            {unreadCount > 0 && (
              <CountBadge size="dot" tone={mentioned ? 'human' : 'primary'}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </CountBadge>
            )}
          </p>
          {children}
        </PreviewCard.Popup>
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  );
}

/**
 * A lista, sem buscar nada.
 *
 * `messages === null` é "ainda buscando", e desenha três linhas cinzas na
 * altura das mensagens: a prévia não pula de tamanho quando a consulta
 * volta. `[]` é "a sala está vazia", que é outra resposta e outra frase.
 */
export function TeamRoomPreviewList({
  messages,
  names,
  userId,
  rooms,
}: {
  messages: TeamMessage[] | null;
  names: Map<string, string>;
  userId: string | null;
  rooms: TeamRoom[];
}) {
  const t = useTranslations('Inbox.team');

  const labels = {
    image: t('attachImage'),
    video: t('attachVideo'),
    audio: t('attachAudio'),
    document: t('attachDocument'),
  };

  /**
   * O nome da sala só aparece quando ela NÃO é a padrão.
   *
   * Numa conta com uma sala só — que é quase toda conta — repetir "Minha
   * equipe" em cada linha seria ruído. Numa conta com "Operação" e
   * "Comercial", a linha sem o nome da sala é uma frase sem endereço.
   */
  const salas = new Map(rooms.map((room) => [room.id, room]));

  if (messages === null) {
    return (
      <ul aria-hidden className="space-y-3 py-1">
        {[0, 1, 2].map((i) => (
          <li key={i} className="space-y-1.5">
            <span className="bg-muted block h-2.5 w-20 rounded" />
            <span className="bg-muted block h-3 w-full rounded" />
          </li>
        ))}
      </ul>
    );
  }

  if (messages.length === 0) {
    return (
      <p className="text-muted-foreground py-2 text-center text-xs">
        {t('cardEmpty')}
      </p>
    );
  }

  return (
    <ul className="divide-border/60 -my-1 divide-y">
      {messages.map((message) => {
        const mine = message.author_id === userId;
        const autor = mine
          ? t('cardYou')
          : // O primeiro nome: numa linha de 18rem, "Juliana Prestes
            // Rodrigues" empurra o horário para fora, e o sobrenome não
            // ajuda ninguém a saber quem é numa equipe de dez.
            (names.get(message.author_id)?.split(' ')[0] ?? t('unknownAuthor'));
        const { media, text } = previewText(message, labels);
        const Icone = media ? MEDIA_ICON[media] : null;
        const sala = message.room_id ? salas.get(message.room_id) : null;
        const nomeDaSala =
          sala && !sala.is_default ? roomName(sala, t('title')) : null;

        return (
          <li key={message.id} className="py-2">
            <p className="text-2xs flex items-baseline gap-1.5">
              <span
                className={cn(
                  'truncate font-semibold',
                  mine ? 'text-muted-foreground' : 'text-foreground'
                )}
              >
                {autor}
              </span>
              {nomeDaSala && (
                <span className="text-muted-foreground truncate">
                  · {nomeDaSala}
                </span>
              )}
              <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                {formatListTime(message.created_at)}
              </span>
            </p>
            <p className="text-secondary-foreground mt-0.5 flex items-start gap-1 text-xs leading-snug">
              {Icone && (
                <Icone className="text-muted-foreground mt-0.5 size-3 shrink-0" />
              )}
              {/* Duas linhas e reticências. A prévia existe para decidir se
                  vale abrir, não para substituir a sala — uma mensagem
                  longa inteira aqui empurraria as outras para fora. */}
              <span className="line-clamp-2 break-words">{text}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Quem busca — montado só quando a prévia abre.
 *
 * O card vive em toda rota, e `useMemberNames` e a consulta das mensagens
 * rodariam em cada navegação se morassem nele. Aqui eles só rodam quando
 * alguém para o ponteiro em cima, que é o momento em que o dado é lido.
 *
 * `version` muda quando chega mensagem nova com a prévia aberta, e a lista
 * se refaz: uma prévia que congela no instante em que abriu mostraria a
 * conversa de antes da resposta que acabou de chegar.
 */
export function TeamRoomPreview({
  rooms,
  version,
}: {
  rooms: TeamRoom[];
  version: number;
}) {
  const { accountId, user } = useAuth();
  const names = useMemberNames();
  const [messages, setMessages] = useState<TeamMessage[] | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void loadTeamPreview(createClient(), accountId).then((rows) => {
      if (!cancelled) setMessages(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, version]);

  return (
    <TeamRoomPreviewList
      messages={messages}
      names={names}
      userId={user?.id ?? null}
      rooms={rooms}
    />
  );
}
