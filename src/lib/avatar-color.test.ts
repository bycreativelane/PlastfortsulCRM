import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_CLASS_LIST,
  avatarClass,
  avatarInitials,
} from './avatar-color';

describe('avatarClass', () => {
  it('is stable for the same name', () => {
    expect(avatarClass('Juliana Prestes')).toBe(avatarClass('Juliana Prestes'));
  });

  it('always returns one of the eight', () => {
    const names = [
      'Marcos Antunes',
      'Fernanda Klein',
      'Patrícia Nogueira',
      'Rodrigo Kunz',
      'Cleber Antunes',
      '+55 51 99999-0000',
      'ç',
      '中文名',
    ];
    for (const name of names) {
      expect(AVATAR_CLASS_LIST).toContain(avatarClass(name));
    }
  });

  it('spreads real names across the palette', () => {
    // Not a distribution proof — just that the seed is not degenerate. Nine
    // seeded contacts landing on one colour would make the whole feature
    // pointless.
    const names = [
      'Marcos Antunes',
      'Fernanda Klein',
      'Patrícia Nogueira',
      'Juliana Prestes',
      'Rodrigo Kunz',
      'Cleber Antunes',
    ];
    expect(new Set(names.map(avatarClass)).size).toBeGreaterThanOrEqual(3);
  });

  it('falls back rather than crashing on nothing', () => {
    expect(AVATAR_CLASS_LIST).toContain(avatarClass(''));
    expect(AVATAR_CLASS_LIST).toContain(avatarClass(null));
    expect(AVATAR_CLASS_LIST).toContain(avatarClass(undefined));
  });
});

describe('avatarInitials', () => {
  it('takes up to two words', () => {
    expect(avatarInitials('Marcos Antunes')).toBe('MA');
    expect(avatarInitials('Cooperativa Agrícola Vale Verde')).toBe('CA');
    expect(avatarInitials('Juliana')).toBe('J');
  });

  it('ignores stray whitespace', () => {
    expect(avatarInitials('  Fernanda   Klein  ')).toBe('FK');
  });

  it('returns the fallback for an empty name', () => {
    expect(avatarInitials('', '?')).toBe('?');
    expect(avatarInitials(null, '?')).toBe('?');
    expect(avatarInitials(undefined)).toBe('');
  });
});

describe('the palette Tailwind can see', () => {
  // The failure this guards is silent: `bg-avatar-${n}` generates no CSS in
  // Tailwind v4 — the scanner reads source as text — and the disc renders
  // transparent rather than wrong. Both halves have to be checked: the eight
  // classes exist as literals, and every one of them has a token behind it.
  const css = readFileSync(
    join(process.cwd(), 'src/app/globals.css'),
    'utf8'
  );

  it('maps all eight in @theme inline', () => {
    for (let n = 1; n <= 8; n += 1) {
      expect(css).toContain(`--color-avatar-${n}: var(--avatar-${n});`);
    }
    expect(css).toContain('--color-avatar-ink: var(--avatar-ink);');
  });

  it('defines all eight in both modes', () => {
    for (let n = 1; n <= 8; n += 1) {
      const defined = css.match(new RegExp(`--avatar-${n}: oklch\\(`, 'g'));
      expect(defined, `--avatar-${n} in light and dark`).toHaveLength(2);
    }
    expect(css.match(/--avatar-ink: oklch\(/g)).toHaveLength(2);
  });

  it('lists exactly the eight classes', () => {
    expect(AVATAR_CLASS_LIST).toHaveLength(8);
    for (let n = 1; n <= 8; n += 1) {
      expect(AVATAR_CLASS_LIST).toContain(`bg-avatar-${n}`);
    }
  });
});
