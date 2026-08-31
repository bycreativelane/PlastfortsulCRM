import type { ComponentType } from 'react';
import {
  Bot,
  Coins,
  FileText,
  KeyRound,
  LayoutGrid,
  Palette,
  Megaphone,
  MessagesSquare,
  Shield,
  MessageSquareText,
  Shuffle,
  Sparkles,
  ShieldCheck,
  Tags,
  User,
  UsersRound,
  Webhook,
} from 'lucide-react';

import type { Capability } from '@/lib/auth/capabilities';
import { WhatsAppMark } from '@/components/whatsapp-mark';

/**
 * Configurações: one door, and permissions decide what is behind it.
 *
 * ------------------------------------------------------------------
 * THE SPLIT, AND WHY IT CAME BACK
 * ------------------------------------------------------------------
 *
 * For one release this was two destinations: `/settings` for what is
 * yours and `/admin` for the account's structure. The reasoning was
 * sound — eighteen sections are not eighteen of the same thing, and the
 * most dangerous screens in the product sat one scroll below "Aparência".
 *
 * The reasoning was sound and the answer was wrong, because it solved a
 * VISIBILITY problem with a LOCATION one. Two doors means somebody has
 * to know which door a setting is behind before they can look for it,
 * and the answer ("is this about you or about the company?") is obvious
 * only to whoever drew the line. Templates are yours; who may approve
 * one is the company's. Same screen.
 *
 * So: one rail, and a section appears if the person can actually use it.
 * An agent's rail is seven rows and every one of them does something; an
 * admin's is eighteen, in four groups. Nobody has to guess a door, and
 * nobody is shown a row that will refuse them.
 *
 * ------------------------------------------------------------------
 * A CAPABILITY, NOT A ROLE
 * ------------------------------------------------------------------
 *
 * `capability` rather than `minRole`, and it is worth being exact about
 * what that buys, because the obvious answer is wrong.
 *
 * It does NOT mean an account can hand one section to one agent. Every
 * gated section here is behind `settings.manage`, which is rls-backed:
 * `can()` refuses to widen an rls-backed capability past the role,
 * because the policy in the database would refuse the write anyway and
 * the screen would load and then fail to save. So the floor is the role,
 * always.
 *
 * What it DOES buy is the other direction. An override that takes a
 * capability away is honoured, so an account can hide Webhooks or the AI
 * keys from its admins and leave them with the rest — a real thing to
 * want, and impossible if this table named a role.
 *
 * `section-links.test.ts` pins both directions, and it pins them because
 * the first version of this file got it backwards: Acesso was gated on
 * `audit.view` on the theory that a non-rls-backed capability made it
 * grantable. It is not. `AccessPanel` refuses anyone below admin on its
 * own, and `/api/account/audit` calls `requireRole('admin')` — so the
 * grant produced a rail row that opened a refusal, which is the exact
 * thing this design says never to draw.
 *
 * Undefined means everybody. Not "no gate by oversight" — the sections
 * without one are the four that are about the person reading them, plus
 * the two an attendant uses during a shift, plus the release notes.
 *
 * AND THIS IS THE COURTESY, NEVER THE CONTROL. Each panel refuses on its
 * own, and so does the policy behind it. Hiding a row stops somebody
 * being shown a thing that will say no; it does not stop anybody who
 * types the URL, and it is not supposed to.
 */
export const SETTINGS_SECTIONS = [
  'overview',

  // ---- Yours -------------------------------------------------------
  'profile',
  'security',
  'appearance',

  // ---- The channel, and what goes down it --------------------------
  'whatsapp',
  'templates',
  // `MessageSquareText`, not `Zap`. The lightning is Automações' mark in
  // the left nav, and a saved sentence is the opposite of a thing that
  // fires by itself: somebody picks it, edits it and sends it. One glyph
  // cannot mean "runs without you" and "you run it" on the same screen.
  'quick-replies',
  'ai',
  // Right after the agent, and separate from it on purpose. The agent
  // answers customers by itself; these read what arrived and hand words
  // to a PERSON. Until 057 both hung off one switch, so "no robots
  // talking to my customers" also meant "no audio transcribed".
  'ai-tools',
  'assignment',
  'rooms',

  // ---- The account's own shape -------------------------------------
  'fields',
  'deals',
  'members',
  // Right after the roster, because it is the roster's other half: the
  // Team tab answers "who is here", this one answers "what may they do"
  // and "what have they done". Somebody arrives at the second question
  // from the first, every time.
  'access',
  // Beside API keys, because it is the same question from the other
  // direction: that one is how the CRM is read from outside, this one is
  // how the outside writes into it.
  'hooks',
  'api',
  // LAST. It sat second, right under Overview, on the theory that
  // somebody arrives in Configurações already holding the question "what
  // changed". They do — but not often, and the rail is read top-down by
  // people looking for a setting to change. A release log is the one
  // entry here that configures nothing, so it goes at the bottom where
  // the eye lands after failing to find what it came for.
  'whats-new',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

export interface SectionMeta {
  id: SettingsSection;
  label: string;
  /**
   * Widened from `LucideIcon` so a brand mark can sit in this table.
   *
   * Every consumer — the rail and the Overview tiles — renders this as
   * `<Icon className="size-4" />` and nothing else, so the contract was
   * always "something that takes a className". Saying that out loud is
   * what lets `WhatsAppMark` in without wrapping it in a fake lucide
   * `forwardRef` to satisfy a type nobody was using.
   */
  icon: ComponentType<{ className?: string }>;
  group: 'top' | 'account' | 'channel' | 'workspace';
  /**
   * What you must be able to do for this row to appear.
   *
   * Undefined = everybody. See the header: this is what replaced the
   * two-destination split, and it is a courtesy rather than a control.
   */
  capability?: Capability;
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

  // The logo, not a plug. This row and its tile on the Overview landing
  // are the two places in the product that ARE the WhatsApp connection,
  // and `PlugZap` is a stand-in you have to read the label to identify.
  // One `SECTION_META` entry feeds both surfaces.
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: WhatsAppMark,
    group: 'channel',
    capability: 'settings.manage',
  },
  // Ungated, as it has always been: an attendant picks a template in the
  // inbox and needs to know what is in the list. The panel's own write
  // controls are gated inside it.
  templates: {
    id: 'templates',
    label: 'Templates',
    icon: FileText,
    group: 'channel',
  },
  'quick-replies': {
    id: 'quick-replies',
    label: 'Quick replies',
    icon: MessageSquareText,
    group: 'channel',
  },
  ai: {
    id: 'ai',
    label: 'AI agent',
    icon: Bot,
    group: 'channel',
    capability: 'settings.manage',
  },
  'ai-tools': {
    id: 'ai-tools',
    label: 'AI tools',
    icon: Sparkles,
    group: 'channel',
    capability: 'settings.manage',
  },
  assignment: {
    id: 'assignment',
    label: 'Assignment',
    icon: Shuffle,
    group: 'channel',
    capability: 'settings.manage',
  },
  rooms: {
    id: 'rooms',
    label: 'Team rooms',
    icon: MessagesSquare,
    group: 'channel',
    capability: 'settings.manage',
  },

  fields: {
    id: 'fields',
    label: 'Fields & tags',
    icon: Tags,
    group: 'workspace',
    capability: 'settings.manage',
  },
  deals: {
    id: 'deals',
    label: 'Deals & currency',
    icon: Coins,
    group: 'workspace',
    capability: 'settings.manage',
  },
  members: {
    id: 'members',
    label: 'Team members',
    icon: UsersRound,
    group: 'workspace',
    capability: 'settings.manage',
  },
  // `settings.manage`, matching what the panel behind it actually
  // enforces. It was `audit.view` — see the header: the theory was that
  // a non-rls-backed capability made this section grantable to one
  // person, and both `AccessPanel` and the audit API refuse below admin,
  // so the grant only ever produced a row that opened "Acesso restrito".
  // A gate must name the thing the screen will really ask for.
  access: {
    id: 'access',
    label: 'Access & audit',
    icon: ShieldCheck,
    group: 'workspace',
    capability: 'settings.manage',
  },
  hooks: {
    id: 'hooks',
    label: 'Webhooks',
    icon: Webhook,
    group: 'workspace',
    capability: 'settings.manage',
  },
  api: {
    id: 'api',
    label: 'API keys',
    icon: KeyRound,
    group: 'workspace',
    capability: 'settings.manage',
  },
  // `Megaphone`, not `Sparkles`. The sparkle is the house style for "AI did
  // this" across the whole product — it is on the draft-with-AI action, the
  // AI badge on a bubble and the Hermes card — and nothing on this page was
  // written by a machine. Borrowing it here would make the one icon that
  // means something mean nothing.
  //
  // Ungated. It was admin-only for the one release the split lasted,
  // which meant an attendant could never find out what had changed in
  // the product they use all day. It configures nothing.
  'whats-new': {
    id: 'whats-new',
    label: "What's new",
    icon: Megaphone,
    group: 'workspace',
  },
};

/**
 * The sections this person can actually use, in registry order.
 *
 * `can` is passed in rather than read from a hook so this stays a pure
 * function — the rail, the Overview tiles and the page's own gate all
 * ask the same question and must not be able to answer it differently.
 */
export function visibleSections(
  can: (capability: Capability) => boolean
): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => {
    const capability = SECTION_META[s].capability;
    return !capability || can(capability);
  });
}

/** Whether one section is reachable by this person. */
export function canSeeSection(
  section: SettingsSection,
  can: (capability: Capability) => boolean
): boolean {
  const capability = SECTION_META[section].capability;
  return !capability || can(capability);
}

/**
 * The href for a section, built from the registry rather than typed.
 *
 * It used to have a real decision to make — the split put twelve
 * sections behind `/admin`, and six hand-written links stayed pointing
 * at the old door and quietly resolved to the Overview landing with the
 * URL still naming the section. There is one door again, so this is now
 * a one-line function; it stays because `section-links.test.ts` uses the
 * same table to fail the build on a hand-written link that disagrees,
 * and because the next time somebody moves a section, the links move
 * with it.
 */
export function sectionHref(section: SettingsSection): string {
  return `/settings?tab=${section}`;
}

export const RAIL_GROUPS: {
  label: string | null;
  group: SectionMeta['group'];
}[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  // Four groups rather than three, now that one rail carries everything.
  // "Espaço de trabalho" holding fifteen rows is a list you read by
  // scanning for a word, not a structure. Split at the seam that was
  // already in the array: what goes out to a customer, and what shapes
  // the account.
  { label: 'Channel', group: 'channel' },
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
