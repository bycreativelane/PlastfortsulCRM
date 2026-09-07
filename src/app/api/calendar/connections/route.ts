import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/calendar-sync/admin-client';

/**
 * O estado da conexão, e como desfazê-la.
 *
 * ------------------------------------------------------------------
 * POR QUE ISTO É UMA ROTA E NÃO UM SELECT DO NAVEGADOR
 * ------------------------------------------------------------------
 *
 * `calendar_connections` tem RLS ligada e NENHUMA política (069). O
 * navegador não consegue lê-la nem com a sessão de um dono — de propósito:
 * a linha guarda um refresh token que abre a agenda da empresa, e uma
 * política de leitura seria uma concessão permanente a todo navegador de
 * todo membro, para sempre, por causa de uma tela.
 *
 * Aqui os campos saem escolhidos à mão. Os dois cifrados nunca entram na
 * resposta, e nem sequer são selecionados — o que não é lido não pode
 * vazar por um `console.log` distraído mais tarde.
 */
export async function GET() {
  try {
    // Ler o ESTADO é de qualquer membro: a agenda mostra eventos
    // importados para todo mundo, e "por que isto está aqui?" é uma
    // pergunta que qualquer um pode fazer. Conectar e desconectar é que
    // são de admin.
    const ctx = await getCurrentAccount();

    const { data } = await supabaseAdmin()
      .from('calendar_connections')
      .select(
        'id, provider, provider_email, status, last_error, connected_at, scopes'
      )
      .eq('account_id', ctx.accountId)
      .eq('provider', 'google')
      .maybeSingle();

    return NextResponse.json({ connection: data ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Desconectar.
 *
 * O CASCADE da 069 leva junto as fontes e o espelho — os eventos
 * importados somem da agenda, que é o que "desconectar" quer dizer. Os
 * `task_calendar_links` também caem, e isso é deliberado: sem conexão não
 * há como manter o outro lado, e um vínculo órfão apontaria para um evento
 * que ninguém mais consegue tocar.
 *
 * As TAREFAS ficam. É a regra 3 do §D5 levada ao caso extremo: o
 * compromisso é do CRM, e desligar uma integração nunca apaga trabalho.
 */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin');

    await supabaseAdmin()
      .from('calendar_connections')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('provider', 'google');

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
