import { describe, expect, it } from 'vitest';

import { caretAfterDigits, deleteAcrossSeparator } from './masked-caret';

/**
 * O Backspace que não apagava nada.
 *
 * Medido no navegador, no campo `+55 (51) 99000-0001` com o caret logo depois
 * do `)`: apertar Backspace deixava o campo IGUAL e mandava o caret de 8 para
 * 19 — o fim do número. O próximo Backspace então apagava o último dígito, que
 * não é onde a pessoa estava.
 *
 * O mecanismo: apagar um separador não muda os dígitos, então o valor não
 * muda, o texto formatado não muda, e o efeito que recoloca o caret — que
 * depende dele — não roda. Enquanto isso o React reescreve o valor no
 * `<input>` para ressincronizar o campo controlado, e atribuir `.value` num
 * input estaciona o caret no fim.
 *
 * A regra que estes testes fixam: separador não é conteúdo, é desenho.
 */

/** `+55 (51) 99000-0001` — os índices que importam, para os casos abaixo. */
const CAMPO = '+55 (51) 99000-0001';
//             0123456789...
//             0:+  3:esp  4:(  7:)  8:esp  14:-

describe('deleteAcrossSeparator', () => {
  it('não se mete quando o caret está encostado num dígito', () => {
    // O caso comum, e o navegador acerta sozinho: devolver `null` é o que
    // deixa o Backspace normal continuar sendo o Backspace normal.
    expect(deleteAcrossSeparator(CAMPO, 19, 'back')).toBeNull();
    expect(deleteAcrossSeparator(CAMPO, 3, 'back')).toBeNull();
    expect(deleteAcrossSeparator(CAMPO, 5, 'forward')).toBeNull();
  });

  it('o `+` da frente também é desenho', () => {
    // Caret no começo de tudo, Delete: o que está à direita é o `+`, que o
    // formatador escreveu e ninguém digitou. Apagar o primeiro DÍGITO é a
    // mesma regra dos outros separadores — e a alternativa seria apagar um
    // `+` que reaparece no render seguinte, ou seja, não fazer nada.
    expect(deleteAcrossSeparator(CAMPO, 0, 'forward')).toEqual({
      digits: '551990000001',
      caretDigits: 0,
    });
  });

  it('Backspace sobre um separador apaga o dígito da esquerda', () => {
    // Caret depois do `)`: o que está à esquerda é o `1` do DDD.
    expect(deleteAcrossSeparator(CAMPO, 8, 'back')).toEqual({
      digits: '555990000001',
      caretDigits: 3,
    });

    // Caret depois do `-`: o que está à esquerda é o último `0` de `99000`.
    expect(deleteAcrossSeparator(CAMPO, 15, 'back')).toEqual({
      digits: '555199000001',
      caretDigits: 8,
    });
  });

  it('Delete sobre um separador apaga o dígito da direita', () => {
    // Caret antes do `)`: o que está à direita é o primeiro `9` do local.
    expect(deleteAcrossSeparator(CAMPO, 7, 'forward')).toEqual({
      digits: '555190000001',
      caretDigits: 4,
    });
  });

  it('não apaga dígito nenhum quando não há dígito daquele lado', () => {
    // Caret logo depois do `+`, que abre a string. Não há o que apagar à
    // esquerda, e o certo é o campo ficar como está — não engolir o primeiro
    // dígito só porque o `+` estava no caminho.
    expect(deleteAcrossSeparator(CAMPO, 1, 'back')).toEqual({
      digits: '5551990000001',
      caretDigits: 0,
    });
  });

  it('segurar Backspace some com o número um dígito por vez', () => {
    // A propriedade que interessa de verdade: treze teclas, treze dígitos, e
    // os separadores caindo sozinhos no caminho. Antes do conserto este laço
    // travava na primeira vez que o caret encostava num separador.
    const format = (digits: string) => {
      // O mesmo agrupamento do `formatPhone`, o bastante para o laço.
      const rest = digits.slice(2);
      const ddd = rest.slice(0, 2);
      const local = rest.slice(2);
      if (!digits) return '';
      if (!ddd) return `+55`;
      if (!local) return `+55 (${ddd}`;
      if (local.length <= 4) return `+55 (${ddd}) ${local}`;
      const head = local.length >= 9 ? 5 : 4;
      return `+55 (${ddd}) ${local.slice(0, head)}-${local.slice(head)}`;
    };

    let digits = '5551990000001';
    const vistos: number[] = [];

    for (let i = 0; i < 13; i++) {
      const text = format(digits);
      const plano = deleteAcrossSeparator(text, text.length, 'back');
      // `null` = caret num dígito, e aí o apagar é o do navegador.
      digits = plano ? plano.digits : digits.slice(0, -1);
      vistos.push(digits.length);
    }

    expect(vistos).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(digits).toBe('');
  });
});

/**
 * O mesmo defeito vivia nos DOIS campos mascarados, e é por isso que a decisão
 * virou módulo. O dinheiro é o caso mais fácil de encontrar à mão: o ponto de
 * milhar cai bem no meio de um valor de quatro dígitos.
 */
describe('deleteAcrossSeparator — o campo de dinheiro', () => {
  it('Backspace sobre o ponto de milhar apaga o dígito da esquerda', () => {
    // `18.400`, cursor logo depois do ponto. Antes: campo igual, cursor
    // no fim, e o Backspace seguinte comia o último dígito — que num campo
    // de dinheiro é a diferença entre 18.400 e 1.840.
    expect(deleteAcrossSeparator('18.400', 3, 'back')).toEqual({
      digits: '1400',
      caretDigits: 1,
    });
  });

  it('Delete sobre o ponto apaga o dígito da direita', () => {
    // `18.400` com o cursor ANTES do ponto: o que está à direita dele é o
    // `4`, não o último zero. Sai `1800`.
    expect(deleteAcrossSeparator('18.400', 2, 'forward')).toEqual({
      digits: '1800',
      caretDigits: 2,
    });
  });

  it('não se mete no meio de um grupo de dígitos', () => {
    expect(deleteAcrossSeparator('18.400', 6, 'back')).toBeNull();
    expect(deleteAcrossSeparator('18.400', 1, 'back')).toBeNull();
  });
});

describe('caretAfterDigits', () => {
  it('devolve o índice logo depois do n-ésimo dígito', () => {
    //  1  8  .  4  0  0
    //  0  1  2  3  4  5
    expect(caretAfterDigits('18.400', 1)).toBe(1);
    expect(caretAfterDigits('18.400', 2)).toBe(2);
    // O terceiro dígito é o `4`, no índice 3 — o cursor vai para 4, pulando
    // o ponto sozinho.
    expect(caretAfterDigits('18.400', 3)).toBe(4);
    expect(caretAfterDigits('+55 (51) 99000-0001', 4)).toBe(7);
  });

  it('zero dígitos é o começo da string, não o fim', () => {
    // O caso que decide o campo esvaziado: sem isto o cursor ia para o fim
    // de uma string vazia por um caminho e para o começo por outro.
    expect(caretAfterDigits('18.400', 0)).toBe(0);
    expect(caretAfterDigits('', 0)).toBe(0);
  });

  it('pede mais dígitos do que existem e cai no fim', () => {
    expect(caretAfterDigits('18.400', 99)).toBe(6);
  });
});
