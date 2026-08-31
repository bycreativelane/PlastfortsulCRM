'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Ban,
  Gauge,
  Loader2,
  Lock,
  MoonStar,
  Shuffle,
  Trophy,
  UserRoundX,
  Users,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { fetchAccountMembers } from '@/lib/account/members';
import { ACCOUNT_ROLES, type AccountRole } from '@/lib/auth/roles';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import { MemberAvatar } from '@/components/presence/member-avatar';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { Switch } from '@/components/ui/switch';

/**
 * "Quem atende a próxima?" — the whole answer, on one screen.
 *
 * This used to be a single switch living at the bottom of Team members,
 * under a comment that said the rotation "has no options worth exposing"
 * and that every knob would be "a way for the team to end up with a
 * routing rule nobody remembers agreeing to".
 *
 * That was right about a feature nobody had used and wrong about one in
 * use. Three of its behaviours turned out to be decisions rather than
 * facts — who is even in the rotation, what happens out of hours, and
 * whether a rotation should care how much work somebody already has —
 * and a decision the product makes silently on your behalf is exactly
 * the routing rule nobody remembers agreeing to. Written down, on a page
 * with a name, it is a rule the team CAN agree to.
 *
 * Every default here is what the engine did before migration 051, with
 * one deliberate exception: the role floor now starts at `agent`,
 * because assigning to a read-only viewer was a confirmed defect and not
 * a preference. See the note in the migration.
 */

type Mode = 'off' | 'round_robin' | 'least_busy' | 'best_score';
type Fallback = 'rotate_all' | 'leave_unassigned';

interface Rules {
  mode: Mode;
  /** Minutes a customer may wait with an absent owner. 0 = never. */
  reassignAfter: number;
  minRole: AccountRole;
  fallback: Fallback;
  maxOpen: number;
}

const DEFAULTS: Rules = {
  mode: 'off',
  reassignAfter: 0,
  minRole: 'agent',
  fallback: 'rotate_all',
  maxOpen: 0,
};

export function AssignmentPanel() {
  const t = useTranslations('Settings.assignment');
  const tRoles = useTranslations('Settings.roles');
  const { accountId, user } = useAuth();
  const canEdit = useCan('manage-members');

  const [rules, setRules] = useState<Rules | null>(null);
  const [saved, setSaved] = useState<Rules>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  /** True when migration 051 (or 045) has not landed. */
  const [pending, setPending] = useState(false);

  const [members, setMembers] = useState<AccountMember[] | null>(null);
  const [optOut, setOptOut] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const db = createClient();

    (async () => {
      // The wide read first, the narrow one as the pre-051 fallback. Same
      // shape as the engine's own loader, and for the same reason:
      // naming a column the database does not have is a 42703 for the
      // whole row, which would render this page as "auto-assignment is
      // off" for an account that has it on.
      const wide = await db
        .from('accounts')
        .select(
          'auto_assign_mode, auto_assign_min_role, auto_assign_offline_fallback, auto_assign_max_open, auto_reassign_after_minutes'
        )
        .eq('id', accountId)
        .maybeSingle();

      let row = wide.data as Record<string, unknown> | null;
      let legacy = false;

      if (wide.error && isUnknownColumn(wide.error)) {
        legacy = true;
        const narrow = await db
          .from('accounts')
          .select('auto_assign_mode')
          .eq('id', accountId)
          .maybeSingle();
        row = narrow.data as Record<string, unknown> | null;
        if (narrow.error) {
          if (!cancelled) {
            setPending(true);
            setRules(DEFAULTS);
          }
          return;
        }
      } else if (wide.error) {
        if (!cancelled) {
          setPending(true);
          setRules(DEFAULTS);
        }
        return;
      }

      if (cancelled) return;
      const mode = row?.auto_assign_mode;
      const next: Rules = {
        mode:
          mode === 'round_robin' ||
          mode === 'least_busy' ||
          mode === 'best_score'
            ? (mode as Mode)
            : 'off',
        minRole: (ACCOUNT_ROLES as readonly string[]).includes(
          String(row?.auto_assign_min_role)
        )
          ? (row?.auto_assign_min_role as AccountRole)
          : DEFAULTS.minRole,
        fallback:
          row?.auto_assign_offline_fallback === 'leave_unassigned'
            ? 'leave_unassigned'
            : 'rotate_all',
        maxOpen: Number(row?.auto_assign_max_open) || 0,
        reassignAfter: Number(row?.auto_reassign_after_minutes) || 0,
      };
      setPending(legacy);
      setRules(next);
      setSaved(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    void fetchAccountMembers().then((rows) => {
      if (cancelled) return;
      setMembers(rows);
      setOptOut(
        new Set(rows.filter((m) => m.auto_assign_opt_out).map((m) => m.user_id))
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(
    () =>
      !!rules &&
      (rules.mode !== saved.mode ||
        rules.minRole !== saved.minRole ||
        rules.fallback !== saved.fallback ||
        rules.maxOpen !== saved.maxOpen ||
        rules.reassignAfter !== saved.reassignAfter),
    [rules, saved]
  );

  const save = useCallback(async () => {
    if (!accountId || !rules) return;
    setSaving(true);

    const payload: Record<string, unknown> = {
      auto_assign_mode: rules.mode,
      auto_reassign_after_minutes: rules.reassignAfter,
      auto_assign_min_role: rules.minRole,
      auto_assign_offline_fallback: rules.fallback,
      auto_assign_max_open: rules.maxOpen,
    };

    const db = createClient();
    let { error } = await db
      .from('accounts')
      .update(payload)
      .eq('id', accountId);

    // Pre-051 only the mode exists. Saving the one field that CAN be saved
    // beats refusing the whole form over three that cannot — the switch
    // is the setting people came for.
    if (error && isUnknownColumn(error)) {
      ({ error } = await db
        .from('accounts')
        .update({ auto_assign_mode: rules.mode })
        .eq('id', accountId));
      if (!error) setPending(true);
    }

    setSaving(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    setSaved(rules);
    toast.success(t('saved'));
  }, [accountId, rules, t]);

  const toggleMember = useCallback(
    async (member: AccountMember, inRotation: boolean) => {
      const next = new Set(optOut);
      if (inRotation) next.delete(member.user_id);
      else next.add(member.user_id);
      setOptOut(next);

      const { error } = await createClient().rpc('set_member_auto_assign', {
        p_user_id: member.user_id,
        p_opt_out: !inRotation,
      });

      if (error) {
        // Put it back. The switch is the only feedback there is, and one
        // that stays where you left it while the database disagrees is
        // the worst kind of lie a settings page can tell.
        setOptOut(optOut);
        toast.error(
          error.code === 'PGRST202' ? t('needsMigration') : error.message
        );
      }
    },
    [optOut, t]
  );

  if (!rules) {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const off = rules.mode === 'off';

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {pending && (
        <StatePanel
          size="md"
          icon={Lock}
          title={t('pendingTitle')}
          description={t('pendingBody')}
        />
      )}

      {/* ---- How ---- */}
      <Panel>
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle>{t('strategyTitle')}</PanelTitle>
            <PanelSub>{t('strategySub')}</PanelSub>
          </div>
        </PanelHeader>
        <PanelBody className="space-y-3">
          {/* Three cards rather than a select: these are not three values
              of one setting, they are three different products. Reading
              what each one does is the decision, and a dropdown hides two
              of the three behind a click. */}
          <ModeCard
            active={rules.mode === 'off'}
            disabled={!canEdit}
            icon={Ban}
            title={t('modeOff')}
            body={t('modeOffBody')}
            onPick={() => setRules({ ...rules, mode: 'off' })}
          />
          <ModeCard
            active={rules.mode === 'round_robin'}
            disabled={!canEdit}
            icon={Shuffle}
            title={t('modeRoundRobin')}
            body={t('modeRoundRobinBody')}
            onPick={() => setRules({ ...rules, mode: 'round_robin' })}
          />
          <ModeCard
            active={rules.mode === 'best_score'}
            disabled={!canEdit}
            icon={Trophy}
            title={t('modeBestScore')}
            body={t('modeBestScoreBody')}
            onPick={() => setRules({ ...rules, mode: 'best_score' })}
          />
          <ModeCard
            active={rules.mode === 'least_busy'}
            disabled={!canEdit}
            icon={Gauge}
            title={t('modeLeastBusy')}
            body={t('modeLeastBusyBody')}
            onPick={() => setRules({ ...rules, mode: 'least_busy' })}
          />
        </PanelBody>
      </Panel>

      {/* ---- Rules ---- */}
      <Panel className={cn(off && 'opacity-60')}>
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle>{t('rulesTitle')}</PanelTitle>
            <PanelSub>{off ? t('rulesOff') : t('rulesSub')}</PanelSub>
          </div>
        </PanelHeader>
        <PanelBody className="space-y-5">
          <div className="space-y-2">
            <FieldLabel htmlFor="assign-min-role">{t('minRole')}</FieldLabel>
            <p className="text-muted-foreground text-xs">{t('minRoleDesc')}</p>
            <Select
              value={rules.minRole}
              onValueChange={(v) =>
                v && setRules({ ...rules, minRole: v as AccountRole })
              }
              disabled={!canEdit || off}
            >
              <SelectTrigger id="assign-min-role" className="w-full sm:w-64">
                <SelectValue>{tRoles(rules.minRole)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {/* Owner is not offered. A floor of "owner" would mean
                    every customer conversation goes to one person, which
                    is not a routing rule, it is a way to lose the queue. */}
                {(['viewer', 'agent', 'admin'] as AccountRole[]).map((role) => (
                  <SelectItem key={role} value={role}>
                    {tRoles(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="assign-fallback">
              <MoonStar className="text-muted-foreground mr-1.5 inline size-3.5" />
              {t('fallback')}
            </FieldLabel>
            <p className="text-muted-foreground text-xs">{t('fallbackDesc')}</p>
            <Select
              value={rules.fallback}
              onValueChange={(v) =>
                v && setRules({ ...rules, fallback: v as Fallback })
              }
              disabled={!canEdit || off}
            >
              <SelectTrigger id="assign-fallback" className="w-full sm:w-64">
                <SelectValue>
                  {rules.fallback === 'rotate_all'
                    ? t('fallbackRotate')
                    : t('fallbackQueue')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rotate_all">{t('fallbackRotate')}</SelectItem>
                <SelectItem value="leave_unassigned">
                  {t('fallbackQueue')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="assign-max">{t('maxOpen')}</FieldLabel>
            <p className="text-muted-foreground text-xs">{t('maxOpenDesc')}</p>
            <Input
              id="assign-max"
              type="number"
              min={0}
              max={500}
              value={rules.maxOpen}
              onChange={(e) =>
                setRules({
                  ...rules,
                  maxOpen: Math.min(500, Math.max(0, Number(e.target.value) || 0)),
                })
              }
              disabled={!canEdit || off}
              className="w-28"
            />
          </div>

          {/* REPASSE POR AUSÊNCIA.

              Zero é desligado, e é o padrão. Tirar uma conversa de uma
              pessoa e dar para outra sem ninguém pedir é uma decisão da
              equipe, não um comportamento a herdar — numa equipe pequena
              onde todo mundo sabe quem está onde, isso é atrapalhar.

              Fora do bloco `off` acima, de propósito: repassar uma
              conversa parada faz sentido mesmo com a distribuição
              automática desligada, porque quem atribuiu à mão também sai
              para almoçar. */}
          <div className="border-border space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <UserRoundX className="text-muted-foreground size-4" />
              <FieldLabel htmlFor="assign-reassign">
                {t('reassignTitle')}
              </FieldLabel>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('reassignDesc')}
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="assign-reassign"
                type="number"
                min={0}
                max={1440}
                step={5}
                value={rules.reassignAfter}
                onChange={(e) => {
                  const raw = Number(e.target.value) || 0;
                  // The column's CHECK is 0 or 5-1440. Snapping here
                  // means the form cannot produce a value the database
                  // will refuse — a 400 on save for a number the field
                  // itself offered would be the app arguing with itself.
                  const next =
                    raw <= 0 ? 0 : Math.min(1440, Math.max(5, Math.round(raw)));
                  setRules({ ...rules, reassignAfter: next });
                }}
                disabled={!canEdit}
                className="w-28"
              />
              <span className="text-muted-foreground text-xs">
                {rules.reassignAfter === 0
                  ? t('reassignOff')
                  : t('reassignMinutes')}
              </span>
            </div>
            {rules.reassignAfter > 0 && (
              <p className="bg-human-soft text-human-ink rounded-md px-2.5 py-2 text-xs">
                {t('reassignWarning', { minutes: rules.reassignAfter })}
              </p>
            )}
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <Button onClick={save} disabled={!dirty || saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('save')}
              </Button>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ---- Who ---- */}
      <Panel>
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle>{t('rosterTitle')}</PanelTitle>
            <PanelSub>{t('rosterSub')}</PanelSub>
          </div>
        </PanelHeader>
        <PanelBody flush>
          {members === null ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <StatePanel
              icon={Users}
              title={t('rosterEmptyTitle')}
              description={t('rosterEmptyBody')}
            />
          ) : (
            <ul className="divide-border divide-y">
              {members.map((member) => {
                const inRotation = !optOut.has(member.user_id);
                // Somebody the role floor already excludes is shown as
                // out, and says why — a switch that is on for a person the
                // engine will never pick is the interface disagreeing with
                // itself.
                const belowFloor =
                  ACCOUNT_ROLES.indexOf(member.role) <
                  ACCOUNT_ROLES.indexOf(rules.minRole);
                // Your own row, always. Somebody else's, only as an admin —
                // the same rule `set_member_auto_assign` enforces.
                const mayToggle = canEdit || member.user_id === user?.id;

                return (
                  <li
                    key={member.user_id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <MemberAvatar
                      name={member.full_name || member.email}
                      avatarUrl={member.avatar_url}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm">
                        {member.full_name || member.email}
                      </p>
                      <p className="text-muted-foreground text-2xs truncate">
                        {belowFloor
                          ? t('belowFloor', { role: tRoles(rules.minRole) })
                          : tRoles(member.role)}
                      </p>
                    </div>
                    <Switch
                      checked={inRotation && !belowFloor}
                      disabled={!mayToggle || belowFloor || off}
                      onCheckedChange={(next) => toggleMember(member, next)}
                      aria-label={member.full_name || member.email || member.user_id}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}

function ModeCard({
  active,
  disabled,
  icon: Icon,
  title,
  body,
  onPick,
}: {
  active: boolean;
  disabled: boolean;
  icon: typeof Shuffle;
  title: string;
  body: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'surface-interactive flex w-full items-start gap-3 rounded-lg border p-3 text-left',
        active
          ? 'border-primary/40 bg-primary-soft'
          : 'border-border bg-card hover:bg-muted',
        disabled && 'pointer-events-none opacity-60'
      )}
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-md',
          active ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm font-semibold',
            active ? 'text-primary' : 'text-foreground'
          )}
        >
          {title}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
          {body}
        </span>
      </span>
    </button>
  );
}
