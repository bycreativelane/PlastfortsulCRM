import { describe, expect, it } from 'vitest';

import {
  BlingApiError,
  BlingConnectionError,
  describeBlingFailure,
  parseBlingError,
  sanitizeBlingText,
} from './errors';

// Todos os documentos, e-mails, telefones e tokens daqui são inventados.
// Nada dos prints da especificação entra em teste.

describe('parseBlingError — os três formatos de corpo', () => {
  it('o formato da API v3, com fields', () => {
    const erro = parseBlingError(
      400,
      JSON.stringify({
        error: {
          type: 'VALIDATION_ERROR',
          message: 'Não foi possível salvar a venda',
          description: 'Não foi possível salvar a venda',
          fields: [
            { code: 34, msg: 'O CPF 123.456.789-09 é inválido', element: 'contato.numeroDocumento' },
          ],
        },
      })
    );
    expect(erro.status).toBe(400);
    expect(erro.type).toBe('VALIDATION_ERROR');
    expect(erro.extra.fields).toEqual([
      { code: 34, message: 'O CPF [documento] é inválido', element: 'contato.numeroDocumento' },
    ]);
  });

  it('/oauth/token também usa o formato v3, não o OAuth padrão', () => {
    const erro = parseBlingError(
      400,
      JSON.stringify({
        error: {
          type: 'invalid_grant',
          message: 'invalid_grant',
          description: 'The authorization code has expired',
        },
      })
    );
    expect(erro.type).toBe('invalid_grant');
    expect(erro.detail).toBe('The authorization code has expired');
  });

  it('o OAuth padrão, se um dia vier', () => {
    const erro = parseBlingError(
      401,
      JSON.stringify({ error: 'invalid_client', error_description: 'credenciais inválidas' })
    );
    expect(erro.type).toBe('invalid_client');
    expect(erro.detail).toBe('credenciais inválidas');
  });

  it('o gateway da AWS, que responde antes do Bling', () => {
    const erro = parseBlingError(403, JSON.stringify({ message: 'Missing Authentication Token' }));
    expect(erro.type).toBe('gateway');
    expect(erro.detail).toBe('Missing Authentication Token');
  });

  it('corpo que não é JSON vira o status', () => {
    const erro = parseBlingError(502, '<html>Bad Gateway</html>');
    expect(erro.type).toBe('unknown');
    expect(erro.detail).toBe('HTTP 502');
  });

  it('429 traz limite e período; só o do segundo é passageiro', () => {
    const segundo = parseBlingError(
      429,
      JSON.stringify({ error: { type: 'TOO_MANY_REQUESTS', description: 'x', limit: 3, period: 'second' } })
    );
    expect(segundo.extra).toMatchObject({ limit: 3, period: 'second' });
    expect(segundo.isRateLimited).toBe(true);
    expect(segundo.isTransient).toBe(true);

    const dia = parseBlingError(
      429,
      JSON.stringify({ error: { type: 'TOO_MANY_REQUESTS', description: 'x', limit: 120000, period: 'day' } })
    );
    // Só amanhã resolve: repetir agora só soma erro, e erro também bloqueia IP.
    expect(dia.isTransient).toBe(false);
  });
});

describe('classificação', () => {
  it('sem resposta e 5xx passam; 4xx fica', () => {
    expect(new BlingApiError(0, 'timeout', 'x').isTransient).toBe(true);
    expect(new BlingApiError(503, 'SERVER_ERROR', 'x').isTransient).toBe(true);
    expect(new BlingApiError(400, 'VALIDATION_ERROR', 'x').isTransient).toBe(false);
    expect(new BlingApiError(404, 'RESOURCE_NOT_FOUND', 'x').isTransient).toBe(false);
  });

  it('401 é token que não serve', () => {
    expect(new BlingApiError(401, 'invalid_token', 'x').isInvalidToken).toBe(true);
    expect(new BlingApiError(403, 'insufficient_scope', 'x').isInvalidToken).toBe(false);
  });
});

describe('sanitizeBlingText — nada de token nem dado pessoal na mensagem', () => {
  it('JWT e Bearer', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJhLWZhbHNh';
    expect(sanitizeBlingText(`token ${jwt} recusado`)).toBe('token [token] recusado');
    expect(sanitizeBlingText('Authorization: Bearer abc.def-ghi')).toBe('Authorization: Bearer [token]');
  });

  it('token opaco comprido', () => {
    expect(sanitizeBlingText(`refresh ${'a1b2'.repeat(10)} inválido`)).toBe('refresh [token] inválido');
  });

  it('CPF, CNPJ, com e sem pontuação', () => {
    expect(sanitizeBlingText('CPF 123.456.789-09')).toBe('CPF [documento]');
    expect(sanitizeBlingText('CPF 12345678909')).toBe('CPF [documento]');
    expect(sanitizeBlingText('CNPJ 12.345.678/0001-95')).toBe('CNPJ [documento]');
    expect(sanitizeBlingText('CNPJ 12345678000195')).toBe('CNPJ [documento]');
  });

  it('e-mail e telefone', () => {
    expect(sanitizeBlingText('contato fulano.tal@example.com')).toBe('contato [e-mail]');
    expect(sanitizeBlingText('fone (51) 99876-5432')).toBe('fone [telefone]');
    // Onze dígitos sem pontuação são CPF OU celular — não dá para saber qual.
    // O marcador pode ser qualquer um; o número é que não pode sobrar.
    expect(sanitizeBlingText('fone 51998765432')).not.toMatch(/\d{4}/);
  });

  it('não come o que não é dado pessoal', () => {
    expect(sanitizeBlingText('pedido 14349 com 8 itens, total 1.117,00')).toBe(
      'pedido 14349 com 8 itens, total 1.117,00'
    );
    expect(sanitizeBlingText('dataPrevista 2026-09-14 inválida')).toBe('dataPrevista 2026-09-14 inválida');
  });

  it('corta em 300 caracteres e junta os espaços', () => {
    expect(sanitizeBlingText('a\n\n  b')).toBe('a b');
    expect(sanitizeBlingText('x '.repeat(400))).toHaveLength(300);
  });
});

describe('describeBlingFailure', () => {
  it('erro do Bling, erro de conexão e erro qualquer', () => {
    expect(describeBlingFailure(new BlingApiError(400, 'VALIDATION_ERROR', 'campo'))).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'campo',
    });
    expect(describeBlingFailure(new BlingConnectionError('revoked', 'reconecte'))).toEqual({
      code: 'revoked',
      message: 'reconecte',
    });
    // Um Error qualquer também passa pelo sanitizador.
    expect(describeBlingFailure(new Error('falhou para fulano@example.com'))).toEqual({
      code: 'unexpected',
      message: 'falhou para [e-mail]',
    });
  });
});

describe('sanitizeBlingText — o que a auditoria da 0.11.0 achou passando', () => {
  it('RG e inscrição estadual com pontuação', () => {
    expect(sanitizeBlingText('RG 12.345.678-9 inválido')).toBe('RG [documento] inválido');
    expect(sanitizeBlingText('IE 123.456.789.012 não confere')).toBe('IE [documento] não confere');
  });

  it('CEP e número comprido sem pontuação', () => {
    expect(sanitizeBlingText('CEP 90000-000 inexistente')).toBe('CEP [cep] inexistente');
    // Dez dígitos também parecem telefone: o marcador pode ser qualquer um.
    expect(sanitizeBlingText('IE 1234567890 inválida')).not.toMatch(/\d{4}/);
    expect(sanitizeBlingText('IE 123456789012 inválida')).toBe('IE [número] inválida');
    expect(sanitizeBlingText('CEP 90000000 inexistente')).toBe('CEP [número] inexistente');
  });
});
