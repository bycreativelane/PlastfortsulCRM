'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Bot,
  History,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  UserCog,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { fetchAccountMembers } from '@/lib/account/members';
import {
  CAPABILITIES,
  CAPABILITY_LIST,
  can,
  canBeGranted,
  parseOverrides,
  roleGrants,
  type Capability,
  type PermissionOverrides,
} from '@/lib/auth/capabilities';
import type { AuditArea } from '@/lib/audit/events';
import { dateLocale } from '@/lib/i18n/dates';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import { MemberAvatar } from '@/components/presence/member-avatar';
import { WhatsAppMark } from '@/components/whatsapp-mark';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { Button } from '@/components/ui/button';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { Switch } from '@/components/ui/switch';

import { formatDistance } from 'date-fns';

/**
 * Acesso e permissões — who may do what, and what has already been done.
 *
 * The two halves are one screen because they are one question with a
 * tense on either side. "Quem pode mexer nisso" and "quem mexeu nisso"
 * get asked by the same person, in the same minute, usually starting
 * from the second.
 *
 * ADMIN ONLY, and the gate is the same one the API and the RLS policies
 * use. This page shows every member's sign-in times and every settings
 * change on the account, which is not roster information.
 */
export function AccessPanel() {
  const t = useTranslations('Settings.access');
  const canManage = useCan('manage-members');

  if (!canManage) {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <StatePanel
          size="md"
          icon={Lock}
          title={t('restrictedTitle')}
          description={t('restrictedBody')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <PermissionsSection />
      <AuditSection />
    </div>
  );
}

// ------------------------------------------------------------------
// Permissions
// ------------------------------------------------------------------

function PermissionsSection() {
  const t = useTranslations('Settings.access');
  const tCaps = useTranslations('Settings.access.caps');
  // The role's own name, translated. Interpolating `selected.role` raw
  // would put the database enum — "agent" — into a Portuguese sentence.
  const tRoles = useTranslations('Settings.roles');
  const { user } = useAuth();

  const [members, setMembers] = useState<AccountMember[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The map being edited, before it is saved. */
  const [draft, setDraft] = useState<PermissionOverrides>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchAccountMembers().then((rows) => setMembers(rows));
  }, []);

  // Everybody you can actually edit.
  //
  // The owner is excluded because the API refuses them — a screen that
  // can take Configurações away from the owner is a screen that can lock
  // the account out of itself. You are excluded because the database
  // trigger refuses a self-edit, which is the one change nobody else
  // sees happen.
  const editable = useMemo(
    () =>
      (members ?? []).filter(
        (m) => m.role !== 'owner' && m.user_id !== user?.id
      ),
    [members, user?.id]
  );

  const selected = editable.find((m) => m.user_id === selectedId) ?? null;

  const select = useCallback((member: AccountMember) => {
    setSelectedId(member.user_id);
    setDraft(parseOverrides(member.permission_overrides));
  }, []);

  const save = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/account/members/${selected.user_id}/permissions`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides: draft }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t('saveFailed'));
        return;
      }
      // The route normalises what it stored — it drops any override that
      // agrees with the role. Taking its answer rather than the draft is
      // what keeps the switches showing what is actually saved.
      const stored = parseOverrides(body.overrides);
      setDraft(stored);
      setMembers((prev) =>
        prev
          ? prev.map((m) =>
              m.user_id === selected.user_id
                ? { ...m, permission_overrides: stored }
                : m
            )
          : prev
      );
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [selected, draft, t]);

  const dirty = useMemo(() => {
    if (!selected) return false;
    const stored = parseOverrides(selected.permission_overrides);
    const keys = new Set([...Object.keys(stored), ...Object.keys(draft)]);
    for (const key of keys) {
      const k = key as Capability;
      if (stored[k] !== draft[k]) return true;
    }
    return false;
  }, [selected, draft]);

  return (
    <Panel>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>{t('permissionsTitle')}</PanelTitle>
          <PanelSub>{t('permissionsSub')}</PanelSub>
        </div>
      </PanelHeader>

      <PanelBody className="space-y-4">
        {/* THE BOUNDARY, said out loud, to the person about to rely on it.
            These overrides are enforced by the interface and by this
            app's own routes — the same strength as the gate on
            /relatórios — and NOT by row-level security, which still
            answers to the role alone. That is enough for "não precisa
            ver" and not enough for "não pode ver". Somebody configuring
            access deserves to know which of the two they are buying
            before they buy it, not after. */}
        <p className="border-border bg-muted/40 text-muted-foreground rounded-md border p-3 text-xs">
          {t('scopeNote')}
        </p>

        {members === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : editable.length === 0 ? (
          <StatePanel
            icon={UserCog}
            title={t('noEditableTitle')}
            description={t('noEditableBody')}
          />
        ) : (
          <>
            {/* Who, first. The capability list means nothing until it is
                about somebody, and a wall of switches with a name picker
                buried above it is a screen people edit the wrong person
                on. */}
            <div className="flex flex-wrap gap-2">
              {editable.map((member) => {
                const active = member.user_id === selectedId;
                const count = Object.keys(
                  parseOverrides(member.permission_overrides)
                ).length;
                return (
                  <button
                    key={member.user_id}
                    type="button"
                    onClick={() => select(member)}
                    aria-pressed={active}
                    className={cn(
                      'flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-border bg-card text-secondary-foreground hover:bg-muted'
                    )}
                  >
                    <MemberAvatar
                      name={member.full_name || member.email}
                      avatarUrl={member.avatar_url}
                      size="xs"
                    />
                    <span className="max-w-40 truncate">
                      {member.full_name || member.email}
                    </span>
                    {/* How many exceptions this person already carries.
                        Without it the only way to find the one member
                        somebody configured last month is to click all of
                        them. */}
                    {count > 0 && (
                      <span className="bg-primary text-3xs grid size-4 place-items-center rounded-full font-semibold text-white">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selected ? (
              <div className="border-border divide-border divide-y rounded-md border">
                {CAPABILITY_LIST.map((capability) => {
                  const meta = CAPABILITIES[capability];
                  const byRole = roleGrants(selected.role, capability);
                  const overridden = typeof draft[capability] === 'boolean';
                  const effective = can(selected.role, draft, capability);
                  const grantable = canBeGranted(selected.role, capability);

                  return (
                    <div
                      key={capability}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground text-sm">
                          {tCaps(meta.labelKey)}
                        </p>
                        {/* What the ROLE says, next to what this person
                            gets. The two agreeing is the normal case and
                            the line reads as a reassurance; the two
                            disagreeing is the whole reason the screen
                            exists, and it says so in words rather than
                            leaving somebody to infer it from a switch
                            position. */}
                        <p className="text-muted-foreground text-2xs mt-0.5">
                          {overridden
                            ? t('overridden', {
                                role: tRoles(selected.role),
                                roleAnswer: byRole ? t('yes') : t('no'),
                              })
                            : t('fromRole', {
                                role: tRoles(selected.role),
                                roleAnswer: byRole ? t('yes') : t('no'),
                              })}
                          {!grantable && !byRole ? ` — ${t('denyOnly')}` : ''}
                        </p>
                      </div>

                      {overridden && (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) => {
                              const next = { ...prev };
                              delete next[capability];
                              return next;
                            })
                          }
                          aria-label={t('resetToRole')}
                          title={t('resetToRole')}
                          className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md transition-colors"
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}

                      <Switch
                        checked={effective}
                        // A grant the database would refuse is not
                        // offered. See `canBeGranted` — drawing the
                        // switch and letting the save fail moves the
                        // disappointment to after the decision.
                        disabled={saving || (!grantable && !effective)}
                        onCheckedChange={(next) =>
                          setDraft((prev) => ({ ...prev, [capability]: next }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{t('pickMember')}</p>
            )}

            {selected && (
              <div className="flex justify-end">
                <Button onClick={save} disabled={!dirty || saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('save')}
                </Button>
              </div>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

// ------------------------------------------------------------------
// Audit
// ------------------------------------------------------------------

interface AuditRow {
  id: string;
  action: string;
  area: AuditArea;
  actor_user_id: string | null;
  actor_label: string | null;
  target_label: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const AREA_ICON: Record<AuditArea, ComponentType<{ className?: string }>> = {
  session: LogIn,
  member: UserCog,
  account: ShieldCheck,
  key: KeyRound,
  integration: PlugZap,
};

/**
 * The glyph for one ROW, which is finer than the area it belongs to.
 *
 * "Integração" holds two very different things — the AI provider and the
 * WhatsApp number — and in a log you scan rather than read, the icon is
 * how you find the line you came for. The same plug on both made "quem
 * trocou o número" and "quem mexeu na IA" identical at a glance.
 *
 * Everything else falls through to its area, which is the right default:
 * five sign-ins in a row should look like five sign-ins.
 */
const ACTION_ICON: Record<string, ComponentType<{ className?: string }>> = {
  'whatsapp.config_updated': WhatsAppMark,
  'ai.config_updated': Bot,
};

const AREAS: AuditArea[] = [
  'session',
  'member',
  'account',
  'key',
  'integration',
];

const PAGE = 30;

function AuditSection() {
  const t = useTranslations('Settings.access');
  const [entries, setEntries] = useState<AuditRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [area, setArea] = useState<AuditArea | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (opts: { before?: string; area: AuditArea | null }) => {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (opts.before) params.set('before', opts.before);
      if (opts.area) params.set('area', opts.area);
      const res = await fetch(`/api/account/audit?${params}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t('auditFailed'));
        return null;
      }
      return body as { entries: AuditRow[]; hasMore: boolean; pending: boolean };
    },
    [t]
  );

  useEffect(() => {
    let cancelled = false;
    void load({ area }).then((body) => {
      if (cancelled || !body) return;
      setEntries(body.entries);
      setHasMore(body.hasMore);
      setPending(body.pending);
    });
    return () => {
      cancelled = true;
    };
  }, [area, load]);

  // Clearing the list belongs to the CLICK, not to the effect the click
  // causes. Blanking it inside the effect is a second synchronous render
  // for every filter change (and the lint rule that catches it is right
  // — see react.dev/learn/you-might-not-need-an-effect); doing it here
  // means one render, and the skeleton appears on the same frame as the
  // chip lighting up.
  const chooseArea = useCallback((next: AuditArea | null) => {
    setArea(next);
    setEntries(null);
  }, []);

  const more = useCallback(async () => {
    if (!entries?.length) return;
    setLoadingMore(true);
    const body = await load({
      area,
      before: entries[entries.length - 1].created_at,
    });
    setLoadingMore(false);
    if (!body) return;
    setEntries((prev) => [...(prev ?? []), ...body.entries]);
    setHasMore(body.hasMore);
  }, [entries, area, load]);

  return (
    <Panel>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>{t('auditTitle')}</PanelTitle>
          <PanelSub>{t('auditSub')}</PanelSub>
        </div>
      </PanelHeader>

      <PanelBody className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <AreaChip
            label={t('areaAll')}
            active={area === null}
            onClick={() => chooseArea(null)}
          />
          {AREAS.map((a) => (
            <AreaChip
              key={a}
              label={
                a === 'session'
                  ? t('areaSession')
                  : a === 'member'
                    ? t('areaMember')
                    : a === 'account'
                      ? t('areaAccount')
                      : a === 'key'
                        ? t('areaKey')
                        : t('areaIntegration')
              }
              active={area === a}
              onClick={() => chooseArea(a)}
            />
          ))}
        </div>

        {entries === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : pending ? (
          // "The table is not there yet" and "nothing has happened" are
          // different screens, and drawing the second over the first
          // tells an admin their account has no history when what it has
          // is an unapplied migration.
          <StatePanel
            icon={History}
            title={t('auditPendingTitle')}
            description={t('auditPendingBody')}
          />
        ) : entries.length === 0 ? (
          <StatePanel
            icon={History}
            title={t('auditEmptyTitle')}
            description={t('auditEmptyBody')}
          />
        ) : (
          <>
            <ul className="divide-border divide-y">
              {entries.map((entry) => (
                <AuditRowView key={entry.id} entry={entry} />
              ))}
            </ul>
            {hasMore && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={more}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t('auditMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function AreaChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold transition-colors [@media(pointer:coarse)]:min-h-11',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}

function AuditRowView({ entry }: { entry: AuditRow }) {
  const t = useTranslations('Settings.access');
  const Icon = ACTION_ICON[entry.action] ?? AREA_ICON[entry.area] ?? History;

  /**
   * The sentence, from a table of literal keys.
   *
   * Not `t(`action.${entry.action}`)`, which would read better and would
   * be invisible to `keys-exist.test.ts` — the guard that stands between
   * a renamed key and a screen rendering `Settings.access.actionInvited`
   * at users. Every key here is a literal for that reason.
   *
   * An action this table does not know still renders: it falls through
   * to its own dotted key, which is ugly and true. A log that dropped
   * rows it had no label for would be a log that hides exactly the
   * events somebody forgot to finish wiring up.
   */
  const LABEL: Record<string, string> = {
    'session.signed_in': t('actionSignedIn'),
    'member.invited': t('actionInvited'),
    'member.invite_revoked': t('actionInviteRevoked'),
    'member.joined': t('actionJoined'),
    'member.role_changed': t('actionRoleChanged'),
    'member.permissions_changed': t('actionPermissionsChanged'),
    'member.removed': t('actionRemoved'),
    'account.ownership_transferred': t('actionOwnershipTransferred'),
    'api_key.created': t('actionKeyCreated'),
    'api_key.revoked': t('actionKeyRevoked'),
    'ai.config_updated': t('actionAiUpdated'),
    'whatsapp.config_updated': t('actionWhatsappUpdated'),
  };

  const detail = describe(entry);

  return (
    // THREE THINGS ON ONE LINE, AT THREE HEIGHTS.
    //
    // Measured, before: the 28px disc carried `mt-0.5` under an
    // `items-start` row, so on a single-line entry — which is most of
    // them, since a sign-in has no detail — its centre sat 6px BELOW the
    // sentence, while the timestamp, being shorter, rode 2px above it.
    // Eight pixels of disagreement across one row, on the screen whose
    // whole job is being scanned.
    //
    // The fix is to say what the row actually is: a first line that holds
    // the glyph, the sentence and the time together, with an optional
    // detail hanging under it. `min-h-7` gives that line the disc's own
    // height, so `items-start` lines the two up by construction and
    // `items-center` settles the text inside it — and a two-line entry
    // still puts the disc on the FIRST line, which is where it belongs.
    <li className="flex items-start gap-3 py-2.5">
      <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-7 items-center gap-3">
          <p className="text-foreground min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {entry.actor_label ?? t('unknownActor')}
            </span>{' '}
            {LABEL[entry.action] ?? entry.action}
            {entry.target_label ? (
              <span className="font-medium"> {entry.target_label}</span>
            ) : null}
          </p>
          <time
            dateTime={entry.created_at}
            title={new Date(entry.created_at).toLocaleString()}
            className="text-muted-foreground text-2xs shrink-0 tabular-nums"
          >
            {formatDistance(new Date(entry.created_at), new Date(), {
              locale: dateLocale,
              addSuffix: true,
            })}
          </time>
        </div>
        {detail ? (
          <p className="text-muted-foreground text-2xs pb-0.5">{detail}</p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The second line — whatever the metadata happens to hold that a person
 * would want.
 *
 * Deliberately shallow and deliberately untranslated: these are field
 * values, not prose. A role change reads `agent → admin`, a key reads
 * its prefix. Anything this function has no rule for shows nothing,
 * which is better than rendering raw JSON at somebody.
 */
function describe(entry: AuditRow): string | null {
  const meta = entry.metadata ?? {};
  if (entry.action === 'member.role_changed') {
    const from = typeof meta.from === 'string' ? meta.from : '—';
    const to = typeof meta.to === 'string' ? meta.to : '—';
    return `${from} → ${to}`;
  }
  if (entry.action === 'member.invited' && typeof meta.role === 'string') {
    return meta.role;
  }
  if (entry.action === 'api_key.created' && typeof meta.key_prefix === 'string') {
    return meta.key_prefix;
  }
  if (entry.action === 'member.permissions_changed') {
    const overrides = meta.overrides;
    if (overrides && typeof overrides === 'object') {
      const keys = Object.keys(overrides as Record<string, unknown>);
      return keys.length ? keys.join(', ') : null;
    }
  }
  if (
    entry.action === 'whatsapp.config_updated' &&
    typeof meta.phone_number_id === 'string'
  ) {
    return meta.phone_number_id;
  }
  return null;
}
