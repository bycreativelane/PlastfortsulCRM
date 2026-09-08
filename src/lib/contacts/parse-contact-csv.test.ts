import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
        },
        {
          phone: '+15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
        },
      ],
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
        },
      ],
    });
  });

  /*
   * As TRÊS causas de "nenhuma linha", separadas.
   *
   * Elas caíam todas num array vazio e a tela respondia às três com a
   * mensagem da segunda: "falta a coluna phone", dita sobre um arquivo que
   * tem a coluna e nenhum telefone dentro dela.
   */
  it('says the file was empty', () => {
    expect(parseContactCsv('phone,name').failure).toBe('empty');
    expect(parseContactCsv('').failure).toBe('empty');
  });

  it('says the header has no phone column', () => {
    const csv = `name,email
Alice,alice@example.com`;
    expect(parseContactCsv(csv).failure).toBe('no-phone-column');
  });

  it('says no row carries a phone number', () => {
    const csv = `phone,name
,Alice
,Bruno`;
    const out = parseContactCsv(csv);
    expect(out.rows).toEqual([]);
    expect(out.failure).toBe('no-phone-values');
  });

  it('carries no failure when it parsed something', () => {
    const csv = `phone,name
+15551234567,Alice`;
    expect(parseContactCsv(csv).failure).toBeUndefined();
  });
});
