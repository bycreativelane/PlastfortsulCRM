import { describe, expect, it } from 'vitest';

import { groupPreview, previewText } from './preview';

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

describe('groupPreview', () => {
  const msg = (
    id: string,
    author: string,
    iso: string,
    room: string | null = null
  ) =>
    ({
      id,
      account_id: 'a',
      author_id: author,
      body: id,
      conversation_id: null,
      room_id: room,
      created_at: iso,
      edited_at: null,
    }) as unknown as Parameters<typeof groupPreview>[0][number];

  it('duas mensagens seguidas da mesma pessoa são UM turno', () => {
    const runs = groupPreview([
      msg('m1', 'u1', '2026-09-08T14:00:00'),
      msg('m2', 'u1', '2026-09-08T14:01:00'),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('o outro colega começa outro turno', () => {
    const runs = groupPreview([
      msg('m1', 'u1', '2026-09-08T14:00:00'),
      msg('m2', 'u2', '2026-09-08T14:01:00'),
      msg('m3', 'u1', '2026-09-08T14:02:00'),
    ]);
    expect(runs.map((r) => r.authorId)).toEqual(['u1', 'u2', 'u1']);
  });

  it('a virada do dia quebra o turno, mesmo sem trocar de pessoa', () => {
    const runs = groupPreview([
      msg('m1', 'u1', '2026-09-08T23:59:00'),
      msg('m2', 'u1', '2026-09-09T00:01:00'),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0].day).not.toBe(runs[1].day);
  });

  it('mudar de sala quebra o turno — a legenda diz de qual sala é', () => {
    const runs = groupPreview([
      msg('m1', 'u1', '2026-09-08T14:00:00', null),
      msg('m2', 'u1', '2026-09-08T14:01:00', 'r-op'),
    ]);
    expect(runs.map((r) => r.roomId)).toEqual([null, 'r-op']);
  });

  it('sem mensagens, sem turnos', () => {
    expect(groupPreview([])).toEqual([]);
  });
});
