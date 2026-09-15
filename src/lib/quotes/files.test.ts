import { describe, expect, it } from 'vitest';

import { filesDecision } from './files';

describe('filesDecision — reaproveitar, preencher ou arquivar', () => {
  it('sem linha, arquiva uma', () => {
    expect(filesDecision(null)).toBe('new');
    expect(filesDecision(undefined)).toBe('new');
  });

  it('com arquivo, reaproveita — sem Chromium e sem upload', () => {
    expect(
      filesDecision({ id: 'q1', pdf_url: 'https://x/o.pdf', image_url: null })
    ).toBe('reuse');
  });

  /*
   * O caso que a rota errava depois do `23505`: a linha vencedora existe e
   * ainda não tem arquivo, porque o primeiro clique está desenhando. Ela
   * era devolvida assim mesmo, e a tela recebia `pdfUrl: null`.
   */
  it('linha sem arquivo é PREENCHIDA, nunca devolvida vazia', () => {
    expect(filesDecision({ id: 'q1', pdf_url: null, image_url: null })).toBe(
      'fill'
    );
  });

  it('só a imagem não conta como arquivo: o PDF é o que o arquivo abre', () => {
    expect(
      filesDecision({ id: 'q1', pdf_url: null, image_url: 'https://x/o.png' })
    ).toBe('fill');
  });
});
