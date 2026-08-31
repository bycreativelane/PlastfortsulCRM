import { describe, expect, it } from 'vitest';

import {
  formatTaxId,
  isValidTaxId,
  normalizeTaxId,
  taxIdKind,
} from './tax-id';

describe('normalizeTaxId', () => {
  it('reduces both spellings of one number to one value', () => {
    // The whole point: this is what makes the duplicate findable. The
    // complaint that prompted it describes the same company entered
    // twice, punctuated one way and then the other.
    expect(normalizeTaxId('12.345.678/0001-90')).toBe('12345678000190');
    expect(normalizeTaxId('12345678000190')).toBe('12345678000190');
  });

  it('is empty for nothing', () => {
    expect(normalizeTaxId(null)).toBe('');
    expect(normalizeTaxId('   ')).toBe('');
  });
});

describe('formatTaxId', () => {
  it('punctuates a complete CNPJ', () => {
    expect(formatTaxId('12345678000190')).toBe('12.345.678/0001-90');
  });

  it('punctuates a complete CPF', () => {
    expect(formatTaxId('12345678909')).toBe('123.456.789-09');
  });

  it('leaves a half-typed number alone', () => {
    // Reformatting under the caret is how a field fights the person
    // using it.
    expect(formatTaxId('123456')).toBe('123456');
  });
});

describe('taxIdKind', () => {
  it('tells the two documents apart by length', () => {
    expect(taxIdKind('123.456.789-09')).toBe('cpf');
    expect(taxIdKind('12.345.678/0001-90')).toBe('cnpj');
    expect(taxIdKind('123')).toBe('unknown');
  });
});

describe('isValidTaxId', () => {
  it('accepts a real CNPJ', () => {
    expect(isValidTaxId('12.345.678/0001-95')).toBe(true);
  });

  it('rejects a CNPJ whose check digits do not agree', () => {
    expect(isValidTaxId('12.345.678/0001-90')).toBe(false);
  });

  it('accepts a real CPF', () => {
    expect(isValidTaxId('529.982.247-25')).toBe(true);
  });

  it('rejects a CPF whose check digits do not agree', () => {
    expect(isValidTaxId('529.982.247-26')).toBe(false);
  });

  it('rejects the placeholders that pass the arithmetic', () => {
    // Every one of these is what somebody types to get past a required
    // field, and every one of them satisfies mod-11.
    expect(isValidTaxId('111.111.111-11')).toBe(false);
    expect(isValidTaxId('11.111.111/1111-11')).toBe(false);
  });

  it('has no verdict on an incomplete or empty field', () => {
    // Not "invalid". A form that says "CNPJ inválido" over three digits
    // is a form people learn to ignore.
    expect(isValidTaxId('123')).toBeNull();
    expect(isValidTaxId('')).toBeNull();
    expect(isValidTaxId(null)).toBeNull();
  });
});
