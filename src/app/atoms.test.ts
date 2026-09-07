import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Ninguém reescreve à mão um átomo que já existe.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE TESTE
 * ------------------------------------------------------------------
 *
 * O inventário de 7 de setembro de 2026 encontrou o mesmo contador escrito
 * seis vezes e o mesmo ladrilho de ícone escrito treze — com quatro
 * escritas diferentes para a mesma medida, nenhuma delas com um comentário
 * defendendo o desvio. Não eram decisões; eram digitações.
 *
 * Extrair `CountBadge` e `IconTile` resolve o passado. Este teste resolve o
 * futuro, que é a parte que sempre volta: um componente novo é escrito por
 * quem não sabe que o átomo existe, e nada no compilador, no lint ou nos
 * outros 1800 testes tem o que dizer sobre isso.
 *
 * ------------------------------------------------------------------
 * O QUE É PROCURADO, E O QUE NÃO É
 * ------------------------------------------------------------------
 *
 * Só a MEDIDA canônica de cada um, não a intenção. `h-4.5 min-w-4.5` com
 * `rounded-full` é um contador em qualquer escrita; um quadrado tingido de
 * 28px com `place-items-center` é um ladrilho. Um `size-7` sozinho não é
 * nada e não é procurado — a busca precisa errar para o lado de deixar
 * passar, senão vira ruído e alguém a desliga.
 *
 * Botões de ícone estão FORA de propósito: um ícone que é a ação pede
 * `<Button variant="ghost" size="icon">`, não `IconTile`, e confundir os
 * dois foi o que fez o ladrilho parecer um problema maior do que era.
 */

const SRC = join(process.cwd(), 'src');

/** A pílula de contagem: altura e largura mínima da casa, redonda. */
const HAND_ROLLED_COUNT = /h-4\.5[^"'`]*min-w-4\.5[^"'`]*rounded-full/;

/**
 * O ladrilho: quadrado com preenchimento tonal EM REPOUSO e ícone centrado.
 *
 * O `(?<![\w:-])` é o que separa um ladrilho de um botão de ícone. Sem ele,
 * `hover:bg-muted` casa com `bg-muted` e a busca acusa toda a família de
 * botões fantasma — que é exatamente a peça que NÃO deve virar `IconTile`.
 * Um preenchimento que só existe no hover é um botão; um que existe em
 * repouso é um ladrilho.
 */
const HAND_ROLLED_TILE =
  /(?<![\w:-])(bg-muted|bg-auto-soft|bg-human-soft|bg-ok-soft|bg-danger-soft|bg-primary-soft)[^"'`]*\bsize-[6789]\b[^"'`]*place-items-center/;

/**
 * Um disco não é um ladrilho.
 *
 * `rounded-full` com um ícone dentro é outro objeto: a marca de excedente
 * de uma pilha de avatares, o selo de uma sugestão. Forçá-los ao raio do
 * `IconTile` mudaria a forma, e a forma é o que os distingue. Ficam de fora
 * por decisão, e não por a busca não os alcançar.
 */
const IS_CIRCLE = /rounded-full/;

/** Quem implementa o átomo precisa citar a medida dele. */
const ALLOWED = new Set([
  'count-badge.tsx',
  'icon-tile.tsx',
  'atoms.test.ts',
]);

/** Comentários explicam a regra; explicar não é infringir. */
function stripComments(source: string): string {
  return (
    source
      // As quebras de linha do bloco são PRESERVADAS. Apagá-las desloca
      // tudo o que vem depois, e o guarda passa a apontar para um
      // comentário dezenas de linhas acima do problema real — foi o que a
      // primeira versão deste teste fez, e um guarda que indica o lugar
      // errado custa mais tempo do que economiza.
      .replace(/\/\*[\s\S]*?\*\//g, (block) =>
        '\n'.repeat((block.match(/\n/g) ?? []).length)
      )
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (ALLOWED.has(entry)) return [];
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function offenders(pattern: RegExp, skip?: RegExp): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    source.split('\n').forEach((line, i) => {
      if (pattern.test(line) && !skip?.test(line)) {
        found.push(`${file.replace(SRC, 'src')}:${i + 1}`);
      }
    });
  }
  return found;
}

describe('atoms', () => {
  it('no one hand-rolls a count badge', () => {
    expect(
      offenders(HAND_ROLLED_COUNT),
      'Use `CountBadge` de @/components/ui/count-badge — ele traz a medida ' +
        'da casa (18px, a mesma família do StatusBadge size="sm"). Se o tom ' +
        'que você quer não existe, passe `className`, como o seg-bar faz.'
    ).toEqual([]);
  });

  it('no one hand-rolls an icon tile', () => {
    expect(
      offenders(HAND_ROLLED_TILE, IS_CIRCLE),
      'Use `IconTile` de @/components/ui/icon-tile — ele encadeia tamanho e ' +
        'raio, que eram dois eixos soltos. Se o ícone É a ação, o componente ' +
        'certo é `<Button variant="ghost" size="icon">`.'
    ).toEqual([]);
  });

  it('finds files at all — guards against a silent empty pass', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(200);
  });
});
