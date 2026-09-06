// ============================================================
// De qual endereço a documentação fala.
//
// Uma referência de API que escreve `https://seu-crm.exemplo.com` em
// todo `curl` obriga quem lê a fazer uma substituição mental em cada
// bloco — e a errar uma. Como esta página é servida pela MESMA origem
// que a API que ela documenta, o endereço certo já está na requisição.
//
// Então o spec escreve `__BASE_URL__` e a renderização troca. O token
// é feio de propósito: nada em prosa de verdade se parece com ele, o
// que torna a substituição segura sem parser.
// ============================================================

import { headers } from 'next/headers';

export const BASE_URL_TOKEN = '__BASE_URL__';

/** O que aparece quando não há requisição de onde tirar a origem. */
const FALLBACK = 'https://seu-crm.exemplo.com';

/** Troca o token pela origem, em qualquer string do spec. */
export function applyBaseUrl(text: string, baseUrl: string): string {
  return text.split(BASE_URL_TOKEN).join(baseUrl);
}

/**
 * A origem desta instância, lida da requisição.
 *
 * `x-forwarded-proto` primeiro porque em produção há um proxy à frente
 * e o processo enxerga http mesmo quando o mundo enxerga https —
 * publicar `http://` num exemplo de credencial seria um conselho ruim.
 * `NEXT_PUBLIC_SITE_URL` entra antes do host quando está configurada,
 * já que ela é a resposta deliberada de quem fez o deploy.
 *
 * Chamar isto torna a página dinâmica, o que é o certo: uma doc que
 * fala do endereço de quem a abriu não pode ser pré-renderizada num
 * endereço só.
 */
export async function currentBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  try {
    const h = await headers();
    const host = h.get('host');
    if (!host) return FALLBACK;
    const proto =
      h.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
      (host.startsWith('localhost') || host.startsWith('127.0.0.1')
        ? 'http'
        : 'https');
    return `${proto}://${host}`;
  } catch {
    return FALLBACK;
  }
}
