import {
  Bot,
  Coins,
  FileText,
  KeyRound,
  LayoutGrid,
  Palette,
  PlugZap,
  Megaphone,
  Shield,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'templates',
  'quick-replies',
  // Sits with the two above it on purpose: WhatsApp is the channel,
  // templates and quick replies are what a PERSON sends down it, and
  // this is what the MACHINE sends down it. Grouping it with "what gets
  // said" rather than with the integrations at the bottom is what makes
  // the rail readable without reading every label.
  'ai',
  'fields',
  'deals',
  'members',
  'api',
  // LAST, under the workspace group. It sat second, right under Overview,
  // on the theory that somebody arrives in Settings already holding the
  // question "what changed". They do — but not often, and the rail is read
  // top-down by people looking for a setting to change. A release log is
  // the one entry here that configures nothing, so it goes at the bottom
  // where the eye lands after failing to find what it came for.
  'whats-new',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: {
    id: 'overview',
    label: 'Overview',
    icon: LayoutGrid,
    group: 'top',
  },
  profile: {
    id: 'profile',
    label: 'Your profile',
    icon: User,
    group: 'account',
  },
  security: {
    id: 'security',
    label: 'Login & security',
    icon: Shield,
    group: 'account',
  },
  appearance: {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    group: 'account',
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: PlugZap,
    group: 'workspace',
  },
  templates: {
    id: 'templates',
    label: 'Templates',
    icon: FileText,
    group: 'workspace',
  },
  'quick-replies': {
    id: 'quick-replies',
    label: 'Quick replies',
    icon: Zap,
    group: 'workspace',
  },
  ai: { id: 'ai', label: 'AI agent', icon: Bot, group: 'workspace' },
  fields: {
    id: 'fields',
    label: 'Fields & tags',
    icon: Tags,
    group: 'workspace',
  },
  deals: {
    id: 'deals',
    label: 'Deals & currency',
    icon: Coins,
    group: 'workspace',
  },
  members: {
    id: 'members',
    label: 'Team members',
    icon: UsersRound,
    group: 'workspace',
  },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'workspace' },
  // `Megaphone`, not `Sparkles`. The sparkle is the house style for "AI did
  // this" across the whole product — it is on the draft-with-AI action, the
  // AI badge on a bubble and the Hermes card — and nothing on this page was
  // written by a machine. Borrowing it here would make the one icon that
  // means something mean nothing.
  'whats-new': {
    id: 'whats-new',
    label: "What's new",
    icon: Megaphone,
    group: 'workspace',
  },
};

export const RAIL_GROUPS: {
  label: string | null;
  group: SectionMeta['group'];
}[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  // The AI agent was the top-level route `/agents` before it moved in
  // here. next.config.ts redirects the old path; this covers anything
  // that reaches the query string by another road.
  if (raw === 'agents') return 'ai';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
