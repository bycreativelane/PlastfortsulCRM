import { describe, expect, it } from 'vitest';
import {
  API_SCOPES,
  SCOPE_DESCRIPTION_KEYS,
  hasScope,
  isApiScope,
  normalizeScopes,
} from './scopes';
import ptBR from '../../../messages/pt-BR.json';
import en from '../../../messages/en.json';
import ko from '../../../messages/ko.json';

const LOCALES: Record<string, Record<string, string>> = {
  'pt-BR': ptBR.Settings.apiKeys.scopes,
  en: en.Settings.apiKeys.scopes,
  ko: ko.Settings.apiKeys.scopes,
};

describe('isApiScope', () => {
  it('accepts every declared scope', () => {
    for (const s of API_SCOPES) expect(isApiScope(s)).toBe(true);
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isApiScope('messages:delete')).toBe(false);
    expect(isApiScope('')).toBe(false);
    expect(isApiScope(null)).toBe(false);
    expect(isApiScope(42)).toBe(false);
  });
});

describe('normalizeScopes', () => {
  it('passes a valid list through, de-duplicated', () => {
    expect(
      normalizeScopes(['messages:send', 'messages:send', 'contacts:read'])
    ).toEqual(['messages:send', 'contacts:read']);
  });

  it('treats an empty array as valid (key with no scopes)', () => {
    expect(normalizeScopes([])).toEqual([]);
  });

  it('returns null if any entry is not a known scope', () => {
    expect(normalizeScopes(['messages:send', 'bogus'])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(normalizeScopes('messages:send')).toBeNull();
    expect(normalizeScopes(undefined)).toBeNull();
  });
});

describe('hasScope', () => {
  it('is true when the scope is present', () => {
    expect(hasScope(['messages:send', 'contacts:read'], 'contacts:read')).toBe(
      true
    );
  });

  it('is false when the scope is absent or the list is empty', () => {
    expect(hasScope(['messages:send'], 'contacts:read')).toBe(false);
    expect(hasScope([], 'messages:send')).toBe(false);
  });
});

describe('SCOPE_DESCRIPTION_KEYS', () => {
  it('has a key for every scope', () => {
    for (const s of API_SCOPES) {
      expect(SCOPE_DESCRIPTION_KEYS[s]).toBeTruthy();
    }
  });

  it('every key resolves in every locale', () => {
    // The map holds keys now, not sentences, so "has a description" is no
    // longer something this file can see on its own — a key that no
    // catalogue defines is exactly as broken as a missing description, and
    // renders as the raw key in the UI.
    for (const locale of ['pt-BR', 'en', 'ko'] as const) {
      const messages = LOCALES[locale];
      for (const s of API_SCOPES) {
        expect(messages[SCOPE_DESCRIPTION_KEYS[s]]).toBeTruthy();
      }
    }
  });
});
