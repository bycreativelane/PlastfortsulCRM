/**
 * FRETE POR CONTA — o código `fretePorConta` do Bling.
 *
 * ------------------------------------------------------------------
 * O QUE ESTAVA GRAVADO, E POR QUE MUDOU
 * ------------------------------------------------------------------
 *
 * A 075 criou `deals.freight_mode` dizendo que ele guardaria "o código de
 * 0 a 9 do Bling". A gaveta gravou a CHAVE do catálogo de tradução —
 * `freightCif`, `freightFob`… —, e dois comentários do código discordavam
 * sobre o que estava lá (um dizia "código", outro dizia "texto").
 *
 * Uma chave de i18n é detalhe de interface: renomear a mensagem mudaria o
 * que as linhas gravadas significam, e nenhum sistema de fora sabe o que
 * é `freightOwnSender`. O código é fixo em todo pedido do país e é o que o
 * payload do Bling leva.
 *
 * A 078 converte o que já estava gravado. Este arquivo lê AS DUAS formas
 * para sempre — a app pode rodar contra um banco em que a 078 ainda não
 * foi aplicada — e grava só o código.
 */

export const FREIGHT_PAYER_CODES = ['0', '1', '2', '3', '4', '9'] as const;

export type FreightPayerCode = (typeof FREIGHT_PAYER_CODES)[number];

/** A chave de tradução de cada código — o rótulo que a pessoa lê. */
export const FREIGHT_LABEL_KEY = {
  '0': 'freightCif',
  '1': 'freightFob',
  '2': 'freightThird',
  '3': 'freightOwnSender',
  '4': 'freightOwnReceiver',
  '9': 'freightNone',
} as const satisfies Record<FreightPayerCode, string>;

export type FreightLabelKey = (typeof FREIGHT_LABEL_KEY)[FreightPayerCode];

const CODE_BY_LEGACY_KEY: Record<string, FreightPayerCode> = Object.fromEntries(
  Object.entries(FREIGHT_LABEL_KEY).map(([codigo, chave]) => [
    chave,
    codigo as FreightPayerCode,
  ])
);

/**
 * O código, a partir do que estiver gravado — código, chave antiga ou nada.
 *
 * Qualquer outra coisa vira `null` em vez de passar adiante: um valor que
 * não é nem código nem chave não pode chegar ao payload de um pedido.
 */
export function freightCode(
  valor: string | null | undefined
): FreightPayerCode | null {
  const v = (valor ?? '').trim();
  if ((FREIGHT_PAYER_CODES as readonly string[]).includes(v)) {
    return v as FreightPayerCode;
  }
  return CODE_BY_LEGACY_KEY[v] ?? null;
}

/** A chave de tradução do rótulo, para quem desenha. */
export function freightLabelKey(
  valor: string | null | undefined
): FreightLabelKey | null {
  const codigo = freightCode(valor);
  return codigo ? FREIGHT_LABEL_KEY[codigo] : null;
}
