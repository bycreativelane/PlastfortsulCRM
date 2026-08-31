'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { Header } from '@/components/layout/header';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';
import { cn } from '@/lib/utils';

/**
 * The two pieces of chrome that depend on the query string.
 *
 * ------------------------------------------------------------------
 * WHY THEY LIVE HERE AND NOT IN THE SHELL
 * ------------------------------------------------------------------
 *
 * `useSearchParams` opts its subtree out of prerendering, and Next
 * requires a `<Suspense>` boundary around whatever calls it — a static
 * page that does not have one fails the production build outright
 * (`missing-suspense-with-csr-bailout`; it passes in dev, where routes
 * render on demand, which is exactly how it reaches a build).
 *
 * The boundary CSRs everything up to itself, so it wants to be as LOW as
 * possible. Called from `dashboard-shell.tsx` the boundary would have to
 * wrap the shell — every page in the app, out of the initial HTML, to
 * decide whether one bar is visible. Down here it wraps a header and a
 * tab bar and nothing else.
 *
 * ------------------------------------------------------------------
 * THE DECISION ITSELF
 * ------------------------------------------------------------------
 *
 * `?c=` is where the inbox already publishes the open conversation, for
 * deep links. Reading it means the chrome cannot disagree with what the
 * page is showing — there is one fact, in one place, and neither of
 * these components owns it.
 */

/**
 * The app's top bar, minus the cases where it is in the way.
 *
 * Hidden on lg+ inside the inbox, which is a full-height three-pane app
 * with a header of its own.
 *
 * And hidden ON A PHONE WITH A THREAD OPEN, which is the case that cost
 * the most: below lg the app drew this bar AND the thread drew its own —
 * two bars, about 112px, on the one screen with the least room to give.
 * Everything up here is redundant while you are inside a conversation.
 * The title reads "Caixa de entrada" when the bar below already names
 * the person, and the search and the bell are both things you leave the
 * thread to use anyway.
 *
 * On the LIST it stays: that is where the search and the bell earn their
 * 56px.
 */
export function AppHeaderSlot() {
  const pathname = usePathname();
  const params = useSearchParams();
  const insideThread = pathname.startsWith('/inbox') && params.has('c');

  return (
    <div
      className={cn(
        pathname.startsWith('/inbox') && 'lg:hidden',
        insideThread && 'hidden'
      )}
    >
      <Header />
    </div>
  );
}

/**
 * The phone's tab bar — see the component for the design. Wrapped here
 * only so the `useSearchParams` boundary is shared with the header.
 */
export function AppTabBarSlot({ onOpenMenu }: { onOpenMenu: () => void }) {
  return <MobileTabBar onOpenMenu={onOpenMenu} />;
}
