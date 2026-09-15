import type { SupabaseClient } from '@supabase/supabase-js';

import { isUnknownColumn } from '@/lib/supabase/pg-errors';

import { isValidTaxId, normalizeTaxId, taxIdKind } from './tax-id';

/**
 * DADOS FISCAIS E ENDEREÇO DO CONTATO — o que o Bling precisa para emitir.
 *
 * ------------------------------------------------------------------
 * POR QUE UMA SEÇÃO À PARTE
 * ------------------------------------------------------------------
 *
 * O contato nasce do WhatsApp com telefone e nome do perfil, e continua
 * assim na maioria dos casos. Os dados fiscais só importam quando a conversa
 * vira pedido — D5 manda exigir CPF/CNPJ para emitir, e não para conversar.
 * Por isso eles moram numa gaveta que abre sozinha só quando já há algo
 * preenchido, igual à dos dados comerciais.
 *
 * As colunas chegam na 085, aplicada à mão; `hasContactFiscal` pergunta
 * antes, e o formulário só as cita quando elas existem — um `update` com uma
 * coluna ausente não grava nada (o defeito medido em 14 de setembro).
 *
 * `tax_id`, `city` e `state` são da 040 e continuam onde estão.
 */

export const CONTACT_FISCAL_MIGRATION = 85;

export type PersonType = '' | 'F' | 'J';
/** 1 contribuinte de ICMS · 2 isento · 9 não contribuinte (códigos da NF-e). */
export type TaxpayerIndicator = '' | '1' | '2' | '9';

export const TAXPAYER_INDICATORS = ['1', '2', '9'] as const;

export interface FiscalDraft {
  personType: PersonType;
  tradeName: string;
  stateRegistration: string;
  taxpayerIndicator: TaxpayerIndicator;
  rg: string;
  zipCode: string;
  street: string;
  streetNumber: string;
  complement: string;
  district: string;
  nfeEmail: string;
  landlinePhone: string;
}

export const EMPTY_FISCAL: FiscalDraft = {
  personType: '',
  tradeName: '',
  stateRegistration: '',
  taxpayerIndicator: '',
  rg: '',
  zipCode: '',
  street: '',
  streetNumber: '',
  complement: '',
  district: '',
  nfeEmail: '',
  landlinePhone: '',
};

/** As colunas da 085 em `contacts`, como o contato as traz. */
export interface ContactFiscalColumns {
  person_type?: string | null;
  trade_name?: string | null;
  state_registration?: string | null;
  taxpayer_indicator?: string | null;
  rg?: string | null;
  zip_code?: string | null;
  street?: string | null;
  street_number?: string | null;
  complement?: string | null;
  district?: string | null;
  nfe_email?: string | null;
  landline_phone?: string | null;
  bling_contact_id?: string | null;
}

export const FISCAL_COLUMNS = [
  'person_type',
  'trade_name',
  'state_registration',
  'taxpayer_indicator',
  'rg',
  'zip_code',
  'street',
  'street_number',
  'complement',
  'district',
  'nfe_email',
  'landline_phone',
] as const;

export function fiscalFromContact(
  contato: ContactFiscalColumns | null | undefined
): FiscalDraft {
  const tipo = contato?.person_type;
  const indicador = contato?.taxpayer_indicator;
  return {
    personType: tipo === 'F' || tipo === 'J' ? tipo : '',
    tradeName: contato?.trade_name ?? '',
    stateRegistration: contato?.state_registration ?? '',
    taxpayerIndicator:
      indicador === '1' || indicador === '2' || indicador === '9' ? indicador : '',
    rg: contato?.rg ?? '',
    zipCode: contato?.zip_code ? formatZip(contato.zip_code) : '',
    street: contato?.street ?? '',
    streetNumber: contato?.street_number ?? '',
    complement: contato?.complement ?? '',
    district: contato?.district ?? '',
    nfeEmail: contato?.nfe_email ?? '',
    landlinePhone: contato?.landline_phone ?? '',
  };
}

/** Algum campo fiscal preenchido? Decide se a seção abre sozinha. */
export function hasAnyFiscal(rascunho: FiscalDraft): boolean {
  return Object.values(rascunho).some((v) => v !== '');
}

/** CEP só com dígitos — o CHECK da 085 aceita exatamente oito. */
export function normalizeZip(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

export function formatZip(valor: string | null | undefined): string {
  const d = normalizeZip(valor);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (valor ?? '');
}

function corta(valor: string, max: number): string | null {
  const t = valor.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * O rascunho como as colunas o gravam.
 *
 * Os limites são os CHECKs da 085: cortar aqui é gravar o que cabe, em vez
 * de o banco recusar o contato inteiro por um complemento comprido. Um CEP
 * que não tenha oito dígitos vai vazio pelo mesmo motivo — o formulário já
 * disse que ele está incompleto.
 */
export function fiscalRow(rascunho: FiscalDraft): Record<(typeof FISCAL_COLUMNS)[number], string | null> {
  const cep = normalizeZip(rascunho.zipCode);
  return {
    person_type: rascunho.personType || null,
    trade_name: corta(rascunho.tradeName, 120),
    state_registration: corta(rascunho.stateRegistration, 30),
    taxpayer_indicator: rascunho.taxpayerIndicator || null,
    rg: corta(rascunho.rg, 20),
    zip_code: cep.length === 8 ? cep : null,
    street: corta(rascunho.street, 120),
    street_number: corta(rascunho.streetNumber, 20),
    complement: corta(rascunho.complement, 60),
    district: corta(rascunho.district, 60),
    nfe_email: corta(rascunho.nfeEmail, 120),
    landline_phone: corta(rascunho.landlinePhone, 30),
  };
}

/**
 * A 085 está no banco? A sonda é a própria coluna, com `limit(0)` — o
 * PostgREST valida a coluna antes da RLS (o raciocínio de `hasOrderTotals`).
 */
export async function hasContactFiscal(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from('contacts').select('zip_code').limit(0);
  return !(error && isUnknownColumn(error));
}

// ------------------------------------------------------------------
// O que falta para emitir
// ------------------------------------------------------------------

export interface FiscalFacts extends ContactFiscalColumns {
  tax_id?: string | null;
  city?: string | null;
  state?: string | null;
}

export type DocumentIssue = 'missing' | 'invalid' | 'type_mismatch' | null;
export type AddressField =
  | 'zip_code'
  | 'street'
  | 'street_number'
  | 'district'
  | 'city'
  | 'state';

export interface FiscalIssues {
  document: DocumentIssue;
  address: AddressField[];
  /** Contribuinte de ICMS (1) sem inscrição estadual. */
  stateRegistration: boolean;
}

const vazio = (v: string | null | undefined) => !(v ?? '').trim();

/**
 * O que impede de emitir, sem julgar nada que o Bling não julga.
 *
 * - documento: ausente, com dígito verificador errado, ou CPF num contato
 *   marcado Jurídica (e CNPJ em Física);
 * - endereço: os campos que a NF-e exige — CEP, logradouro, número, bairro,
 *   cidade e UF. Complemento é opcional lá e aqui;
 * - IE: só quando o contato é contribuinte (1). Isento e não contribuinte
 *   emitem sem ela.
 */
export function contactFiscalIssues(contato: FiscalFacts | null | undefined): FiscalIssues {
  const digitos = normalizeTaxId(contato?.tax_id);
  let document: DocumentIssue = null;
  if (!digitos) document = 'missing';
  else if (isValidTaxId(digitos) !== true) document = 'invalid';
  else {
    const tipo = contato?.person_type;
    const kind = taxIdKind(digitos);
    if ((tipo === 'J' && kind === 'cpf') || (tipo === 'F' && kind === 'cnpj')) {
      document = 'type_mismatch';
    }
  }

  const address: AddressField[] = [];
  if (normalizeZip(contato?.zip_code).length !== 8) address.push('zip_code');
  if (vazio(contato?.street)) address.push('street');
  if (vazio(contato?.street_number)) address.push('street_number');
  if (vazio(contato?.district)) address.push('district');
  if (vazio(contato?.city)) address.push('city');
  if (!/^[A-Z]{2}$/.test((contato?.state ?? '').trim())) address.push('state');

  return {
    document,
    address,
    stateRegistration:
      contato?.taxpayer_indicator === '1' && vazio(contato?.state_registration),
  };
}

/** O tipo de pessoa que o documento sugere, para preencher sem perguntar. */
export function personTypeFromTaxId(valor: string | null | undefined): PersonType {
  const kind = taxIdKind(valor);
  if (kind === 'cpf') return 'F';
  if (kind === 'cnpj') return 'J';
  return '';
}
