'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/** What every surface that draws a colleague needs to know about them. */
export interface DirectoryMember {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
}

export type MemberDirectory = Map<string, DirectoryMember>;

/**
 * Auth user id → the member, for everybody in the account.
 *
 * `useMemberNames` is this hook with the photo thrown away, and throwing the
 * photo away is exactly the bug this fixes. Four surfaces drew a colleague
 * from `profiles` — the presence stack in the top bar, the team room, the
 * room's card in the rail, and the assign menu — and every one of them
 * selected `user_id, full_name` and nothing else. So a member could upload a
 * photo in Configurações › Perfil, see it in the settings header and in the
 * account tile, and then watch the rest of the app keep showing their
 * initials. The column was never missing; the four SELECTs were.
 *
 * One query per mount, and small by definition: an account's members, not its
 * contacts. RLS already scopes `profiles` to the caller's account, which is
 * why there is no `account_id` filter here.
 */
export function useMemberDirectory(): MemberDirectory {
  const [members, setMembers] = useState<MemberDirectory>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from('profiles')
        .select('user_id, full_name, avatar_url');
      if (cancelled || !data) return;
      setMembers(
        new Map(
          (
            data as Array<{
              user_id: string | null;
              full_name: string | null;
              avatar_url: string | null;
            }>
          )
            .filter(
              (p): p is DirectoryMember => Boolean(p.user_id) && Boolean(p.full_name)
            )
            .map((p) => [p.user_id, p])
        )
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return members;
}
