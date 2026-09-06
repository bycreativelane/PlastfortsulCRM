import type { SupabaseClient } from '@supabase/supabase-js';

import {
  toBusinessHours,
  type BusinessHourRow,
  type BusinessHours,
  type HoursExceptionRow,
} from '@/lib/hours';

/**
 * O expediente de uma conta, vindo do banco.
 *
 * Separado de `lib/hours.ts` de propósito: aquele arquivo é aritmética pura
 * e é importado por componentes de navegador, e a decisão de mantê-lo sem
 * nenhuma IO é o que deixa a semana inteira testável sem um Supabase de
 * mentira. Aqui mora a única parte que fala com o banco.
 *
 * Um só lugar, e não dois, porque os dois leitores têm de concordar: o
 * gancho do navegador desenha a grade e a varredura de lembretes decide a
 * que horas alguém é interrompido. Se um deles lesse o expediente de um
 * jeito diferente, o lembrete chegaria numa hora que a tela diz estar
 * fechada.
 *
 * TOLERA A 066 AUSENTE devolvendo o padrão, que é o que mantém uma
 * instância nova de pé — a mesma escolha que `lib/dashboard/agenda.ts` faz
 * fonte por fonte com o seu `safe()`.
 */
export interface LoadedBusinessHours {
  hours: BusinessHours;
  /** `true` quando o que voltou é o padrão de fábrica, não o banco. */
  fallback: boolean;
}

export async function loadBusinessHours(
  db: SupabaseClient,
  accountId: string
): Promise<LoadedBusinessHours> {
  const [account, weekly, exceptions] = await Promise.all([
    db
      .from('accounts')
      .select('timezone, week_starts_on, slot_minutes')
      .eq('id', accountId)
      .maybeSingle(),
    db
      .from('business_hours')
      .select('weekday, opens_at, closes_at')
      .eq('account_id', accountId)
      .is('user_id', null)
      .order('weekday')
      .order('opens_at'),
    db
      .from('business_hours_exceptions')
      .select('on_date, closed, opens_at, closes_at, label')
      .eq('account_id', accountId)
      .is('user_id', null)
      .order('on_date'),
  ]);

  const rows = (weekly.data ?? []) as BusinessHourRow[];

  return {
    hours: toBusinessHours(
      account.data ?? null,
      rows,
      (exceptions.data ?? []) as HoursExceptionRow[]
    ),
    fallback:
      Boolean(account.error) || Boolean(weekly.error) || rows.length === 0,
  };
}
