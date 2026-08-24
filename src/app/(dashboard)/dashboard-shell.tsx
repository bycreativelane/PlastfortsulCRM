'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AccountAccessAlert } from '@/components/layout/account-access-alert';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { PageTransition } from '@/components/layout/page-transition';
import { cn } from '@/lib/utils';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

/**
 * Two page shapes, and the shell decides which one you get.
 *
 * DOCUMENT (the default) — a column of content that scrolls vertically.
 * The shell gives it the gutters and the measure, so `space-y-6` and a
 * `<PageHeader>` is the whole of what a page has to write.
 *
 * APP — a surface that owns the height it is given and scrolls inside
 * itself: the inbox's three panes, the pipeline board (which must scroll
 * sideways, never down), the two editors. The shell gives it exactly the
 * content area and no padding; it does the rest.
 *
 * Before this existed, "fill the height" was every page's own problem
 * and each solved it differently: the inbox and the board with
 * `-m-4 h-[calc(100vh/var(--zoom)-3.5rem)]` (viewport arithmetic that
 * silently assumed the height of a header they can't see), the flow
 * editor with an `h-full` that resolved against an auto-height wrapper
 * and collapsed its canvas to nothing, the automation editor with
 * `fixed inset-0` — which resolved against the page wrapper, not the
 * viewport, and rendered a toolbar over 0px of canvas. Three answers,
 * two of them broken on screen. Now there is one, it is stated here,
 * and a page cannot get it wrong by forgetting to.
 *
 * Matching is by prefix on the segment, so `/inbox/anything` counts and
 * `/inboxes` does not.
 */
const APP_SHAPED = [
  /^\/inbox(\/|$)/,
  /^\/pipelines(\/|$)/,
  // The two builders — but NOT their siblings: `/automations/[id]/logs`
  // and `/flows/[id]/runs` are ordinary tables.
  /^\/automations\/new$/,
  /^\/automations\/[^/]+\/edit$/,
  /^\/flows\/[^/]+$/,
];

function isAppShaped(pathname: string): boolean {
  return APP_SHAPED.some((pattern) => pattern.test(pathname));
}

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Routes');
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="h-vh-100 bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary size-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const appShaped = isAppShaped(pathname);

  return (
    <div className="h-vh-100 bg-background flex overflow-hidden">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* The inbox is already a full-height three-pane application with its
            own header per conversation; a second bar above it only takes
            56px from the thread. Hidden on lg+ ONLY — on mobile the
            hamburger in this bar is the sole way back to the navigation. */}
        <div className={cn(pathname.startsWith('/inbox') && 'lg:hidden')}>
          <Header onOpenSidebar={() => setSidebarOpen(true)} />
        </div>
        {/* `min-h-0` is what makes an app-shaped page possible at all: a
            flex item's floor is its content, so without it this grows to
            fit a full-height child instead of clipping it, and the whole
            window scrolls. */}
        {/* `overflow-y-auto` on its own resolves `overflow-x` to `auto`
            too, so one element a few pixels too wide anywhere on a page
            let the WHOLE app scroll sideways — sidebar, header and all —
            which is what made a settings section look like it had slipped
            off the screen. Nothing at page level may scroll horizontally:
            the things that legitimately can (tables, the board, the
            settings rail) each own a scroll container of their own. */}
        <main
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            appShaped ? 'overflow-hidden' : 'overflow-x-hidden overflow-y-auto'
          )}
        >
          {/* Above every page: writes are being rejected and here's why.
              This one earns the space — until the account resolves, every
              save in the app silently fails — and it renders nothing in the
              normal case, which is why the band is `empty:hidden`: an alert
              that isn't there must not leave its padding behind.

              Nothing else goes in this band. "WhatsApp isn't connected" used
              to sit here too and it was the wrong trade: a standing state
              that can last weeks, charging every page — including the inbox
              and the board, which budget their own height and got pushed
              down by it — for something you cannot act on from where you
              are. It lives behind the bell now, in `NotificationsMenu`.

              It stays outside PageTransition: it is a property of the
              account, not of the page, and re-animating it on every
              navigation would make a standing warning look like news. */}
          <div className="max-w-page mx-auto w-full shrink-0 px-4 pt-5 empty:hidden sm:px-6 sm:pt-6 lg:px-8">
            <AccountAccessAlert />
          </div>
          <PageTransition
            className={cn(
              'mx-auto w-full min-w-0',
              appShaped
                ? // No gutters and no measure: the surface IS the page,
                  // and it manages its own padding and scrolling.
                  'flex min-h-0 flex-1 flex-col'
                : // One measure and one set of gutters for every reading
                  // page in the app. The cap is not shyness about wide
                  // screens — past ~1600px a table row is a hike from the
                  // name at the left to the action at the right, and the
                  // page stops reading as one object.
                  'max-w-page px-4 py-5 sm:px-6 sm:py-6 lg:px-8'
            )}
          >
            {children}
          </PageTransition>
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
