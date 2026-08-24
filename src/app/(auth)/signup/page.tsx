'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, MailCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { SectionTransition } from '@/components/layout/section-transition';
import {
  AuthError,
  AuthHeading,
  AuthSteps,
  PasswordStrength,
} from '@/components/auth/shared';

/** Supabase's own floor, and the number the copy quotes. */
const MIN_PASSWORD = 6;

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

/**
 * Signing up, in two steps.
 *
 * Sign-in and sign-up are not the same shape of task and should not
 * look like the same screen with two extra fields: one is a door you
 * already have the key to, the other is four decisions and a password
 * you have to invent. Four fields stacked in one column read as a wall
 * — the classic result is somebody abandoning at the confirm field —
 * so the form is split where the subject changes: who you are, then
 * how you get back in.
 *
 * The rail is the one from `/broadcasts/new`, deliberately (see
 * `AuthSteps`). It is doing two things at once: it tells you how much
 * is left, which is the only honest answer to "how long will this
 * take", and it is the visual difference that stops this screen being
 * mistaken for the login it links to.
 *
 * One `<form>`, not one per step. The browser only validates controls
 * that are actually in the document, so the fields of the step you are
 * on are exactly the fields that get checked, and `required` /
 * `type="email"` do the first pass for free.
 */
function SignupPageInner() {
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get('invite');

  const [step, setStep] = useState<0 | 1>(0);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();
  const t = useTranslations('SignupPage');
  const tAuth = useTranslations('Auth');

  const signInHref = inviteToken
    ? `/login?invite=${encodeURIComponent(inviteToken)}`
    : '/login';

  async function createAccount() {
    if (password !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }

    if (password.length < MIN_PASSWORD) {
      setError(t('passwordTooShort', { min: MIN_PASSWORD }));
      return;
    }

    setLoading(true);

    // If we have an invite token, point Supabase's verification
    // email back at the join page so the user can accept after
    // verifying. Without a token, Supabase uses its default
    // redirect (the app root).
    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (step === 0) {
      setStep(1);
      return;
    }

    await createAccount();
  };

  if (success) {
    return (
      <div>
        {/* The one screen in the funnel that is a receipt rather than a
            form, and the mark says so before the sentence does. Soft
            accent fill, same tinted-primary surface the sidebar's active
            row and the validation badges use. */}
        <div className="bg-primary-soft text-primary mb-5 grid size-12 place-items-center rounded-2xl">
          <MailCheck className="size-6" strokeWidth={1.9} />
        </div>
        <AuthHeading
          title={t('checkEmailTitle')}
          description={t.rich('checkEmailBody', {
            email: () => (
              <span className="text-foreground font-medium">{email}</span>
            ),
          })}
        />
        {/* `render` rather than <Link><Button/></Link>: nesting the
            anchor outside the button gives the row two focusable
            elements and two hit shapes for one action. Every other
            link-button in the auth funnel already renders this way. */}
        <Button
          variant="outline"
          className="h-10 w-full"
          nativeButton={false}
          render={<Link href={signInHref} />}
        >
          {t('backToSignIn')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AuthHeading
        title={inviteToken ? t('titleJoin') : t('title')}
        description={inviteToken ? t('descJoin') : t('desc')}
      />

      <AuthSteps steps={[t('stepAccount'), t('stepPassword')]} current={step} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AuthError>{error}</AuthError>}

        {/* Keyed on the step so the house's own section entrance replays
            on every advance. Without it the two panels swap between
            frames and the rail above is the only thing that says
            anything happened. */}
        <SectionTransition token={String(step)} className="flex flex-col gap-4">
          {step === 0 ? (
            <>
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="fullName">{t('nameLabel')}</FieldLabel>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder={t('namePlaceholder')}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="bg-muted h-10"
                />
              </div>

              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="email">{t('emailLabel')}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-muted h-10"
                />
              </div>
            </>
          ) : (
            <>
              {/* A password manager needs the account name in the same
                  form as the password to offer to save the pair. On step
                  two the visible email field is gone, so it rides along
                  hidden — same value, same autocomplete token. */}
              <input
                type="hidden"
                autoComplete="username"
                value={email}
                readOnly
              />

              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="password">{t('passwordLabel')}</FieldLabel>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  placeholder={t('passwordPlaceholder', { min: MIN_PASSWORD })}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  showLabel={tAuth('showPassword')}
                  hideLabel={tAuth('hidePassword')}
                  className="bg-muted h-10"
                />
                <PasswordStrength
                  value={password}
                  hint={t('strengthHint', { min: MIN_PASSWORD })}
                  labels={[
                    t('strengthWeak'),
                    t('strengthFair'),
                    t('strengthGood'),
                    t('strengthStrong'),
                  ]}
                />
              </div>

              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="confirmPassword">
                  {t('confirmLabel')}
                </FieldLabel>
                <PasswordInput
                  id="confirmPassword"
                  autoComplete="new-password"
                  placeholder={t('confirmPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  showLabel={tAuth('showPassword')}
                  hideLabel={tAuth('hidePassword')}
                  className="bg-muted h-10"
                />
              </div>
            </>
          )}
        </SectionTransition>

        {step === 0 ? (
          <Button type="submit" className="mt-2 h-10 w-full">
            {t('continue')}
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          // Back first in the DOM and on screen, sized to what it is:
          // the escape hatch, not a peer of the thing you came here to
          // do. `w-full` on the primary and `shrink-0` on the secondary
          // keeps the pair from splitting the row down the middle.
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setStep(0);
              }}
              className="h-10 shrink-0 px-3.5"
              aria-label={t('back')}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <Button
              type="submit"
              disabled={loading}
              // `flex-1 min-w-0`, NOT `w-full`. Every Button in this app
              // carries `shrink-0` in its base class (ui/button.tsx), so
              // `w-full` in a flex row asks for 100% of the row AND refuses
              // to give any of it back — the pair then overflowed by exactly
              // the width of the back button plus the gap, which is the
              // shifted, clipped button in the report.
              className="h-10 min-w-0 flex-1 disabled:opacity-50"
            >
              {loading ? t('creating') : t('submit')}
            </Button>
          </div>
        )}
      </form>

      <div className="border-border mt-7 border-t pt-5">
        <p className="text-muted-foreground mb-2.5 text-sm">
          {t('haveAccount')}
        </p>
        <Button
          variant="outline"
          className="h-10 w-full"
          nativeButton={false}
          render={<Link href={signInHref} />}
        >
          {t('signIn')}
        </Button>
      </div>
    </div>
  );
}
