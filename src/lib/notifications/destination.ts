import type { Notification } from '@/types';

/**
 * Where a notification takes you, or nowhere.
 *
 * Shared by the bell panel and the notifications page, which is the whole
 * point: the panel learned the `contact_id` fallback and the page did not,
 * so the same row was a working link in one surface and a dead click in the
 * other — and the page is the one people open when the panel has already
 * failed to answer them.
 *
 * `null` is a real answer. A notification about something with no page to
 * open — an account-level event, or a row whose subject has since been
 * deleted — must render as text rather than as a control, because a button
 * that does nothing is indistinguishable from a button that is broken.
 */
export function destinationFor(n: Notification): string | null {
  if (n.conversation_id) return `/inbox?c=${n.conversation_id}`;
  // A menção abre a sala NA mensagem: `tm` é lido pela caixa de entrada e
  // passado à sala, que escolhe a sala certa e rola até ela. "Fulano te
  // chamou" que abre no fim da sala errada obriga a procurar.
  if (n.team_message_id) return `/inbox?team=1&tm=${n.team_message_id}`;
  // O aviso de um pedido no Bling (088) abre a oportunidade no quadro — é
  // lá que está a área Pedido com o que mudou.
  if (n.deal_id) return `/pipelines?deal=${n.deal_id}`;
  // Uma tarefa ainda não tem página própria: a Fase 3 do
  // `docs/spec-tarefas-e-agendas.md` cria `/agenda`, e aí este ramo passa a
  // ser `/agenda?task=${n.task_id}`. Até lá, a ficha do contato é onde a
  // tarefa aparece de verdade — e um lembrete de tarefa sem contato leva a
  // lugar nenhum, que é a resposta que o comentário acima defende.
  if (n.contact_id) return `/contacts?id=${n.contact_id}`;
  return null;
}
