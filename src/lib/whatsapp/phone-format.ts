import { normalizePhone } from './phone-utils';

/**
 * How a phone number looks to a person.
 *
 * The field asked for "+55 para o Brasil" and then printed back
 * `+555199000001`, which is thirteen digits in a row that somebody has to
 * count with a finger to check. Every number in this product is a Brazilian
 * mobile written the same way on every invoice, every WhatsApp screen and
 * every business card the team has ever seen — and this was the one place
 * that showed it as a string.
 *
 * SAFE BY CONSTRUCTION, and this is the part worth checking before
 * believing: nothing downstream reads the formatting. Meta gets
 * `sanitizePhoneForMeta` (digits only), matching goes through
 * `normalizePhone` (digits only), and `contacts.phone_normalized` is a
 * generated column — `regexp_replace(phone, '\\D', '', 'g')`, migration 022 —
 * so the unique index that stops duplicate contacts is computed from digits
 * whatever the column happens to hold.
 *
 * Even so, what gets STORED stays E.164 (`+5551990000001`). One canonical
 * form in the database, formatting only on the way to a screen: the public
 * v1 API hands `phone` to integrators, and handing them a string with
 * parentheses in it would make every one of them write a parser.
 */

/** Brazil. The only country code this file knows how to GROUP. */
const BR = '55';

/**
 * The two-digit country codes, so the other ones can be told apart.
 *
 * E.164 codes are one, two or three digits and the length is decided by the
 * leading digits, not by guessing: zone 1 (`+1`) and zone 7 (`+7`) are a
 * single digit, this list is the two-digit set, and everything else is
 * three. Slicing a fixed two off the front — which is what this file used to
 * do — renders Paraguay's `+595 991234567` as `+59 5991234567`, a country
 * code that belongs to nobody attached to a number that is now missing a
 * digit. It read as authoritative and it was wrong, which is the one thing
 * the comment on `formatPhone` promises not to do.
 */
const TWO_DIGIT_CODES = new Set([
  '20',
  '27',
  '30',
  '31',
  '32',
  '33',
  '34',
  '36',
  '39',
  '40',
  '41',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '81',
  '82',
  '84',
  '86',
  '90',
  '91',
  '92',
  '93',
  '94',
  '95',
  '98',
]);

/** How many leading digits are the country code. */
function countryCodeLength(digits: string): number {
  if (digits.startsWith('1') || digits.startsWith('7')) return 1;
  if (TWO_DIGIT_CODES.has(digits.slice(0, 2))) return 2;
  return 3;
}

/**
 * Group a number for reading.
 *
 * Brazilian numbers get the shape everybody writes them in —
 * `+55 (51) 99000-0001` for a mobile, `+55 (51) 9900-0001` for a landline.
 * Anything else gets its country code split off and the rest left alone.
 *
 * THAT RESTRAINT IS DELIBERATE. This account talks to transportadoras and
 * suppliers abroad, and there is no correct universal grouping: imposing
 * `(XX) XXXXX-XXXX` on a Paraguayan number produces something that looks
 * authoritative and is wrong. Better an unstyled `+595 991234567` than a
 * confidently mis-grouped one — but the COUNTRY CODE still has to be the
 * real one, so it is measured rather than assumed to be two digits.
 */
export function formatPhone(phone: string | null | undefined): string {
  const digits = normalizePhone(phone ?? '');
  if (!digits) return '';

  if (digits.startsWith(BR)) {
    const rest = digits.slice(BR.length);
    // 10 = landline (2 + 8), 11 = mobile (2 + 9). Anything else is a
    // half-typed number, and it is formatted progressively below so the
    // field does not jump around while somebody is still typing it.
    const ddd = rest.slice(0, 2);
    const local = rest.slice(2);

    if (!ddd) return `+${BR}`;
    if (!local) return `+${BR} (${ddd}`;

    if (local.length <= 4) return `+${BR} (${ddd}) ${local}`;

    // The split point is what tells a mobile from a landline: 9 digits
    // breaks 5-4, 8 breaks 4-4. Below 8 it follows the mobile shape, which
    // is what somebody typing one is heading for.
    const head = local.length >= 9 ? 5 : 4;

    /*
     * `slice(head)` E NÃO `slice(head, head + 4)`. Este era o segundo `4`.
     *
     * O `+ 4` cortava tudo acima de nove dígitos locais — quer dizer, treze
     * no total — e isso seria inofensivo se esta função só pintasse texto.
     * Ela não só pinta: o `PhoneInput` é controlado por ela (`value={display}`)
     * e aceita quinze dígitos (`MAX_PHONE_DIGITS`). Formatador e campo
     * discordavam em dois dígitos, e a diferença ia parar no banco.
     *
     * O que acontecia, medido no navegador com o estado do React lido pelo
     * fiber, digitando um dígito a mais num celular:
     *
     *   na tela   +55 (51) 99000-0001   (não muda mais, tecla o que teclar)
     *   salvo     +55519900000017       (o 14º existe e ninguém o viu)
     *
     * A tela congela porque o próximo caractere é reinterpretado a partir do
     * TEXTO VISÍVEL, que já perdeu o dígito: cada tecla substitui o invisível
     * em vez de acrescentar. Pelo mesmo motivo um Backspace no fim apagava
     * DOIS dígitos de uma vez (14 → 12, medido).
     *
     * E nada rio abaixo pega: `isValidE164` aceita de 7 a 15 dígitos, então
     * um número de 14 passa por toda validação e só falha no envio pela Meta,
     * longe de quem digitou.
     *
     * Não é o teto que está errado. O campo é o único ponto de entrada de
     * telefone do produto e o parágrafo acima explica que esta conta fala com
     * transportadoras e fornecedores fora do Brasil — E.164 vai a quinze, e
     * baixar o teto para treze trocaria um defeito brasileiro por um
     * paraguaio. O certo é o formatador parar de mentir.
     *
     * `+55 (51) 99000-00012` é feio de propósito: nenhum número brasileiro
     * tem tantos dígitos, e a feiura é o aviso de que sobrou um. Conferido
     * por execução em todos os comprimentos: a saída é idêntica, caractere
     * por caractere, de 2 a 13 dígitos — só 14 e 15 mudam, e eles hoje
     * perdem dígito.
     */
    return `+${BR} (${ddd}) ${local.slice(0, head)}-${local.slice(head)}`;
  }

  // Not Brazil: split the country code off so it reads as a country plus a
  // number, and leave the grouping of the rest alone. The LENGTH of that
  // code is derived, not assumed — see `countryCodeLength`.
  const cut = countryCodeLength(digits);
  const cc = digits.slice(0, cut);
  const rest = digits.slice(cut);
  return rest ? `+${cc} ${rest}` : `+${cc}`;
}

/**
 * What goes in the database: `+` and digits, nothing else.
 *
 * Every write path runs through this, so a number typed with a mask, pasted
 * from a spreadsheet with dots in it, or imported from a CSV that used
 * spaces all land as the same string.
 */
export function toE164(phone: string | null | undefined): string {
  const digits = normalizePhone(phone ?? '');
  return digits ? `+${digits}` : '';
}

/**
 * Longest a number can get, in digits.
 *
 * E.164's own ceiling. Used to stop the masked field accepting a number
 * that could never be dialled rather than to validate one that could —
 * `isValidE164` in `./phone-utils` is what answers the second question.
 */
export const MAX_PHONE_DIGITS = 15;

/**
 * Dá para salvar este número, ou ele está pela metade?
 *
 * Os dois editores de contato só perguntavam se o campo estava VAZIO. Um
 * `+55 (51) 9` passava: ia para o banco, e a primeira notícia de que ninguém
 * conseguia falar com aquele cliente vinha lá na frente, num envio que falha
 * longe de quem digitou — e sem dizer que o problema era o número.
 *
 * DOIS COMPRIMENTOS PARA O BRASIL E NENHUM OUTRO: 12 dígitos no fixo
 * (55 + DDD + 8) e 13 no celular (55 + DDD + 9). Não existe número brasileiro
 * de outro tamanho, então aqui dá para ser exato — e `+55` é o código do
 * Brasil e de mais ninguém, então o teste do prefixo não pega estrangeiro por
 * engano.
 *
 * FORA DO BRASIL, a régua larga do E.164 e nada além dela. O cabeçalho do
 * `formatPhone` explica que esta conta fala com transportadoras e
 * fornecedores no exterior, e não há como saber o comprimento certo de um
 * número paraguaio ou chileno daqui. Recusar o que não se sabe julgar seria
 * inventar uma regra e cobrar por ela.
 */
export function isCompletePhone(phone: string | null | undefined): boolean {
  const digits = normalizePhone(phone ?? '');
  if (!digits) return false;
  if (digits.startsWith(BR))
    return digits.length === 12 || digits.length === 13;
  // 7 a 15 dígitos, começando por não-zero — o que o E.164 permite.
  return /^[1-9]\d{6,14}$/.test(digits);
}
