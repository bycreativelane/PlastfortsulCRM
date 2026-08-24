'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, Search } from 'lucide-react';
import { ModeToggle } from '@/components/layout/mode-toggle';
import { GlobalSearch } from '@/components/layout/global-search';
import { NotificationsMenu } from '@/components/layout/notifications-menu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The top bar carries what belongs to the APP: search, notifications,
 * light/dark. Nothing that belongs to the page you are on, and nothing
 * that belongs to you.
 *
 * Two things left it. The page's own buttons went to `<PageHeader>`,
 * because an action a window away from its subject is an action you do
 * not find (see page-actions.tsx). And the avatar-with-name went too:
 * it opened the same menu, over the same three items, as the one in the
 * sidebar footer eighteen inches below it. Two identical doors to one
 * room is not redundancy that costs nothing — it is a question ("are
 * these the same?") the user has to answer every time, forever. The
 * sidebar keeps it: that is where the account, the role and the
 * workspace name already are.
 *
 * Page titles below are MOBILE ONLY. On desktop the sidebar is on
 * screen with the current row lit, so a title in the bar says the same
 * thing twice. On mobile the sidebar is a closed drawer, so this is the
 * only thing telling you where you are, and it stays.
 */
const pageTitles: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/inbox': 'inbox',
  '/notifications': 'notifications',
  '/contacts': 'contacts',
  '/pipelines': 'pipelines',
  '/broadcasts': 'broadcasts',
  '/automations': 'automations',
  '/flows': 'flows',
  '/reports': 'reports',
  '/settings': 'settings',
};

/**
 * The label for the bar, or nothing.
 *
 * It used to fall back to `'dashboard'`, and the map was missing
 * `/flows` and `/reports` — so on a phone those four routes (/reports,
 * /flows, /flows/[id], /flows/[id]/runs) put "Visão Geral" in the one
 * place that is supposed to tell you where you are. A location label
 * that is wrong is worse than one that is absent: nobody double-checks
 * a statement the system makes with confidence, so the mistake is only
 * caught after acting on it.
 *
 * Returning null means the next route somebody forgets to add here is
 * silent rather than a liar.
 */
function getPageTitleKey(pathname: string): string | null {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(`${path}/`)
  );
  return match ? match[1] : null;
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

import { useTranslations } from 'next-intl';

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations('Header');
  const tSearch = useTranslations('Search');
  const pathname = usePathname();
  const titleKey = getPageTitleKey(pathname);
  const [searchOpen, setSearchOpen] = useState(false);

  // The gutter ladder below (`px-4 sm:px-6 lg:px-8`) is the SAME one
  // dashboard-shell.tsx gives the page body. It was `px-4 lg:px-6`, so
  // on any desktop the search field in this bar started 8px to the left
  // of the page title directly beneath it — two horizontal rules of the
  // interface disagreeing about where the left edge of the app is.
  return (
    <header className="border-border bg-card flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Hamburger — mobile only. 44×44, which is what the comment
            here always claimed and what `size-10` (40px) never was.
            It is the ONLY way back to the navigation on a phone — on
            /inbox this bar exists for no other reason — and it sits in
            the top-left corner, the furthest point from the thumb of a
            right-handed one-handed grip. Four pixels matter there. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t('openMenu')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-11 items-center justify-center rounded-md transition-colors lg:hidden"
        >
          <Menu className="size-5" />
        </button>
        {/* Not an `<h1>`: the page's own `<PageHeader>` already carries
            one, and two headings of the same rank with the same words
            is a duplicate the screen reader reads twice. This is a
            location indicator — the bar does not scroll, so it is what
            still says where you are once the title has scrolled off. */}
        {titleKey ? (
          <p className="text-foreground truncate text-base font-semibold lg:hidden">
            {t(titleKey)}
          </p>
        ) : null}
        <div className="hidden min-w-0 flex-1 lg:block">
          <GlobalSearch />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {/* Search, on the devices that had none.
            `GlobalSearch` has exactly one call site and it sits behind
            `hidden lg:block`, so below 1024px — every phone, and an
            iPad in portrait — there was no way to find a customer from
            the top of the app at all. In a WhatsApp CRM "where is this
            person's chat" is the most-asked question there is, and the
            phone is where it gets asked. Same component, same query,
            same results; only the container changes. */}
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={() => setSearchOpen(true)}
          aria-label={tSearch('placeholder')}
          className="lg:hidden"
        >
          <Search className="size-5" />
        </Button>
        <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
          {/* Seated near the top rather than centred: the results grow
              downwards out of the field, and a vertically centred box
              would push them into the lower half of a phone where the
              keyboard is. */}
          <DialogContent
            showCloseButton={false}
            className="top-16 max-w-[calc(100%-1.5rem)] translate-y-0 overflow-visible p-3 sm:max-w-md"
          >
            <DialogTitle className="sr-only">
              {tSearch('placeholder')}
            </DialogTitle>
            <GlobalSearch
              autoFocus
              className="max-w-none"
              onNavigate={() => setSearchOpen(false)}
            />
          </DialogContent>
        </Dialog>

        {/* Notifications live here rather than as a navigation row. A row in
            the menu implies a place you go; this is a state you glance at,
            and it belongs with the other things you check without leaving
            what you are doing — which is now literal: the bell opens a
            panel instead of navigating. `NotificationsMenu` owns the count,
            the panel and the link through to the full page.
            The count is amber and stays visible even on the notifications
            page itself — it reflects unread, which you clear by reading,
            not by being here. */}
        <NotificationsMenu />

        <ModeToggle />
      </div>
    </header>
  );
}
