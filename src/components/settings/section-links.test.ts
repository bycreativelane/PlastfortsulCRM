import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  CAPABILITIES,
  CAPABILITY_LIST,
  can,
  type Capability,
} from '@/lib/auth/capabilities';
import type { AccountRole } from '@/lib/auth/roles';
import {
  DEFAULT_SECTION,
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  canSeeSection,
  resolveSection,
  sectionHref,
  visibleSections,
  type SettingsSection,
} from './settings-sections';

/**
 * Configurações is one destination, and permissions decide the rows.
 *
 * ------------------------------------------------------------------
 * THE BUG THIS FILE WAS BORN FOR
 * ------------------------------------------------------------------
 *
 * When the settings split shipped, twelve sections moved to `/admin`
 * and six hand-written links stayed pointing at `/settings`. None of
 * them 404'd. All six resolved to the Overview landing, silently, with
 * the URL still naming the section the person had asked for — nothing
 * failed, no console said anything, and the only way to find it was to
 * click all six.
 *
 * The split is gone, so the six-links failure cannot recur in that
 * shape. What remains is the same class of problem one level down: a
 * link that names a section nobody defined, a section in a group the
 * rail does not render, or a gate that hides the very row the page
 * falls back to. All three are silent, and all three are checkable.
 */

const SRC = join(process.cwd(), 'src');

/** Every `.ts`/`.tsx` under src/, tests included. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments blanked out, offsets preserved.
 *
 * Prose talks about these links constantly — this file's own header
 * does, `proxy.ts` explains a redirect in terms of one, and
 * `next.config.ts` documents the `/admin` hop. A check that cannot tell
 * a link from a sentence about a link forces everybody to write worse
 * comments, which is a bad trade for a static check to demand.
 *
 * Character by character rather than by regex, because the naive
 * version eats the `//` in every `https://` it passes.
 */
function stripComments(text: string): string {
  const out = text.split('');
  let i = 0;
  let quote: string | null = null;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
      continue;
    }

    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      while (i < stop) {
        // Newlines stay, so a failure still reports a sane line count.
        if (out[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      continue;
    }

    i += 1;
  }

  return out.join('');
}

const LINK = /["'`](\/(settings|admin))\?tab=([a-z-]+)["'`]/g;

interface FoundLink {
  file: string;
  path: string;
  tab: string;
}

function collect(): FoundLink[] {
  const found: FoundLink[] = [];
  for (const file of sourceFiles(SRC)) {
    // This file is nothing but example links.
    if (file.endsWith('section-links.test.ts')) continue;
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(LINK)) {
      found.push({
        file: file.slice(SRC.length + 1).replace(/\\/g, '/'),
        path: m[1],
        tab: m[3],
      });
    }
  }
  return found;
}

/** A legacy `?tab=` value `resolveSection` still maps. */
const LEGACY = new Set(['tags', 'custom-fields', 'agents']);

describe('the links in the app', () => {
  it('finds them at all — a green run on zero matches proves nothing', () => {
    // If the regex ever stops matching (a refactor to `?section=`, say),
    // every assertion below passes vacuously and the check silently
    // stops guarding anything. So the count itself is asserted.
    expect(collect().length).toBeGreaterThan(0);
  });

  /**
   * `/admin` is a `redirects()` entry now, not a route. A link still
   * pointing there works — and costs a round trip on every click, for a
   * path the config comment calls temporary.
   */
  it('none still points at the door that was removed', () => {
    const stale = collect().filter((l) => l.path === '/admin');
    expect(stale.map((l) => `${l.file}: ${l.path}?tab=${l.tab}`)).toEqual([]);
  });

  it('none names a section that does not exist', () => {
    const bad = collect().filter(
      (l) =>
        !SETTINGS_SECTIONS.includes(l.tab as SettingsSection) &&
        !LEGACY.has(l.tab)
    );
    expect(bad.map((l) => `${l.file}: ?tab=${l.tab}`)).toEqual([]);
  });

  it('a legacy value still resolves to a real section', () => {
    for (const raw of LEGACY) {
      expect(SETTINGS_SECTIONS).toContain(resolveSection(raw));
    }
  });

  it('sectionHref agrees with what the links say', () => {
    expect(sectionHref('whatsapp')).toBe('/settings?tab=whatsapp');
    for (const section of SETTINGS_SECTIONS) {
      expect(sectionHref(section)).toBe(`/settings?tab=${section}`);
    }
  });
});

describe('the registry', () => {
  /**
   * A section in a group `RAIL_GROUPS` does not list renders NOWHERE —
   * no error, no warning, just a row that is missing from a rail nobody
   * counts. The type allows it; only this catches it.
   */
  it('every section is in a group the rail renders', () => {
    const rendered = new Set(RAIL_GROUPS.map((g) => g.group));
    const orphans = SETTINGS_SECTIONS.filter(
      (s) => !rendered.has(SECTION_META[s].group)
    );
    expect(orphans).toEqual([]);
  });

  it('every group the rail renders has something in it for an admin', () => {
    const forAdmin = visibleSections((c) => can('admin', {}, c));
    const empty = RAIL_GROUPS.filter(
      ({ group }) => !forAdmin.some((s) => SECTION_META[s].group === group)
    );
    expect(empty.map((g) => g.group)).toEqual([]);
  });

  it('every declared capability is a real one', () => {
    const unknown = SETTINGS_SECTIONS.map((s) => SECTION_META[s].capability)
      .filter((c): c is Capability => !!c)
      .filter((c) => !(c in CAPABILITIES));
    expect(unknown).toEqual([]);
  });

  it('the id in each entry matches the key it is filed under', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(SECTION_META[section].id).toBe(section);
    }
  });
});

describe('what each role can see', () => {
  const seenBy = (role: AccountRole) => visibleSections((c) => can(role, {}, c));

  it('an owner sees everything', () => {
    expect(seenBy('owner')).toEqual([...SETTINGS_SECTIONS]);
  });

  it('an admin sees everything', () => {
    expect(seenBy('admin')).toEqual([...SETTINGS_SECTIONS]);
  });

  /**
   * THE ONE THAT MATTERS FOR THE MERGE.
   *
   * The whole reason two destinations existed was that an agent should
   * not open a rail full of things they cannot use. One door only beats
   * two if this stays true.
   */
  it('an agent sees only what they can act on', () => {
    const agent = seenBy('agent');
    expect(agent.length).toBeLessThan(SETTINGS_SECTIONS.length);
    for (const section of agent) {
      const capability = SECTION_META[section].capability;
      expect(!capability || can('agent', {}, capability)).toBe(true);
    }
    // And the dangerous ones are not among them.
    expect(agent).not.toContain('whatsapp');
    expect(agent).not.toContain('members');
    expect(agent).not.toContain('api');
  });

  it('a viewer sees the ungated sections and nothing else', () => {
    const viewer = seenBy('viewer');
    const ungated = SETTINGS_SECTIONS.filter(
      (s) => !SECTION_META[s].capability
    );
    expect(viewer).toEqual([...ungated]);
  });

  /**
   * The page falls back to `DEFAULT_SECTION` for a section somebody
   * cannot see. If that landing were ever gated, the fallback would be
   * invisible too — and the fallback for the fallback is nothing.
   */
  it('the landing is visible to every role', () => {
    for (const role of ['owner', 'admin', 'agent', 'viewer'] as const) {
      expect(canSeeSection(DEFAULT_SECTION, (c) => can(role, {}, c))).toBe(true);
    }
  });

  it('everybody keeps their own profile, security and appearance', () => {
    for (const role of ['owner', 'admin', 'agent', 'viewer'] as const) {
      const seen = seenBy(role);
      expect(seen).toContain('profile');
      expect(seen).toContain('security');
      expect(seen).toContain('appearance');
    }
  });

  /**
   * NO OVERRIDE OPENS A GATED SECTION. Not one.
   *
   * Every gated section is behind `settings.manage`, which is rls-backed,
   * and `can` refuses to widen an rls-backed capability past the role —
   * the policy in the database would refuse the write anyway, and
   * honouring the grant would draw a screen that loads and then fails to
   * save.
   *
   * This runs over EVERY capability rather than one, because the first
   * version of the registry got this wrong in a way a single-case test
   * could not catch: Acesso was gated on `audit.view`, which is not
   * rls-backed and so passed a "grantable" assertion — while the panel
   * behind it and its API both refuse below admin, so the grant produced
   * a rail row that opened "Acesso restrito".
   */
  it('no override opens a section an agent cannot otherwise reach', () => {
    const base = seenBy('agent');
    for (const capability of CAPABILITY_LIST) {
      const seen = visibleSections((c) =>
        can('agent', { [capability]: true }, c)
      );
      expect({ capability, seen }).toEqual({ capability, seen: base });
    }
  });

  /**
   * THE DIRECTION THAT DOES WORK, and the reason this table names a
   * capability rather than a role.
   *
   * Taking one away is honoured even for an rls-backed capability —
   * narrowing in the interface something the database would have allowed
   * is a real and safe choice. An account can hide the AI keys from its
   * admins and leave them everything else.
   */
  it('a narrowing override takes a section away, even from an admin', () => {
    const seen = visibleSections((c) =>
      can('admin', { 'settings.manage': false }, c)
    );
    expect(seen).not.toContain('whatsapp');
    expect(seen).not.toContain('api');
    // What is not behind that capability is untouched.
    expect(seen).toContain('profile');
    expect(seen).toContain('templates');
  });
});
