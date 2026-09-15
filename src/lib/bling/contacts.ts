import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeZip } from '@/lib/contacts/fiscal';
import { normalizeTaxId, taxIdKind } from '@/lib/contacts/tax-id';

import { blingRequest, type ClientDeps } from './client';
import { foldName } from './health';
import { BlingApiError } from './errors';

/**
 * O CLIENTE NO BLING — D5.
 *
 * 1. Com `bling_contact_id`, é aquele contato. Se ele sumiu do Bling, o
 *    pedido para: religar a outro sozinho seria adivinhar.
 * 2. Sem id, procura pelo CPF/CNPJ sem pontuação. Um resultado: liga. Vários:
 *    BLOQUEIA e pede resolução. Nenhum: cria.
 * 3. Nunca deduplica por nome ou telefone.
 * 4. Nunca sobrescreve campo já preenchido no Bling: só completa os vazios. O
 *    que difere volta como lista, para a tela mostrar.
 * 5. Sem documento válido, não emite.
 */

export type ContactProblem =
  | 'contact_document_missing'
  | 'contact_ambiguous'
  | 'contact_link_broken';

export class BlingContactError extends Error {
  constructor(readonly code: ContactProblem, readonly detail = '') {
    super(`[bling] contato: ${code}${detail ? ` — ${detail}` : ''}`);
  }
}

export interface CrmContact {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  tax_id?: string | null;
  city?: string | null;
  state?: string | null;
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

type Objeto = Record<string, unknown>;

const texto = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t || undefined;
};

/** Celular do WhatsApp no formato que o Bling mostra: `(54) 99999-8888`. */
export function blingPhone(e164: string | null | undefined): string | undefined {
  const d = (e164 ?? '').replace(/\D/g, '');
  const nacional = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (nacional.length === 11) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  if (nacional.length === 10) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  return texto(e164 ?? undefined);
}

/**
 * O contato do CRM no formato de `POST/PUT /contatos` (ContatosDadosDTO).
 * Só o que o CRM sabe — o que ele não sabe fica fora, para não apagar nada
 * lá num PUT.
 */
export function contactToBling(contato: CrmContact, clientTypeId: string | null = null): Objeto {
  const documento = normalizeTaxId(contato.tax_id);
  const tipo =
    contato.person_type === 'F' || contato.person_type === 'J'
      ? contato.person_type
      : taxIdKind(documento) === 'cpf'
        ? 'F'
        : 'J';
  const cep = normalizeZip(contato.zip_code);
  const indicador = Number(contato.taxpayer_indicator);

  const endereco: Objeto = {
    endereco: texto(contato.street),
    numero: texto(contato.street_number),
    complemento: texto(contato.complement),
    bairro: texto(contato.district),
    cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : undefined,
    municipio: texto(contato.city),
    uf: texto(contato.state)?.toUpperCase(),
  };

  return limpar({
    nome: texto(contato.company) && tipo === 'J' ? texto(contato.company) : texto(contato.name) ?? texto(contato.company),
    fantasia: texto(contato.trade_name),
    tipo,
    situacao: 'A',
    numeroDocumento: documento || undefined,
    indicadorIe: [1, 2, 9].includes(indicador) ? indicador : undefined,
    ie: texto(contato.state_registration),
    rg: tipo === 'F' ? texto(contato.rg) : undefined,
    email: texto(contato.email),
    emailNotaFiscal: texto(contato.nfe_email),
    telefone: texto(contato.landline_phone),
    celular: blingPhone(contato.phone),
    endereco: { geral: endereco },
    tiposContato: clientTypeId && /^\d+$/.test(clientTypeId) ? [{ id: Number(clientTypeId) }] : undefined,
  });
}

/** Tira `undefined` e objetos vazios, recursivamente. */
function limpar(valor: Objeto): Objeto {
  const saida: Objeto = {};
  for (const [k, v] of Object.entries(valor)) {
    if (v === undefined || v === null || v === '') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const dentro = limpar(v as Objeto);
      if (Object.keys(dentro).length > 0) saida[k] = dentro;
      continue;
    }
    saida[k] = v;
  }
  return saida;
}

const vazioNoBling = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || v === 0;

/**
 * Completa o contato remoto com o que o CRM sabe, sem sobrescrever nada.
 *
 * Devolve o objeto mesclado (o PUT do Bling substitui o cadastro, então vai
 * o remoto inteiro com os vazios preenchidos), os campos preenchidos e os
 * que diferem — preenchidos lá E aqui, com valores diferentes.
 */
export function fillOnlyMerge(
  remoto: Objeto,
  local: Objeto,
  caminho = ''
): { merged: Objeto; filled: string[]; differences: string[] } {
  const merged: Objeto = { ...remoto };
  const filled: string[] = [];
  const differences: string[] = [];
  for (const [chave, valorLocal] of Object.entries(local)) {
    const nome = caminho ? `${caminho}.${chave}` : chave;
    const valorRemoto = remoto[chave];
    if (valorLocal && typeof valorLocal === 'object' && !Array.isArray(valorLocal)) {
      const sub = fillOnlyMerge(
        valorRemoto && typeof valorRemoto === 'object' ? (valorRemoto as Objeto) : {},
        valorLocal as Objeto,
        nome
      );
      merged[chave] = sub.merged;
      filled.push(...sub.filled);
      differences.push(...sub.differences);
      continue;
    }
    // Tipos de contato e situação: o Bling é quem manda neles.
    if (chave === 'tiposContato' || chave === 'situacao') {
      if (vazioNoBling(valorRemoto) || (Array.isArray(valorRemoto) && valorRemoto.length === 0)) {
        merged[chave] = valorLocal;
        filled.push(nome);
      }
      continue;
    }
    if (vazioNoBling(valorRemoto)) {
      merged[chave] = valorLocal;
      filled.push(nome);
    } else if (comparavel(valorRemoto) !== comparavel(valorLocal)) {
      differences.push(nome);
    }
  }
  return { merged, filled, differences };
}

/** Compara sem pontuação e sem caixa: `(54) 3333-4444` é `5433334444`. */
function comparavel(valor: unknown): string {
  return foldName(String(valor)).replace(/[^0-9a-z@]/g, '');
}

export interface ResolvedContact {
  blingId: string;
  action: 'existing' | 'linked' | 'created';
  filled: string[];
  differences: string[];
}

interface Lista {
  data?: Objeto[];
}

/**
 * Acha, liga ou cria o cliente no Bling, e grava o id no contato do CRM.
 * Lança `BlingContactError` nos três casos que pedem uma pessoa.
 */
export async function resolveBlingContact(
  db: SupabaseClient,
  connectionId: string,
  contato: CrmContact,
  opcoes: { clientTypeId?: string | null; deps?: ClientDeps } = {}
): Promise<ResolvedContact> {
  const deps = opcoes.deps ?? {};
  const local = contactToBling(contato, opcoes.clientTypeId ?? null);
  const documento = normalizeTaxId(contato.tax_id);

  let remoto: Objeto | null = null;
  let action: ResolvedContact['action'] = 'existing';

  if (contato.bling_contact_id) {
    try {
      const resposta = await blingRequest<{ data?: Objeto }>(
        db,
        connectionId,
        `/contatos/${encodeURIComponent(contato.bling_contact_id)}`,
        {},
        deps
      );
      remoto = resposta?.data ?? null;
    } catch (erro) {
      if (erro instanceof BlingApiError && erro.status === 404) {
        throw new BlingContactError('contact_link_broken', contato.bling_contact_id);
      }
      throw erro;
    }
    if (!remoto) throw new BlingContactError('contact_link_broken', contato.bling_contact_id);
  } else {
    if (!documento || !['cpf', 'cnpj'].includes(taxIdKind(documento))) {
      throw new BlingContactError('contact_document_missing');
    }
    const busca = await blingRequest<Lista>(
      db,
      connectionId,
      '/contatos',
      { query: { numeroDocumento: documento, criterio: 1, pagina: 1, limite: 5 } },
      deps
    );
    // A busca do Bling por documento ignora pontuação; confere de novo aqui,
    // para um resultado "parecido" nunca virar vínculo.
    const achados = (busca?.data ?? []).filter(
      (c) => normalizeTaxId(String(c.numeroDocumento ?? '')) === documento
    );
    if (achados.length > 1) throw new BlingContactError('contact_ambiguous', String(achados.length));
    if (achados.length === 1) {
      action = 'linked';
      const detalhe = await blingRequest<{ data?: Objeto }>(
        db,
        connectionId,
        `/contatos/${encodeURIComponent(String(achados[0].id))}`,
        {},
        deps
      );
      remoto = detalhe?.data ?? achados[0];
    }
  }

  let blingId: string;
  let filled: string[] = [];
  let differences: string[] = [];

  if (!remoto) {
    const criado = await blingRequest<{ data?: { id?: number | string } }>(
      db,
      connectionId,
      '/contatos',
      { method: 'POST', body: local },
      deps
    );
    const id = criado?.data?.id;
    if (id === undefined || id === null) {
      throw new BlingApiError(0, 'invalid_response', 'o Bling não devolveu o id do contato');
    }
    blingId = String(id);
    action = 'created';
    filled = Object.keys(local);
  } else {
    blingId = String(remoto.id ?? contato.bling_contact_id);
    const mescla = fillOnlyMerge(remoto, local);
    filled = mescla.filled;
    differences = mescla.differences;
    if (filled.length > 0) {
      await blingRequest(
        db,
        connectionId,
        `/contatos/${encodeURIComponent(blingId)}`,
        { method: 'PUT', body: mescla.merged },
        deps
      );
    }
  }

  if (contato.bling_contact_id !== blingId) {
    const { error } = await db.from('contacts').update({ bling_contact_id: blingId }).eq('id', contato.id);
    // 23505: outro contato do CRM já aponta para este cliente do Bling — dois
    // cadastros da mesma pessoa. Não liga; a pessoa resolve.
    if (error?.code === '23505') throw new BlingContactError('contact_ambiguous', 'crm');
    if (error) throw new Error(`[bling] não consegui gravar o vínculo do contato: ${error.message}`);
  }

  return { blingId, action, filled, differences };
}
