import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { StatePanel } from '@/components/ui/state-panel';
import { buttonVariants } from '@/components/ui/button';

/**
 * The 404, in the app's own voice.
 *
 * Without this file Next serves its built-in page: black Times-ish
 * type on white, "This page could not be found." in English, no
 * navigation, no way back. That is a screen a real user of this
 * product reaches — an invite link that was already redeemed, a
 * bookmark to a deal that was deleted, a typo in a URL somebody
 * pasted into WhatsApp.
 *
 * It renders under the root layout, so it inherits the fonts, the
 * saved theme and the saved light/dark mode: the page is wrong, the
 * product around it is not. The only affordance is the way out, and
 * it is the primary button — there is nothing else to decide here.
 */
export default async function NotFound() {
  const t = await getTranslations('Routes');

  return (
    <main className="min-h-vh-100 flex items-center justify-center px-4">
      <StatePanel
        size="md"
        icon={FileQuestion}
        title={t('notFoundTitle')}
        description={t('notFoundBody')}
        actions={
          <Link href="/dashboard" className={buttonVariants({ size: 'lg' })}>
            {t('notFoundAction')}
          </Link>
        }
      />
    </main>
  );
}
