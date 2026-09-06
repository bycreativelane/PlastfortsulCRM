// ============================================================
// O modelo da documentação — uma árvore tipada da qual TODA a
// superfície `/developers` é desenhada.
//
// Dados, e não Markdown/MDX. Três razões, na ordem do peso:
//
//   1. A barra lateral, o índice lateral, os links "anterior/próximo",
//      a busca e o playground precisam ler a MESMA fonte. Um `.md`
//      obriga cada uma dessas a re-parsear prosa e adivinhar estrutura;
//      um `Endpoint` já sabe qual é o método, qual escopo exige e qual
//      é o corpo da requisição.
//   2. Os exemplos de código (cURL, JavaScript, Python) são GERADOS a
//      partir do endpoint — ver `samples.ts`. Escritos à mão, os três
//      divergem na primeira mudança de rota e ninguém percebe.
//   3. Um endpoint que muda no servidor deve quebrar a compilação aqui
//      quando o escopo deixa de existir: `scope` é `ApiScope`, o mesmo
//      union que `requireApiKey` exige.
//
// O texto em si é pt-BR, fixo, e não passa pelo catálogo de i18n. O
// que é contrato — caminhos, escopos, códigos de erro, nomes de campo,
// JSON — é inglês porque está no fio. Já a moldura da página (busca,
// "Nesta página", "Copiar") é traduzida: ver o namespace `Docs`.
// ============================================================

import type { ApiScope } from '@/lib/api-keys/scopes';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * As linguagens que o realce de sintaxe conhece. Deliberadamente
 * poucas: `code-block.tsx` tokeniza cada uma com um punhado de regex
 * em vez de arrastar um Shiki/Prism (centenas de kB) para uma página
 * que mostra JSON, curl e dois snippets.
 */
export type Language = 'bash' | 'json' | 'js' | 'python' | 'http' | 'text';

/**
 * Marcação inline aceita em QUALQUER `text` deste modelo, e só ela:
 *
 *   `código`            → <code>
 *   **forte**           → <strong>
 *   [rótulo](/destino)  → link (interno vira <Link>, externo abre fora)
 *
 * Um subconjunto minúsculo de Markdown, resolvido por `rich-text.tsx`.
 * Deliberadamente pequeno: o dia em que a prosa precisar de mais do que
 * isso, o que ela precisa é de um bloco novo, não de um parser maior.
 */
export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; id: string; text: string }
  | { kind: 'h3'; id: string; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'code'; language: Language; code: string; title?: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | {
      kind: 'callout';
      tone: 'note' | 'warn' | 'danger';
      title?: string;
      text: string;
    }
  | { kind: 'cards'; items: DocCard[] };

export interface DocCard {
  title: string;
  text: string;
  href: string;
  /** Nome de um ícone em `card-icons.tsx`. String para manter o spec puro. */
  icon: 'key' | 'send' | 'webhook' | 'contacts' | 'deals' | 'releases' | 'hook';
}

/**
 * Um parâmetro — de caminho, de query ou de corpo. `children` aninha
 * um objeto (o `template` de uma mensagem, por exemplo) sem inventar um
 * segundo tipo para isso.
 */
export interface Param {
  name: string;
  type: string;
  required?: boolean;
  description: string;
  /** Mostrado como `Padrão: …` sob a descrição. */
  defaultValue?: string;
  /** Valores aceitos, renderizados como chips. */
  values?: string[];
  example?: string;
  children?: Param[];
}

/** Uma aba do painel de resposta: o status e o corpo daquele status. */
export interface ResponseExample {
  status: number;
  /** Rótulo curto quando o status sozinho não diz (`201` vs `200`). */
  label?: string;
  json: string;
}

export interface Endpoint {
  slug: string;
  title: string;
  summary: string;
  method: Method;
  /** Caminho com `{placeholders}`, como aparece na barra do topo. */
  path: string;
  /**
   * O escopo que a chave precisa carregar, ou `null` para "basta uma
   * chave válida" — hoje só `GET /api/v1/me`.
   */
  scope: ApiScope | null;
  /** Prosa antes das tabelas de parâmetros. */
  intro?: Block[];
  pathParams?: Param[];
  query?: Param[];
  body?: Param[];
  /**
   * O corpo JSON usado pelos exemplos gerados E pelo playground. Texto,
   * não objeto, para que o exemplo possa trazer comentários e a ordem
   * das chaves que a prosa cita.
   */
  requestExample?: string;
  responses: ResponseExample[];
  /** Prosa depois das tabelas — semântica, limites, armadilhas. */
  notes?: Block[];
}

export interface GuidePage {
  slug: string;
  title: string;
  summary: string;
  blocks: Block[];
}

/**
 * Uma página da barra lateral. `releases` não carrega conteúdo: ela é
 * desenhada a partir de `RELEASES` (`lib/releases.ts`), a mesma lista
 * que alimenta Configurações › Novidades — duas superfícies, uma fonte.
 */
export type DocPage =
  | ({ type: 'guide' } & GuidePage)
  | ({ type: 'endpoint' } & Endpoint)
  | { type: 'releases'; slug: string; title: string; summary: string };

export interface DocGroup {
  /** `null` para o bloco de topo, que não leva cabeçalho. */
  label: string | null;
  pages: DocPage[];
}
