import { describe, expect, it } from 'vitest';
import { signMessage } from './use-signature';

describe('signMessage', () => {
  it('prefixes the name in WhatsApp bold, on its own line', () => {
    expect(signMessage('Bom dia!', 'Thales')).toBe('*Thales*\nBom dia!');
  });

  it('leaves the message alone when there is no name', () => {
    // An empty signature is "off", not an empty bold line.
    expect(signMessage('Bom dia!', '')).toBe('Bom dia!');
    expect(signMessage('Bom dia!', '   ')).toBe('Bom dia!');
  });

  it('trims the name but not the message', () => {
    expect(signMessage('  espaço à esquerda', '  Ana  ')).toBe(
      '*Ana*\n  espaço à esquerda'
    );
  });

  it('signs a multi-line message once, at the top', () => {
    const body = 'Primeira linha\nSegunda linha';
    expect(signMessage(body, 'Thales')).toBe(`*Thales*\n${body}`);
  });
});
