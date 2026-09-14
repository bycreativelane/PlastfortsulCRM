import { describe, expect, it } from 'vitest';

import {
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  mentionSegments,
  resolveMentions,
  type MentionMember,
} from './mentions';

const JULIANA: MentionMember = {
  user_id: 'u-ju',
  full_name: 'Juliana Prestes',
};
const JOAO: MentionMember = { user_id: 'u-jo', full_name: 'João Batista' };
const ANA: MentionMember = { user_id: 'u-ana', full_name: 'Ana' };
const ANA_PAULA: MentionMember = { user_id: 'u-ap', full_name: 'Ana Paula' };
const EU: MentionMember = { user_id: 'u-eu', full_name: 'Gabriel Spencer' };

const TODOS = [JULIANA, JOAO, ANA, ANA_PAULA, EU];
const DIRETORIO = new Map(TODOS.map((m) => [m.user_id, m]));

describe('mentionQueryAt', () => {
  it('abre no começo do campo', () => {
    expect(mentionQueryAt('@ju', 3)).toEqual({ start: 0, query: 'ju' });
  });

  it('abre no meio da frase, depois de espaço — é como se chama um colega', () => {
    const texto = 'valeu @jul';
    expect(mentionQueryAt(texto, texto.length)).toEqual({
      start: 6,
      query: 'jul',
    });
  });

  it('um @ sozinho já abre, com a lista inteira', () => {
    expect(mentionQueryAt('oi @', 4)).toEqual({ start: 3, query: '' });
  });

  it('não abre num e-mail', () => {
    const texto = 'manda para joao@empresa';
    expect(mentionQueryAt(texto, texto.length)).toBeNull();
  });

  it('fecha depois de um espaço — a palavra já foi escrita', () => {
    const texto = 'oi @ju vou';
    expect(mentionQueryAt(texto, texto.length)).toBeNull();
  });

  it('olha para o cursor, e não para o fim do texto', () => {
    // Editando o meio de uma frase já escrita.
    const texto = 'oi @ju, tudo certo?';
    expect(mentionQueryAt(texto, 6)).toEqual({ start: 3, query: 'ju' });
  });
});

describe('filterMentionCandidates', () => {
  it('por prefixo de palavra, não por pedaço', () => {
    // "an" não pode trazer "Juliana".
    expect(
      filterMentionCandidates(TODOS, 'an', 'u-eu').map((m) => m.full_name)
    ).toEqual(['Ana', 'Ana Paula']);
  });

  it('acha o sobrenome também', () => {
    expect(filterMentionCandidates(TODOS, 'pres', 'u-eu')).toEqual([JULIANA]);
  });

  it('sem acento: "joao" acha "João"', () => {
    expect(filterMentionCandidates(TODOS, 'joao', 'u-eu')).toEqual([JOAO]);
  });

  it('quem digita não aparece na lista', () => {
    expect(filterMentionCandidates(TODOS, 'gab', 'u-eu')).toEqual([]);
    expect(filterMentionCandidates(TODOS, '', 'u-eu')).not.toContainEqual(EU);
  });
});

describe('insertMention', () => {
  it('troca a consulta pelo nome e deixa o cursor depois do espaço', () => {
    const r = insertMention('valeu @jul', 6, 10, 'Juliana Prestes');
    expect(r.text).toBe('valeu @Juliana Prestes ');
    expect(r.caret).toBe(r.text.length);
  });

  it('não dobra o espaço que já existia depois do cursor', () => {
    const r = insertMention('oi @ju tudo bem', 3, 6, 'Juliana Prestes');
    expect(r.text).toBe('oi @Juliana Prestes tudo bem');
  });
});

describe('resolveMentions', () => {
  it('só avisa quem ainda está no texto — apagar a menção desfaz o aviso', () => {
    const texto = '@Juliana Prestes pode ver?';
    expect(resolveMentions(texto, ['u-ju', 'u-jo'], DIRETORIO)).toEqual([
      'u-ju',
    ]);
  });

  it('não repete quem foi escolhido duas vezes', () => {
    const texto = '@Juliana Prestes e de novo @Juliana Prestes';
    expect(resolveMentions(texto, ['u-ju', 'u-ju'], DIRETORIO)).toEqual([
      'u-ju',
    ]);
  });

  it('um nome digitado à mão, sem o painel, não avisa ninguém', () => {
    expect(resolveMentions('@Juliana Prestes oi', [], DIRETORIO)).toEqual([]);
  });
});

describe('mentionSegments', () => {
  it('separa a menção do texto em volta', () => {
    expect(
      mentionSegments(
        'valeu @Juliana Prestes, vou ver',
        ['u-ju'],
        DIRETORIO,
        'u-eu'
      )
    ).toEqual([
      { text: 'valeu ' },
      { text: '@Juliana Prestes', mention: { userId: 'u-ju', self: false } },
      { text: ', vou ver' },
    ]);
  });

  it('marca quando a menção é a quem está lendo', () => {
    const [pedaco] = mentionSegments(
      '@Gabriel Spencer olha',
      ['u-eu'],
      DIRETORIO,
      'u-eu'
    );
    expect(pedaco.mention).toEqual({ userId: 'u-eu', self: true });
  });

  it('o nome mais longo ganha: "@Ana Paula" não sai como "@Ana" + " Paula"', () => {
    const pedacos = mentionSegments(
      '@Ana Paula e @Ana',
      ['u-ana', 'u-ap'],
      DIRETORIO,
      null
    );
    expect(pedacos.map((p) => p.text)).toEqual(['@Ana Paula', ' e ', '@Ana']);
    expect(pedacos[0].mention?.userId).toBe('u-ap');
    expect(pedacos[2].mention?.userId).toBe('u-ana');
  });

  it('um "@Nome" que não está em `mentions` fica como texto', () => {
    expect(mentionSegments('@Juliana Prestes oi', [], DIRETORIO, null)).toEqual(
      [{ text: '@Juliana Prestes oi' }]
    );
  });

  it('mensagem anterior à 077, sem o array, é só texto', () => {
    expect(mentionSegments('oi', undefined, DIRETORIO, null)).toEqual([
      { text: 'oi' },
    ]);
  });

  it('corpo vazio não vira um pedaço vazio', () => {
    expect(mentionSegments('', ['u-ju'], DIRETORIO, null)).toEqual([]);
  });
});
