/**
 * CNPJ and CPF — checked, formatted, and used to catch a duplicate
 * before it exists.
 *
 * This is the direct answer to one of the complaints in the research
 * that prompted this pass: *"cadastro de empresa por CNPJ gerando
 * duplicação de informações; a plataforma permite duplicar registros sem
 * restrições"*. The failure it describes is not exotic — it is the same
 * company entered twice, once as `12.345.678/0001-90` and once as
 * `12345678000190`, and from then on half the history is on each row and
 * neither is the customer.
 *
 * Two things stop that, and both are here:
 *
 *   1. A CANONICAL FORM. Digits only, so the two spellings above are one
 *      value and a comparison can actually find the twin.
 *   2. A CHECK DIGIT. `11.111.111/1111-11` is a plausible-looking string
 *      and not a CNPJ; catching it at the keyboard is the difference
 *      between a typo and a record.
 *
 * NOT a hard block. The number goes in either way — a customer who reads
 * their CNPJ wrong over the phone still has to be saved — and what the
 * form does with the answer is warn. A CRM that refuses a record because
 * a field failed a checksum is a CRM people keep in a spreadsheet.
 */

/** Digits only. The comparison key, and what should be stored. */
export function normalizeTaxId(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** `12.345.678/0001-90` or `123.456.789-09`, from anything. */
export function formatTaxId(value: string | null | undefined): string {
  const digits = normalizeTaxId(value);

  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5'
    );
  }
  // Anything else goes back untouched. A half-typed number is not an
  // error, it is somebody mid-keystroke, and reformatting it under the
  // caret is how a field fights the person using it.
  return value ?? '';
}

export type TaxIdKind = 'cpf' | 'cnpj' | 'unknown';

export function taxIdKind(value: string | null | undefined): TaxIdKind {
  const digits = normalizeTaxId(value);
  if (digits.length === 11) return 'cpf';
  if (digits.length === 14) return 'cnpj';
  return 'unknown';
}

/**
 * Does the check digit agree with the rest of the number?
 *
 * `null` for anything that is not a complete CPF or CNPJ — "not a
 * verdict" rather than "invalid", because an empty field and a
 * half-typed one are neither valid nor wrong and a form that says "CNPJ
 * inválido" over three digits is a form people learn to ignore.
 */
export function isValidTaxId(value: string | null | undefined): boolean | null {
  const digits = normalizeTaxId(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return null;
}

/**
 * The mod-11 both documents use, with the weight ladder as the only
 * difference.
 *
 * Written once rather than twice: the two algorithms are the same
 * arithmetic over different weights, and two copies is two places for
 * the remainder rule to drift.
 */
function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(digits[index]) * weight,
    0
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCpf(digits: string): boolean {
  // Eleven of the same digit passes the arithmetic and is not a CPF.
  // Every one of these is a well-known placeholder somebody types to get
  // past a required field.
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const first = checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(digits[9]) && second === Number(digits[10]);
}

function isValidCnpj(digits: string): boolean {
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const first = checkDigit(
    digits,
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  );
  const second = checkDigit(
    digits,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  );
  return first === Number(digits[12]) && second === Number(digits[13]);
}
