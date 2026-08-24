'use client';

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { FieldLabel } from '@/components/ui/field';
import { AuthError, AuthHeading } from '@/components/auth/shared';

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

/**
 * The `?next=` the middleware attached, or the dashboard.
 *
 * Everything here is about the one thing a `next` parameter is for:
 * being an open redirect. The value arrives in a URL, which means it
 * arrives from whoever wrote the link, which means it is attacker
 * input — a phishing mail linking to
 * `…/login?next=https://evil.example` would hand a freshly
 * authenticated user straight to someone else's page, wearing the trust
 * of having just signed in to the real product.
 *
 * So: it must start with a single `/`. That rejects an absolute URL
 * (`https://…`), and it rejects `//evil.example`, which browsers read
 * as protocol-relative and would resolve off-site despite looking like
 * a path. A backslash is rejected too — some parsers normalise `\` to
 * `/`, so `/\evil.example` is the same trick with different spelling.
 *
 * The default stays `/dashboard`, which is where this always went.
 */
function safeNext(next: string | null): string {
  if (!next) return '/dashboard';
  if (!next.startsWith('/')) return '/dashboard';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  return next;
}

/**
 * Who signed in here last.
 *
 * The address only, never the password, and it is a convenience rather
 * than a session: it survives sign-out on purpose, because the point is
 * the second visit. On the shared machine this CRM often runs on that
 * is a real consideration, which is why the field is always editable
 * and why a remembered address comes with its own visible way out
 * ("não é você?") instead of silently deciding who you are.
 */
const LAST_EMAIL_KEY = 'pfs.auth.last-email';

/**
 * Two values the server cannot know: what time it is where the operator
 * is, and who signed in on this machine last.
 *
 * Both are read through `useSyncExternalStore` rather than in an effect.
 * The effect version works and is what this looked like first, but it
 * renders the page once with the value missing and once with it
 * present — a cascading render the `react-hooks/set-state-in-effect`
 * rule exists to catch — and it puts the greeting's arrival one paint
 * after the form's. Here the server snapshot is `null` (so the SSR
 * markup and the first client render agree, and hydration is clean) and
 * the client snapshot is the real value from the first client render
 * onward.
 *
 * No subscription: neither value changes underneath the page in any way
 * worth re-rendering for. Somebody signing in across midnight can have
 * the wrong greeting.
 *
 * Both snapshots return strings, which `Object.is` compares by value —
 * that is what keeps React from deciding the store changed on every
 * render and looping.
 */
const NO_SUBSCRIBE = () => () => {};

function readDaypart(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

function readStoredEmail(): string | null {
  // localStorage throws outright in a locked-down browser profile, and
  // a convenience is not worth taking the sign-in form down with it.
  try {
    return localStorage.getItem(LAST_EMAIL_KEY);
  } catch {
    return null;
  }
}

const serverSnapshot = () => null;

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get('invite');
  // Where the middleware was taking them when the session ran out.
  // See `src/proxy.ts` — a request to a protected route without a
  // session arrives here carrying `?next=<path+query>`.
  const nextParam = searchParams.get('next');
  const t = useTranslations('LoginPage');
  const tAuth = useTranslations('Auth');

  const daypart = useSyncExternalStore(
    NO_SUBSCRIBE,
    readDaypart,
    serverSnapshot
  );
  const storedEmail = useSyncExternalStore(
    NO_SUBSCRIBE,
    readStoredEmail,
    serverSnapshot
  );

  // `null` means "the operator has not touched this field", which is
  // what lets the remembered address fill it without a second copy of
  // the value in state — and what makes clearing it a one-liner that
  // cannot get out of step with the store.
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const email = typedEmail ?? storedEmail ?? '';
  const remembered = typedEmail === null && Boolean(storedEmail);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  // The one field still to fill gets the cursor. Landing on a
  // pre-filled email and having to tab past it is the small tax that
  // makes a "we remember you" feature feel like it did nothing.
  //
  // Mount only — deliberately not keyed on `remembered`. Moving the
  // caret while somebody is typing is the worst thing a login form can
  // do, and `forgetEmail` already places it by hand.
  useEffect(() => {
    if (readStoredEmail()) {
      passwordRef.current?.focus();
    } else {
      emailRef.current?.focus();
    }
  }, []);

  function forgetEmail() {
    try {
      localStorage.removeItem(LAST_EMAIL_KEY);
    } catch {
      // Nothing to clean up — see readStoredEmail.
    }
    setTypedEmail('');
    emailRef.current?.focus();
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    try {
      localStorage.setItem(LAST_EMAIL_KEY, email);
    } catch {
      // Non-fatal: the sign-in worked, only the convenience is lost.
    }

    // Full-page navigation (not router.push) so the browser issues a
    // fresh top-level request that carries the just-written Supabase
    // auth cookies to the middleware gating /dashboard. A soft
    // client-side navigation can reach the protected route before the
    // server observes the new session, so the middleware bounces it
    // back to /login — which looks like the page "just refreshing"
    // instead of signing in (issue #365). Mirrors the deliberate full
    // reload the invite-accept flow already uses in join/[token].
    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : safeNext(nextParam);
    window.location.href = destination;
  };

  return (
    <div>
      <AuthHeading
        eyebrow={daypart ? tAuth(`greeting.${daypart}`) : null}
        title={inviteToken ? t('titleAccept') : t('titleWelcome')}
        description={inviteToken ? t('descAccept') : t('descWelcome')}
      />

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {error && <AuthError>{error}</AuthError>}

        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="email">{t('emailLabel')}</FieldLabel>
          <Input
            id="email"
            ref={emailRef}
            type="email"
            autoComplete="username"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setTypedEmail(e.target.value)}
            required
            className="bg-muted h-10"
          />
          {/* Only shown when we filled the field for them. A "not you?"
              under an address the user just typed is nonsense. */}
          {remembered ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={forgetEmail}
              className="text-muted-foreground hover:text-foreground -mt-0.5 h-auto justify-start p-0 font-normal"
            >
              {t('notYou')}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {/* The row carries FieldLabel's own 4px so the label can sit
              optically centred against the link beside it, and the gap
              down to the input still matches every other field. */}
          <div className="mb-1 flex items-center justify-between">
            <FieldLabel htmlFor="password" className="mb-0">
              {t('passwordLabel')}
            </FieldLabel>
            <Button
              variant="link"
              size="sm"
              className="-mr-2.5 font-normal"
              nativeButton={false}
              render={<Link href="/forgot-password" />}
            >
              {t('forgotPassword')}
            </Button>
          </div>
          <PasswordInput
            id="password"
            ref={passwordRef}
            autoComplete="current-password"
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            showLabel={tAuth('showPassword')}
            hideLabel={tAuth('hidePassword')}
            className="bg-muted h-10"
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="mt-2 h-10 w-full disabled:opacity-50"
        >
          {loading ? t('signingIn') : t('signIn')}
        </Button>
      </form>

      {/* Signing up is a different job, so it gets a different block.
          It was a text link in a sentence under the button, which put
          the one destructive-to-your-progress action on the page — leave
          this form, start another one — in the same weight as a footnote.
          Behind the rule and in its own control, it reads as the other
          door rather than as a word in a sentence. */}
      <div className="border-border mt-7 border-t pt-5">
        <p className="text-muted-foreground mb-2.5 text-sm">
          {t('noAccount')}
        </p>
        <Button
          variant="outline"
          className="h-10 w-full"
          nativeButton={false}
          render={
            <Link
              href={
                inviteToken
                  ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                  : '/signup'
              }
            />
          }
        >
          {t('createAccount')}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
