import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * UM `Button` QUE VIRA LINK DIZ ISSO AO BASE UI.
 *
 * ------------------------------------------------------------------
 * O DEFEITO
 * ------------------------------------------------------------------
 *
 * O `Button` desta casa é o do Base UI, que por padrão presume estar
 * desenhando um `<button>` de verdade (`nativeButton`). Quando o `render`
 * troca o elemento por um `<Link>` — um `<a>` —, ele continua presumindo,
 * e o console do navegador acusa em toda renderização:
 *
 *     Base UI: A component that acts as a button expected a native
 *     <button> because the `nativeButton` prop is true. Rendering a
 *     non-<button> removes native button semantics, which can impact
 *     forms and accessibility.
 *
 * As telas de login, cadastro e convite já passam `nativeButton={false}`
 * nesse caso. Três lugares não passavam — o link do arquivo e o "Abrir
 * PDF" do orçamento, e o "Abrir conversa" da ficha do contato — e foi
 * preciso abrir o bench em 14 de setembro de 2026, com o overlay do Next
 * contando "1 Issue", para alguém ver.
 *
 * ------------------------------------------------------------------
 * POR QUE UM GUARDA
 * ------------------------------------------------------------------
 *
 * O TypeScript aceita as duas formas, o teste passa nas duas, e a tela
 * funciona nas duas: o erro só existe no console de desenvolvimento, que
 * ninguém lê enquanto a página parece certa. A regra estava escrita — em
 * forma de código, em seis lugares — e foi quebrada em três.
 *
 * Grosseiro de propósito: um `<Button` cujo `render` é um `<Link` ou um
 * `<a` precisa de `nativeButton={false}` na mesma tag. Não percorre JSX de
 * verdade; lê a tag de abertura. Não há alarme falso com que discutir.
 */

const SRC = join(process.cwd(), 'src');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const cheio = join(dir, nome);
    if (statSync(cheio).isDirectory()) return arquivos(cheio);
    return nome.endsWith('.tsx') ? [cheio] : [];
  });
}

/**
 * A tag de abertura que começa em `inicio`: até o primeiro `>` fora de
 * chaves e de aspas. O `>` de `render={<Link />}` e o de `() =>` estão
 * dentro de chaves, então não contam.
 */
function tagDeAbertura(fonte: string, inicio: number): string {
  let chaves = 0;
  let aspas: string | null = null;
  for (let i = inicio; i < fonte.length; i++) {
    const c = fonte[i];
    if (aspas) {
      if (c === aspas) aspas = null;
      continue;
    }
    if (chaves === 0 && (c === '"' || c === "'")) aspas = c;
    else if (c === '{') chaves++;
    else if (c === '}') chaves--;
    else if (c === '>' && chaves === 0) return fonte.slice(inicio, i + 1);
  }
  return fonte.slice(inicio);
}

describe('Button renderizado como link', () => {
  const lista = arquivos(SRC);

  it('acha arquivos — sem isto o teste passa no vazio', () => {
    expect(lista.length).toBeGreaterThan(200);
  });

  it('declara `nativeButton={false}`', () => {
    const acusados: string[] = [];

    for (const arquivo of lista) {
      const fonte = readFileSync(arquivo, 'utf8');
      for (const m of fonte.matchAll(/<Button\b/g)) {
        const tag = tagDeAbertura(fonte, m.index ?? 0);
        const viraLink = /render=\{\s*<(Link|a)\b/.test(tag);
        if (viraLink && !/nativeButton=\{false\}/.test(tag)) {
          const linha = fonte.slice(0, m.index).split('\n').length;
          acusados.push(`${arquivo.replace(SRC, 'src')}:${linha}`);
        }
      }
    }

    expect(
      acusados,
      'Um <Button render={<Link />}> sem `nativeButton={false}` faz o Base ' +
        'UI acusar no console a cada renderização — ele presume um <button> ' +
        'nativo. Ver o comentário no topo deste arquivo.'
    ).toEqual([]);
  });
});
