'use client';

import Link from 'next/link';
import { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useNavCollapsed } from '@/hooks/use-nav-collapsed';
import { useCapability } from '@/hooks/use-can';
import type { Capability } from '@/lib/auth/capabilities';
import { useTotalUnread } from '@/hooks/use-total-unread';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Crown,
  KanbanSquare,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquare,
  Package,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import type { AccountRole } from '@/lib/auth/roles';
import { BrandMark } from '@/components/brand-mark';
import { RoadmapCard } from '@/components/layout/roadmap-card';
import { TeamRoomCard } from '@/components/layout/team-room-card';

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: 'roleOwner',
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  admin: {
    icon: Shield,
    labelKey: 'roleAdmin',
    // Primary-tinted: significant but not as scarce as owner.
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  agent: {
    icon: UserCog,
    labelKey: 'roleAgent',
    // Neutral slate: the operational default.
    className: 'border-border bg-muted text-foreground',
  },
  viewer: {
    icon: User,
    labelKey: 'roleViewer',
    // Muted slate: read-only role; visually quieter than agent.
    className: 'border-border bg-card text-muted-foreground',
  },
};
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
  /**
   * Hide the row from anyone without this capability.
   *
   * The menu used to list all nine destinations to all four roles while
   * `/reports` returns a padlock to anybody below admin — so an agent
   * saw the "Análise" group all day, clicked it, and hit a wall. A menu
   * is a promise about what is reachable; a row that is always there
   * and never works teaches people to distrust the whole menu, not just
   * that row. The dashboard already gets this right, wrapping its own
   * "Ver relatórios" link in the same check.
   *
   * A CAPABILITY rather than a `CanAction` since migration 050: the
   * question a menu row asks is "may THIS PERSON go here", and the role
   * is only the default answer to it. This is what makes the exceptions
   * in Configurações › Acesso visible where somebody would look for
   * them — hiding Relatórios from one agent now takes the row away
   * rather than leaving it there to fail on arrival.
   */
  capability?: Capability;
}

interface NavGroup {
  /** Section heading. Omitted for the first group, which needs none. */
  labelKey?: string;
  items: NavItem[];
}

/**
 * The menu, grouped the way the operation is actually divided:
 * what you do all day (Operação), what the machine does for you
 * (Automação), and what you look at afterwards (Análise).
 *
 * The test for a row: is this a place you go to WORK, or a place you go
 * to change how the work behaves? The second kind lives in Settings.
 *
 * Three rows failed it. Templates and Etiquetas were `?tab=` links —
 * the same two sections the Settings rail already lists, so the two
 * surfaces showed them side by side and `isRowActive` needed a special
 * case to stop both lighting at once. Neither is a destination anyway:
 * you pick a template from inside a campaign, and you apply a tag from
 * the contact. Agentes IA went the same way — test, configure, meter —
 * and its own components already lived in `components/settings/`.
 *
 * What that leaves is nine rows in four groups, with Automação (3)
 * finally the same weight as Operação (3) instead of carrying six.
 */
const navGroups: NavGroup[] = [
  {
    items: [
      { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
    ],
  },
  {
    labelKey: 'groupOperation',
    items: [
      {
        href: '/inbox',
        labelKey: 'inbox',
        icon: MessageSquare,
        capability: 'inbox.view',
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
      // Below Contatos, which is where the products plan put it: the
      // agent opens a product in the middle of a conversation to check a
      // measurement and a price, so it belongs with the things you do
      // all day and not with the things you configure once.
      {
        href: '/products',
        labelKey: 'products',
        icon: Package,
        capability: 'products.view',
      },
    ],
  },
  {
    labelKey: 'groupAutomation',
    items: [
      {
        href: '/automations',
        labelKey: 'automations',
        icon: Zap,
        capability: 'automations.manage',
      },
      {
        href: '/broadcasts',
        labelKey: 'broadcasts',
        icon: Radio,
        capability: 'broadcasts.send',
      },
      {
        href: '/flows',
        labelKey: 'flows',
        icon: Workflow,
        beta: true,
        capability: 'flows.manage',
      },
    ],
  },
  {
    labelKey: 'groupAnalysis',
    items: [
      {
        href: '/reports',
        labelKey: 'reports',
        icon: BarChart3,
        capability: 'reports.view',
      },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  { href: '/settings', labelKey: 'settings', icon: Settings },
];

/**
 * Is this row the one you're on?
 *
 * Prefix matching, so `/broadcasts/42` keeps Campanhas lit. Dashboard is
 * exact because it should not claim anything nested under it.
 *
 * This used to match on `?tab=` as well, because two rows pointed into
 * Settings and every Settings URL shares one pathname — it needed a
 * rule saying plain "Configurações" lights up only on the sections
 * without a row of their own, or opening Templates lit two rows at
 * once. Those rows are gone, and the query string went with them.
 */
function isRowActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/dashboard') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * A navigation row's icon — and, while the route it points at is still
 * being fetched, a spinner in the very same 16px box.
 *
 * Most navigations here are instant: the router prefetches, so `pending`
 * never flips and this renders exactly what it rendered before. It earns
 * its place on the navigations that are NOT instant — a cold cache, a
 * phone on 3G in a warehouse — where the app currently gives you nothing
 * at all between the click and the new screen, and the honest reading of
 * nothing is "it did not register, press again".
 *
 * The spinner replaces the icon inside a fixed-size wrapper instead of
 * being appended to the row. Appending would reflow the label mid-click,
 * which is the one thing worse than no feedback.
 */
function NavRowIcon({
  Icon,
  active,
}: {
  Icon: NavItem['icon'];
  active: boolean;
}) {
  const { pending } = useLinkStatus();

  return (
    <span className="relative grid size-4 shrink-0 place-items-center">
      <Icon
        className={cn('size-4 transition-opacity', pending && 'opacity-0')}
        strokeWidth={active ? 2.1 : 1.75}
      />
      {pending ? (
        <Loader2 aria-hidden className="absolute size-4 animate-spin" />
      ) : null}
    </span>
  );
}

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from 'next-intl';
import { avatarInitials } from '@/lib/avatar-color';

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations('Sidebar');
  const pathname = usePathname();
  /** The one screen where the rail's neighbour is content, not padding. */
  const onInbox = pathname.startsWith('/inbox');
  const { collapsed, toggle } = useNavCollapsed();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  // One call per capability the menu can gate on. Hooks cannot run in a
  // loop, so the list is written out. Each one reads the same context,
  // so seven calls cost what one does.
  //
  // `useCapability` returns false while the profile is still loading,
  // which is the right direction here — a row that appears a beat late
  // is invisible, and a row that appears and then vanishes is a glitch.
  const can: Partial<Record<Capability, boolean>> = {
    'inbox.view': useCapability('inbox.view'),
    'pipelines.view': useCapability('pipelines.view'),
    'contacts.view': useCapability('contacts.view'),
    'products.view': useCapability('products.view'),
    'automations.manage': useCapability('automations.manage'),
    'broadcasts.send': useCapability('broadcasts.send'),
    'flows.manage': useCapability('flows.manage'),
    'reports.view': useCapability('reports.view'),
  };
  const isVisible = (item: NavItem) =>
    !item.capability || can[item.capability] === true;
  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter(isVisible) }))
    .filter((group) => group.items.length > 0);
  const totalUnread = useTotalUnread();
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t('closeMenu')}
        onClick={onClose}
        className={cn(
          'bg-background/70 fixed inset-0 z-30 backdrop-blur-sm transition-opacity lg:hidden',
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
      />

      <aside
        data-sidebar
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          // `relative` on lg+ anchors the collapse handle to the right edge.
          // `group/rail` so the collapse handle can hide until the pointer
          // is over the rail — see the note on that button.
          'group/rail border-border bg-sidebar fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r lg:relative',
          'ease-out-soft transition-transform duration-(--dur-2) will-change-transform',
          open ? 'translate-x-0' : '-translate-x-full',
          // Desktop: always visible — reset the mobile framing. The width
          // here is the EXPANDED one; `data-nav="collapsed"` on <html>
          // narrows it from globals.css, so the state survives navigation
          // without a React round trip.
          //
          // NOT `lg:static`, which is what this block used to carry while
          // the line above it said `lg:relative`. Two position utilities at
          // the same breakpoint, and Tailwind emits the static one last, so
          // static quietly won — which left the collapse handle below, being
          // `absolute`, with no positioned ancestor at all. It anchored to
          // the VIEWPORT instead of to this edge.
          //
          // `z-20` and not `z-0`: most pages leave padding at the left of
          // the content column, so the half of the handle that overhangs
          // lands on empty background. The inbox and the pipeline board
          // cancel that padding with `-m-4` to run full-bleed, so an opaque
          // panel starts exactly at the boundary and buried it.
          //
          // Transform is swapped for WIDTH here rather than switched off.
          // The drawer slide is a mobile-only gesture, but the collapse is
          // a desktop one, and it used to happen between two frames: 240px
          // of chrome vanished with nothing to follow. Transitioning the
          // width instead means the content beside it grows into the space
          // rather than teleporting. It cannot be a transform — the sidebar
          // has to actually give the space back, not merely look narrower.
          'lg:z-20 lg:w-60 lg:translate-x-0',
          'lg:ease-out-soft lg:transition-[width] lg:duration-(--dur-2)'
        )}
        aria-label={t('primaryNav')}
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        {/* The lockup sits on the navigation's own left edge, not centred
            in the strip.

            Centring it (`lg:justify-center`, which is what this was) put
            the brand on an axis nothing else in the rail shares: every
            nav icon below starts at 24px in — `nav` px-3 plus the row's
            own px-3 — and the mark started at ~90px, so the one element
            at the top of the column was the one element out of line with
            it. A sidebar is read as a single left-aligned list; the thing
            above the list has to belong to it.

            The 20px here is not the nav's 24: the mark's artwork is inset
            inside its own viewBox (the arcs start at 12.6% of a 100-unit
            box, so 5px at this size), and 20 + 5 lands its INK on the same
            25px the lucide icons' ink lands on. Aligning the boxes would
            have left the logo looking 5px too far right, which is the
            complaint this is fixing, one notch smaller.

            The wordmark steps up 18 → 20px to take back the width the
            move gives away. `truncate` and `min-w-0` still hold: this is
            the one string in the app an installer can replace with
            anything. */}
        {/* `min-h-14 pt-safe-0` for the same reason the app bar carries
            it — see `header.tsx`. This drawer is `fixed inset-y-0`, so
            once the app is installed and the address bar is gone, its
            top edge IS the top of the display and the wordmark sits
            under the clock. Zero inset resolves to the 56px this always
            was. */}
        <div
          data-nav-strip
          className="border-border pt-safe-0 flex min-h-14 shrink-0 items-center justify-between gap-2 border-b px-3"
        >
          <Link
            href="/dashboard"
            data-nav-row
            title={t('title')}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-2"
          >
            {/* Sized to the row rather than to a default. The lockup had a
                32px mark and 14px text in a 56px bar, leaving most of the
                brand's own strip empty — the one place in the app where the
                name is supposed to carry. */}
            <BrandMark className="size-10" />
            <span
              data-nav-label
              className="text-foreground min-w-0 truncate text-xl font-bold tracking-tight"
            >
              {t('title')}
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('closeMenu')}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 w-9 items-center justify-center rounded-md lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav
          id="sidebar-nav"
          className="flex-1 overflow-y-auto px-3 py-4 select-none"
        >
          {/* NO GROUP HEADINGS.
              
              There were three — OPERAÇÃO, AUTOMAÇÃO, ANÁLISE — over nine
              rows. Nine is a length the eye reads as one list, so the
              headings were not helping anyone find anything; what they did
              was break the column into four blocks, each with a label
              indented differently from the rows under it, so nothing in the
              rail lined up with anything else vertically.
              
              A menu this short is scanned by ICON and by position. The
              spacing between groups stays — it is a pause, and pauses are
              free — but the words are gone and every row now starts on the
              same left edge, which is the alignment that was asked for. The
              `labelKey` field survives on the model for the day the menu is
              long enough to need it again. */}
          {/* No margin between groups either. The pause existed to separate
              LABELLED sections; with the labels gone it marks nothing, and
              three different vertical gaps in one nine-row column is what
              reads as misaligned. One rhythm, every row the same distance
              from the next. */}
          {visibleGroups.map((group) => (
            <div key={group.labelKey ?? 'root'} data-nav-group>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const isActive = isRowActive(item, pathname);

                  const showUnreadDot =
                    item.href === '/inbox' && totalUnread > 0 && !isActive;

                  const label = t(item.labelKey);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        data-nav-row
                        // The tooltip is the label's only home once the
                        // menu is collapsed to icons.
                        title={label}
                        className={cn(
                          // Taller on mobile so fingers can hit the row reliably (>=44px).
                          'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2',
                          isActive
                            ? 'bg-primary-soft text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {/* The active row thickens its icon as well as
                            tinting it, so "where I am" survives for
                            anyone who can't separate the two colours. */}
                        <NavRowIcon Icon={item.icon} active={isActive} />
                        <span data-nav-label className="flex-1 truncate">
                          {label}
                        </span>
                        {/* SMALLER, AND NOT AMBER.
                            
                            This was a bordered amber pill — a border, a
                            fill and an ink, three devices for one word, in
                            the one colour this system reserves for "a
                            person has to do something about this". Nobody
                            has to do anything about a feature being in
                            beta; it is a fact about the feature, and the
                            grey every other machine-and-metadata marker in
                            the app uses is what says that.
                            
                            No border and no pill either: the row is 32px
                            tall and the badge was 20 of them. A lowercase
                            grey word at 10px sits beside the label instead
                            of competing with it, and it stops being the
                            loudest thing in a nine-row menu. */}
                        {item.beta && (
                          <span
                            data-nav-label
                            aria-label={t('beta')}
                            className="text-muted-foreground text-3xs shrink-0 font-medium tracking-wide"
                          >
                            {t('beta')}
                          </span>
                        )}
                        {/* A static dot, and only a static dot.
                            This carried `animate-ping` — an infinite
                            loop — under a condition that is TRUE for
                            most of a working day in a WhatsApp CRM:
                            "there is an unread conversation". So the
                            app pulsed something in the operator's
                            peripheral field for eight hours. Motion is
                            the strongest pre-attentive trigger there
                            is and, unlike colour, it does not habituate:
                            every cycle takes a slice of attention off
                            whatever the person is actually reading, and
                            the cost does not fall with exposure. The
                            dot alone already says "unread"; the
                            animation only said it louder, forever. */}
                        {/* `data-nav-badge` is the whole collapsed-rail
                            fix, and the rule it opts into
                            (globals.css) already existed with no
                            consumer.

                            Without it the dot stayed a normal flex item
                            in a row whose collapsed state is
                            `justify-content: center`, so the row's
                            content went from one 16px icon to
                            16 + 12(gap) + 8 = 36px inside a 37px box:
                            the icon slid 10px to the left and the row
                            went flush to both edges while every other
                            row sat inset. The label vanishes cleanly
                            because `display: none` removes the box
                            entirely; the dot never had the attribute
                            that does the same for a badge.

                            The ring is the prototype's
                            `box-shadow: 0 0 0 2px var(--surface)` — an
                            8px dot pinned to the corner needs to
                            separate from the row's own hover and active
                            fill. */}
                        {showUnreadDot && (
                          <span
                            data-nav-badge
                            aria-label={t('unreadConversations', {
                              count: totalUnread,
                            })}
                            className="bg-primary ring-sidebar size-2 shrink-0 rounded-full ring-2"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {/* Settings sits on the same rhythm as every row above it now.
              It used to keep 20px of its own — a distance that made sense
              when the groups above were also spaced apart and labelled.
              It is one more destination in the same list, and the line
              was drawing a border around the idea that it isn't.
              Collapsed, it gives that distance up along with everyone
              else: `data-nav-group`. */}
          <ul data-nav-group className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const isActive = isRowActive(item, pathname);
              const label = t(item.labelKey);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    data-nav-row
                    title={label}
                    className={cn(
                      // `relative` for the same reason the rows above have
                      // it: a `data-nav-badge` here would otherwise take
                      // its position from the `<aside>` and land in the
                      // sidebar's own corner. Nothing badges this row
                      // today; the trap is cheaper to close than to find.
                      'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2',
                      isActive
                        ? 'bg-primary-soft text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <NavRowIcon Icon={item.icon} active={isActive} />
                    <span data-nav-label className="truncate">
                      {label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Collapse handle. Desktop only — on mobile the sidebar is a
            drawer, and a 62px drawer helps nobody.

            It straddles the right border at the vertical midpoint rather
            than taking a row of its own. A full row cost the same height as
            a navigation item, permanently, to hold a control used maybe
            twice a day; sitting on the edge it costs nothing and lands
            exactly where the pointer already is when you reach for the
            boundary you want to move. The chevron points the way it will
            travel, which is the only label it needs. */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="sidebar-nav"
          title={collapsed ? t('expandMenu') : t('collapseMenu')}
          aria-label={collapsed ? t('expandMenu') : t('collapseMenu')}
          // INSIDE THE RAIL, not straddling its edge.
          //
          // This was `right-0 translate-x-1/2`, so half the disc hung over
          // whatever was on the other side of the seam. At `top-1/2` that
          // other side is the middle of the conversation list — a 24px
          // circle parked on somebody's avatar and name, which is what the
          // "elemento bugado" screenshot shows.
          //
          // The sibling handle on the thread's right edge hit the same
          // thing and answered it by moving vertically, to a band where the
          // facing side is chrome (see the note in inbox/page.tsx). That
          // works there because that column's chrome is a fixed 56px
          // header. It does not work here: the conversation list is rows
          // from top to bottom once there are more than a few, so there is
          // no height at which the facing side is reliably empty.
          //
          // Vertically centred, and INSIDE the rail rather than straddling
          // its edge. Those are two separate fixes for two separate
          // complaints, and the second is the one that matters: half the
          // disc used to hang over the neighbouring pane, which on the
          // inbox is the conversation list, so it parked on somebody's
          // avatar. Flush inside, it stays on its own column.
          //
          // It spent a moment at `bottom-3` — off the rows entirely — and
          // that traded one collision for a worse one: the rail's footer is
          // the account tile, so it landed on the user's own name.
          //
          // CENTRED ON THE BORDER, which is where a seam control belongs —
          // `translate-x-1/2` puts its axis exactly on the line it moves.
          //
          // It was pulled inside the rail earlier precisely to stop it
          // overlapping the conversation list, and this is only safe again
          // because of the rule below: on the inbox it is invisible until
          // somebody reaches for it, so there is nothing permanently parked
          // on anybody's avatar. The hover rule is what bought the position
          // back.
          className={cn(
            'border-border bg-card text-muted-foreground hover:border-primary hover:text-primary absolute top-1/2 right-0 z-10 hidden size-6 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border shadow-sm transition-[color,border-color,opacity] duration-(--dur-1) lg:grid',
            // ON THE INBOX, ONLY WHEN REACHED FOR.
            //
            // That screen is the one where the rail's neighbour is a dense
            // list rather than page padding, so a permanent disc on the
            // seam is a permanent disc over somebody's avatar. Everywhere
            // else there is nothing behind it and it can stay put.
            //
            // Hidden by opacity rather than unmounted: the button keeps its
            // place in the tab order and `focus-visible` brings it back, so
            // a keyboard user is not left without a way to collapse the
            // rail on the one screen where the space matters most.
            onInbox &&
              'opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100'
          )}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" strokeWidth={2} />
          ) : (
            <ChevronLeft className="size-3.5" strokeWidth={2} />
          )}
        </button>

        {/* User section. No rule above it either: both things in here
            are bordered tiles sitting on the rail's own surface, so the
            footer already has an edge — its children draw it.

            `pb-safe-3` and not `p-3`: on the desk this element is a
            column in a flex row and its bottom edge is the window's.
            On a phone it is the floor of a `fixed inset-y-0` drawer,
            and the last 34px of a modern iPhone belong to the home
            gesture — so a plain 12px put "Sair" underneath it. The app
            is `overflow: hidden` with children scrolling inside, so the
            browser never scrolls the inset out of the way the way it
            would in an ordinary document. The utility resolves to the
            same 12px on every device without an inset. */}
        <div className="pb-safe-3 shrink-0 px-3 pt-3">
          {/* What's coming next — DESK ONLY.

              On the desk this rail is always on screen and its footer is
              periphery: something you read in the gaps, next to the
              account tile you are not looking at either. On a phone the
              same rail is a MODAL drawer you opened with an intention,
              and answering that intention with a product announcement —
              90px of card, carousel and pager — puts news between a
              person and the thing they came for. Same component, and the
              context is what changed.

              It removes itself once dismissed, on both. */}
          <div className="hidden lg:block">
            <RoadmapCard />
          </div>
          {/* The team room's last line, below the news and above the
              account tile. See `team-room-card` for why it is in the rail
              at all — it is the only surface that survives every route,
              and a room you can only find by navigating to it is a room
              that gets used twice. Draws nothing before migration 046. */}
          <TeamRoomCard />
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {showAccountStrip && account?.name ? (
            <div
              data-nav-label
              className="text-muted-foreground mb-2 flex items-center gap-2 px-3 text-xs"
            >
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole
                ? // Always render the chip — owners used to be
                  // invisible here, which made them indistinguishable
                  // from admins at a glance. Now everyone sees their
                  // role (with a colour cue) regardless of tier.
                  (() => {
                    const meta = ROLE_CHIP[accountRole];
                    const Icon = meta.icon;
                    return (
                      <span
                        className={`text-3xs ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium tracking-wider uppercase ${meta.className}`}
                      >
                        <Icon className="size-3" />
                        {t(meta.labelKey as string)}
                      </span>
                    );
                  })()
                : null}
            </div>
          ) : null}
          <DropdownMenu>
            {/* The account row, as a tile rather than as two lines of text.
                It was neither: no surface, no border, and — the part that
                actually cost something — no affordance at all. The control
                that opens the only menu holding "Sair" looked exactly like
                the static account line above it, so the way you found out
                it was a button was by clicking your own name on the off
                chance.

                It gets the app's own recipe for a surface you can click,
                unchanged from the automation cards and the notification
                rows: `surface-interactive` on a bordered tile, where hover
                warms the border toward the accent and lifts it a pixel,
                and the FILL never moves — the fill is what says "selected"
                everywhere else in this app and hover must not be able to
                impersonate it.

                `bg-muted` and not `bg-card`: in light mode `--sidebar` and
                `--card` are both pure white, so a card-coloured tile on
                this rail would have been an invisible one.

                The chevrons are the affordance that was missing, and they
                carry `data-nav-label` so they leave with the text when the
                rail collapses — what is left there is an avatar button,
                which needs no arrow to explain it.

                And `data-nav-tile`, which drops the tile itself in the
                collapsed rail (globals.css). The fill and the border earn
                their place around a name and an e-mail; around a single
                32px avatar they became a box drawn 3px from the artwork
                on all four sides — a second, squarer outline fighting the
                round one the avatar already has. Collapsed, the avatar IS
                the affordance. */}
            <DropdownMenuTrigger
              data-nav-row
              data-nav-tile
              title={profile?.full_name ?? t('defaultUser')}
              className="surface-interactive group/account border-border bg-muted focus-visible:border-ring focus-visible:ring-ring/50 data-popup-open:border-primary/40 data-popup-open:bg-card-2 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-3"
            >
              <Avatar className="ring-primary/15 size-8 shrink-0 ring-2">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t('defaultAvatar')}
                  />
                ) : null}
                <AvatarFallback
                  seed={profile?.full_name ?? profile?.email}
                  className="text-sm font-medium"
                >
                  {avatarInitials(profile?.full_name ?? profile?.email, 'U')}
                </AvatarFallback>
              </Avatar>
              <div data-nav-label className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {profile?.full_name ?? t('defaultUser')}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {profile?.email ?? ''}
                </p>
              </div>
              <ChevronsUpDown
                data-nav-label
                aria-hidden
                className="text-muted-foreground group-hover/account:text-primary group-data-popup-open/account:text-primary size-4 shrink-0 transition-colors"
              />
            </DropdownMenuTrigger>
            {/* Aligned to the START of the row and left at its natural
                `w-(--anchor-width)`, so the panel is exactly as wide as the
                row it belongs to and shares its left edge. Anchored to the
                END it came out narrower than the trigger and offset from it,
                which read as a panel floating loose over the navigation
                rather than as this row's own menu. */}
            <DropdownMenuContent align="start" side="top" sideOffset={6}>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t('menuProfile')}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t('menuSettings')}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t('menuSignOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
