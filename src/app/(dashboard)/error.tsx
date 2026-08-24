'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, buttonVariants } from '@/components/ui/button';
import { StatePanel } from '@/components/ui/state-panel';

/**
 * The error boundary for every authenticated route.
 *
 * Before this file, there was none — anywhere. Every page in the
 * dashboard is a client component that reads Supabase directly, so a
 * single row in an unexpected shape (a null `template_name`, an
 * unparseable `created_at` handed to `new Date`) unmounted the whole
 * React tree and left the built-in "Application error: a client-side
 * exception has occurred" — white page, English, no sidebar, no way
 * back. In a tool somebody has open for eight hours that is the end of
 * the shift.
 *
 * Sitting in the `(dashboard)` segment rather than at the root is the
 * whole point: `error.tsx` replaces the segment's CHILDREN, so the
 * shell above it survives. The sidebar stays lit on the row you were
 * on, the top bar keeps working, and the failure is contained to the
 * body of one page — which is the honest size of it. The user reads
 * "this screen broke", not "the product broke", because only one of
 * those is true.
 *
 * `reset()` re-renders the segment without a full reload, so a
 * transient failure (a request that raced the session refresh) costs
 * one click and no state.
 *
 * The digest is shown, quietly, because it is the only string that
 * connects what the user saw to what the server logged. It is not an
 * apology and not a stack trace: it is the number you read out.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('Routes');

  useEffect(() => {
    // The boundary is the only place that sees this at all — without
    // it the exception is swallowed by React's own handler and the
    // console shows a minified component stack and nothing else.
    //
    // FIELDS, not the object. `console.error('…', error)` serialises to
    // `{}` in the dev server's log, because an Error's `message` and
    // `stack` are non-enumerable and a Supabase error's `details`,
    // `hint` and `code` are too — which is how twelve of these landed
    // in `next-development.log` saying literally nothing. The same trap
    // is already documented in the inbox page's conversation fetch.
    console.error('[dashboard] route error', {
      name: error.name,
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      // Supabase's PostgrestError shape, when that is what threw.
      ...(error as unknown as Record<string, unknown>),
    });
  }, [error]);

  return (
    <StatePanel
      // `min-h` + the panel's own centring, so the message sits in the
      // middle of the space rather than pinned under the top edge with the
      // rest of the page empty below it. `StatePanel` already centres on
      // both axes — it just had no height to centre inside, the same thing
      // that was wrong beside the agenda calendar.
      //
      // 60vh and not `h-full`: this boundary renders inside route bodies of
      // different heights, and a percentage of a parent that has not
      // committed to one resolves to auto.
      className="min-h-vh-60"
      size="md"
      icon={AlertTriangle}
      title={t('errorTitle')}
      description={
        <>
          {t('errorBody')}
          {error.digest ? (
            <span className="text-muted-foreground/70 mt-2 block font-mono text-xs">
              {t('errorCode', { digest: error.digest })}
            </span>
          ) : null}
        </>
      }
      actions={
        <>
          <Button size="lg" onClick={reset}>
            {t('errorRetry')}
          </Button>
          <Link
            href="/dashboard"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            {t('errorHome')}
          </Link>
        </>
      }
    />
  );
}
