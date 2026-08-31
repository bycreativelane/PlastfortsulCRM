'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  KanbanSquare,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { useCapability } from '@/hooks/use-can';
import { useTotalUnread } from '@/hooks/use-total-unread';
import type { Capability } from '@/lib/auth/capabilities';
import { cn } from '@/lib/utils';

/**
 * The phone's navigation, in the thumb's reach.
 *
 * ------------------------------------------------------------------
 * WHY THIS REPLACES REACHING FOR THE HAMBURGER
 * ------------------------------------------------------------------
 *
 * Every destination on a phone used to cost two taps and one of them
 * was in the worst place on the device: the top-left corner. On a 6.7"
 * phone held one-handed that corner is a re-grip, and this is an app
 * somebody uses standing in a warehouse with a box in the other hand.
 *
 * A bar at the bottom costs one tap, sits inside the thumb arc, and —
 * the part a drawer can never do — is VISIBLE. A drawer answers "where
 * can I go" only after you have already decided to go somewhere; a tab
 * bar also answers "where am I", continuously, which is the question
 * somebody who just followed a notification actually has.
 *
 * ------------------------------------------------------------------
 * FOUR, AND THE FOURTH IS THE DRAWER
 * ------------------------------------------------------------------
 *
 * Three real destinations plus a way to everything else. Not five, not
 * seven: past four the labels truncate at 360px and the targets drop
 * under 44px, and a tab bar whose items cannot be read or reliably hit
 * is a worse hamburger.
 *
 * The three are chosen by what somebody does on a PHONE, which is not
 * what they do at a desk. Attend conversations; move a deal; look
 * somebody up. Relatórios, Disparos, Fluxos and Configurações are all
 * desk work — they stay one tap further away, behind "Mais", which is
 * the same drawer that was always there.
 *
 * Dashboard replaces Conversas when somebody cannot see the inbox, so a
 * viewer-limited account still gets a first tab rather than a hole.
 *
 * ------------------------------------------------------------------
 * AND IT GETS OUT OF THE WAY INSIDE A THREAD
 * ------------------------------------------------------------------
 *
 * With a conversation open the bar hides. Two reasons, and the second
 * is the real one: 56px is a lot to take from a composer that is
 * already sharing the screen with a keyboard — and reading a thread is
 * a task somebody is INSIDE, where a persistent tab strip invites
 * leaving it by accident with the same thumb that is trying to type.
 * WhatsApp hides its own tabs in a chat for exactly this reason.
 */

interface Tab {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  capability?: Capability;
  /** The unread count rides on this one. */
  badge?: boolean;
}

const TABS: Tab[] = [
  {
    href: '/inbox',
    labelKey: 'inbox',
    icon: MessageSquare,
    capability: 'inbox.view',
    badge: true,
  },
  {
    href: '/pipelines',
    labelKey: 'pipelines',
    icon: KanbanSquare,
    capability: 'pipelines.view',
  },
  {
    href: '/contacts',
    labelKey: 'contacts',
    icon: Users,
    capability: 'contacts.view',
  },
];

export function MobileTabBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const t = useTranslations('Sidebar');
  const pathname = usePathname();
  const params = useSearchParams();
  const unread = useTotalUnread();

  // Hooks cannot be called in a loop, so each is read by name. Three
  // capabilities, three calls, and the table above stays declarative.
  const canInbox = useCapability('inbox.view');
  const canPipelines = useCapability('pipelines.view');
  const canContacts = useCapability('contacts.view');
  const allowed: Record<string, boolean> = {
    'inbox.view': canInbox,
    'pipelines.view': canPipelines,
    'contacts.view': canContacts,
  };

  // `?c=` is the open conversation. Reading the URL rather than lifting
  // thread state into a context: the inbox already puts it there for
  // deep links, so the fact is public and needs no new plumbing.
  const insideThread = pathname.startsWith('/inbox') && params.has('c');
  if (insideThread) return null;

  const tabs = TABS.filter((tab) => !tab.capability || allowed[tab.capability]);
  // A first tab that always exists. An account with no inbox access
  // would otherwise open onto a bar missing its leftmost item, which
  // reads as a broken layout rather than as a permission.
  const items: Tab[] =
    tabs.length > 0
      ? tabs
      : [{ href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard }];

  return (
    <nav
      aria-label={t('primaryNav')}
      className={cn(
        // A FLEX CHILD, NOT A FIXED OVERLAY, and that is the whole
        // difference between a tab bar and a bug report.
        //
        // Fixed, it floats over the bottom 56px of everything — the last
        // conversation in the list, the last row of the contacts table,
        // the bottom of the Kanban column — and every one of those
        // surfaces would need its own bottom padding to compensate. Six
        // paddings to maintain, and the seventh screen somebody adds
        // forgets. As a sibling of <main> it simply takes its space and
        // the app is 56px shorter; nothing can be hidden behind it
        // because there is no behind.
        'border-border bg-card flex shrink-0 border-t lg:hidden',
        // `select-none` on the chrome and nowhere near the content: a
        // press held a beat too long on "Atendimento" used to start a
        // text selection and raise the copy callout instead of
        // navigating. See the note in globals.css.
        'select-none',
        // The home indicator on a modern iPhone sits ON the bar unless
        // the inset is honoured; without this the last 34px of every
        // tab is a swipe-up gesture rather than a button.
        'pb-[env(safe-area-inset-bottom)]'
      )}
    >
      {items.map((tab) => {
        const Icon = tab.icon;
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // 56px of real target, and the whole cell is the target —
              // not the icon, and not the label.
              'text-3xs relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 font-medium transition-colors duration-(--dur-1)',
              active
                ? 'text-primary'
                : 'text-muted-foreground active:text-foreground'
            )}
          >
            {/* The active mark is a bar at the TOP edge of the cell, not
                a filled pill behind the icon. It reads at a glance from
                the corner of the eye, and it does not compete with the
                unread badge for the same 24px. */}
            {active && (
              <span
                aria-hidden
                className="bg-primary absolute inset-x-4 top-0 h-0.5 rounded-full"
              />
            )}
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {tab.badge && unread > 0 && (
                <span className="bg-human-strong text-3xs absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-full px-1 font-bold text-white tabular-nums">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            <span className="max-w-full truncate px-1">{t(tab.labelKey)}</span>
          </Link>
        );
      })}

      {/* Everything else. A button and not a link, because it opens the
          drawer that already holds the full navigation — building a
          second list here would be two places to add the next route to. */}
      <button
        type="button"
        onClick={onOpenMenu}
        className="text-muted-foreground active:text-foreground text-3xs flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 font-medium"
      >
        <Menu className="size-5" aria-hidden />
        <span className="max-w-full truncate px-1">{t('more')}</span>
      </button>
    </nav>
  );
}
