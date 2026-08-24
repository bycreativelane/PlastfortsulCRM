import { describe, expect, it } from 'vitest';
import {
  normalizeShortcut,
  parseQuickReplyBody,
  parseQuickReplyContent,
} from './parse';
import { mediaKindFromMime } from './media';

describe('normalizeShortcut', () => {
  it('drops a slash somebody typed out of habit', () => {
    expect(normalizeShortcut('/frete')).toBe('frete');
    expect(normalizeShortcut('//frete')).toBe('frete');
  });

  it('folds case, because the keystrokes are the same', () => {
    expect(normalizeShortcut('Orcamento')).toBe('orcamento');
  });

  it('removes what the panel could never reach', () => {
    // The `/` panel closes on the first space, so a shortcut with one in it
    // is unreachable by definition.
    expect(normalizeShortcut('linha 100')).toBe('linha100');
    expect(normalizeShortcut(' prazo! ')).toBe('prazo');
  });

  it('keeps accents — people type them', () => {
    expect(normalizeShortcut('orçamento')).toBe('orçamento');
  });

  it('is null for nothing, so the unique index skips the row', () => {
    expect(normalizeShortcut('')).toBeNull();
    expect(normalizeShortcut('   ')).toBeNull();
    expect(normalizeShortcut('///')).toBeNull();
    expect(normalizeShortcut(undefined)).toBeNull();
    expect(normalizeShortcut(42)).toBeNull();
  });
});

describe('parseQuickReplyContent', () => {
  it('refuses a media snippet with no file', () => {
    const result = parseQuickReplyContent({ kind: 'media', content_text: 'oi' });
    expect(result.ok).toBe(false);
  });

  it('lets a media snippet carry no caption', () => {
    const result = parseQuickReplyContent({
      kind: 'media',
      media_url: 'https://x/catalogo.pdf',
      media_type: 'application/pdf',
      content_text: '   ',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'media', content_text: null, media_url: 'https://x/catalogo.pdf' },
    });
  });

  it('still requires text for a text snippet', () => {
    expect(parseQuickReplyContent({ kind: 'text', content_text: ' ' }).ok).toBe(
      false
    );
  });

  it('clears the columns the new kind does not own', () => {
    // A row switched from media to text that kept its media_url is a row the
    // picker would stage as an attachment.
    const result = parseQuickReplyContent({
      kind: 'text',
      content_text: 'Bom dia!',
      media_url: 'https://x/old.png',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { media_url: null, media_type: null, interactive_payload: null },
    });
  });

  it('treats an unknown kind as text', () => {
    expect(
      parseQuickReplyContent({ kind: 'sticker', content_text: 'oi' })
    ).toMatchObject({ ok: true, value: { kind: 'text' } });
  });
});

describe('parseQuickReplyBody', () => {
  it('requires a title', () => {
    expect(parseQuickReplyBody({ content_text: 'oi' }).ok).toBe(false);
  });

  it('normalises the shortcut on the way in', () => {
    expect(
      parseQuickReplyBody({
        title: 'Frete',
        shortcut: '/FRETE',
        content_text: 'CIF acima de 500 kg',
      })
    ).toMatchObject({ ok: true, value: { shortcut: 'frete' } });
  });
});

describe('mediaKindFromMime', () => {
  it('maps the three the picker offers', () => {
    expect(mediaKindFromMime('image/png')).toBe('image');
    expect(mediaKindFromMime('video/mp4')).toBe('video');
    expect(mediaKindFromMime('application/pdf')).toBe('document');
  });

  it('falls back to document, which WhatsApp always accepts', () => {
    expect(mediaKindFromMime(null)).toBe('document');
    expect(mediaKindFromMime(undefined)).toBe('document');
    expect(mediaKindFromMime('application/x-who-knows')).toBe('document');
  });
});
