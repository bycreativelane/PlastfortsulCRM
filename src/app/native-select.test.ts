import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nenhum componente desenha um `<select>` nativo.
 *
 * ------------------------------------------------------------------
 * POR QUE ISTO MERECE UM TESTE
 * ------------------------------------------------------------------
 *
 * O painel de um select nativo no Windows é uma lista cinza-clara com texto
 * preto e destaque azul, desenhada pelo sistema. **Nenhum CSS alcança
 * aquilo** — nem `appearance: none`, que só some com a seta. Fechado, o
 * campo é indistinguível de qualquer outro do formulário; aberto, é um
 * buraco na interface.
 *
 * O produto já passou por isso: `option-select.tsx` foi escrito para
 * substituir o `NativeSelect`, e o comentário de topo dele registra a
 * reclamação original — "um tapa no olho".
 *
 * Só que remover não impede voltar. Em 7 de setembro de 2026 três deles
 * entraram de novo, em telas novas, e a primeira notícia foi uma captura de
 * tela do dropdown branco no meio do app. Nem o compilador, nem o lint, nem
 * os outros 1810 testes tinham o que dizer.
 *
 * ------------------------------------------------------------------
 * E AS EXCEÇÕES
 * ------------------------------------------------------------------
 *
 * `option-select.tsx` e `select.tsx` podem, porque são a implementação:
 * quem constrói a alternativa precisa citar o que substitui. É a mesma
 * isenção que `type-scale.test.ts` se dá.
 */

const SRC = join(process.cwd(), 'src');

/** Uma abertura do elemento, com ou sem atributos na mesma linha. */
const NATIVE_SELECT = /<select[\s>]/;

/** Quem constrói a alternativa, e este arquivo, que precisa nomeá-la. */
const ALLOWED = new Set([
  'option-select.tsx',
  'select.tsx',
  'native-select.test.ts',
]);

/**
 * Tira comentários antes de procurar.
 *
 * Sem isto, a primeira execução deste teste acusou dois arquivos por
 * MENCIONAREM o elemento numa frase — um deles o comentário que explica por
 * que não se deve usá-lo. Um guarda que reprova quem documenta a regra é um
 * guarda que alguém desliga na terceira vez.
 *
 * A remoção é grosseira de propósito: não é um parser e não precisa ser. O
 * risco de uma barra dupla dentro de string apagar código real existe, e o
 * segundo teste deste arquivo — o que exige achar arquivos — é a rede
 * contra a varredura virar vazia sem ninguém notar.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (ALLOWED.has(entry)) return [];
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('native select', () => {
  it('no component renders one — use OptionSelect', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      source.split('\n').forEach((line, i) => {
        if (NATIVE_SELECT.test(line)) {
          offenders.push(`${file.replace(SRC, 'src')}:${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      'Um select nativo abre o painel do sistema operacional, que nenhum ' +
        'CSS alcança. Use `OptionSelect` de @/components/ui/option-select — ' +
        'ele aceita os mesmos `<option>` como filhos.'
    ).toEqual([]);
  });

  it('finds files at all — guards against a silent empty pass', () => {
    // Um teste que varre arquivos pode passar por não ter varrido nenhum.
    expect(sourceFiles(SRC).length).toBeGreaterThan(200);
  });
});
