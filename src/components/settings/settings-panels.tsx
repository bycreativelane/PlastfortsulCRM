'use client';

import type { ReactNode } from 'react';

import type { SettingsSection } from '@/components/settings/settings-sections';
import { AccessPanel } from '@/components/settings/access-panel';
import { AiAgentPanel } from '@/components/settings/ai-agent-panel';
import { AiToolsPanel } from '@/components/settings/ai-tools-panel';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { AssignmentPanel } from '@/components/settings/assignment-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { HooksPanel } from '@/components/settings/hooks-panel';
import { MembersTab } from '@/components/settings/members-tab';
import { ProfileForm } from '@/components/settings/profile-form';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { RoomsPanel } from '@/components/settings/rooms-panel';
import { SecurityPanel } from '@/components/settings/security-panel';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { TemplateManager } from '@/components/settings/template-manager';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { WhatsNewPanel } from '@/components/settings/whats-new-panel';

/**
 * Section → panel, in one table for both destinations.
 *
 * `/settings` and `/admin` are two doors onto the same set of panels —
 * which door a section is behind is a property of the section
 * (`SectionMeta.area`), not of the page. Keeping the mapping here means
 * moving a section between the two is one flag, and cannot leave a
 * section reachable in a rail with nothing to render.
 */
export function panelFor(
  section: SettingsSection,
  onSelect: (next: SettingsSection) => void
): ReactNode {
  switch (section) {
    case 'overview':
      return <SettingsOverview onSelect={onSelect} />;
    case 'whats-new':
      return <WhatsNewPanel />;
    case 'profile':
      return <ProfileForm />;
    case 'security':
      return <SecurityPanel />;
    case 'appearance':
      return <AppearancePanel />;
    case 'whatsapp':
      return <WhatsAppConfig />;
    case 'templates':
      return <TemplateManager />;
    case 'quick-replies':
      return <QuickRepliesManager />;
    case 'ai':
      return <AiAgentPanel />;
    case 'ai-tools':
      return <AiToolsPanel />;
    case 'hooks':
      return <HooksPanel />;
    case 'fields':
      return <FieldsAndTagsPanel />;
    case 'deals':
      return <DealsSettings />;
    case 'members':
      return <MembersTab />;
    case 'access':
      return <AccessPanel />;
    case 'assignment':
      return <AssignmentPanel />;
    case 'rooms':
      return <RoomsPanel />;
    case 'api':
      return <ApiKeysSettings />;
  }
}
