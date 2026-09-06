'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from '@/lib/hours';
import { loadBusinessHours } from '@/lib/hours-db';

/**
 * O relógio da conta, para quem desenha.
 *
 * As três consultas e a conversão moram em `lib/hours-db.ts`, compartilhadas
 * com a varredura de lembretes do cron — os dois leitores precisam concordar
 * sobre o expediente, ou o lembrete chega numa hora que a tela diz estar
 * fechada.
 *
 * TOLERA A 066 NÃO TER RODADO, e isso não é zelo excessivo: as migrações
 * deste projeto são aplicadas à mão, de propósito, então existe uma janela
 * real em que o código conhece uma coluna que o banco não tem. Durante ela,
 * a agenda continua desenhando o expediente padrão em vez de ficar em
 * branco — a mesma escolha que `lib/dashboard/agenda.ts` faz fonte por fonte
 * com o seu `safe()`.
 *
 * Uma consulta por montagem, e pequena por definição: são no máximo algumas
 * dezenas de linhas por conta.
 */
export interface UseBusinessHours {
  hours: BusinessHours;
  loading: boolean;
  /** `true` quando o que está em `hours` é o padrão, não o banco. */
  fallback: boolean;
  refresh: () => Promise<void>;
}

export function useBusinessHours(): UseBusinessHours {
  const { accountId } = useAuth();
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_BUSINESS_HOURS);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    const loaded = await loadBusinessHours(createClient(), accountId);
    setHours(loaded.hours);
    setFallback(loaded.fallback);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return { hours, loading, fallback, refresh: load };
}
