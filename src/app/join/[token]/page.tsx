'use client';

// ============================================================
// /join/[token] — invitation redemption landing page.
//
// Four UI states driven by:
//   - the peek result (server-validated invite payload), and
//   - whether the visitor is currently authenticated.
//
//   ┌──────────────────────┬───────────────┬─────────────────────────┐
//   │ peek                 │ auth          │ render                   │
//   ├──────────────────────┼───────────────┼─────────────────────────┤
//   │ loading              │ —             │ spinner                  │
//   │ ok:false (any reason)│ —             │ friendly error + signup  │
//   │ ok:true              │ signed out    │ "Sign up" + "Sign in"    │
//   │ ok:true              │ signed in     │ "Accept" button → redeem │
//   └──────────────────────┴───────────────┴─────────────────────────┘
//
// We deliberately do NOT redeem automatically on page load — the
// invitee should confirm what account/role they're accepting.
// Auto-redeem would also race with the signup flow returning to
// this page after email verification.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  MailX,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatePanel } from '@/components/ui/state-panel';
import { createClient } from '@/lib/supabase/client';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { cn } from '@/lib/utils';

interface PeekOk {
  ok: true;
  account_name: string;
  role: 'admin' | 'agent' | 'viewer';
  expires_at: string;
}
interface PeekFail {
  ok: false;
  reason: 'not_found' | 'used' | 'expired' | 'server_error';
}
type PeekResult = PeekOk | PeekFail;

const ROLE_KEY: Record<PeekOk['role'], string> = {
  admin: 'roleAdmin',
  agent: 'roleAgent',
  viewer: 'roleViewer',
};

// The peek endpoint speaks snake_case on the wire and the message
// catalogue is camelCase. One map keeps the two vocabularies from
// leaking into each other at every call site.
const FAIL_KEY: Record<PeekFail['reason'], string> = {
  not_found: 'notFound',
  used: 'used',
  expired: 'expired',
  server_error: 'serverError',
};

// StatePanel renders whatever icon component it is handed inside its
// disc, and the loading state needs that icon to spin. Wrapping is
// cheaper than teaching the shared primitive about spinners.
function SpinnerIcon({ className }: { className?: string }) {
  return <Loader2 className={cn(className, 'animate-spin')} />;
}

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations('Join');

  const [peek, setPeek] = useState<PeekResult | null>(null);
  // Local auth probe — the AuthProvider lives inside the (dashboard)
  // route group, so it doesn't reach this page. We hit Supabase
  // directly the same way `/login` and `/signup` do.
  const [authedUserId, setAuthedUserId] = useState<string | null | undefined>(
    undefined // undefined = unknown / still loading; null = signed out
  );
  const [accepting, setAccepting] = useState(false);
  // `redeem_invitation` returns 409 when the caller's current account
  // has domain data, or they're already a member of a shared account.
  // A transient toast wasn't enough — the user has no actionable next
  // step. Surface a blocking modal that walks them through it.
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Extracted so the "Try again" button on the server_error card
  // can re-run the same logic without remounting the component.
  const loadPeekAndAuth = useCallback(async () => {
    if (!token) return;
    setPeek(null);
    setAuthedUserId(undefined);
    try {
      const [peekRes, authRes] = await Promise.all([
        fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
          cache: 'no-store',
        }),
        createClient().auth.getUser(),
      ]);
      const peekBody = (await peekRes.json()) as PeekResult;
      setPeek(peekBody);
      setAuthedUserId(authRes.data.user?.id ?? null);
    } catch (err) {
      console.error('[join] peek error:', err);
      setPeek({ ok: false, reason: 'server_error' });
      setAuthedUserId(null);
    }
  }, [token]);

  // Fetch peek + auth state on mount. The peek endpoint is
  // rate-limited per-IP (30/min) so double-mounting in React 19
  // strict mode dev is harmless. We also use the `cancelled` flag
  // to drop setState calls if the component unmounts mid-fetch.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [peekRes, authRes] = await Promise.all([
          fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
            cache: 'no-store',
          }),
          createClient().auth.getUser(),
        ]);
        const peekBody = (await peekRes.json()) as PeekResult;
        if (cancelled) return;
        setPeek(peekBody);
        setAuthedUserId(authRes.data.user?.id ?? null);
      } catch (err) {
        console.error('[join] peek error:', err);
        if (cancelled) return;
        setPeek({ ok: false, reason: 'server_error' });
        setAuthedUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/redeem`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        // 409 = caller already has data / is in another shared
        // account. The redeem RPC's error message is descriptive
        // enough to show directly; we open a modal so the user has
        // a clear next-action (sign out → use different email)
        // rather than a 3-second toast.
        if (res.status === 409) {
          setConflictMessage(payload.error || t('conflictFallback'));
        } else {
          toast.error(payload.error || t('toastAcceptFailed'));
        }
        setAccepting(false);
        return;
      }
      toast.success(t('toastWelcome'));
      // Full reload (not router.push) so AuthProvider re-fetches
      // the profile with the new account_id and account_role.
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[join] redeem error:', err);
      toast.error(t('toastNetwork'));
      setAccepting(false);
    }
  }, [token, t]);

  const handleSignOutAndRetry = useCallback(async () => {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      // Hard reload so the new auth state propagates everywhere
      // (middleware, AuthProvider). Preserves the invite token in
      // the URL so the rebuilt page renders the signed-out CTA path.
      window.location.reload();
    } catch (err) {
      console.error('[join] sign-out error:', err);
      toast.error(t('toastSignOutFailed'));
      setSigningOut(false);
    }
  }, [t]);

  // ----- Loading state (peek pending OR auth not yet resolved) -----
  if (peek === null || authedUserId === undefined) {
    return (
      <Card className="w-full max-w-md py-0">
        <StatePanel size="md" icon={SpinnerIcon} title={t('verifying')} />
      </Card>
    );
  }

  // ----- Peek failed -----
  if (!peek.ok) {
    const failKey = FAIL_KEY[peek.reason];
    return (
      <Card className="w-full max-w-md py-0">
        <StatePanel
          size="md"
          icon={MailX}
          title={t(`fail.${failKey}.title`)}
          description={t(`fail.${failKey}.body`)}
          actions={
            /* For server_error the failure is transient — the network
               flapped or the peek endpoint hiccupped. Try-again is
               the right primary action; the "create account" /
               "sign in" links stay as secondary options. Other
               failure reasons (not_found / used / expired) are
               terminal for this token, so no retry — just the
               signup/sign-in escape hatches. */
            peek.reason === 'server_error' ? (
              <>
                <Button onClick={loadPeekAndAuth} className="h-10">
                  {t('tryAgain')}
                </Button>
                <Button
                  variant="outline"
                  className="h-10"
                  nativeButton={false}
                  render={<Link href="/signup" />}
                >
                  {t('createAccountInstead')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  className="h-10"
                  nativeButton={false}
                  render={<Link href="/signup" />}
                >
                  {t('createAccountInstead')}
                </Button>
                <Button
                  variant="outline"
                  className="h-10"
                  nativeButton={false}
                  render={<Link href="/login" />}
                >
                  {t('signIn')}
                </Button>
              </>
            )
          }
        />
      </Card>
    );
  }

  // ----- Peek OK -----
  const expiresOn = new Date(peek.expires_at).toLocaleDateString(APP_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const inviteHeader = (
    <CardHeader className="justify-items-center text-center">
      {/* Same disc geometry StatePanel uses, so the invite card and the
          failure card read as two states of one screen. */}
      <div className="bg-primary/10 text-primary mb-2 grid size-12 place-items-center rounded-full">
        <UsersRound className="size-5" />
      </div>
      <CardTitle className="text-foreground text-2xl font-bold tracking-tight">
        {t.rich('invitedTo', {
          account: () => (
            <span className="text-primary">{peek.account_name}</span>
          ),
        })}
      </CardTitle>
      <CardDescription>
        {t.rich('joinAs', {
          date: expiresOn,
          role: () => (
            <span className="text-foreground inline-flex items-center gap-1">
              <ShieldCheck className="text-primary size-3.5" />
              {t(ROLE_KEY[peek.role])}
            </span>
          ),
        })}
      </CardDescription>
    </CardHeader>
  );

  // ----- Authed: show Accept button -----
  if (authedUserId) {
    return (
      <>
        <Card className="w-full max-w-md">
          {inviteHeader}
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleAccept}
              disabled={accepting}
              className="h-10 w-full"
            >
              {accepting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('accepting')}
                </>
              ) : (
                <>
                  <CheckCircle className="size-4" />
                  {t('accept')}
                </>
              )}
            </Button>
            <p className="text-muted-foreground text-center text-xs">
              {t.rich('acceptNote', {
                account: () => (
                  <span className="text-foreground">{peek.account_name}</span>
                ),
              })}
            </p>
          </CardContent>
        </Card>

        {/* Conflict modal — opens when the redeem endpoint returns 409
            (caller already in a shared account or has domain data).
            Blocks the flow until the user picks a recovery action so
            they aren't stuck retrying an inevitable failure. */}
        <Dialog
          open={conflictMessage !== null}
          onOpenChange={(open) => {
            if (!open) setConflictMessage(null);
          }}
        >
          <DialogContent className="bg-popover border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground flex items-center gap-2">
                {/* Amber, not a raw hex: a person has to pick an account
                    before anything else can happen here. */}
                <AlertTriangle className="text-human-ink size-4" />
                {t('conflictTitle', { account: peek.account_name })}
              </DialogTitle>
              <DialogDescription>{conflictMessage}</DialogDescription>
            </DialogHeader>
            <div className="text-muted-foreground space-y-2 py-2 text-xs">
              <p>
                {t.rich('conflictBody', {
                  account: () => (
                    <span className="text-popover-foreground">
                      {peek.account_name}
                    </span>
                  ),
                })}
              </p>
            </div>
            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => setConflictMessage(null)}
                className="text-popover-foreground"
              >
                {t('staySignedIn')}
              </Button>
              <Button onClick={handleSignOutAndRetry} disabled={signingOut}>
                {signingOut ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('signingOut')}
                  </>
                ) : (
                  t('signOutDifferentEmail')
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ----- Not authed: prompt to sign up or sign in -----
  return (
    <Card className="w-full max-w-md">
      {inviteHeader}
      <CardContent className="flex flex-col gap-2">
        <Button
          className="h-10 w-full"
          nativeButton={false}
          render={
            <Link href={`/signup?invite=${encodeURIComponent(token!)}`} />
          }
        >
          {t('createAccountAndJoin')}
        </Button>
        <Button
          variant="outline"
          className="h-10 w-full"
          nativeButton={false}
          render={<Link href={`/login?invite=${encodeURIComponent(token!)}`} />}
        >
          {t('haveAccount')}
        </Button>
      </CardContent>
    </Card>
  );
}
