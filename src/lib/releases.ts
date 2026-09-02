/**
 * What changed, for the people who use this — not for the people who deploy it.
 *
 * There are already release notes in `docs/releases/`. They are written for
 * GitHub and they talk about zip files, Docker stages and migration numbers,
 * which is the right register for that audience and useless to somebody in
 * the commercial team wondering why the inbox has three tabs this morning.
 * So this is a second, smaller thing, and it says what a person can now do.
 *
 * A TYPED CONSTANT AND NOT MARKDOWN. Three reasons, in order of weight: the
 * copy has to be translatable, and a `.md` file is one language; the badge
 * on each line is data, not formatting; and the "new since you last looked"
 * dot needs to compare versions, which means the version has to be a field
 * rather than a heading somebody might typo.
 *
 * Newest first. `version` is compared as a string for the unread dot, so
 * whatever is at index 0 is "the latest" — the order in this array is the
 * source of truth, not a sort.
 */

export type ReleaseChangeKind = 'new' | 'improved' | 'fixed';

export interface ReleaseChange {
  kind: ReleaseChangeKind;
  /** Message key under `WhatsNew.items`. */
  key: string;
}

export interface ReleaseHighlight {
  /** Key under `WhatsNew.highlights` — a title and a sentence. */
  key: string;
  /**
   * Where the thing being described actually lives.
   *
   * A release note that only tells you something changed leaves you to go
   * find it, and the moment you are most likely to want to look at a
   * feature is the moment you just read about it. Optional: some changes —
   * a name that stops reverting — have no screen to send anybody to.
   */
  href?: string;
}

export interface Release {
  version: string;
  /** ISO date, so the page can format it in the reader's locale. */
  date: string;
  /**
   * The two or three worth reading about, keyed into `WhatsNew.highlights`
   * (a title and a sentence each).
   *
   * A release note that is only a list makes every line the same size, so
   * "the Esperando tab means something different now" sits at the same
   * weight as "a button stopped overflowing". Somebody skimming sixteen
   * equal rows learns nothing and closes the page. The highlights are the
   * two or three that change how the day works; the list is still there,
   * one click away, for whoever wants it.
   */
  highlights: ReleaseHighlight[];
  changes: ReleaseChange[];
}

export const RELEASES: Release[] = [
  {
    version: '0.8.5',
    date: '2026-09-02',
    highlights: [
      { key: 'teamMedia', href: '/inbox' },
      { key: 'playbookConsult', href: '/playbook' },
      { key: 'quieterUi', href: '/reports' },
    ],
    changes: [
      { kind: 'new', key: 'teamMedia' },
      { kind: 'new', key: 'playbookConsult' },
      { kind: 'new', key: 'sendCost' },
      { kind: 'improved', key: 'reportsCharts' },
      { kind: 'improved', key: 'dashboardLayout' },
      { kind: 'improved', key: 'controlBorders' },
      { kind: 'fixed', key: 'profileAvatar' },
      { kind: 'fixed', key: 'settingsSticky' },
      { kind: 'fixed', key: 'reportsSkeleton' },
    ],
  },
  {
    version: '0.8.4',
    date: '2026-08-31',
    highlights: [
      { key: 'audioToText', href: '/inbox' },
      { key: 'products', href: '/products' },
      { key: 'aiAssist', href: '/inbox' },
    ],
    changes: [
      { kind: 'new', key: 'audioToText' },
      { kind: 'new', key: 'products' },
      { kind: 'new', key: 'aiAssist' },
      { kind: 'new', key: 'accountAudit' },
      { kind: 'new', key: 'memberPermissions' },
      { kind: 'new', key: 'assignScore' },
      { kind: 'new', key: 'teamRoomNames' },
      { kind: 'new', key: 'inboundHooks' },
      { kind: 'new', key: 'installApp' },
      { kind: 'new', key: 'cnpjCheck' },
      { kind: 'improved', key: 'aiAgentDepth' },
      { kind: 'improved', key: 'reportsRedesign' },
      { kind: 'improved', key: 'settingsOneArea' },
      { kind: 'improved', key: 'profilePhotos' },
      { kind: 'improved', key: 'mobileNav' },
      { kind: 'improved', key: 'messageAuthor' },
      { kind: 'fixed', key: 'productDialogs' },
      { kind: 'fixed', key: 'periodCompare' },
    ],
  },
  {
    version: '0.8.3',
    date: '2026-08-24',
    highlights: [
      { key: 'weekStrip', href: '/dashboard' },
      { key: 'customColors', href: '/settings?tab=fields' },
      { key: 'assignFromList', href: '/inbox' },
    ],
    changes: [
      { kind: 'new', key: 'weekStrip' },
      { kind: 'new', key: 'customColors' },
      { kind: 'new', key: 'assignFromList' },
      { kind: 'improved', key: 'onlineFaces' },
      { kind: 'improved', key: 'mediaThumb' },
      { kind: 'fixed', key: 'closedFilter' },
      { kind: 'fixed', key: 'contactNameAgain' },
      { kind: 'fixed', key: 'csvNames' },
      { kind: 'fixed', key: 'waitingClock' },
      { kind: 'fixed', key: 'phoneMaskSecond' },
      { kind: 'fixed', key: 'foreignPhone' },
      { kind: 'fixed', key: 'teamRoomExit' },
      { kind: 'fixed', key: 'teamRoomDot' },
      { kind: 'fixed', key: 'teamRoomLink' },
      { kind: 'fixed', key: 'notificationRead' },
      { kind: 'fixed', key: 'notificationDeadClick' },
      { kind: 'fixed', key: 'emptyFlowCanvas' },
      { kind: 'improved', key: 'translations' },
    ],
  },
  {
    version: '0.8.2',
    date: '2026-08-24',
    highlights: [
      { key: 'waiting', href: '/inbox' },
      { key: 'teamRoom', href: '/inbox?team=1' },
      { key: 'conversationMenu', href: '/inbox' },
    ],
    changes: [
      { kind: 'fixed', key: 'waitingTab' },
      { kind: 'fixed', key: 'messageNotifications' },
      { kind: 'fixed', key: 'contactName' },
      { kind: 'fixed', key: 'occurrenceWarning' },
      { kind: 'fixed', key: 'signupButton' },
      { kind: 'new', key: 'teamRoom' },
      { kind: 'new', key: 'conversationMenu' },
      { kind: 'new', key: 'hideConversation' },
      { kind: 'new', key: 'autoAssign' },
      { kind: 'new', key: 'contactPhoto' },
      { kind: 'new', key: 'pasteImage' },
      { kind: 'improved', key: 'mediaPreview' },
      { kind: 'improved', key: 'signature' },
      { kind: 'improved', key: 'mobileThread' },
      { kind: 'improved', key: 'phoneMask' },
      { kind: 'improved', key: 'inviteScreen' },
      { kind: 'improved', key: 'agendaEmpty' },
      { kind: 'improved', key: 'inviteOnly' },
      { kind: 'improved', key: 'editorCanvas' },
      { kind: 'new', key: 'onlineMembers' },
      { kind: 'new', key: 'teamPreview' },
      { kind: 'fixed', key: 'presenceLocale' },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-08-23',
    highlights: [{ key: 'firstRelease' }],
    changes: [
      { kind: 'new', key: 'firstRelease' },
      { kind: 'new', key: 'playbook' },
      { kind: 'improved', key: 'uxOverhaul' },
    ],
  },
];

/** How many of each kind, for the one-line summary above the list. */
export function countByKind(
  release: Release
): Record<ReleaseChangeKind, number> {
  const counts: Record<ReleaseChangeKind, number> = {
    new: 0,
    improved: 0,
    fixed: 0,
  };
  for (const change of release.changes) counts[change.kind]++;
  return counts;
}

/** The version the What's new page is currently headlining. */
export const LATEST_RELEASE = RELEASES[0]?.version ?? '';

const SEEN_KEY = 'wacrm.whatsNew.seen';

/**
 * Has this person seen the latest release notes?
 *
 * `localStorage`, like the composer signature and for the same reason: it is
 * a fact about one person at one desk, not about the account, and putting it
 * in Postgres would mean a migration, an RLS policy and a round trip to
 * decide whether to draw a 6px dot.
 */
export function lastSeenRelease(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    // Safari in private mode throws on access, not on write.
    return null;
  }
}

export function markReleasesSeen(version: string = LATEST_RELEASE): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* A preference that cannot be stored is not worth an error. */
  }
}

/** Whether to draw the dot. Unseen on a fresh browser counts as unread. */
export function hasUnreadRelease(seen: string | null): boolean {
  return !!LATEST_RELEASE && seen !== LATEST_RELEASE;
}
