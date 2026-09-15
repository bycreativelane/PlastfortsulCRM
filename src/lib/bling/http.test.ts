import { describe, expect, it } from 'vitest';

import { blingFetch, parseCompany } from './http';
import type { FetchLike } from './oauth';

function fetchQueResponde(status: number, body: string) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const impl: FetchLike = async (url, init) => {
    chamadas.push({ url, init });
    // 204 não pode ter corpo nenhum, nem vazio, no Response do Node.
    return new Response(status === 204 ? null : body, { status });
  };
  return { impl, chamadas };
}

describe('blingFetch', () => {
  it('monta a URL da v3, com a query sem os ausentes', async () => {
    const { impl, chamadas } = fetchQueResponde(200, '{"data":[]}');
    await blingFetch('tok', '/produtos', { query: { pagina: 1, criterio: 5, tipo: undefined, x: null } }, impl);
    expect(chamadas[0].url).toBe('https://api.bling.com.br/Api/v3/produtos?pagina=1&criterio=5');
  });

  it('Bearer, enable-jwt e Accept; sem Content-Type num GET', async () => {
    const { impl, chamadas } = fetchQueResponde(200, '{}');
    await blingFetch('tok-123', '/empresas/me/dados-basicos', {}, impl);
    const { init } = chamadas[0];
    const headers = init.headers as Record<string, string>;
    expect(headers).toEqual({
      Authorization: 'Bearer tok-123',
      Accept: 'application/json',
      'enable-jwt': '1',
    });
    expect(init.method).toBe('GET');
    // Seguir um redirecionamento levaria o token para onde o Location mandar.
    expect(init.redirect).toBe('manual');
  });

  it('corpo em JSON com Content-Type', async () => {
    const { impl, chamadas } = fetchQueResponde(201, '{"data":{"id":1}}');
    const r = await blingFetch('t', '/pedidos/vendas', { method: 'POST', body: { a: 1 } }, impl);
    expect(r).toEqual({ ok: true, status: 201, data: { data: { id: 1 } } });
    expect((chamadas[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(chamadas[0].init.body).toBe('{"a":1}');
  });

  it('erro volta como resultado, não como exceção', async () => {
    const { impl } = fetchQueResponde(
      404,
      '{"error":{"type":"RESOURCE_NOT_FOUND","message":"x","description":"Recurso não encontrado"}}'
    );
    const r = await blingFetch('t', '/pedidos/vendas/1', {}, impl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.error.status, r.error.type]).toEqual([404, 'RESOURCE_NOT_FOUND']);
  });

  it('204 e corpo vazio são sucesso sem dado', async () => {
    const { impl } = fetchQueResponde(204, '');
    expect(await blingFetch('t', '/x', { method: 'PATCH' }, impl)).toEqual({ ok: true, status: 204, data: null });
  });

  it('sucesso que não é JSON é resposta inválida', async () => {
    const { impl } = fetchQueResponde(200, '<html>');
    const r = await blingFetch('t', '/x', {}, impl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('invalid_response');
  });

  it('rede caída vira falha sem resposta', async () => {
    const quebra: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const r = await blingFetch('t', '/x', {}, quebra);
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.error.status, r.error.type]).toEqual([0, 'network']);
  });

  it('caminho sem barra é erro de programação', async () => {
    await expect(blingFetch('t', 'produtos')).rejects.toThrow('/');
  });
});

describe('parseCompany', () => {
  it('lê id, nome e CNPJ, aparados', () => {
    expect(
      parseCompany({
        data: {
          id: ' 436c56a5679921f5f13a3d6433561773 ',
          nome: ' Empresa Exemplo Ltda ',
          cnpj: '12.345.678/0001-95',
          email: 'contato@example.com',
          dataContrato: '2024-12-31',
        },
      })
    ).toEqual({ id: '436c56a5679921f5f13a3d6433561773', name: 'Empresa Exemplo Ltda', cnpj: '12.345.678/0001-95' });
  });

  it('sem data, ou com id que não é string, não há empresa', () => {
    expect(parseCompany(null)).toBeNull();
    expect(parseCompany({})).toBeNull();
    expect(parseCompany({ data: { id: 12345, nome: 'x' } })).toBeNull();
    expect(parseCompany({ data: { id: '  ' } })).toBeNull();
  });

  it('nome e CNPJ ausentes viram nulo', () => {
    expect(parseCompany({ data: { id: 'abc' } })).toEqual({ id: 'abc', name: null, cnpj: null });
  });
});
