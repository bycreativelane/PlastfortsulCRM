import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Um campo de texto em `components/ui/` carrega `data-slot="input"`.
 *
 * ------------------------------------------------------------------
 * O QUE ACONTECEU
 * ------------------------------------------------------------------
 *
 * O `PhoneInput` desenhava um `<input>` NU com `className={cn(className)}` e
 * nada mais. Na ficha do contato, ao lado de três irmãos que usam o `Input`
 * da casa, ele ficava assim — medido no navegador, não estimado:
 *
 *              Input da casa      PhoneInput
 *   largura    acompanha a coluna  trava em ~215px (o `size` padrão do UA)
 *   altura     32px                24px
 *   padding    10px                0
 *   borda      1px                 0
 *   raio       8px                 0
 *
 * A borda é a parte que engana. Os dois call sites passavam `border-border`,
 * que é COR; o preflight do Tailwind zera `border-width` em tudo, então
 * pintar uma borda que não existe não desenha nada. O campo aparecia sem
 * contorno, com o número colado na margem esquerda, e ninguém tinha escrito
 * uma linha errada em lugar nenhum — o defeito era o que NÃO estava lá.
 *
 * ------------------------------------------------------------------
 * POR QUE O ATRIBUTO, E NÃO A APARÊNCIA
 * ------------------------------------------------------------------
 *
 * Porque `data-slot="input"` é o que menos se vê e mais custa perder: é por
 * ele que o `globals.css` dá 44px de altura no ponteiro grosso, e o bloco lá
 * explica que num `<input>` — elemento substituído — o escudo `::before` não
 * funciona, então a regra por atributo é a ÚNICA que alcança um campo. Sem o
 * atributo, o telefone era um alvo de 24px num formulário; no componente cujo
 * `type="tel"` existe, diz o comentário dele, porque é do celular que a
 * maioria dos contatos é cadastrada.
 *
 * E porque o atributo é verificável. "Tem a receita certa" exigiria comparar
 * listas de classes e envelheceria na primeira mudança do `Input`; o atributo
 * é uma string, e quem o escreve está declarando que copiou a receita.
 *
 * ------------------------------------------------------------------
 * O ESCOPO, E POR QUE ELE PARA EM `ui/`
 * ------------------------------------------------------------------
 *
 * Aqui moram os átomos, e um átomo que perde a receita multiplica o defeito
 * por todos os call sites dele — foi o que aconteceu: dois. Uma tela que
 * desenha um `<input>` à mão erra sozinha.
 *
 * Isso NÃO quer dizer que as telas estejam limpas. Em 8 de setembro de 2026
 * havia três fora daqui — `layout/global-search.tsx`, `tasks/tasks-page.tsx`
 * e `dashboard/period-picker.tsx` — e elas estão anotadas no worklog em vez
 * de escondidas numa lista de exceções aqui. Uma guarda com exceções que
 * ninguém decidiu é uma guarda que passa verde sem procurar nada.
 *
 * A lista de isenções por TIPO abaixo é outra coisa: um `type="file"` ou um
 * `type="checkbox"` não é um campo de texto e não tem a receita de um.
 */

const UI = join(process.cwd(), 'src', 'components', 'ui');

/** Tipos que não são campo de texto e não devem a receita de um. */
const NOT_A_TEXT_FIELD = new Set([
  'hidden',
  'file',
  'checkbox',
  'radio',
  'color',
  'range',
  'submit',
  'reset',
  'button',
  'image',
]);

/**
 * Tira comentários antes de procurar.
 *
 * Mesma razão que em `native-select.test.ts`: sem isto, o comentário que
 * explica a regra é acusado por citá-la — e a explicação do `phone-input`
 * fala de `<input>` nu em três parágrafos. As quebras de linha do bloco são
 * preservadas para o número da linha continuar sendo o do problema.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) =>
      '\n'.repeat((block.match(/\n/g) ?? []).length)
    )
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function uiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return uiFiles(full);
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) return [];
    return /\.tsx$/.test(entry) ? [full] : [];
  });
}

/**
 * Cada abertura de `<input …>`, com a tag inteira e a linha em que começa.
 *
 * A tag é lida até o `>` que a fecha porque os atributos quase sempre estão
 * em linhas diferentes — procurar `data-slot` só na linha do `<input` não
 * acharia nenhum dos que existem.
 */
function inputTags(source: string): { line: number; tag: string }[] {
  const out: { line: number; tag: string }[] = [];
  const open = /<input[\s/>]/g;
  let match: RegExpExecArray | null;

  while ((match = open.exec(source))) {
    const start = match.index;
    const end = source.indexOf('>', start);
    out.push({
      line: source.slice(0, start).split('\n').length,
      tag: source.slice(start, end === -1 ? source.length : end + 1),
    });
  }
  return out;
}

function typeOf(tag: string): string | null {
  return /type="([a-z]+)"/.exec(tag)?.[1] ?? null;
}

describe('campo de texto em ui/', () => {
  it('todo <input> de texto declara data-slot="input"', () => {
    const offenders: string[] = [];

    for (const file of uiFiles(UI)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const { line, tag } of inputTags(source)) {
        const type = typeOf(tag);
        if (type && NOT_A_TEXT_FIELD.has(type)) continue;
        if (tag.includes('data-slot="input"')) continue;
        offenders.push(
          `${file.replace(join(process.cwd(), 'src'), 'src')}:${line}`
        );
      }
    }

    expect(
      offenders,
      'Um `<input>` de texto sem `data-slot="input"` fica fora da regra de ' +
        '44px do ponteiro grosso em globals.css, e quase sempre está sem a ' +
        'receita inteira junto. Use o `Input` de @/components/ui/input; se o ' +
        'campo precisa mesmo do elemento nu (o `CurrencyInput` precisa, por ' +
        'causa do símbolo sobreposto), copie a receita E o atributo.'
    ).toEqual([]);
  });

  it('acha arquivos — guarda contra a varredura vazia', () => {
    // Uma varredura pode passar por não ter varrido nada. Este número é o
    // piso; `ui/` tinha ~60 componentes quando isto foi escrito.
    expect(uiFiles(UI).length).toBeGreaterThan(30);
  });

  it('acha os <input> dentro dos arquivos', () => {
    // E pode passar por ter varrido os arquivos e não ter encontrado uma
    // única tag — um regex quebrado tem exatamente essa aparência. Os três
    // de hoje são o currency, o date e o time; os três precisam do elemento
    // nu e os três copiam a receita à mão.
    const total = uiFiles(UI).reduce(
      (n, file) =>
        n + inputTags(stripComments(readFileSync(file, 'utf8'))).length,
      0
    );
    expect(total).toBeGreaterThanOrEqual(3);
  });
});
