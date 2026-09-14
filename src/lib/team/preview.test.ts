import { describe, expect, it } from 'vitest';

import { previewText } from './preview';

const LABELS = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
};

describe('previewText', () => {
  it('texto é texto', () => {
    expect(
      previewText(
        { body: 'o Cleiton ligou', content_type: 'text', media_name: null },
        LABELS
      )
    ).toEqual({ media: null, text: 'o Cleiton ligou' });
  });

  it('uma linha antiga, de antes da 063, não tem content_type e é texto', () => {
    expect(previewText({ body: 'oi', media_name: null }, LABELS)).toEqual({
      media: null,
      text: 'oi',
    });
  });

  it('anexo com legenda mostra a legenda, e diz que é anexo', () => {
    expect(
      previewText(
        { body: 'foto do pedido', content_type: 'image', media_name: 'x.jpg' },
        LABELS
      )
    ).toEqual({ media: 'image', text: 'foto do pedido' });
  });

  it('anexo sem legenda vira o nome do tipo, e não uma linha em branco', () => {
    expect(
      previewText(
        { body: null, content_type: 'audio', media_name: 'gravacao.webm' },
        LABELS
      )
    ).toEqual({ media: 'audio', text: 'Áudio' });
  });

  it('documento sem legenda leva o nome do arquivo', () => {
    expect(
      previewText(
        {
          body: '',
          content_type: 'document',
          media_name: 'proposta-cotrisel.pdf',
        },
        LABELS
      )
    ).toEqual({ media: 'document', text: 'Documento: proposta-cotrisel.pdf' });
  });

  it('documento sem nome ainda diz o que é', () => {
    expect(
      previewText(
        { body: null, content_type: 'document', media_name: null },
        LABELS
      )
    ).toEqual({ media: 'document', text: 'Documento' });
  });
});
