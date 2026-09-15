import { describe, expect, it } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import {
  blingPhone,
  BlingContactError,
  contactToBling,
  fillOnlyMerge,
  resolveBlingContact,
  type CrmContact,
} from './contacts';
import { fakeDb } from './fake-db';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';

const CONFIG = { clientId: 'id', clientSecret: 's', redirectUri: 'https://crm.example.com/cb' };
const AGORA = Date.parse('2026-09-15T12:00:00.000Z');

/* Documento de TESTE (dígito certo, de exemplo público) — nunca de cliente. */
const CNPJ = '11222333000181';

const CONTATO: CrmContact = {
  id: 'c-1',
  name: 'Fulano de Exemplo',
  company: 'Empresa Exemplo',
  phone: '+5554999998888',
  email: 'compras@exemplo.test',
  tax_id: CNPJ,
  person_type: 'J',
  state_registration: '123456',
  taxpayer_indicator: '1',
  zip_code: '90000000',
  street: 'Rua de Teste',
  street_number: '100',
  district: 'Centro',
  city: 'Cidade Exemplo',
  state: 'RS',
};

describe('contactToBling', () => {
  it('pessoa jurídica pelo nome da empresa, com endereço e contato no formato do Bling', () => {
    expect(contactToBling(CONTATO, '44')).toEqual({
      nome: 'Empresa Exemplo',
      tipo: 'J',
      situacao: 'A',
      numeroDocumento: CNPJ,
      indicadorIe: 1,
      ie: '123456',
      email: 'compras@exemplo.test',
      celular: '(54) 99999-8888',
      endereco: {
        geral: {
          endereco: 'Rua de Teste',
          numero: '100',
          bairro: 'Centro',
          cep: '90000-000',
          municipio: 'Cidade Exemplo',
          uf: 'RS',
        },
      },
      tiposContato: [{ id: 44 }],
    });
  });

  it('o que o CRM não sabe não vai — um PUT não apaga nada lá', () => {
    const minimo = contactToBling({ id: 'c', name: 'Só nome', tax_id: '52998224725' });
    expect(minimo).toEqual({ nome: 'Só nome', tipo: 'F', situacao: 'A', numeroDocumento: '52998224725' });
  });

  it('telefone', () => {
    expect(blingPhone('+555433334444')).toBe('(54) 3333-4444');
    expect(blingPhone(null)).toBeUndefined();
  });
});

describe('fillOnlyMerge — só completa, nunca sobrescreve', () => {
  it('preenche os vazios, mantém o que o Bling tem, e lista as diferenças sem pontuação', () => {
    const remoto = {
      id: 5,
      nome: 'EMPRESA EXEMPLO LTDA',
      telefone: '',
      celular: '54 99999 8888',
      endereco: { geral: { endereco: 'Rua Velha', cep: '' } },
      tiposContato: [{ id: 9 }],
    };
    const local = {
      nome: 'Empresa Exemplo',
      telefone: '(54) 3333-4444',
      celular: '(54) 99999-8888',
      endereco: { geral: { endereco: 'Rua de Teste', cep: '90000-000' } },
      tiposContato: [{ id: 44 }],
    };
    const r = fillOnlyMerge(remoto, local);
    expect(r.merged).toMatchObject({
      id: 5,
      nome: 'EMPRESA EXEMPLO LTDA',
      telefone: '(54) 3333-4444',
      celular: '54 99999 8888',
      endereco: { geral: { endereco: 'Rua Velha', cep: '90000-000' } },
      tiposContato: [{ id: 9 }],
    });
    expect(r.filled.sort()).toEqual(['endereco.geral.cep', 'telefone']);
    expect(r.differences.sort()).toEqual(['endereco.geral.endereco', 'nome']);
  });
});

/** O Bling de mentira para contatos: guarda o cadastro e as chamadas. */
function blingFalso(cadastro: Array<Record<string, unknown>>, falhas: { detalhe404?: boolean } = {}) {
  const chamadas: string[] = [];
  const corpos: unknown[] = [];
  let proximo = 900;
  const impl: FetchLike = async (url, init) => {
    if (url === BLING_TOKEN_URL) throw new Error('não deveria renovar');
    const u = new URL(url);
    const caminho = u.pathname.replace('/Api/v3', '');
    const metodo = init?.method ?? 'GET';
    chamadas.push(`${metodo} ${caminho}${u.search}`);
    if (init?.body) corpos.push(JSON.parse(String(init.body)));
    if (caminho === '/contatos' && metodo === 'GET') {
      const doc = u.searchParams.get('numeroDocumento');
      return new Response(JSON.stringify({ data: cadastro.filter((c) => c.numeroDocumento === doc) }), { status: 200 });
    }
    if (caminho === '/contatos' && metodo === 'POST') {
      const id = ++proximo;
      cadastro.push({ id, ...(JSON.parse(String(init?.body)) as object) });
      return new Response(JSON.stringify({ data: { id } }), { status: 201 });
    }
    const id = Number(caminho.split('/').pop());
    const achado = cadastro.find((c) => c.id === id);
    if (metodo === 'GET') {
      if (!achado || falhas.detalhe404) {
        return new Response(JSON.stringify({ error: { type: 'RESOURCE_NOT_FOUND', description: 'não achado' } }), { status: 404 });
      }
      return new Response(JSON.stringify({ data: achado }), { status: 200 });
    }
    if (metodo === 'PUT') return new Response(JSON.stringify({ data: { id } }), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  return { impl, chamadas, corpos };
}

function banco(contato: CrmContact) {
  return fakeDb({
    tables: {
      bling_connections: [
        {
          id: 'conn-1',
          account_id: 'acc-1',
          status: 'connected',
          access_token: encrypt('access'),
          access_expires_at: new Date(AGORA + 3_600_000).toISOString(),
          refresh_token: encrypt('refresh'),
          refresh_lock_until: null,
          consecutive_failures: 0,
        },
      ],
      contacts: [{ ...contato }],
    },
    rpcs: { bling_take_request: () => 0 },
  });
}

const deps = (impl: FetchLike) => ({ config: CONFIG, fetchImpl: impl, now: () => AGORA });

describe('resolveBlingContact — D5', () => {
  it('nenhum com o documento: cria, e grava o id no CRM', async () => {
    const db = banco(CONTATO);
    const bling = blingFalso([]);
    const r = await resolveBlingContact(db.client, 'conn-1', CONTATO, { deps: deps(bling.impl) });
    expect(r.action).toBe('created');
    expect(bling.chamadas.map((c) => c.split('?')[0])).toEqual(['GET /contatos', 'POST /contatos']);
    expect(db.tables.contacts[0].bling_contact_id).toBe(r.blingId);
  });

  it('um com o documento: liga, e só completa o que está vazio lá', async () => {
    const db = banco(CONTATO);
    const bling = blingFalso([{ id: 77, nome: 'Exemplo Comércio Ltda', numeroDocumento: CNPJ, email: '' }]);
    const r = await resolveBlingContact(db.client, 'conn-1', CONTATO, { deps: deps(bling.impl) });
    expect(r).toMatchObject({ blingId: '77', action: 'linked' });
    expect(r.differences).toContain('nome');
    expect(r.filled).toContain('email');
    const put = bling.corpos.at(-1) as Record<string, unknown>;
    expect(put.nome).toBe('Exemplo Comércio Ltda');
    expect(put.email).toBe('compras@exemplo.test');
    expect(db.tables.contacts[0].bling_contact_id).toBe('77');
  });

  it('vários com o documento: bloqueia, sem ligar nem criar', async () => {
    const db = banco(CONTATO);
    const bling = blingFalso([
      { id: 1, numeroDocumento: CNPJ },
      { id: 2, numeroDocumento: CNPJ },
    ]);
    await expect(resolveBlingContact(db.client, 'conn-1', CONTATO, { deps: deps(bling.impl) })).rejects.toMatchObject({
      code: 'contact_ambiguous',
    });
    expect(bling.chamadas.some((c) => c.startsWith('POST'))).toBe(false);
    expect(db.tables.contacts[0].bling_contact_id).toBeUndefined();
  });

  it('nunca procura por nome ou telefone: sem documento, para', async () => {
    const semDoc = { ...CONTATO, tax_id: null };
    const db = banco(semDoc);
    const bling = blingFalso([{ id: 3, nome: 'Empresa Exemplo', celular: '(54) 99999-8888' }]);
    await expect(resolveBlingContact(db.client, 'conn-1', semDoc, { deps: deps(bling.impl) })).rejects.toBeInstanceOf(
      BlingContactError
    );
    expect(bling.chamadas).toEqual([]);
  });

  it('com id salvo: usa aquele; se sumiu do Bling, para em vez de religar', async () => {
    const ligado = { ...CONTATO, bling_contact_id: '77' };
    const completo = { id: 77, nome: 'X', numeroDocumento: CNPJ, email: 'a@b.test', celular: '1', ie: '1', indicadorIe: 1, tipo: 'J', situacao: 'A', endereco: { geral: { endereco: 'R', numero: '1', bairro: 'B', cep: '9', municipio: 'M', uf: 'RS' } } };
    const bling = blingFalso([completo]);
    const r = await resolveBlingContact(banco(ligado).client, 'conn-1', ligado, { deps: deps(bling.impl) });
    expect(r.action).toBe('existing');
    // Nada vazio lá: nenhum PUT.
    expect(bling.chamadas).toEqual(['GET /contatos/77']);

    const sumiu = blingFalso([]);
    await expect(
      resolveBlingContact(banco(ligado).client, 'conn-1', ligado, { deps: deps(sumiu.impl) })
    ).rejects.toMatchObject({ code: 'contact_link_broken' });
  });
});
