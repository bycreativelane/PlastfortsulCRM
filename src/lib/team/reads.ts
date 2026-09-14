import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ATÉ ONDE CADA PESSOA LEU — no banco, por sala (migração 077).
 *
 * ------------------------------------------------------------------
 * O QUE ISTO SUBSTITUI
 * ------------------------------------------------------------------
 *
 * O marcador de "visto" morava no `localStorage` (`markTeamRoomSeen`), e o
 * comentário dele admitia o preço: "errado na direção inofensiva — um
 * segundo navegador mostra o ponto de novo". Com a sala em uso, o erro
 * deixou de ser inofensivo, e o Gabriel pediu o número "contando real".
 * O que estava errado, medido no código em 14 de setembro de 2026, está
 * no topo da seção 3 da 077.
 *
 * ------------------------------------------------------------------
 * O RECUO
 * ------------------------------------------------------------------
 *
 * As migrações são aplicadas à mão. Antes da 077 as duas funções não
 * existem, o PostgREST responde `PGRST202`, e quem chama volta para o
 * marcador local — o comportamento de antes, e não uma sala que para de
 * contar. `'missing'` é essa resposta, distinta de "zero não lidas".
 */

export interface TeamUnreadCounts {
  /** Não lidas de outras pessoas, somando todas as salas. */
  total: number;
  /** Quantas dessas chamam esta pessoa pelo nome. */
  mentions: number;
  /** Por sala — o seletor de salas mostra cada uma. */
  byRoom: Map<string, { unread: number; mentions: number }>;
}

/** A função não existe: a 077 não rodou. */
export function isMissingFunction(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(
    error.message ?? ''
  );
}

export async function loadTeamUnreadCounts(
  db: SupabaseClient
): Promise<TeamUnreadCounts | 'missing' | null> {
  const { data, error } = await db.rpc('team_unread_counts');
  if (error) {
    if (isMissingFunction(error)) return 'missing';
    console.error('Failed to count team unread:', error.message);
    return null;
  }

  const byRoom = new Map<string, { unread: number; mentions: number }>();
  let total = 0;
  let mentions = 0;
  for (const row of (data ?? []) as Array<{
    room_id: string;
    unread: number | string;
    mentions: number | string;
  }>) {
    // BIGINT pode chegar como texto — mesma guarda de `quotes/store.ts`.
    const unread = Number(row.unread) || 0;
    const chamadas = Number(row.mentions) || 0;
    byRoom.set(row.room_id, { unread, mentions: chamadas });
    total += unread;
    mentions += chamadas;
  }
  return { total, mentions, byRoom };
}

/**
 * Marca a sala como lida até `readAt`.
 *
 * Nunca anda para trás — o GREATEST mora na função, porque duas abas na
 * mesma sala mandam marcadores fora de ordem (ver a seção 4 da 077).
 */
export async function markTeamRoomRead(
  db: SupabaseClient,
  roomId: string,
  readAt: string
): Promise<'ok' | 'missing' | 'error'> {
  const { error } = await db.rpc('mark_team_room_read', {
    p_room_id: roomId,
    p_read_at: readAt,
  });
  if (!error) return 'ok';
  if (isMissingFunction(error)) return 'missing';
  console.error('Failed to mark team room read:', error.message);
  return 'error';
}
