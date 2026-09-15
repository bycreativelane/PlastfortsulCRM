/**
 * O TEXTO DE UM CAMPO DE DINHEIRO COM CENTAVOS — ler e escrever.
 *
 * Puro, sem React, para poder ser testado caractere por caractere. O
 * componente é `money-input.tsx`.
 *
 * ------------------------------------------------------------------
 * POR QUE NÃO O MODO "CAIXA REGISTRADORA"
 * ------------------------------------------------------------------
 *
 * O jeito mais simples de aceitar centavos é o dos aplicativos de banco:
 * cada dígito entra pela direita, e digitar 8, 0 dá R$ 0,80. Aqui ele seria
 * uma armadilha: o campo de frete aceitava reais inteiros até hoje, e quem
 * digita "80" por hábito mandaria um pedido com R$ 0,80 de frete sem
 * perceber. Então "80" continua sendo R$ 80,00, e os centavos entram
 * depois da vírgula — que é como se digita valor no Bling.
 *
 * ------------------------------------------------------------------
 * O PONTO QUE ÀS VEZES É VÍRGULA
 * ------------------------------------------------------------------
 *
 * Em português o separador decimal é a vírgula e o ponto agrupa milhares:
 * "1.117,00". Quem cola de uma planilha em inglês traz "1117.00", e ler o
 * ponto como agrupador daria R$ 111.700,00 — um erro de cem vezes que não
 * se nota olhando rápido.
 *
 * A regra: se não há vírgula nenhuma e há EXATAMENTE um ponto seguido de
 * um ou dois dígitos no fim, o ponto é decimal ("80.5", "1117.00"). Com
 * três dígitos depois ("1.117") ele continua agrupando milhares, que é o
 * que ele quer dizer em português.
 */

/** Dez dígitos inteiros: o NUMERIC(12,2) do banco, com folga nenhuma a mais. */
const MAX_INTEIROS = 10;

export interface MoneyText {
  /** O que o campo mostra enquanto a pessoa digita. */
  text: string;
  /** O valor em centavos, ou `null` quando o campo está vazio. */
  cents: number | null;
}

/** O separador decimal do idioma — "," em pt-BR e ko, "." em en. */
export function decimalSeparatorFor(locale: string): string {
  const parte = new Intl.NumberFormat(locale)
    .formatToParts(1.5)
    .find((p) => p.type === 'decimal');
  return parte?.value ?? ',';
}

function agrupar(inteiro: string, locale: string): string {
  if (inteiro === '') return '';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Number(inteiro)
  );
}

/**
 * O que a pessoa digitou (ou colou) vira texto formatado e centavos.
 *
 * Mantém a vírgula e os dígitos decimais que ela já digitou — "80," fica
 * "80," e não volta a "80" no meio da digitação, o que tornaria impossível
 * escrever a vírgula.
 */
export function parseMoneyText(raw: string, locale: string): MoneyText {
  const sep = decimalSeparatorFor(locale);
  const outro = sep === ',' ? '.' : ',';
  let s = raw.trim();

  if (!s.includes(sep)) {
    const ocorrencias = s.split(outro).length - 1;
    const decimalNoFim = new RegExp(`\\${outro}\\d{1,2}$`).test(s);
    if (ocorrencias === 1 && decimalNoFim) s = s.replace(outro, sep);
  }

  const i = s.indexOf(sep);
  const parteInteira = i === -1 ? s : s.slice(0, i);
  const parteDecimal = i === -1 ? null : s.slice(i + 1);

  const inteiro = parteInteira
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, MAX_INTEIROS);
  const decimal =
    parteDecimal === null ? null : parteDecimal.replace(/\D/g, '').slice(0, 2);

  if (inteiro === '' && (decimal === null || decimal === '')) {
    // Só uma vírgula digitada: o campo mostra "0," para a pessoa seguir.
    return { text: decimal === null ? '' : `0${sep}`, cents: null };
  }

  const cents =
    Number(inteiro || '0') * 100 + Number((decimal ?? '').padEnd(2, '0'));
  const text =
    (inteiro === '' ? '0' : agrupar(inteiro, locale)) +
    (decimal === null ? '' : `${sep}${decimal}`);

  return { text, cents };
}

/** Centavos para o texto "em repouso" do campo: sempre com duas casas. */
export function formatMoneyCents(cents: number | null, locale: string): string {
  if (cents === null) return '';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Onde o cursor fica depois de reformatar: depois do mesmo número de
 * caracteres SIGNIFICATIVOS (dígitos e o separador decimal). Os pontos de
 * milhar mudam de lugar a cada tecla; os dígitos não.
 */
export function caretAfterSignificant(
  formatted: string,
  count: number,
  sep: string
): number {
  if (count <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]) || formatted[i] === sep) {
      vistos += 1;
      if (vistos === count) return i + 1;
    }
  }
  return formatted.length;
}

/** Quantos caracteres significativos há antes de uma posição. */
export function significantBefore(
  text: string,
  position: number,
  sep: string
): number {
  let n = 0;
  for (let i = 0; i < Math.min(position, text.length); i++) {
    if (/\d/.test(text[i]) || text[i] === sep) n += 1;
  }
  return n;
}
