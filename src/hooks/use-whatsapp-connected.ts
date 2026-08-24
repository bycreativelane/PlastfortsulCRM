'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

/**
 * Whether this account's WhatsApp connection is live.
 *
 * Three states, and the third one matters: `null` is "we have not been
 * told yet", not "no". Nothing in the UI may claim a disconnection
 * before the row has come back, and a failed read stays `null` rather
 * than accusing an operator whose account is probably fine — a network
 * blip must never render as "nothing you send is going out".
 *
 * Only an explicit status other than `connected` returns false.
 */
export function useWhatsAppConnected(): boolean | null {
  const { accountId } = useAuth();
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!accountId) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await createClient()
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle();

      if (!cancelled && !error) setConnected(data?.status === 'connected');
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return connected;
}
