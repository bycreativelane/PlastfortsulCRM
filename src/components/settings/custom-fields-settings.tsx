'use client';

import { Shield, SlidersHorizontal } from 'lucide-react';
import {
  Panel,
  PanelHeader,
  PanelTitle,
  PanelSub,
  PanelBody,
} from '@/components/ui/panel';

import { useTranslations } from 'next-intl';
import { CustomFieldsPanel } from '@/components/contacts/custom-fields-manager';
import { SettingsChip } from './settings-chip';

/**
 * Settings → Custom Fields card. Manages the account-wide custom
 * contact field catalogue (the same panel the Contacts page exposes
 * via a dialog). Writes are admin-gated by the caller and enforced by
 * `custom_fields` RLS.
 */
export function CustomFieldsSettings() {
  const t = useTranslations('Settings.tagsAndFields');
  
  return (
    <Panel>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-primary" />
            {t('fieldsTitle')}
            <SettingsChip variant="admin" className="font-medium">
              <Shield />
              {t('adminRole')}
            </SettingsChip>
          </PanelTitle>
          <PanelSub>
            {t('fieldsDesc')}
          </PanelSub>
        </div>
      </PanelHeader>
      <PanelBody>
        <CustomFieldsPanel />
      </PanelBody>
    </Panel>
  );
}
