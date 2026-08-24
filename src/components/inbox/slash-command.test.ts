import { describe, expect, it } from 'vitest';
import type { QuickReply } from '@/types';
import { filterQuickReplies, slashQuery } from './slash-command';

const qr = (title: string, body = '', shortcut?: string): QuickReply =>
  ({ id: title, title, kind: 'text', content_text: body, shortcut }) as QuickReply;

describe('slashQuery', () => {
  it('opens only at the start of the field', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/pra')).toBe('pra');
    // The reason the rule exists: a slash mid-sentence is a slash.
    expect(slashQuery('R$ 12/kg')).toBeNull();
    expect(slashQuery('seg/qua/sex')).toBeNull();
    expect(slashQuery('veja https://plastfort.com.br/precos')).toBeNull();
  });

  it('closes once a space is typed', () => {
    // `/ola ` is somebody writing a message, not somebody choosing one.
    expect(slashQuery('/ola ')).toBeNull();
    expect(slashQuery('/ola mundo')).toBeNull();
  });

  it('is closed for an empty field', () => {
    expect(slashQuery('')).toBeNull();
  });
});

describe('filterQuickReplies', () => {
  const items = [
    qr('Horário de atendimento', 'Nosso atendimento é de segunda a sexta'),
    qr('Prazo de entrega padrão', 'O prazo padrão é de 6 dias úteis'),
    qr('Compra futura', 'Retomo o contato conforme combinamos'),
  ];

  it('returns everything for an empty query', () => {
    expect(filterQuickReplies(items, '')).toHaveLength(3);
  });

  it('matches a word prefix, not a substring anywhere', () => {
    const found = filterQuickReplies(items, 'pra').map((i) => i.title);
    // The example the sibling module warns about by name: `pra` must not
    // drag in "Compra" just because the letters appear inside it.
    expect(found).toEqual(['Prazo de entrega padrão']);
  });

  it('searches the body as well as the title', () => {
    const found = filterQuickReplies(items, 'segunda').map((i) => i.title);
    expect(found).toEqual(['Horário de atendimento']);
  });

  it('ignores case and surrounding space', () => {
    expect(filterQuickReplies(items, '  COMPRA ')).toHaveLength(1);
  });
});

describe('filterQuickReplies — shortcuts', () => {
  const items = [
    qr('Compra futura', 'Retomo o contato conforme combinamos'),
    qr('Tabela de fretes', 'CIF acima de 500 kg', 'fretes'),
    qr('Frete para o interior', 'Consulte a tabela', 'frete'),
  ];

  it('finds a snippet by its shortcut', () => {
    expect(filterQuickReplies(items, 'frete').map((i) => i.shortcut)).toContain(
      'frete'
    );
  });

  it('puts the exact shortcut first', () => {
    // The one that matters: `/frete` typed in full must be what Enter sends,
    // even though "Tabela de fretes" also matches by prefix and by word.
    expect(filterQuickReplies(items, 'frete')[0].shortcut).toBe('frete');
  });

  it('ranks shortcut prefixes above title-only matches', () => {
    const items2 = [
      qr('Frete grátis acima de 500 kg'),
      qr('Tabela comercial', 'preços e prazos', 'frete'),
    ];
    // The second row matches only by shortcut and still leads: the title of
    // the first one starts with the same letters, and it does not matter.
    expect(filterQuickReplies(items2, 'fre').map((i) => i.title)).toEqual([
      'Tabela comercial',
      'Frete grátis acima de 500 kg',
    ]);
  });

  it('still finds snippets that have no shortcut at all', () => {
    expect(filterQuickReplies(items, 'compra').map((i) => i.title)).toEqual([
      'Compra futura',
    ]);
  });

  it('keeps the given order within a rank', () => {
    // Nothing matches by shortcut here, so the account's own ordering has to
    // survive — the panel is not free to shuffle equally-good answers.
    const items2 = [qr('Prazo A'), qr('Prazo B'), qr('Prazo C')];
    expect(filterQuickReplies(items2, 'prazo').map((i) => i.title)).toEqual([
      'Prazo A',
      'Prazo B',
      'Prazo C',
    ]);
  });
});
