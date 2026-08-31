"use client";

import { useAuth } from "@/hooks/use-auth";
import { can, type Capability } from "@/lib/auth/capabilities";
import {
  canDeleteAccount,
  canEditSettings,
  canManageMembers,
  canSendMessages,
  canTransferOwnership,
  canViewOnly,
} from "@/lib/auth/roles";

/**
 * Typed action keys for `useCan`. Adding a capability = one new
 * entry here + one new case in the switch below + (usually) one
 * new predicate in `@/lib/auth/roles`. Keeping the list closed
 * lets the compiler catch typos at every call site.
 */
export type CanAction =
  | "manage-members"
  | "edit-settings"
  | "send-messages"
  | "view-only"
  | "delete-account"
  | "transfer-ownership";

/**
 * Inline alternative to `<RequireRole>` for places that need a
 * boolean rather than a render conditional — typically disabled-
 * state on buttons, the readOnly flag on inputs, or controlling
 * tooltip copy ("Read-only" vs the action label).
 *
 * Returns `false` while `profileLoading` is true so transient
 * "you can!" flashes never appear to under-privileged users.
 *
 * Example:
 *   const canEdit = useCan("edit-settings");
 *   <Button disabled={!canEdit} title={canEdit ? "Save" : "Read-only"} />
 */
export function useCan(action: CanAction): boolean {
  const { profileLoading, accountRole } = useAuth();
  if (profileLoading || !accountRole) return false;

  switch (action) {
    case "manage-members":
      return canManageMembers(accountRole);
    case "edit-settings":
      return canEditSettings(accountRole);
    case "send-messages":
      return canSendMessages(accountRole);
    case "view-only":
      return canViewOnly(accountRole);
    case "delete-account":
      return canDeleteAccount(accountRole);
    case "transfer-ownership":
      return canTransferOwnership(accountRole);
    default: {
      // Exhaustiveness check — adding a new `CanAction` without a
      // case here fails the typecheck because TS narrows `action`
      // to `never` in this branch. The runtime throw is unreachable
      // for valid inputs; it only fires if someone bypasses the
      // type system at the call site (e.g. with a wrong-typed cast).
      const _exhaustive: never = action;
      throw new Error(`Unknown CanAction: ${String(_exhaustive)}`);
    }
  }
}

/**
 * The same question, asked per PERSON rather than per role.
 *
 * `useCan` answers from the role alone, which is right for the four
 * capabilities the role system was built around and blind to the
 * exceptions somebody wrote in Configurações › Acesso. This one applies
 * both: the role is the base, `profiles.permission_overrides` is the
 * exception over it (migration 050).
 *
 * WHY BOTH HOOKS EXIST. `useCan` maps to predicates that RLS also
 * enforces — "can this role write a message" is a question the database
 * answers identically, and putting an overridable layer in front of it
 * would let the interface disagree with the database about a thing the
 * database decides. `useCapability` covers the surfaces the APP gates:
 * which sections appear in the rail, who reaches /relatórios, who sees
 * the audit log. See the note in `@/lib/auth/capabilities` for exactly
 * how far that goes and where it stops.
 *
 * Returns false while the profile is in flight, same as `useCan`, so a
 * gate never flashes open before settling.
 */
export function useCapability(capability: Capability): boolean {
  const { profileLoading, accountRole, permissionOverrides } = useAuth();
  if (profileLoading) return false;
  return can(accountRole, permissionOverrides, capability);
}

/**
 * The same answer as a predicate, for a caller that has a LIST to filter.
 *
 * `useCapability` is one hook per question, which is right at a call site
 * that asks one — and impossible at one that asks eighteen, since a hook
 * cannot go in a loop. The settings rail decides which of its rows to
 * draw from the section registry, so it needs the function rather than
 * the answer.
 *
 * `ready` is exposed rather than folded in. Every gate here returns false
 * while the profile is in flight, which is right for a button (better
 * disabled for a beat than briefly wrong) and wrong for a rail: the
 * ungated rows would paint first and the rest would pop in a moment
 * later. A caller that draws a list waits on `ready` instead.
 */
export function useCapabilityCheck(): {
  can: (capability: Capability) => boolean;
  ready: boolean;
} {
  const { profileLoading, accountRole, permissionOverrides } = useAuth();
  return {
    can: (capability: Capability) =>
      profileLoading ? false : can(accountRole, permissionOverrides, capability),
    ready: !profileLoading,
  };
}
