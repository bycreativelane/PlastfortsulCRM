// ============================================================
// Per-person exceptions, over the role.
//
// `roles.ts` answers "what can an admin do", which is the right question
// for four people and the wrong one for the fifth. This file answers
// "what can THIS person do" — the role's answer, unless somebody has
// written an exception for them in `profiles.permission_overrides`
// (migration 050).
//
// The shape is deliberately small:
//
//     effective(cap) = override[cap] ?? hasMinRole(role, MIN_ROLE[cap])
//
// An absent key means "ask the role", which is what makes this safe to
// add to a live account: an account nobody has configured behaves
// exactly as it did before the column existed, and a capability added
// next year defaults to the role rather than to a blank.
//
// ------------------------------------------------------------
// WHAT THIS IS NOT
// ------------------------------------------------------------
//
// It is not row-level security. RLS decides what the database will hand
// over and RLS knows only about `account_role`; these overrides are
// enforced here, in the interface, and in this app's own API routes.
//
// That is the same strength as the gate on /relatórios has today, and it
// is enough for "o Vitor não precisa ver isso". It is not enough for "o
// Vitor não pode ver isso, de jeito nenhum" — somebody holding the
// account's anon key still gets whatever their ROLE allows. Where the
// difference matters, the answer is the role.
//
// `rlsBacked` below marks the capabilities where the database ALSO says
// no. For those, an override can only ever take something away: granting
// one to a role the database refuses produces an interface that offers a
// button and a request that fails.
// ============================================================

import { hasMinRole, type AccountRole } from './roles';

export type Capability =
  /** The shared inbox. */
  | 'inbox.view'
  /** Contacts, and the CRM board they sit on. */
  | 'contacts.view'
  /** Download the contact list. */
  | 'contacts.export'
  /** The Kanban. */
  | 'pipelines.view'
  /** The product catalogue. */
  | 'products.view'
  /** The commercial reference: scripts, objections, operating rules. */
  | 'playbook.view'
  /** Compose and send a broadcast. */
  | 'broadcasts.send'
  /** Create, edit and activate automations. */
  | 'automations.manage'
  /** Create, edit and activate flows. */
  | 'flows.manage'
  /** /relatórios — period totals, per-user conversion, value closed. */
  | 'reports.view'
  /** Account-wide settings: WhatsApp, templates, tags, fields. */
  | 'settings.manage'
  /** Write in the team room. Reading it is every member's. */
  | 'team-room.write'
  /** The audit log and the permission screen this file feeds. */
  | 'audit.view';

export interface CapabilityMeta {
  /** The role that gets this capability when nobody has said otherwise. */
  minRole: AccountRole;
  /**
   * True when a policy in the database enforces the same thing.
   *
   * These are the capabilities an override can only NARROW. Granting one
   * to somebody the database refuses draws a control that produces an
   * error — worse than not drawing it, because the person tries.
   */
  rlsBacked: boolean;
  /** i18n key under `Settings.permissions.caps`. */
  labelKey: string;
}

/**
 * The closed vocabulary. Adding a capability = one entry here, one
 * label in the three catalogues, and one call site.
 *
 * `minRole` mirrors what `roles.ts` and the routes already do today, so
 * that an account with no overrides gets byte-identical behaviour. Where
 * this file and a route disagree, the route is the bug.
 */
export const CAPABILITIES: Record<Capability, CapabilityMeta> = {
  'inbox.view': { minRole: 'viewer', rlsBacked: true, labelKey: 'inboxView' },
  'contacts.view': {
    minRole: 'viewer',
    rlsBacked: true,
    labelKey: 'contactsView',
  },
  // `viewer`, deliberately the lowest floor in the product. The base
  // exists to be READ during a conversation, and the person most likely
  // to need "o que respondo quando ele reclama do preço" is the one with
  // the least seniority. Writing is a different question and it is not
  // this capability's — migration 064 puts INSERT/UPDATE/DELETE behind
  // `admin` in RLS, so the edit buttons are gated by the database and
  // not by this flag.
  'playbook.view': {
    minRole: 'viewer',
    rlsBacked: true,
    labelKey: 'playbookView',
  },
  'contacts.export': {
    minRole: 'agent',
    rlsBacked: false,
    labelKey: 'contactsExport',
  },
  'pipelines.view': {
    minRole: 'viewer',
    rlsBacked: true,
    labelKey: 'pipelinesView',
  },
  // Reading the catalogue is every member's — a price somebody cannot
  // look up is a price they ask a colleague for. Writing it is split
  // between agent (correct) and admin (create, retire) by migration 055,
  // which is a finer distinction than one capability can carry, so this
  // one is about the ROW in the menu.
  'products.view': {
    minRole: 'viewer',
    rlsBacked: true,
    labelKey: 'productsView',
  },
  'broadcasts.send': {
    minRole: 'agent',
    rlsBacked: true,
    labelKey: 'broadcastsSend',
  },
  'automations.manage': {
    minRole: 'agent',
    rlsBacked: true,
    labelKey: 'automationsManage',
  },
  'flows.manage': {
    minRole: 'agent',
    rlsBacked: true,
    labelKey: 'flowsManage',
  },
  'reports.view': {
    minRole: 'admin',
    rlsBacked: false,
    labelKey: 'reportsView',
  },
  'settings.manage': {
    minRole: 'admin',
    rlsBacked: true,
    labelKey: 'settingsManage',
  },
  'team-room.write': {
    minRole: 'agent',
    rlsBacked: true,
    labelKey: 'teamRoomWrite',
  },
  'audit.view': { minRole: 'admin', rlsBacked: false, labelKey: 'auditView' },
};

/** Every capability, in the order the settings panel lists them. */
export const CAPABILITY_LIST = Object.keys(CAPABILITIES) as Capability[];

/** What `profiles.permission_overrides` holds. */
export type PermissionOverrides = Partial<Record<Capability, boolean>>;

/** Type-narrow a string coming out of the database or a request body. */
export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && value in CAPABILITIES;
}

/**
 * Throw away anything that is not a known capability with a boolean
 * value.
 *
 * The column is `jsonb` with only a "must be an object" check on it, so
 * this is the boundary where an old key from a removed capability, or a
 * hand-edited row, stops being able to confuse a reader. Silent rather
 * than loud: a stale key is not an error, it is a capability that no
 * longer exists.
 */
export function parseOverrides(raw: unknown): PermissionOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PermissionOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isCapability(key) && typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * What the role alone says. Kept separate from `can` so the settings
 * panel can show the two side by side — "admins podem" next to a switch
 * that is off for this one person is what makes the screen legible.
 */
export function roleGrants(role: AccountRole, cap: Capability): boolean {
  return hasMinRole(role, CAPABILITIES[cap].minRole);
}

/**
 * The answer for one person.
 *
 * `??` and not `||`: an override of `false` has to win over a role that
 * says yes, and `||` would quietly discard exactly that case — which is
 * the whole reason somebody opened the screen.
 */
export function can(
  role: AccountRole | null | undefined,
  overrides: PermissionOverrides | null | undefined,
  cap: Capability
): boolean {
  if (!role) return false;
  const override = overrides?.[cap];
  if (typeof override === 'boolean') {
    // A grant the database will refuse is not a grant. Better to answer
    // "no" here than to draw the control and let the request fail — the
    // person has already committed to the action by then.
    if (override && CAPABILITIES[cap].rlsBacked && !roleGrants(role, cap)) {
      return false;
    }
    return override;
  }
  return roleGrants(role, cap);
}

/**
 * Whether this capability can be granted to somebody the role does not
 * already give it to. Drives the disabled state on the settings switch,
 * so the interface never offers a promise the database will break.
 */
export function canBeGranted(role: AccountRole, cap: Capability): boolean {
  return !CAPABILITIES[cap].rlsBacked || roleGrants(role, cap);
}
