import { describe, expect, it } from 'vitest';
import {
  conversationPreview,
  mediaPlaceholderOf,
  splitSignature,
} from './message-preview';

describe('mediaPlaceholderOf', () => {
  it('recognises the webhook placeholders', () => {
    expect(mediaPlaceholderOf('[audio]')).toBe('audio');
    expect(mediaPlaceholderOf('[image]')).toBe('image');
    expect(mediaPlaceholderOf('  [document]  ')).toBe('document');
  });

  it('leaves real text alone', () => {
    expect(mediaPlaceholderOf('Bom dia')).toBeNull();
    expect(mediaPlaceholderOf('')).toBeNull();
    expect(mediaPlaceholderOf(null)).toBeNull();
  });

  it('does not match a placeholder buried in a sentence', () => {
    // The customer quoting the string is still the customer talking.
    expect(mediaPlaceholderOf('me manda o [audio] de novo')).toBeNull();
  });

  it('passes an unknown type through as text', () => {
    // Better to show `[order]` than to invent a label for a kind nobody
    // has taught this function about.
    expect(mediaPlaceholderOf('[order]')).toBeNull();
  });
});

describe('splitSignature', () => {
  it('lifts the agent name off an outbound message', () => {
    expect(splitSignature('*Matheus*\nOla', { outbound: true })).toEqual({
      signature: 'Matheus',
      body: 'Ola',
    });
  });

  it('keeps a multi-line body intact', () => {
    expect(
      splitSignature('*Thales · Vendas*\nBom dia\n\nSegue o orçamento', {
        outbound: true,
      })
    ).toEqual({
      signature: 'Thales · Vendas',
      body: 'Bom dia\n\nSegue o orçamento',
    });
  });

  it('never touches an inbound message', () => {
    // `*palavra*` from a customer is their own bold, not our signature.
    const text = '*urgente*\npreciso hoje';
    expect(splitSignature(text, { outbound: false })).toEqual({
      signature: null,
      body: text,
    });
  });

  it('leaves a lone bolded line as the message', () => {
    // No body after it, so it is emphasis. Stripping here would delete the
    // entire message.
    const text = '*urgente*';
    expect(splitSignature(text, { outbound: true })).toEqual({
      signature: null,
      body: text,
    });
  });

  it('leaves a bolded opening sentence alone', () => {
    // Too long to be a name, so the guess is declined rather than eating
    // somebody's first line.
    const text =
      '*Confirmamos o pedido para a próxima terça-feira, conforme combinado*\nSegue a nota.';
    expect(splitSignature(text, { outbound: true }).signature).toBeNull();
  });

  it('declines when the first line has an asterisk inside it', () => {
    const text = '*a*b*\ncorpo';
    expect(splitSignature(text, { outbound: true }).signature).toBeNull();
  });
});

describe('conversationPreview', () => {
  it('reports the kind instead of the bracket string', () => {
    expect(conversationPreview('[audio]')).toEqual({
      media: 'audio',
      thumbnailUrl: null,
      text: '',
    });
  });

  it('strips our own signature from the row', () => {
    expect(conversationPreview('*Matheus*\nOla')).toMatchObject({
      media: null,
      text: 'Ola',
    });
  });

  it('survives an empty conversation', () => {
    expect(conversationPreview(null)).toEqual({
      media: null,
      thumbnailUrl: null,
      text: '',
    });
  });

  describe('with the columns migration 047 adds', () => {
    it('shows a photo AND its caption', () => {
      // The case the old shape could not express: a captioned photo stores
      // the caption, so it was indistinguishable from a text message.
      expect(
        conversationPreview('Segue a foto do lote', 'image', 'https://x/p.jpg')
      ).toEqual({
        media: 'image',
        thumbnailUrl: 'https://x/p.jpg',
        text: 'Segue a foto do lote',
      });
    });

    it('offers no thumbnail for a kind a square cannot show', () => {
      // An audio file has no picture. The icon carries it instead.
      expect(
        conversationPreview('[audio]', 'audio', 'https://x/a.ogg')
      ).toMatchObject({ media: 'audio', thumbnailUrl: null });
    });

    it('offers no thumbnail when the media URL is missing', () => {
      // Meta expired the bytes, or the mirror failed.
      expect(conversationPreview(null, 'image', null)).toMatchObject({
        media: 'image',
        thumbnailUrl: null,
      });
    });

    it('treats composed kinds as plain text', () => {
      // `text`, `template` and `interactive` are messages somebody wrote —
      // they have words of their own and want no icon.
      for (const kind of ['text', 'template', 'interactive']) {
        expect(conversationPreview('Bom dia', kind, null)).toMatchObject({
          media: null,
          text: 'Bom dia',
        });
      }
    });

    it('falls back to parsing when the columns are not there yet', () => {
      // Every row written before 047 — which is the set the bug was
      // reported about.
      expect(conversationPreview('[image]', null, null)).toMatchObject({
        media: 'image',
      });
    });
  });
});
