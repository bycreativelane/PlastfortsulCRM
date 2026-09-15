import { describe, expect, it } from 'vitest';

import {
  contactFiscalIssues,
  EMPTY_FISCAL,
  fiscalFromContact,
  fiscalRow,
  formatZip,
  hasAnyFiscal,
  personTypeFromTaxId,
} from './fiscal';

/*
 * Documentos de TESTE, conhecidos por terem o dígito verificador certo —
 * nunca de cliente (regra da especificação: nenhum CPF, telefone ou
 * endereço real em fixture).
 */
const CPF_TESTE = '52998224725';
const CNPJ_TESTE = '11222333000181';

const ENDERECO = {
  zip_code: '90000000',
  street: 'Rua de Teste',
  street_number: '100',
  district: 'Centro',
  city: 'Cidade Exemplo',
  state: 'RS',
};

describe('contactFiscalIssues', () => {
  it('um contato completo não tem pendência', () => {
    expect(
      contactFiscalIssues({ tax_id: CNPJ_TESTE, person_type: 'J', ...ENDERECO })
    ).toEqual({ document: null, address: [], stateRegistration: false });
  });

  it('o contato que nasce do WhatsApp tem tudo por fazer', () => {
    const r = contactFiscalIssues({});
    expect(r.document).toBe('missing');
    expect(r.address).toEqual([
      'zip_code',
      'street',
      'street_number',
      'district',
      'city',
      'state',
    ]);
  });

  it('dígito verificador errado é inválido, não ausente', () => {
    expect(contactFiscalIssues({ tax_id: '11222333000180', ...ENDERECO }).document).toBe(
      'invalid'
    );
  });

  it('CPF em pessoa jurídica é incoerente', () => {
    expect(
      contactFiscalIssues({ tax_id: CPF_TESTE, person_type: 'J', ...ENDERECO }).document
    ).toBe('type_mismatch');
  });

  it('contribuinte sem IE pendura; isento não', () => {
    expect(
      contactFiscalIssues({ tax_id: CNPJ_TESTE, taxpayer_indicator: '1', ...ENDERECO })
        .stateRegistration
    ).toBe(true);
    expect(
      contactFiscalIssues({ tax_id: CNPJ_TESTE, taxpayer_indicator: '2', ...ENDERECO })
        .stateRegistration
    ).toBe(false);
  });

  it('CEP com sete dígitos e UF minúscula são endereço incompleto', () => {
    const r = contactFiscalIssues({
      tax_id: CPF_TESTE,
      ...ENDERECO,
      zip_code: '9000000',
      state: 'rs',
    });
    expect(r.address).toEqual(['zip_code', 'state']);
  });
});

describe('fiscalRow', () => {
  it('CEP só com dígitos, vazio vira null, e corta no limite do CHECK', () => {
    const linha = fiscalRow({
      ...EMPTY_FISCAL,
      zipCode: '90000-000',
      complement: 'x'.repeat(80),
      personType: 'J',
    });
    expect(linha.zip_code).toBe('90000000');
    expect(linha.complement).toHaveLength(60);
    expect(linha.street).toBeNull();
    expect(linha.person_type).toBe('J');
  });

  it('CEP incompleto não vai (o CHECK recusaria o contato inteiro)', () => {
    expect(fiscalRow({ ...EMPTY_FISCAL, zipCode: '9000' }).zip_code).toBeNull();
  });

  it('ida e volta', () => {
    const rascunho = fiscalFromContact({ zip_code: '90000000', person_type: 'F' });
    expect(rascunho.zipCode).toBe('90000-000');
    expect(hasAnyFiscal(rascunho)).toBe(true);
    expect(hasAnyFiscal(EMPTY_FISCAL)).toBe(false);
    expect(formatZip('123')).toBe('123');
  });

  it('o documento sugere o tipo de pessoa', () => {
    expect(personTypeFromTaxId(CPF_TESTE)).toBe('F');
    expect(personTypeFromTaxId(CNPJ_TESTE)).toBe('J');
    expect(personTypeFromTaxId('123')).toBe('');
  });
});
