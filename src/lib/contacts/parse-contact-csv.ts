/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

import { applyDefaultCountry, toE164 } from '@/lib/whatsapp/phone-format';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

/**
 * Why `rows` came back empty.
 *
 * Three different failures used to collapse into one empty array, and the
 * screen answered all three with the message for the second one. "The file
 * only has a header" and "no row has a phone number" are different
 * problems with different fixes.
 */
export type ParseContactCsvFailure =
  'empty' | 'no-phone-column' | 'no-phone-values';

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
  /** Set only when `rows` is empty. Absent on success. */
  failure?: ParseContactCsvFailure;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return {
      rows: [],
      hasTagsColumn: false,
      hasCompanyColumn: false,
      failure: 'empty',
    };
  }

  const headers = lines[0]
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) {
    return {
      rows: [],
      hasTagsColumn: false,
      hasCompanyColumn: false,
      failure: 'no-phone-column',
    };
  }

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');
  const tagsIdx = headers.indexOf('tags');

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const cru = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!cru) continue;

    /*
     * A MESMA REGRA DA OUTRA PORTA. Item 10 do pacote.
     *
     * O campo de telefone passou a pôr o `+55` sozinho, e a planilha é o
     * outro caminho pelo qual contato entra neste produto. Deixar só um dos
     * dois normalizando é a receita do defeito que o `PhoneInput` já teve:
     * uma regra que mora no call site em vez de morar no caminho.
     *
     * E aqui ela conserta um segundo defeito, mais caro. A deduplicação
     * compara `normalizeKey(row.phone)` contra `phone_normalized`, que é
     * dígito puro — então uma planilha com `47999549247` não casava com o
     * contato que já existia como `+5547999549247`, e a importação criava
     * uma SEGUNDA ficha do mesmo cliente. Normalizar antes de comparar é o
     * que faz as duas chaves serem a mesma chave.
     *
     * Um número que já vem com código de país não é tocado: a regra só
     * pega dez ou onze dígitos com assinatura brasileira.
     */
    const phone = toE164(applyDefaultCountry(normalizePhone(cru))) || cru;
    if (!phone) continue;

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
    ...(rows.length === 0 ? { failure: 'no-phone-values' as const } : {}),
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
