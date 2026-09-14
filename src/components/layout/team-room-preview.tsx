'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PreviewCard } from '@base-ui/react/preview-card';
import { FileText, Image as ImageIcon, Mic, Users, Video } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useMemberNames } from '@/hooks/use-member-names';
import { format, isToday, isYesterday } from 'date-fns';

import { formatMonthDay } from '@/lib/i18n/dates';
import { groupPreview, loadTeamPreview, previewText } from '@/lib/team/preview';
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
        {/*
          ENTRA E SAI, em vez de aparecer seco.

          A gramática é a do `ui/sheet.tsx` e a que o Base UI documenta:
          `data-starting-style` e `data-ending-style` com uma TRANSIÇÃO. O
          que estava aqui eram classes de keyframe (`data-open:animate-in`),
          que o Base UI não usa para cronometrar entrada e saída — o popup
          aparecia e sumia no mesmo quadro, e foi o que o Gabriel descreveu
          como "carregando todo duro".

          Desliza 4px a partir do trilho, de onde ele vem, e volta para lá.
          150ms: o bastante para o olho acompanhar, pouco o bastante para
          não atrasar quem só passou o mouse para ler.
        */}
        <PreviewCard.Popup className="glass text-popover-foreground w-72 origin-(--transform-origin) rounded-lg p-3 transition-[opacity,transform] duration-150 ease-out data-ending-style:-translate-x-1 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:-translate-x-1 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
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
 * A LISTA — e ela tem de PARECER a conversa que está prevendo.
 *
 * ------------------------------------------------------------------
 * O QUE ESTAVA ERRADO, COM PRINT
 * ------------------------------------------------------------------
 *
 * A primeira versão era uma linha por mensagem: nome à esquerda, data à
 * direita, texto embaixo. Seis mensagens seguidas da mesma pessoa no mesmo
 * dia viravam seis "Você — 8 de set." empilhados, e o Gabriel disse o que
 * se via: *"não tá parecendo chat"*. Estava certo — aquilo era um registro
 * de log, e o que a pessoa quer reconhecer de relance é uma CONVERSA.
 *
 * O conserto é usar a gramática que a sala já usa, em miniatura:
 *
 *   - BOLHAS, as minhas à direita e as dos outros à esquerda, com os
 *     mesmos tokens do balão da sala (`bg-wa-out` / `bg-wa-in`);
 *   - TURNOS: quem fala três vezes seguidas é uma pessoa falando, e o nome
 *     aparece uma vez (a mesma regra do `firstOfRun` lá);
 *   - O DIA dito UMA VEZ, num separador, onde ele muda — e não carimbado
 *     em cada linha;
 *   - a HORA na última bolha do turno, que é a que responde "quando foi".
 *
 * `messages === null` é "ainda buscando" e desenha bolhas cinzas na altura
 * certa: a prévia não pula de tamanho quando a consulta volta. `[]` é "a
 * sala está vazia", que é outra resposta e outra frase.
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
  // O dia é dito com as palavras da conversa — "Hoje", "Ontem" — e não com
  // uma segunda tradução para a mesma ideia.
  const tThread = useTranslations('Inbox.messageThread');

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
   * equipe" em cada turno seria ruído. Numa conta com "Operação" e
   * "Comercial", o turno sem o nome da sala é uma frase sem endereço.
   */
  const salas = new Map(rooms.map((room) => [room.id, room]));

  if (messages === null) {
    return (
      <ul aria-hidden className="space-y-2 py-1">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className={cn('flex', i === 1 ? 'justify-end' : 'justify-start')}
          >
            <span
              className={cn(
                'bg-muted block h-6 rounded-lg',
                i === 1 ? 'w-28' : i === 0 ? 'w-40' : 'w-32'
              )}
            />
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

  const turnos = groupPreview(messages);

  return (
    /*
     * O MESMO CHÃO DA SALA (`bg-wa-bg`), e não o vidro do popup.
     *
     * A bolha de quem escreve é branca; sobre o vidro — que também é
     * claro — ela sumia, e o que sobrava era texto solto de novo. Na sala
     * ela se apoia no papel de parede do chat, e é esse contraste que faz
     * uma bolha parecer uma bolha.
     */
    <div className="bg-wa-bg -mx-1 space-y-1.5 rounded-lg px-2 py-2">
      {turnos.map((turno, indice) => {
        const meu = turno.authorId === userId;
        // O primeiro nome: numa coluna de 18rem, "Juliana Prestes Rodrigues"
        // empurra tudo, e o sobrenome não ajuda a saber quem é.
        const autor =
          names.get(turno.authorId)?.split(' ')[0] ?? t('unknownAuthor');
        const sala = turno.roomId ? salas.get(turno.roomId) : null;
        const nomeDaSala =
          sala && !sala.is_default ? roomName(sala, t('title')) : null;
        // O dia, uma vez, onde ele muda.
        const diaNovo = indice === 0 || turnos[indice - 1].day !== turno.day;
        const quando = new Date(turno.messages[0].created_at);

        return (
          <div key={turno.key} className="space-y-1">
            {diaNovo && (
              <p className="text-muted-foreground text-3xs pt-1 text-center">
                {isToday(quando)
                  ? tThread('today')
                  : isYesterday(quando)
                    ? tThread('yesterday')
                    : // `formatMonthDay` e não `PPP`: "8 de setembro de 2026"
                      // quebra em duas linhas numa prévia de 18rem.
                      formatMonthDay(quando)}
              </p>
            )}

            {/* A legenda do turno: quem falou, e de qual sala quando não é a
                padrão. Some nas minhas — "Você" à direita, na minha cor, já
                está dito pelo lado em que a bolha está. */}
            {(!meu || nomeDaSala) && (
              <p
                className={cn(
                  'text-2xs text-muted-foreground flex items-baseline gap-1 px-0.5',
                  meu && 'justify-end'
                )}
              >
                {!meu && (
                  <span className="text-foreground font-semibold">{autor}</span>
                )}
                {nomeDaSala && <span className="truncate">{nomeDaSala}</span>}
              </p>
            )}

            <ul className="space-y-0.5">
              {turno.messages.map((message, i) => {
                const { media, text } = previewText(message, labels);
                const Icone = media ? MEDIA_ICON[media] : null;
                const ultima = i === turno.messages.length - 1;
                return (
                  <li
                    key={message.id}
                    className={cn(
                      'flex',
                      meu ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <span
                      className={cn(
                        'text-secondary-foreground max-w-[85%] min-w-0 rounded-lg px-2 py-1 text-xs leading-snug shadow-[var(--wa-shadow)]',
                        meu ? 'bg-wa-out' : 'bg-wa-in'
                      )}
                    >
                      <span className="flex items-start gap-1">
                        {Icone && (
                          <Icone className="text-muted-foreground mt-0.5 size-3 shrink-0" />
                        )}
                        {/* Três linhas e reticências: a prévia existe para
                            decidir se vale abrir, não para substituir a
                            sala. */}
                        <span className="line-clamp-3 break-words">{text}</span>
                      </span>
                      {/* A hora na ÚLTIMA bolha do turno — é ela que responde
                          "quando foi". Nas de cima seria a mesma resposta
                          repetida. */}
                      {ultima && (
                        <span className="text-muted-foreground text-3xs mt-0.5 block text-right tabular-nums">
                          {format(new Date(message.created_at), 'HH:mm')}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
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
/**
 * A ÚLTIMA PRÉVIA CARREGADA, no módulo.
 *
 * A prévia é montada e desmontada a cada passada do mouse. Sem isto, TODA
 * passada começa pelo esqueleto e salta para o conteúdo meio segundo
 * depois — o "carregando duro" do relato. Com o cache, só a primeira do
 * dia mostra esqueleto; as seguintes já abrem com a conversa e se
 * atualizam por baixo, se algo mudou.
 *
 * No módulo e não em `useState` porque o componente não sobrevive entre
 * uma passada e outra — é justamente esse o problema que ele resolve.
 */
let ultimaPrevia: { accountId: string; messages: TeamMessage[] } | null = null;

export function TeamRoomPreview({
  rooms,
  version,
}: {
  rooms: TeamRoom[];
  version: number;
}) {
  const { accountId, user } = useAuth();
  const names = useMemberNames();
  const [messages, setMessages] = useState<TeamMessage[] | null>(() =>
    ultimaPrevia && ultimaPrevia.accountId === accountId
      ? ultimaPrevia.messages
      : null
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void loadTeamPreview(createClient(), accountId).then((rows) => {
      ultimaPrevia = { accountId, messages: rows };
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
