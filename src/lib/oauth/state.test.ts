import { afterEach, describe, expect, it, vi } from 'vitest';

import { newStateNonce, signState, verifyState } from './state';

// O par emitido/conferido já é testado pelo `google/oauth.test.ts`, que usa
// estas funções. Aqui fica o que mudou ao sair de lá: sem chave, não assina.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sem ENCRYPTION_KEY', () => {
  it('não assina com chave vazia — um HMAC que qualquer um calcula', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => signState(newStateNonce())).toThrow('ENCRYPTION_KEY');
  });

  it('e recusa qualquer state na volta', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'b'.repeat(64));
    const nonce = newStateNonce();
    const state = signState(nonce);
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(verifyState(state, nonce)).toBe(false);
  });
});

describe('com ENCRYPTION_KEY', () => {
  it('um state assinado com outra chave não passa', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'b'.repeat(64));
    const nonce = newStateNonce();
    const state = signState(nonce);
    vi.stubEnv('ENCRYPTION_KEY', 'c'.repeat(64));
    expect(verifyState(state, nonce)).toBe(false);
  });
});
