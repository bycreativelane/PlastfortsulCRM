'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  countUnreadTeamMessages,
  lastSeenTeamMessage,
  TEAM_SEEN_EVENT,
  type TeamMessage,
} from '@/lib/team/messages';
import { loadTeamRooms, roomName, type TeamRoom } from '@/lib/team/rooms';
import { cn } from '@/lib/utils';
import { CountBadge } from '@/components/ui/count-badge';

/**
 * The team room, from wherever you happen to be.
 *
 * The room itself lives in the inbox, which is the right home for it — it
 * is a conversation, and conversations are there. What that costs is
 * everywhere else: somebody on the Kanban or in Relatórios has no way of
 * knowing a colleague just asked them something, and a room you only
 * discover by navigating to it is a room that gets used twice.
 *
 * So the rail carries a way in and a count. The rail is the only surface
 * in this app that is on screen on every route, which is exactly the
 * property this needs and the reason it is here rather than in the header.
 *
 * BELOW THE ROADMAP CARD, above the account tile. The tile is the rail's
 * floor — it holds "Sair" and it is where the eye goes to leave — so
 * nothing pushes it off the bottom of a short window.
 *
 * SILENT ONLY BEFORE MIGRATION 046. `team_messages` does not exist until it
 * is applied, and a card rendering "could not load" on every route would be
 * worse than no card.
 *
 * An EMPTY room still draws, which is the correction: hiding it until
 * somebody had written made the feature invisible on the day it shipped, and
 * nobody writes the first message in a place they cannot find.
 *
 * ------------------------------------------------------------------
 * ÍCONE, TÍTULO, SUBTÍTULO — E MAIS NADA (item 37 do pacote)
 * ------------------------------------------------------------------
 *
 * Este card carregava três linhas do histórico, com o rosto de quem
 * escreveu, o primeiro nome e o horário de cada turno. O item 37 pede que
 * ele fique tão simples quanto a linha "Minha equipe" da caixa de entrada,
 * e essa linha existe: é o `TeamRoomRow` do `inbox/conversation-list.tsx`,
 * com `Inbox.team.title` e `Inbox.team.rowHint` — as mesmas duas chaves
 * que a "referência desejada" do pacote transcreve, palavra por palavra.
 * Então não havia um desenho a inventar: havia um a copiar.
 *
 * O QUE SE TROCA, e vale estar escrito porque este arquivo defendia o
 * contrário. A nota que saiu dizia que uma linha é uma notificação e três
 * são uma CONVERSA — uma pergunta e uma resposta ainda cabem, e decidir se
 * vale abrir era o trabalho inteiro do card. Isso deixa de ser possível
 * daqui: o card passa a dizer que há coisa nova e não o que é.
 *
 * O que NÃO saiu foi o contador. A lista de remoções do item 37 é
 * específica — nome, data, prévia de áudio, prévia de texto, mensagens
 * empilhadas, histórico, avatar — e o número não está nela. Ele também é a
 * única coisa que ainda diferencia este card de um item de menu comum, e é
 * o que faz o trilho valer a pena: sem ele, uma sala que ninguém abre não
 * chama ninguém.
 */
export function TeamRoomCard() {
  const t = useTranslations('Inbox.team');
  const { accountId } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  /** True once we know the table exists — see the fetch below. */
  const [available, setAvailable] = useState(false);

  const refreshUnread = useCallback(
    async (db = createClient()) => {
      if (!accountId) return;
      // Across every room, on purpose: "how much have I missed" does not
      // care which room it was missed in.
      setUnreadCount(
        await countUnreadTeamMessages(db, accountId, lastSeenTeamMessage())
      );
    },
    [accountId]
  );

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // UMA LINHA, e só para saber se a tabela existe. Antes eram vinte,
      // porque o card desenhava as últimas três mensagens; sem a prévia,
      // trazer o histórico em toda navegação seria pagar por um dado que
      // ninguém mais lê.
      const { error } = await supabase
        .from('team_messages')
        .select('id')
        .eq('account_id', accountId)
        .limit(1);
      // Pre-046 the error IS "the table is not there", which is the only
      // reason to stay hidden — and not worth a console line on every page
      // load. No error means the room exists, with or without rows: two
      // different facts, and the card needs the first one.
      if (error || cancelled) return;
      setAvailable(true);
      void refreshUnread(supabase);
    })();

    // Rooms, when the schema has them. `'missing-table'` is a pre-052
    // database, where every message is in the one room 046 built and the
    // heading below falls back to its name.
    void loadTeamRooms(supabase, accountId).then((result) => {
      if (cancelled || result === 'missing-table') return;
      setRooms(result);
    });

    const channel = supabase
      .channel('team-room-card')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as TeamMessage;
          // Counted rather than recounted: the round trip would be one
          // query per message received, on every route, for a number this
          // browser can derive exactly.
          const seen = lastSeenTeamMessage();
          if (!seen || row.created_at > seen) {
            setUnreadCount((n) => n + 1);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [accountId, refreshUnread]);

  // Re-derive when the room is read.
  //
  // `lastSeenTeamMessage()` is a localStorage read, which is not reactive:
  // the count above was computed against the marker as it stood when the
  // newest message arrived, and opening the room moves that marker without
  // this component hearing about it. So the card kept a lit badge on every
  // route until a hard navigation remounted it, which is the "o ponto não
  // apaga" report. `markTeamRoomSeen` now announces itself — see
  // `TEAM_SEEN_EVENT`.
  useEffect(() => {
    const recheck = () => void refreshUnread();
    window.addEventListener(TEAM_SEEN_EVENT, recheck);
    return () => window.removeEventListener(TEAM_SEEN_EVENT, recheck);
  }, [refreshUnread]);

  const unread = unreadCount > 0;

  // Hidden ONLY before migration 046, when the room does not exist. It used
  // to hide whenever the room was EMPTY too, and that was wrong in the way
  // that matters: a room nobody has written in yet is exactly the room that
  // needs to be visible, because nobody writes the first message in a place
  // they cannot find. On the day 046 lands every account has an empty room —
  // so the feature shipped invisible, and got reported as missing.
  if (!available) return null;

  /**
   * O nome da sala padrão, e não o da sala em que alguém falou por último.
   *
   * Enquanto o card citava mensagens, o título tinha que dizer de qual sala
   * elas eram. Sem elas, o título é o nome do lugar para onde o clique vai
   * — e o clique vai para a área, não para uma sala.
   */
  const heading = roomName(
    rooms.find((room) => room.is_default) ?? null,
    t('title')
  );

  return (
    <Link
      href="/inbox?team=1"
      // `data-nav-row` and NOT `data-nav-label`: the label attribute takes
      // the whole element away when the rail collapses, and this card is not
      // prose the way the roadmap card is — it is an icon with a dot on it,
      // which is exactly the thing a 62px rail is FOR. Hiding it meant the
      // one always-visible announcement that a colleague had written
      // disappeared for anyone who works with the rail collapsed. The text
      // column below carries `data-nav-label` and leaves on its own;
      // `data-nav-row` centres the disc in what is left.
      data-nav-row
      title={heading}
      className={cn(
        // `items-center` e não `items-start`: com duas linhas de altura fixa
        // não há mais o que alinhar pelo topo, e o disco centrado é o que a
        // linha da caixa de entrada faz.
        'group/team mb-3 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
        // NO FILL AT REST, which is the other half of the duplicate.
        //
        // It was `bg-muted`: the same fill, at nearly the same radius, as
        // the account tile a few pixels below. Two filled boxes of one
        // colour, each holding a disc over two lines of text — even with
        // different faces in them they read as one control drawn twice.
        //
        // What it takes instead is the grammar the nine navigation rows
        // above it already use, verbatim: transparent with a
        // `hover:bg-muted`, and `bg-primary-soft` for the state that wants
        // attention. This card IS a navigation row — it goes to
        // /inbox?team=1 — so looking like one is the consistent answer
        // rather than the quiet one, and the fill finally MEANS something:
        // it appears when there is unread, instead of being the card's
        // permanent costume.
        unread ? 'bg-primary-soft hover:bg-primary-soft/70' : 'hover:bg-muted'
      )}
    >
      <span className="relative shrink-0">
        {/*
          SEMPRE O GLIFO DA SALA, e nunca mais o rosto de quem escreveu por
          último. O item 37 tira o avatar da última pessoa da lista do que o
          card mostra, e ele era a diferença mais visível entre este card e
          a linha que ele passa a imitar.

          De quebra, some um defeito que estava documentado logo abaixo
          dele: quando quem tinha escrito por último era você, o trilho
          terminava na mesma foto duas vezes — esta e a do bloco da conta,
          poucos pixels abaixo — e isso lia como falha de renderização.
        */}
        <span
          className={cn(
            'grid size-7 place-items-center rounded-full',
            unread ? 'bg-primary text-white' : 'bg-muted text-primary'
          )}
        >
          <Users className="size-3.5" />
        </span>
        {/* The collapsed rail's copy of the count. The badge beside the
            heading goes with the text; this one rides the disc, so "there
            is something new" survives at 62px — the width where the card
            has no other way to say it. A dot rather than the number: at
            62px there is no room for two digits, and the number is one
            click away. */}
        {unread && (
          <span
            data-nav-dot
            className="bg-primary ring-primary-soft absolute -top-0.5 -right-0.5 hidden size-2 rounded-full ring-2"
          />
        )}
      </span>

      <span data-nav-label className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm font-semibold',
              unread ? 'text-primary' : 'text-foreground'
            )}
          >
            {heading}
          </span>
          {/* A COUNT, not a dot. Um recado e onze recados são situações
              diferentes: o primeiro se lê depois, o segundo é uma conversa
              que já passou sem você.

              Capped at 99+ because three digits change the card's width
              and nothing above 99 is a different decision. */}
          {unread && (
            <CountBadge size="dot" tone="primary">
              {unreadCount > 99 ? '99+' : unreadCount}
            </CountBadge>
          )}
        </span>

        {/* A MESMA FRASE DA CAIXA DE ENTRADA, e é a chave que ela já usa.
            Escrever outra aqui seriam duas traduções para a mesma ideia,
            divergindo com o tempo — o mesmo argumento que a faixa de
            descadastro da ficha do contato já segue. */}
        <span className="text-muted-foreground text-2xs block truncate leading-snug">
          {t('rowHint')}
        </span>
      </span>
    </Link>
  );
}
