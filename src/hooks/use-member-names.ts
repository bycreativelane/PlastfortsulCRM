'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/**
 * Auth user id → display name, for every member of the account.
 *
 * Three surfaces need the same thing and none of them can get it from the row
 * they are rendering: `conversations.assigned_agent_id` and
 * `notifications.actor_user_id` both reference `auth.users`, and there is no
 * foreign key from either to `profiles` — so PostgREST cannot embed the name
 * and the join has to be a second query.
 *
 * One query per mount of each surface, and the result is small by definition:
 * an account's members, not its contacts. RLS already scopes `profiles` to the
 * caller's account, which is why this does not filter by `account_id` itself.
 */
export function useMemberNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from('profiles')
        .select('user_id, full_name');
      if (cancelled || !data) return;
      setNames(
        new Map(
          (data as Array<{ user_id: string; full_name: string }>)
            .filter((p) => p.user_id && p.full_name)
            .map((p) => [p.user_id, p.full_name])
        )
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
}
