'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, MailCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { AuthError, AuthHeading } from '@/components/auth/shared';

export default function ForgotPasswordPage() {
  const t = useTranslations('ForgotPassword');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div>
        {/* Same receipt mark as the signup confirmation — the two
            screens say the same thing ("go look in your inbox") and
            arriving at either should feel like arriving at the same
            place. */}
        <div className="bg-primary-soft text-primary mb-5 grid size-12 place-items-center rounded-2xl">
          <MailCheck className="size-6" strokeWidth={1.9} />
        </div>
        <AuthHeading
          title={t('sentTitle')}
          description={t.rich('sentBody', {
            email: () => (
              <span className="text-foreground font-medium">{email}</span>
            ),
          })}
        />
        {/* `render` rather than <Link><Button/></Link>: nesting the
            anchor outside the button gives the row two focusable
            elements and two hit shapes for one action. */}
        <Button
          variant="outline"
          className="h-10 w-full"
          nativeButton={false}
          render={<Link href="/login" />}
        >
          {t('backToSignIn')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AuthHeading title={t('title')} description={t('desc')} />

      <form onSubmit={handleReset} className="flex flex-col gap-4">
        {error && <AuthError>{error}</AuthError>}

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
            autoFocus
            className="bg-muted h-10"
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="mt-2 h-10 w-full disabled:opacity-50"
        >
          {loading ? t('sending') : t('submit')}
        </Button>
      </form>

      {/* py-3, not py-2: a bare <Link> gets none of the coarse-pointer
          hit-area expansion that `[data-slot="button"]` does, and at
          py-2 this row was a 36px target on a phone. */}
      <Link
        href="/login"
        className="text-muted-foreground hover:text-foreground mt-4 flex items-center justify-center gap-2 py-3 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t('backToSignIn')}
      </Link>
    </div>
  );
}
