// ============================================================
// O registro — a única tabela que sabe o que existe em /developers,
// em que ordem e sob qual URL.
//
// A barra lateral, a resolução do `[[...slug]]`, os links
// "anterior/próximo" do rodapé e o índice da busca leem TODOS daqui.
// Foi assim que `settings-sections.ts` resolveu o mesmo problema do
// outro lado do produto, e pela mesma razão: no dia em que uma página
// mudar de grupo, ela muda de grupo em todo lugar de uma vez, em vez
// de deixar um link escrito à mão apontando para o lugar antigo.
// ============================================================

import { ENDPOINTS, ENDPOINT_GROUPS } from './endpoints';
import { GUIDES } from './guides';
import type { DocGroup, DocPage, Endpoint, GuidePage } from './types';

/** O slug da página inicial — ela mora em `/developers`, sem sufixo. */
export const ROOT_SLUG = 'introducao';

const RELEASES_PAGE: DocPage = {
  type: 'releases',
  slug: 'releases',
  title: 'Releases',
  summary: 'O que mudou em cada versão, da mais recente para a mais antiga.',
};

function guide(slug: string): DocPage {
  const page = GUIDES.find((g) => g.slug === slug);
  if (!page) throw new Error(`api-docs: guia "${slug}" não existe`);
  return { type: 'guide', ...page };
}

function endpoint(slug: string): DocPage {
  const page = ENDPOINTS.find((e) => e.slug === slug);
  if (!page) throw new Error(`api-docs: endpoint "${slug}" não existe`);
  return { type: 'endpoint', ...page };
}

/**
 * A ordem da barra lateral, de cima para baixo.
 *
 * Começa pelo que se lê uma vez (introdução, início rápido), passa
 * pelos fundamentos que valem para todas as rotas, e só então abre a
 * referência recurso a recurso — a mesma escada que a documentação do
 * Chatwoot desce, porque ela é a ordem em que as perguntas aparecem.
 */
export const DOC_GROUPS: DocGroup[] = [
  {
    label: null,
    pages: [guide('introducao'), guide('inicio-rapido'), RELEASES_PAGE],
  },
  {
    label: 'Fundamentos',
    pages: [
      guide('autenticacao'),
      guide('escopos'),
      guide('erros'),
      guide('limites'),
      guide('paginacao'),
    ],
  },
  ...ENDPOINT_GROUPS.map((group) => ({
    label: group.label,
    pages: group.slugs.map(endpoint),
  })),
  {
    label: 'Eventos',
    pages: [guide('webhooks'), guide('hooks-de-entrada')],
  },
];

/** Toda página, achatada, na ordem da barra lateral. */
export const ALL_PAGES: DocPage[] = DOC_GROUPS.flatMap((g) => g.pages);

/**
 * A URL de uma página.
 *
 * Endpoints ficam sob `/developers/endpoints/…` para que um slug de
 * rota nunca possa colidir com o de um guia — `webhooks` é as duas
 * coisas neste produto, e sem o prefixo uma delas ficaria inalcançável.
 */
export function pageHref(page: DocPage): string {
  if (page.slug === ROOT_SLUG) return '/developers';
  if (page.type === 'endpoint') return `/developers/endpoints/${page.slug}`;
  return `/developers/${page.slug}`;
}

/**
 * Resolve os segmentos de `[[...slug]]` numa página, ou `null` quando
 * não há o que mostrar (o que a rota transforma em `notFound()`).
 */
export function resolvePage(segments: string[] | undefined): DocPage | null {
  const path = segments ?? [];

  if (path.length === 0) return ALL_PAGES.find((p) => p.slug === ROOT_SLUG)!;

  if (path.length === 2 && path[0] === 'endpoints') {
    return (
      ALL_PAGES.find((p) => p.type === 'endpoint' && p.slug === path[1]) ?? null
    );
  }

  if (path.length === 1) {
    return (
      ALL_PAGES.find((p) => p.type !== 'endpoint' && p.slug === path[0]) ?? null
    );
  }

  return null;
}

/** Vizinhas na ordem da barra lateral — o rodapé "anterior / próximo". */
export function neighbours(page: DocPage): {
  prev: DocPage | null;
  next: DocPage | null;
} {
  const i = ALL_PAGES.findIndex((p) => p.slug === page.slug);
  return {
    prev: i > 0 ? ALL_PAGES[i - 1] : null,
    next: i >= 0 && i < ALL_PAGES.length - 1 ? ALL_PAGES[i + 1] : null,
  };
}

/** O grupo a que uma página pertence — mostrado como sobrelinha no topo. */
export function groupOf(page: DocPage): string | null {
  return (
    DOC_GROUPS.find((g) => g.pages.some((p) => p.slug === page.slug))?.label ??
    null
  );
}

export interface SearchEntry {
  slug: string;
  title: string;
  summary: string;
  href: string;
  group: string | null;
  method?: Endpoint['method'];
  path?: string;
  /** Tudo que a busca compara, já em minúsculas e sem acento. */
  haystack: string;
}

/** Remove acentos para que "autenticacao" ache "Autenticação". */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * O índice da busca — pequeno o bastante (algumas dezenas de linhas)
 * para ser filtrado no cliente a cada tecla, sem rota nem debounce.
 */
export const SEARCH_INDEX: SearchEntry[] = DOC_GROUPS.flatMap((group) =>
  group.pages.map((page) => {
    const isEndpoint = page.type === 'endpoint';
    return {
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      href: pageHref(page),
      group: group.label,
      method: isEndpoint ? page.method : undefined,
      path: isEndpoint ? page.path : undefined,
      haystack: fold(
        [
          page.title,
          page.summary,
          group.label ?? '',
          isEndpoint ? `${page.method} ${page.path}` : '',
          isEndpoint && page.scope ? page.scope : '',
        ].join(' ')
      ),
    };
  })
);

export type { DocPage, DocGroup, Endpoint, GuidePage };
