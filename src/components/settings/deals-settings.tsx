'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Coins, Loader2 } from 'lucide-react';
import {
  Panel,
  PanelHeader,
  PanelTitle,
  PanelSub,
  PanelBody,
} from '@/components/ui/panel';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { CURRENCIES } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';
import { OptionSelect } from '@/components/ui/option-select';

/**
 * Deals settings — account-wide default currency.
 *
 * One currency per account (issue #218): the chosen code seeds new
 * deals and formats every aggregated total. Existing deals keep their
 * own saved currency. Writes go straight to `accounts.default_currency`;
 * the `accounts_update` RLS policy (017) already restricts that to
 * admins+, so non-admins see a disabled, read-only control.
 */
export function DealsSettings() {
  const supabase = createClient();
  const {
    accountId,
    defaultCurrency,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [selected, setSelected] = useState(defaultCurrency);
  const [saving, setSaving] = useState(false);
  const t = useTranslations('Settings.deals');

  // Keep the select in sync once the profile (and its account default)
  // resolves, and after a save round-trips through refreshProfile.
  useEffect(() => {
    setSelected(defaultCurrency);
  }, [defaultCurrency]);

  const dirty = selected !== defaultCurrency;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await supabase
      .from('accounts')
      .update({ default_currency: selected })
      .eq('id', accountId);
    if (error) {
      toast.error(t('saveFailed'));
      setSaving(false);
      return;
    }
    // Pull the new value back into the auth context so the deal form
    // and every total pick it up without a full reload.
    await refreshProfile();
    setSaving(false);
    toast.success(t('saveSuccess'));
  }

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-(--dur-3)">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Panel>
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle className="flex items-center gap-2">
              <Coins className="text-primary size-4" />
              {t('defaultCurrency')}
            </PanelTitle>
            <PanelSub>{t('defaultCurrencyDesc')}</PanelSub>
          </div>
        </PanelHeader>
        <PanelBody className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <FieldLabel>{t('currencyLabel')}</FieldLabel>
            <OptionSelect
              value={selected}
              onValueChange={setSelected}
              disabled={!canEditSettings || profileLoading}
              className="border-border bg-muted text-foreground"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </OptionSelect>
            {!canEditSettings && (
              <p className="text-muted-foreground text-xs">
                {t('adminOnlyHint')}
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          )}
        </PanelBody>
      </Panel>
    </section>
  );
}
