/**
 * DINHEIRO EM CENTAVOS — a conta que o banco faz, feita igual aqui.
 *
 * ------------------------------------------------------------------
 * O DEFEITO, MEDIDO NO PRÓPRIO POSTGRES
 * ------------------------------------------------------------------
 *
 * `deal_items.total` é uma coluna GENERATED da 054:
 *
 *     ROUND(quantity * unit_price * (1 - discount_percent / 100), 2)
 *
 * sobre NUMERIC, que é aritmética decimal EXATA com arredondamento de
 * meio para longe do zero. A tela, o documento e a impressão digital
 * faziam a mesma conta em `number` (float64):
 *
 *     Math.round(q * p * (1 - d / 100) * 100) / 100
 *
 * e as duas discordam exatamente onde importa: no meio centavo. Em 14 de
 * setembro de 2026 foram gravadas 72 linhas-sonda no banco de teste — 24
 * delas caindo em meio centavo exato — e o `total` lido de volta comparado
 * com as duas contas:
 *
 *     conta inteira (este arquivo)   72 de 72 iguais ao banco
 *     conta em float (a anterior)     3 divergentes, todas no meio centavo
 *
 *     1 × R$ 2,01 com 50 %    banco 1,01    float 1,00
 *     1 × R$ 1,15 com 10 %    banco 1,04    float 1,03
 *     3 × R$ 0,35 com 50 %    banco 0,53    float 0,52
 *
 * Um centavo parece nada até o pedido ir para um ERP. O Bling confere
 * totais, as parcelas têm de somar EXATAMENTE o total da venda, e a tela
 * mostrava R$ 0,52 numa linha que o banco gravava como R$ 0,53 — o
 * documento dizendo um número e `deals.value` dizendo outro.
 *
 * ------------------------------------------------------------------
 * COMO A CONTA É FEITA
 * ------------------------------------------------------------------
 *
 * Cada fator vira o inteiro que ele é na escala da coluna: quantidade em
 * milésimos (NUMERIC(12,3)), preço em centavos (NUMERIC(12,2)), desconto
 * em centésimos de ponto percentual (NUMERIC(5,2)). O produto dos três é
 * exato — em `BigInt`, porque ele passa com folga de 2^53 — e a divisão
 * final arredonda como o NUMERIC.
 *
 * Converter o `number` que chega para a escala com `Math.round(v * 10^k)`
 * é seguro aqui por uma razão específica: a entrada NUNCA tem mais casas
 * do que a escala (os CHECKs e os campos garantem), então o erro do float
 * é uma fração minúscula longe de 0,5 e o arredondamento recupera o
 * decimal exato. O problema nunca foi ler "2,01"; foi multiplicar em float.
 *
 * `BigInt(n)` e não o literal `1n`: o alvo do TypeScript deste projeto não
 * aceita o literal (ver `lib/deals/order-number.ts`).
 */

const ZERO = BigInt(0);
const DOIS = BigInt(2);

/**
 * `n / d`, arredondando o meio para longe do zero — o ROUND do NUMERIC.
 *
 * `(2|n| + d) / 2d` é `⌊|n|/d + 1/2⌋` em inteiros, sem passar por fração
 * nenhuma.
 */
function dividirArredondando(n: bigint, d: bigint): bigint {
  const negativo = n < ZERO;
  const absoluto = negativo ? -n : n;
  const q = (absoluto * DOIS + d) / (d * DOIS);
  return negativo ? -q : q;
}

/** Um valor com até `casas` decimais como o inteiro daquela escala. */
function naEscala(valor: number | string | null | undefined, casas: number) {
  const n = typeof valor === 'string' ? Number(valor) : (valor ?? 0);
  return Number.isFinite(n) ? Math.round(n * 10 ** casas) : 0;
}

/**
 * Reais para centavos inteiros.
 *
 * Aceita `string` porque é assim que um NUMERIC pode chegar do banco, e
 * vazio, `null` e o que não é número viram zero — que é o que eles valem
 * numa soma.
 */
export function toCents(valor: number | string | null | undefined): number {
  return naEscala(valor, 2);
}

/**
 * Centavos de volta para reais.
 *
 * O resultado é o float mais próximo de um valor com duas casas, e é esse
 * o contrato: `Intl` imprime "1,01", `toFixed(2)` devolve "1.01" e o
 * PostgREST grava 1.01 numa coluna NUMERIC(…,2) — nenhum dos três vê o
 * resíduo binário.
 */
export function fromCents(centavos: number): number {
  return centavos / 100;
}

/** Soma em centavos, e só em centavos. */
export function sumCents(valores: number[]): number {
  return valores.reduce((soma, v) => soma + v, 0);
}

/**
 * O total de uma linha, em centavos — a coluna GENERATED da 054, igual.
 *
 * quantidade (milésimos) × preço (centavos) × (10000 − desconto em
 * centésimos de ponto) dá centavos × 10^7; dividir por 10^7 arredondando
 * devolve os centavos.
 */
export function lineTotalCents(item: {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}): number {
  const quantidade = BigInt(naEscala(item.quantity, 3));
  const preco = BigInt(naEscala(item.unitPrice, 2));
  const desconto = BigInt(naEscala(item.discountPercent, 2));
  const numerador = quantidade * preco * (BigInt(10000) - desconto);
  return Number(dividirArredondando(numerador, BigInt(10000000)));
}

/**
 * A soma das linhas, em centavos — o que o gatilho da 054 grava em
 * `deals.value`.
 *
 * Soma os totais JÁ ARREDONDADOS de cada linha, e não o produto bruto
 * delas: o gatilho faz `SUM(total)` sobre a coluna GENERATED, então o
 * arredondamento acontece linha a linha antes da soma, e é essa a ordem
 * que tem de ser imitada.
 */
export function linesTotalCents(
  itens: Array<{ quantity: number; unitPrice: number; discountPercent: number }>
): number {
  return sumCents(itens.map((item) => lineTotalCents(item)));
}

/**
 * Uma porcentagem (até duas casas) de um valor em centavos, arredondada
 * como o NUMERIC. É a conta do desconto geral em PERCENTUAL.
 */
export function percentOfCents(centavos: number, percentual: number): number {
  const pontos = BigInt(naEscala(percentual, 2));
  return Number(dividirArredondando(BigInt(centavos) * pontos, BigInt(10000)));
}
