'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  countUnreadTeamMessages,
  lastSeenTeamMessage,
  TEAM_SEEN_EVENT,
} from '@/lib/team/messages';
import { loadTeamUnreadCounts, type TeamUnreadCounts } from '@/lib/team/reads';

/**
 * O NÚMERO DA SALA DA EQUIPE — um só, para todo lugar que o desenha.
 *
 * ------------------------------------------------------------------
 * POR QUE UM STORE, E NÃO UM EFEITO EM CADA TELA
 * ------------------------------------------------------------------
 *
 * Três lugares mostram esse número: o card do trilho, a linha "Minha
 * equipe" da caixa de entrada e o seletor de salas. Cada um fazia a sua
 * conta, com a sua assinatura de realtime e o seu critério — o card
 * contava, a linha só acendia um ponto, e os dois discordavam depois de
 * ler a sala até um evento avisar um deles.
 *
 * O desenho é o de `use-unread-notifications`, e pelo mesmo motivo que
 * está escrito lá: o cliente do Supabase é memoizado, `.channel(nome)`
 * devolve o MESMO canal para o mesmo nome, e o segundo componente a
 * assinar derrubaria a tela com "cannot add callbacks after subscribe".
 * Então o canal mora aqui, no módulo, com contagem de referências.
 *
 * ------------------------------------------------------------------
 * RECONTA, EM VEZ DE SOMAR UM
 * ------------------------------------------------------------------
 *
 * O card somava 1 a cada mensagem que chegava. Com o marcador no banco
 * isso deixa de ser exato — a mensagem pode ser de uma sala arquivada, ou
 * alguém pode ter lido a sala no celular um segundo antes —, e a conta
 * certa custa uma consulta. Uma sala de equipe não recebe mensagens em
 * rajada; 300ms de espera juntam as que chegam juntas numa consulta só.
 */

export interface TeamUnreadState extends TeamUnreadCounts {
  /**
   * `db` com a 077 aplicada, `local` antes dela (o marcador do navegador,
   * sem contar as próprias mensagens), `none` antes da primeira resposta.
   */
  source: 'db' | 'local' | 'none';
}

const VAZIO: TeamUnreadState = {
  total: 0,
  mentions: 0,
  byRoom: new Map(),
  source: 'none',
};

let state: TeamUnreadState = VAZIO;
let refs = 0;
let identity: { accountId: string; userId: string } | null = null;
/**
 * DOIS canais, e não um com duas assinaturas.
 *
 * `team_room_reads` só existe depois da 077. Uma assinatura de
 * `postgres_changes` para uma tabela fora da publicação faz o Realtime
 * recusar a entrada no canal — o canal INTEIRO, com todas as assinaturas
 * dele. Com as duas no mesmo canal, um banco sem a 077 deixaria de ouvir
 * até as mensagens novas, que funcionavam antes deste arquivo existir.
 */
let channels: RealtimeChannel[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** Descarta uma contagem que volta depois de a identidade mudar. */
let generation = 0;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function publish(next: TeamUnreadState): void {
  state = next;
  emit();
}

async function recount(): Promise<void> {
  if (!identity) return;
  const mine = generation;
  const { accountId, userId } = identity;
  const db = createClient();

  const counts = await loadTeamUnreadCounts(db);
  if (mine !== generation) return;
  // Erro passageiro: mantém o último número em vez de zerar o card.
  if (counts === null) return;

  if (counts !== 'missing') {
    publish({ ...counts, source: 'db' });
    return;
  }

  // ANTES DA 077: o marcador do navegador, como sempre foi — mas sem as
  // próprias mensagens, que nunca deveriam ter contado.
  const total = await countUnreadTeamMessages(
    db,
    accountId,
    lastSeenTeamMessage(),
    undefined,
    userId
  );
  if (mine !== generation) return;
  publish({ total, mentions: 0, byRoom: new Map(), source: 'local' });
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void recount();
  }, 300);
}

function start(accountId: string, userId: string): void {
  identity = { accountId, userId };
  generation += 1;
  void recount();

  const db = createClient();
  const mensagens = db
    .channel(`team-unread:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'team_messages',
        filter: `account_id=eq.${accountId}`,
      },
      (payload) => {
        // A própria mensagem não muda o número de quem a escreveu. Só o
        // INSERT traz o autor com certeza — um DELETE sem REPLICA IDENTITY
        // FULL chega só com a chave, e aí reconta-se por garantia.
        if (
          payload.eventType === 'INSERT' &&
          (payload.new as { author_id?: string })?.author_id === userId
        ) {
          return;
        }
        schedule();
      }
    )
    .subscribe();

  const leituras = db
    .channel(`team-reads:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'team_room_reads',
        filter: `user_id=eq.${userId}`,
      },
      // Ler a sala em OUTRO aparelho apaga o número aqui — é o que "contar
      // real" quer dizer para quem usa o celular e o computador.
      () => schedule()
    )
    .subscribe();

  channels = [mensagens, leituras];

  window.addEventListener(TEAM_SEEN_EVENT, schedule);
}

function stop(): void {
  generation += 1;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  for (const canal of channels) createClient().removeChannel(canal);
  channels = [];
  window.removeEventListener(TEAM_SEEN_EVENT, schedule);
  identity = null;
  state = VAZIO;
}

function retain(accountId: string, userId: string): () => void {
  refs += 1;
  if (
    !identity ||
    identity.accountId !== accountId ||
    identity.userId !== userId
  ) {
    if (identity) stop();
    start(accountId, userId);
  }
  return () => {
    refs -= 1;
    if (refs === 0) stop();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Zera uma sala AGORA, antes de a consulta voltar.
 *
 * Quem abriu a sala está olhando para o card enquanto a leitura vai e
 * volta do banco; um número que continua aceso por meio segundo depois de
 * a pessoa ler é o "o ponto não apaga" que já foi reportado uma vez.
 */
export function clearTeamRoomUnread(roomId: string): void {
  const sala = state.byRoom.get(roomId);
  if (!sala || (sala.unread === 0 && sala.mentions === 0)) return;
  const byRoom = new Map(state.byRoom);
  byRoom.set(roomId, { unread: 0, mentions: 0 });
  publish({
    ...state,
    byRoom,
    total: Math.max(0, state.total - sala.unread),
    mentions: Math.max(0, state.mentions - sala.mentions),
  });
}

export function useTeamUnread(): TeamUnreadState {
  const { accountId, user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!accountId || !userId) return;
    return retain(accountId, userId);
  }, [accountId, userId]);

  return useSyncExternalStore(
    subscribe,
    () => state,
    // No servidor ninguém está logado e não há socket.
    () => VAZIO
  );
}
