import type { SupabaseClient } from '@supabase/supabase-js';

import {
  CAPABILITIES,
  CAPABILITY_LIST,
  can as builtInCan,
  type Capability,
  type PermissionOverrides,
} from './capabilities';
import { hasMinRole, type AccountRole } from './roles';

/**
 * Who may do what, once the account has had its say.
 *
 * ------------------------------------------------------------------
 * THREE LAYERS, NARROWEST LAST
 * ------------------------------------------------------------------
 *
 *   1. THE CODE      `CAPABILITIES[x].minRole` — what the product ships
 *   2. THE ACCOUNT   `role_capabilities` — this company's exceptions
 *   3. THE PERSON    `profiles.permission_overrides` — one individual
 *
 * Each layer only speaks where it has something to say. A capability
 * with no row in layer 2 falls to layer 1, which is what makes an
 * account that never opened the screen behave exactly as before
 * migration 061 — the test every override table has to pass.
 *
 * ------------------------------------------------------------------
 * AND A LAYER THAT NEVER MOVES: THE DATABASE
 * ------------------------------------------------------------------
 *
 * `rlsBacked` capabilities are enforced by a policy as well. For those,
 * this matrix can only ever take something AWAY. Granting `inbox.view`
 * to a role the database refuses draws a screen that loads nothing —
 * worse than not drawing it, because the person tries and blames
 * themselves.
 *
 * `resolve` therefore refuses to widen an rls-backed capability past
 * what the code allows, and says so on the screen rather than silently
 * ignoring the setting.
 */

export interface CustomCapability {
  id: string;
  key: string;
  label: string;
  description: string | null;
  minRole: AccountRole;
}

export interface PermissionMatrix {
  /** `${role}:${capability}` → allowed. Only the exceptions. */
  overrides: Map<string, boolean>;
  custom: CustomCapability[];
}

export const EMPTY_MATRIX: PermissionMatrix = {
  overrides: new Map(),
  custom: [],
};

const key = (role: AccountRole, capability: string) => `${role}:${capability}`;

/**
 * Read both tables.
 *
 * NEVER THROWS AND NEVER RETURNS NULL. This is on the path of every
 * permission check in the app; a database blip must degrade to "the
 * product's own defaults", which is a working app, and never to "you
 * can do nothing", which is a locked one.
 */
export async function loadPermissionMatrix(
  db: SupabaseClient,
  accountId: string
): Promise<PermissionMatrix> {
  try {
    const [rolesRes, customRes] = await Promise.all([
      db
        .from('role_capabilities')
        .select('role, capability, allowed')
        .eq('account_id', accountId),
      db
        .from('account_capabilities')
        .select('id, key, label, description, min_role')
        .eq('account_id', accountId)
        .order('key'),
    ]);

    // Pre-061 both tables are missing and both errors mean the same
    // thing: this installation has not got the feature yet.
    const overrides = new Map<string, boolean>();
    for (const row of (rolesRes.data ?? []) as {
      role: AccountRole;
      capability: string;
      allowed: boolean;
    }[]) {
      overrides.set(key(row.role, row.capability), row.allowed);
    }

    const custom = ((customRes.data ?? []) as {
      id: string;
      key: string;
      label: string;
      description: string | null;
      min_role: AccountRole;
    }[]).map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      description: row.description,
      minRole: row.min_role,
    }));

    return { overrides, custom };
  } catch {
    return EMPTY_MATRIX;
  }
}

/**
 * Can this role do this thing, in this account?
 *
 * `capability` is a string rather than the `Capability` union because a
 * custom key is not in the union by definition — it did not exist when
 * the code was compiled. An unknown key that is not custom either
 * answers FALSE: a permission nobody defined is not a permission
 * everybody has.
 */
export function roleCan(
  matrix: PermissionMatrix,
  role: AccountRole,
  capability: string
): boolean {
  const override = matrix.overrides.get(key(role, capability));

  const custom = matrix.custom.find((c) => c.key === capability);
  if (custom) {
    return override ?? hasMinRole(role, custom.minRole);
  }

  const meta = CAPABILITIES[capability as Capability];
  if (!meta) return false;

  const byCode = hasMinRole(role, meta.minRole);

  if (override === undefined) return byCode;

  // AN RLS-BACKED CAPABILITY CANNOT BE WIDENED HERE.
  //
  // The policy in the database will refuse regardless, so honouring a
  // `true` would draw a control that produces an error. Narrowing is
  // always allowed: taking something away in the interface when the
  // database would have allowed it is a real, safe choice.
  if (meta.rlsBacked && override === true) return byCode;

  return override;
}

/** The same question for a specific person, personal overrides last. */
export function personCan(
  matrix: PermissionMatrix,
  role: AccountRole,
  personal: PermissionOverrides,
  capability: string
): boolean {
  const custom = matrix.custom.find((c) => c.key === capability);

  // A personal override wins over the account's matrix — it is the
  // narrower statement, made about one person on purpose.
  const individual = (personal as Record<string, boolean | undefined>)[
    capability
  ];

  if (custom) {
    return individual ?? roleCan(matrix, role, capability);
  }

  const meta = CAPABILITIES[capability as Capability];
  if (!meta) return false;

  if (individual !== undefined) {
    if (meta.rlsBacked && individual === true) {
      // Same rule as above, one layer down.
      return builtInCan(role, {}, capability as Capability);
    }
    return individual;
  }

  return roleCan(matrix, role, capability);
}

/** Everything a screen can ask about: the built-ins plus this account's. */
export function allCapabilityKeys(matrix: PermissionMatrix): string[] {
  return [...CAPABILITY_LIST, ...matrix.custom.map((c) => c.key)];
}
