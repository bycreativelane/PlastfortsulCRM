import { NextResponse, type NextRequest } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/calendar-sync/admin-client';

const DIRECTIONS = new Set(['in', 'out', 'both']);

/** As agendas da conexão, com o que cada uma faz. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data } = await supabaseAdmin()
      .from('calendar_sources')
      .select(
        'id, external_id, summary, color, is_primary, direction, enabled, ' +
          'last_synced_at, last_error'
      )
      .eq('account_id', ctx.accountId)
      .order('is_primary', { ascending: false })
      .order('summary', { ascending: true });

    return NextResponse.json({ sources: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Liga, desliga, ou muda a direção de uma agenda.
 *
 * ------------------------------------------------------------------
 * A LISTA BRANCA DE CAMPOS NÃO É CERIMÔNIA
 * ------------------------------------------------------------------
 *
 * O corpo só pode tocar `enabled` e `direction`. Repassar o objeto do
 * cliente para o `update` deixaria alguém escrever `account_id` — e mover
 * uma fonte para OUTRA conta é ler a agenda de outra empresa. `sync_token`
 * também está de fora: escrevê-lo à mão faz a Google devolver 410 e força
 * reimportação, o que é um jeito barato de gastar cota alheia.
 *
 * O `id` é conferido contra `account_id` na própria consulta, e não
 * confiado do corpo: a rota usa o service role, que passa por cima da RLS.
 * Aqui a checagem de conta É a segurança, não uma segunda linha dela.
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json()) as {
      id?: unknown;
      enabled?: unknown;
      direction?: unknown;
    };

    if (typeof body.id !== 'string' || body.id.length === 0) {
      return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.direction === 'string') {
      if (!DIRECTIONS.has(body.direction)) {
        return NextResponse.json(
          { error: 'direction inválida' },
          { status: 400 }
        );
      }
      patch.direction = body.direction;
    }

    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: 'nada a mudar' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin()
      .from('calendar_sources')
      .update(patch)
      .eq('id', body.id)
      .eq('account_id', ctx.accountId)
      .select('id, direction, enabled')
      .maybeSingle();

    if (error) {
      console.error('[calendar] falha ao atualizar a fonte:', error);
      return NextResponse.json({ error: 'falha ao salvar' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'agenda não encontrada' }, { status: 404 });
    }

    return NextResponse.json({ source: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
