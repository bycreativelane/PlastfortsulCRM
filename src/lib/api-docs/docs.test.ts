import { describe, expect, it } from 'vitest';

import { API_SCOPES } from '@/lib/api-keys/scopes';
import { ENDPOINTS, ENDPOINT_GROUPS } from './endpoints';
import { GUIDES } from './guides';
import { highlight } from './highlight';
import {
  ALL_PAGES,
  DOC_GROUPS,
  SEARCH_INDEX,
  fold,
  neighbours,
  pageHref,
  resolvePage,
} from './registry';
import { buildSample } from './samples';

/**
 * O token literal, e não importado de `base-url.ts`: aquele módulo puxa
 * `next/headers`, que não existe fora de uma requisição — e um teste de
 * dados puros não deveria precisar de um servidor de pé para rodar.
 */
const BASE_URL_TOKEN = '__BASE_URL__';

/**
 * O que estes testes protegem NÃO é a prosa — ela muda toda semana e
 * não é falsificável por um teste. É a estrutura em volta dela: uma
 * página que a barra lateral mostra e a rota não resolve é um 404
 * publicado, e nada em `tsc` pega isso.
 */
describe('registro da documentação', () => {
  it('resolve toda página que a barra lateral mostra', () => {
    for (const page of ALL_PAGES) {
      const href = pageHref(page);
      const segments = href
        .replace('/developers', '')
        .split('/')
        .filter(Boolean);
      const resolved = resolvePage(segments);
      expect(resolved, `${href} não resolve`).not.toBeNull();
      expect(resolved?.slug).toBe(page.slug);
    }
  });

  it('não tem slug repetido', () => {
    const slugs = ALL_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('põe todo endpoint em exatamente um grupo', () => {
    const inGroups = ENDPOINT_GROUPS.flatMap((g) => g.slugs);
    expect([...inGroups].sort()).toEqual(ENDPOINTS.map((e) => e.slug).sort());
  });

  it('resolve /developers na introdução, e nada mais na raiz', () => {
    expect(resolvePage([])?.slug).toBe('introducao');
    expect(resolvePage(['nao-existe'])).toBeNull();
    expect(resolvePage(['endpoints', 'nao-existe'])).toBeNull();
  });

  it('encadeia anterior/próximo pelas pontas', () => {
    expect(neighbours(ALL_PAGES[0]).prev).toBeNull();
    expect(neighbours(ALL_PAGES[ALL_PAGES.length - 1]).next).toBeNull();
    expect(neighbours(ALL_PAGES[1]).prev?.slug).toBe(ALL_PAGES[0].slug);
  });

  it('indexa toda página para a busca, sem acento no palheiro', () => {
    expect(SEARCH_INDEX).toHaveLength(ALL_PAGES.length);
    expect(fold('Autenticação')).toBe('autenticacao');
    const auth = SEARCH_INDEX.find((e) => e.slug === 'autenticacao');
    expect(auth?.haystack).toContain('autenticacao');
  });

  it('só aponta para dentro em links internos do spec', () => {
    // Um `[rótulo](/developers/…)` escrito à mão é a única parte da
    // prosa que pode apodrecer sem quebrar nada — é o que este pega.
    const internal = /\]\((\/[^)]+)\)/g;
    const known = new Set(ALL_PAGES.map(pageHref));

    const texts = [
      ...GUIDES.flatMap((g) => [g.summary, ...g.blocks.flatMap(blockText)]),
      ...ENDPOINTS.flatMap((e) => [
        ...(e.intro ?? []).flatMap(blockText),
        ...(e.notes ?? []).flatMap(blockText),
      ]),
    ];

    for (const text of texts) {
      for (const match of text.matchAll(internal)) {
        const href = match[1].split('#')[0];
        // Rotas do produto (/inbox, /automations) não são páginas da doc.
        if (!href.startsWith('/developers')) continue;
        expect(known.has(href), `link morto: ${href}`).toBe(true);
      }
    }
  });
});

describe('endpoints', () => {
  it('declara apenas escopos que a API conhece', () => {
    for (const endpoint of ENDPOINTS) {
      if (endpoint.scope === null) continue;
      expect(API_SCOPES).toContain(endpoint.scope);
    }
  });

  it('mostra ao menos uma resposta por rota, com JSON legível', () => {
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.responses.length).toBeGreaterThan(0);
      for (const response of endpoint.responses) {
        expect(() => JSON.parse(response.json)).not.toThrow();
      }
    }
  });

  it('manda corpo de exemplo em toda rota de escrita', () => {
    for (const endpoint of ENDPOINTS) {
      if (endpoint.method === 'GET' || endpoint.method === 'DELETE') continue;
      expect(
        endpoint.requestExample,
        `${endpoint.slug} sem corpo`
      ).toBeTruthy();
      expect(() => JSON.parse(endpoint.requestExample!)).not.toThrow();
    }
  });
});

describe('exemplos de código', () => {
  const endpoint = ENDPOINTS.find((e) => e.slug === 'enviar-mensagem')!;

  it('escreve a URL completa da instância nas três linguagens', () => {
    for (const lang of ['curl', 'js', 'python'] as const) {
      const code = buildSample(endpoint, lang, 'https://crm.exemplo.com');
      expect(code).toContain('https://crm.exemplo.com/api/v1/messages');
      expect(code).not.toContain(BASE_URL_TOKEN);
    }
  });

  it('leva o corpo nas escritas e não o inventa nas leituras', () => {
    const write = buildSample(endpoint, 'curl', 'https://x.dev');
    expect(write).toContain('-X POST');
    expect(write).toContain('"to"');

    const read = ENDPOINTS.find((e) => e.slug === 'identidade')!;
    const curl = buildSample(read, 'curl', 'https://x.dev');
    expect(curl).not.toContain('-X GET');
    expect(curl).not.toContain('--data');
  });
});

describe('realce de sintaxe', () => {
  const samples: [string, Parameters<typeof highlight>[1]][] = [
    ['{ "a": 1, "b": true, "c": null }', 'json'],
    ['curl -X POST https://x.dev -H "A: b"', 'bash'],
    ["const a = await fetch('x'); // ok", 'js'],
    ['import os\nres = requests.get("x")  # ok', 'python'],
    ['POST /api/v1/messages\nAuthorization: Bearer x', 'http'],
    ['nada a colorir', 'text'],
  ];

  // A invariante que importa: um realce que come um caractere é pior
  // que nenhum realce.
  it.each(samples)('devolve o texto intacto (%s)', (code, language) => {
    const tokens = highlight(code, language);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
  });

  it('separa chave de valor no JSON', () => {
    const tokens = highlight('{ "name": "Joana" }', 'json');
    expect(tokens.find((t) => t.text === '"name"')?.kind).toBe('key');
    expect(tokens.find((t) => t.text === '"Joana"')?.kind).toBe('str');
  });

  it('não confunde // dentro de uma string com comentário', () => {
    const tokens = highlight('{ "url": "https://x.dev" }', 'json');
    expect(tokens.some((t) => t.kind === 'com')).toBe(false);
  });
});

function blockText(block: (typeof GUIDES)[number]['blocks'][number]): string[] {
  switch (block.kind) {
    case 'p':
      return [block.text];
    case 'callout':
      return [block.text, block.title ?? ''];
    case 'list':
      return block.items;
    case 'table':
      return [...block.head, ...block.rows.flat()];
    case 'cards':
      return block.items.flatMap((card) => [
        card.text,
        `[${card.title}](${card.href})`,
      ]);
    default:
      return [];
  }
}

describe('grupos', () => {
  it('não deixa grupo vazio na barra lateral', () => {
    for (const group of DOC_GROUPS) {
      expect(group.pages.length, `grupo ${group.label} vazio`).toBeGreaterThan(
        0
      );
    }
  });
});
