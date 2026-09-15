import { after, NextResponse } from 'next/server';

import { blingAdmin } from '@/lib/bling/admin-client';
import { blingOAuthConfig } from '@/lib/bling/oauth';
import { processWebhookEvents, receiveWebhook } from '@/lib/bling/webhook';

/**
 * O webhook do Bling (Fase 6). Sem sessão: a prova de origem é a assinatura
 * HMAC com o client secret (`lib/bling/webhook.ts`).
 *
 * Responde rápido — o Bling considera falha o que passa de 5 s e desabilita
 * o webhook depois de três dias falhando — e processa depois.
 */
export async function POST(request: Request) {
  const config = blingOAuthConfig();
  // Dormente: nada configurado neste servidor. 503 e não 2xx: se alguém
  // cadastrou o webhook sem configurar o servidor, o Bling mostra o erro.
  if (!config) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const corpo = await request.text();
  const db = blingAdmin();
  try {
    const resultado = await receiveWebhook(db, corpo, request.headers.get('x-bling-signature-256'), config.clientSecret);
    if (resultado.status === 200 && 'accepted' in resultado.body) {
      const eventRowId = resultado.body.id;
      after(() => processWebhookEvents(db, { eventRowId }).then(() => undefined));
    }
    return NextResponse.json(resultado.body, { status: resultado.status });
  } catch (erro) {
    // Gravar falhou: 500, e o Bling retenta — é exatamente o que se quer.
    console.error('[bling] webhook:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  }
}
