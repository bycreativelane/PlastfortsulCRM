import type { QuoteBrand } from '@/components/quotes/quote-document';

/**
 * A conta, vista como quem emite um documento.
 *
 * Uma função de uma linha e não um objeto montado à mão em cada lugar: o
 * orçamento é desenhado em quatro pontos do produto — a gaveta da
 * oportunidade, o arquivo de documentos, o bench e a rota que gera o PDF
 * no servidor — e o dia em que um deles esquecer o CNPJ é o dia em que
 * existem dois orçamentos diferentes com o mesmo nome.
 *
 * `legal_name` NÃO é resolvida aqui. Quem escolhe entre razão social e
 * nome curto é o documento, que sabe onde cada uma cabe; esta função só
 * entrega os dois.
 */
export function brandFromAccount(
  account: {
    name: string;
    legal_name?: string | null;
    tax_id?: string | null;
    company_phone?: string | null;
    company_email?: string | null;
    company_site?: string | null;
    company_address?: string | null;
    logo_url?: string | null;
  } | null
): QuoteBrand {
  return {
    name: account?.name ?? '',
    legalName: account?.legal_name ?? null,
    taxId: account?.tax_id ?? null,
    phone: account?.company_phone ?? null,
    email: account?.company_email ?? null,
    site: account?.company_site ?? null,
    address: account?.company_address ?? null,
    logoUrl: account?.logo_url ?? null,
  };
}
