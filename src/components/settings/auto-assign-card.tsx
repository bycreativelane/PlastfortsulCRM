'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Shuffle } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import { Panel, PanelBody } from '@/components/ui/panel';
import { Switch } from '@/components/ui/switch';

/**
 * "Quem atende a próxima?"
 *
 * One switch, because there is one decision. The rotation itself has no
 * options worth exposing — it goes round the members who are online, in
 * order, skipping nobody and repeating nobody (see
 * `@/lib/conversations/auto-assign`) — and every knob that could be added
 * here is a way for the team to end up with a routing rule nobody remembers
 * agreeing to.
 *
 * OFF BY DEFAULT, and it stays that way until somebody turns it on. A CRM
 * that starts silently routing conversations to people on the day it is
 * installed is a CRM the team stops trusting, and the account column
 * (migration 045) defaults to `'off'` for the same reason.
 *
 * Lives under Team members rather than in its own section: it is a fact
 * about how this team divides work, and the roster it divides work between
 * is the list directly underneath.
 */
export function AutoAssignCard() {
  const t = useTranslations('Settings.autoAssign');
  const { accountId } = useAuth();
  const canEdit = useCan('manage-members');

  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** True when migration 045 has not been applied yet. */
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await createClient()
        .from('accounts')
        .select('auto_assign_mode')
        .eq('id', accountId)
        .maybeSingle();

      if (cancelled) return;
      setLoading(false);

      if (error) {
        // The column arrives with 045, which is applied by hand. Saying so
        // beats a dead switch or a raw database string — the same courtesy
        // `occurrence-dialog.tsx` extends for its own migration.
        setPending(isUnknownColumn(error));
        return;
      }
      setEnabled(data?.auto_assign_mode === 'round_robin');
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!accountId || saving) return;
      setSaving(true);
      // Optimistic: the switch is the one control on screen and a switch
      // that waits for a round trip before moving feels broken.
      setEnabled(next);

      const { error } = await createClient()
        .from('accounts')
        .update({ auto_assign_mode: next ? 'round_robin' : 'off' })
        .eq('id', accountId);

      setSaving(false);
      if (error) {
        setEnabled(!next);
        setPending(isUnknownColumn(error));
        toast.error(
          isUnknownColumn(error) ? t('needsMigration') : t('saveFailed')
        );
        return;
      }
      toast.success(next ? t('turnedOn') : t('turnedOff'));
    },
    [accountId, saving, t]
  );

  if (loading) return null;

  return (
    <Panel>
      <PanelBody>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-muted text-primary grid size-8 shrink-0 place-items-center rounded-md">
              <Shuffle className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-foreground text-sm font-semibold">
                {t('title')}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                {pending ? t('needsMigration') : t('description')}
              </p>
            </div>
          </div>

          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            disabled={!canEdit || saving || pending}
            aria-label={t('title')}
            className="mt-0.5 shrink-0"
          />
        </div>
      </PanelBody>
    </Panel>
  );
}
