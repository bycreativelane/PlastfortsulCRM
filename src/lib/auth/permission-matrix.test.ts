import { describe, it, expect } from 'vitest';

import {
  EMPTY_MATRIX,
  personCan,
  roleCan,
  type PermissionMatrix,
} from './permission-matrix';

/**
 * The three layers, and the one that never moves.
 *
 * A permission bug is silent in the worst direction: nobody reports
 * being able to do something they should not, so a matrix that grants
 * too much is discovered by an auditor, not by a user.
 */

const matrix = (
  overrides: Record<string, boolean> = {},
  custom: PermissionMatrix['custom'] = []
): PermissionMatrix => ({
  overrides: new Map(Object.entries(overrides)),
  custom,
});

describe('roleCan — layer 1, the product default', () => {
  it('an account with no exceptions behaves exactly as before 061', () => {
    // `contacts.export` ships as agent-and-up.
    expect(roleCan(EMPTY_MATRIX, 'agent', 'contacts.export')).toBe(true);
    expect(roleCan(EMPTY_MATRIX, 'viewer', 'contacts.export')).toBe(false);
  });

  it('a capability nobody defined is nobody’s', () => {
    expect(roleCan(EMPTY_MATRIX, 'owner', 'nao.existe')).toBe(false);
  });
});

describe('roleCan — layer 2, the account narrows', () => {
  it('takes a capability away from a role', () => {
    const m = matrix({ 'agent:contacts.export': false });
    expect(roleCan(m, 'agent', 'contacts.export')).toBe(false);
    // Untouched roles keep the default.
    expect(roleCan(m, 'admin', 'contacts.export')).toBe(true);
  });

  it('grants one the code did not, when the database does not care', () => {
    // `contacts.export` is not rls-backed — the export runs in the app.
    const m = matrix({ 'viewer:contacts.export': true });
    expect(roleCan(m, 'viewer', 'contacts.export')).toBe(true);
  });

  /**
   * THE ONE THAT WOULD BE A BUG YOU SEE AS A USER.
   *
   * `inbox.view` is enforced by a policy. Granting it to a viewer the
   * database refuses would draw a screen that loads nothing — and the
   * person would blame themselves, not the setting.
   */
  it('refuses to WIDEN a capability the database also enforces', () => {
    const m = matrix({ 'viewer:inbox.view': true });
    // Viewer already has inbox.view by default, so use one that is
    // rls-backed AND above viewer to make the point.
    const narrowed = matrix({ 'viewer:products.view': true });
    expect(roleCan(narrowed, 'viewer', 'products.view')).toBe(
      roleCan(EMPTY_MATRIX, 'viewer', 'products.view')
    );
    expect(roleCan(m, 'viewer', 'inbox.view')).toBe(true);
  });

  it('but narrowing an rls-backed one is always honoured', () => {
    const m = matrix({ 'agent:inbox.view': false });
    expect(roleCan(m, 'agent', 'inbox.view')).toBe(false);
  });
});

describe('roleCan — custom capabilities', () => {
  const custom = [
    {
      id: '1',
      key: 'desconto.acima_de_10',
      label: 'Desconto acima de 10%',
      description: null,
      minRole: 'admin' as const,
    },
  ];

  it('falls back to its own minRole', () => {
    const m = matrix({}, custom);
    expect(roleCan(m, 'admin', 'desconto.acima_de_10')).toBe(true);
    expect(roleCan(m, 'agent', 'desconto.acima_de_10')).toBe(false);
  });

  /**
   * A custom key has no policy behind it by definition — nothing in the
   * database knows the name — so the matrix is the only authority and
   * may widen freely.
   */
  it('can be granted to a lower role, unlike an rls-backed one', () => {
    const m = matrix({ 'agent:desconto.acima_de_10': true }, custom);
    expect(roleCan(m, 'agent', 'desconto.acima_de_10')).toBe(true);
  });
});

describe('personCan — layer 3, one individual', () => {
  it('a personal override beats the account matrix', () => {
    const m = matrix({ 'agent:contacts.export': false });
    expect(personCan(m, 'agent', { 'contacts.export': true }, 'contacts.export')).toBe(
      true
    );
  });

  it('and beats it downward too', () => {
    const m = matrix({ 'agent:contacts.export': true });
    expect(
      personCan(m, 'agent', { 'contacts.export': false }, 'contacts.export')
    ).toBe(false);
  });

  it('falls through to the matrix when the person has no say', () => {
    const m = matrix({ 'agent:contacts.export': false });
    expect(personCan(m, 'agent', {}, 'contacts.export')).toBe(false);
  });

  it('still cannot widen what the database enforces', () => {
    const m = EMPTY_MATRIX;
    // A viewer granted `broadcasts.send` personally: the policy refuses,
    // so the interface must not offer it.
    const granted = personCan(m, 'viewer', { 'broadcasts.send': true }, 'broadcasts.send');
    expect(granted).toBe(roleCan(m, 'viewer', 'broadcasts.send'));
  });
});
