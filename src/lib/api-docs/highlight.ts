// ============================================================
// Realce de sintaxe, em cem linhas, sem dependência.
//
// Shiki e Prism resolvem isto melhor e custam entre 200 kB e 1 MB de
// gramáticas para uma página que mostra JSON, cURL e dois snippets de
// vinte linhas. O que esta documentação precisa é distinguir string de
// número de chave de comentário — e isso é um punhado de regex.
//
// Puro e sem I/O, para que `highlight.test.ts` possa fixar o que
// importa: que a soma dos tokens devolve o texto original caractere a
// caractere. Um realce que come um caractere é pior do que nenhum.
// ============================================================

import type { Language } from './types';

export type TokenKind = 'plain' | 'str' | 'num' | 'kw' | 'com' | 'key' | 'punc';

export interface Token {
  text: string;
  kind: TokenKind;
}

/**
 * Regras por linguagem, NA ORDEM em que competem.
 *
 * A ordem é o algoritmo inteiro: comentário antes de string, senão um
 * `//` dentro de aspas vira comentário; chave antes de string, senão
 * toda chave de JSON fica com cor de valor. Cada padrão usa apenas
 * grupos `(?:…)` — o índice do grupo capturado é o que identifica a
 * regra, então um grupo capturante a mais desalinha tudo.
 */
const RULES: Record<Language, [TokenKind, string][]> = {
  json: [
    ['com', '//[^\\n]*'],
    ['key', '"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)'],
    ['str', '"(?:[^"\\\\]|\\\\.)*"'],
    ['kw', '\\b(?:true|false|null)\\b'],
    ['num', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
    ['punc', '[{}\\[\\],:]'],
  ],
  bash: [
    ['com', '#[^\\n]*'],
    ['str', "'(?:[^']|\\\\')*'"],
    ['str', '"(?:[^"\\\\]|\\\\.)*"'],
    ['kw', '\\b(?:curl|export)\\b'],
    ['num', '\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?'],
    ['key', '(?:^|\\s)-{1,2}[A-Za-z][A-Za-z0-9-]*'],
  ],
  js: [
    ['com', '//[^\\n]*'],
    ['com', '/\\*[\\s\\S]*?\\*/'],
    ['str', '`(?:[^`\\\\]|\\\\.)*`'],
    ['str', "'(?:[^'\\\\]|\\\\.)*'"],
    ['str', '"(?:[^"\\\\]|\\\\.)*"'],
    [
      'kw',
      '\\b(?:const|let|var|async|await|function|return|if|else|new|import|export|default|from|for|while|do|of|in|throw|try|catch|null|true|false)\\b',
    ],
    ['num', '\\b\\d+(?:\\.\\d+)?\\b'],
    ['punc', '[{}\\[\\]();,]'],
  ],
  python: [
    ['com', '#[^\\n]*'],
    ['str', '"""[\\s\\S]*?"""'],
    ['str', "'(?:[^'\\\\]|\\\\.)*'"],
    ['str', '"(?:[^"\\\\]|\\\\.)*"'],
    [
      'kw',
      '\\b(?:import|from|def|return|if|else|elif|with|as|for|in|while|try|except|raise|None|True|False)\\b',
    ],
    ['num', '\\b\\d+(?:\\.\\d+)?\\b'],
    ['punc', '[{}\\[\\](),:]'],
  ],
  http: [
    ['com', '//[^\\n]*'],
    ['kw', '^(?:GET|POST|PATCH|PUT|DELETE)\\b'],
    ['key', '^[A-Za-z][A-Za-z-]*(?=:)'],
    ['str', '"(?:[^"\\\\]|\\\\.)*"'],
    ['punc', '[{}\\[\\],]'],
  ],
  text: [],
};

const COMPILED = new Map<Language, RegExp | null>();

function compiled(language: Language): RegExp | null {
  if (!COMPILED.has(language)) {
    const rules = RULES[language];
    COMPILED.set(
      language,
      rules.length
        ? new RegExp(rules.map(([, source]) => `(${source})`).join('|'), 'gm')
        : null
    );
  }
  return COMPILED.get(language) ?? null;
}

/**
 * Quebra o código em tokens. A concatenação dos `text` devolvidos é
 * sempre idêntica à entrada — o que sobra entre um casamento e o
 * seguinte volta como `plain`.
 */
export function highlight(code: string, language: Language): Token[] {
  const pattern = compiled(language);
  if (!pattern) return [{ text: code, kind: 'plain' }];

  const rules = RULES[language];
  const out: Token[] = [];
  let last = 0;

  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    // Um padrão que casa vazio (não deveria acontecer, mas um `*` mal
    // escrito no futuro pode) travaria o laço. Avança e segue.
    if (match[0] === '') {
      pattern.lastIndex += 1;
      continue;
    }

    if (match.index > last) {
      out.push({ text: code.slice(last, match.index), kind: 'plain' });
    }

    const groupIndex = match.findIndex(
      (value, i) => i > 0 && value !== undefined
    );
    const kind: TokenKind = groupIndex > 0 ? rules[groupIndex - 1][0] : 'plain';
    out.push({ text: match[0], kind });

    last = match.index + match[0].length;
  }

  if (last < code.length) out.push({ text: code.slice(last), kind: 'plain' });

  return out;
}
