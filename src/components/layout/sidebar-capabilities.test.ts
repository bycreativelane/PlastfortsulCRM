import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Toda capability declarada num item de menu tem a chamada `useCapability`
 * correspondente.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE TESTE EXISTE
 * ------------------------------------------------------------------
 *
 * `sidebar.tsx` monta o mapa `can` à mão, porque um hook não pode ir dentro
 * de um laço. O mapa é `Partial<Record<Capability, boolean>>` — e tem que
 * ser, já que o produto tem mais capabilities do que linhas de menu.
 *
 * O efeito colateral é uma armadilha: declarar `capability: 'x.view'` num
 * item e esquecer a linha `'x.view': useCapability('x.view')` **compila,
 * passa no lint, passa em todos os outros testes — e some com a linha do
 * menu**. `can[cap]` devolve `undefined`, o filtro descarta o item, e não
 * há erro em lugar nenhum.
 *
 * Já aconteceu duas vezes: com o Playbook, e com a Agenda na 0.10.0 — esta
 * segunda foi para produção. O arquivo tem um `console.error` em dev para
 * avisar, mas um aviso no console do navegador só é visto por quem abre o
 * console do navegador, e ninguém abre o console para conferir um menu.
 *
 * Ler o arquivo como texto não é elegante. É o que funciona: o mapa e a
 * lista vivem no mesmo módulo e o teste compara os dois sem precisar
 * montar um React inteiro com sessão, perfil e papel.
 */

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/components/layout/sidebar.tsx'),
  'utf8'
);

/** As capabilities que os itens de menu exigem. */
function declaredCapabilities(): Set<string> {
  const found = new Set<string>();
  for (const m of SOURCE.matchAll(/capability:\s*'([^']+)'/g)) {
    found.add(m[1]);
  }
  return found;
}

/** As capabilities que o mapa `can` responde. */
function answeredCapabilities(): Set<string> {
  const block = SOURCE.match(
    /const can: Partial<Record<Capability, boolean>> = \{([\s\S]*?)\n {2}\};/
  );
  if (!block) throw new Error('mapa `can` não encontrado em sidebar.tsx');

  const found = new Set<string>();
  for (const m of block[1].matchAll(/'([^']+)':\s*useCapability\('([^']+)'\)/g)) {
    // A chave e o argumento têm que ser o MESMO: `'a': useCapability('b')`
    // responderia sempre a pergunta errada, e em silêncio.
    expect(m[1], 'chave e argumento divergem no mapa `can`').toBe(m[2]);
    found.add(m[1]);
  }
  return found;
}

describe('sidebar', () => {
  it('toda capability de item de menu está no mapa `can`', () => {
    const declared = [...declaredCapabilities()].sort();
    const answered = answeredCapabilities();

    const faltando = declared.filter((cap) => !answered.has(cap));

    expect(
      faltando,
      'Estas capabilities são exigidas por um item de menu mas não têm ' +
        '`useCapability` no mapa `can` — as linhas nunca vão aparecer'
    ).toEqual([]);
  });

  it('encontra as capabilities de verdade, e não uma lista vazia', () => {
    // Um teste que lê o arquivo por regex pode passar por não ter achado
    // nada. Esta asserção é o que impede o falso verde.
    expect(declaredCapabilities().size).toBeGreaterThan(5);
    expect(answeredCapabilities().size).toBeGreaterThan(5);
  });
});
