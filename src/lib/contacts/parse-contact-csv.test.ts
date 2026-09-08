import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';
import { normalizeKey } from './dedupe';

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

describe('o +55 da planilha — item 10 do pacote', () => {
  it('põe o código do país num número escrito como todo mundo escreve', () => {
    const csv = `phone,name\n47999549247,Euclides`;
    expect(parseContactCsv(csv).rows[0].phone).toBe('+5547999549247');
  });

  it('aceita a máscara que a pessoa copiou do sistema antigo', () => {
    const csv = `phone,name\n"(47) 99954-9247",Euclides`;
    expect(parseContactCsv(csv).rows[0].phone).toBe('+5547999549247');
  });

  it('não duplica o 55 nem encosta em quem veio de fora', () => {
    const csv = `phone\n+5547999549247\n+15551234567\n+595991234567`;
    expect(parseContactCsv(csv).rows.map((r) => r.phone)).toEqual([
      '+5547999549247',
      '+15551234567',
      '+595991234567',
    ]);
  });

  it('a chave de deduplicação passa a bater com a do banco', () => {
    // `phone_normalized` é dígito puro (migração 022). Antes disso a
    // planilha com `47999549247` gerava a chave `47999549247`, que não casa
    // com `5547999549247` — e a importação criava uma segunda ficha do
    // mesmo cliente.
    const daPlanilha = parseContactCsv(`phone\n47999549247`).rows[0].phone;
    expect(normalizeKey(daPlanilha)).toBe('5547999549247');
  });

  it('o que não é número nenhum passa como veio', () => {
    // Melhor uma linha que o servidor recusa do que uma linha silenciosamente
    // esvaziada: a tela de importação mostra o que vai ser gravado.
    expect(parseContactCsv(`phone\nsem numero aqui`).rows[0].phone).toBe(
      'sem numero aqui'
    );
  });
});
