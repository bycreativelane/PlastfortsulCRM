import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { blingAdmin } from '@/lib/bling/admin-client';
import { blingRequest } from '@/lib/bling/client';
import { BlingConnectionError, describeBlingFailure } from '@/lib/bling/errors';
import { parseCompany } from '@/lib/bling/http';
import { blingOAuthConfig } from '@/lib/bling/oauth';

/**
 * "Testar conexão": uma chamada de verdade, pelo caminho inteiro.
 *
 * `GET /empresas/me/dados-basicos` passa pelo token (e renova, se precisar,
 * com a vez), pelo balde de fichas e pelo cliente — é a mesma porta que as
 * próximas fases vão usar. Se a razão social ou o CNPJ mudaram no Bling, a
 * linha acompanha.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const config = blingOAuthConfig();
    if (!config) {
      return NextResponse.json(
        { ok: false, error: { code: 'not_configured', message: '' } },
        { status: 503 }
      );
    }

    const db = blingAdmin();
    const { data: row } = await db
      .from('bling_connections')
      .select('id, company_name, company_cnpj')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const conexao = row as { id: string; company_name: string | null; company_cnpj: string | null } | null;
    if (!conexao) {
      return NextResponse.json(
        { ok: false, error: { code: 'not_connected', message: '' } },
        { status: 409 }
      );
    }

    try {
      const resposta = await blingRequest<unknown>(
        db,
        conexao.id,
        '/empresas/me/dados-basicos',
        {},
        { config }
      );
      const company = parseCompany(resposta);
      if (!company) {
        return NextResponse.json(
          {
            ok: false,
            error: { code: 'invalid_response', message: 'o Bling respondeu sem os dados da empresa' },
          },
          { status: 502 }
        );
      }
      if (company.name !== conexao.company_name || company.cnpj !== conexao.company_cnpj) {
        await db
          .from('bling_connections')
          .update({
            company_name: company.name,
            company_cnpj: company.cnpj,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conexao.id);
      }
      return NextResponse.json({ ok: true, company: { name: company.name, cnpj: company.cnpj } });
    } catch (erro) {
      const falha = describeBlingFailure(erro);
      const status =
        erro instanceof BlingConnectionError && erro.code === 'revoked' ? 409 : 502;
      return NextResponse.json({ ok: false, error: falha }, { status });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
