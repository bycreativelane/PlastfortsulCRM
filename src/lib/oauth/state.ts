import crypto from 'crypto';

/**
 * O `state` de um fluxo OAuth: um nonce assinado, conferido na volta contra
 * o mesmo nonce guardado num cookie `httpOnly`.
 *
 * Nasceu em `lib/calendar-sync/google/oauth.ts` e mudou-se para cá quando o
 * Bling precisou do mesmo: é código de segurança, e duas cópias são duas
 * chances de uma ficar para trás.
 *
 * ------------------------------------------------------------------
 * POR QUE ELE NÃO É OPCIONAL
 * ------------------------------------------------------------------
 *
 * Sem conferir o `state`, o callback aceita uma autorização que OUTRO site
 * iniciou: alguém induz um admin logado a abrir um endereço de callback com
 * um `code` da conta do atacante, e o CRM da vítima passa a falar com a conta
 * de quem atacou. O ataque é silencioso — a tela diz "conectado" e está
 * dizendo a verdade, só que sobre a conta errada.
 *
 * ------------------------------------------------------------------
 * SEM `ENCRYPTION_KEY`, NÃO ASSINA
 * ------------------------------------------------------------------
 *
 * A versão da Google assinava com a chave vazia quando a variável faltava —
 * um HMAC que qualquer um calcula. Aqui a assinatura lança, e a conferência
 * recusa. Um servidor sem `ENCRYPTION_KEY` também não consegue cifrar os
 * tokens, então não há fluxo que funcione pela metade.
 */

function chave(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY ausente: o state do OAuth não tem como ser assinado');
  }
  return key;
}

export function signState(nonce: string): string {
  const mac = crypto.createHmac('sha256', chave()).update(nonce).digest('hex');
  return `${nonce}.${mac}`;
}

export function newStateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Confere o `state` do retorno contra o nonce guardado no cookie.
 *
 * `timingSafeEqual` e não `===`: a comparação de um MAC byte a byte com
 * saída antecipada vaza, pelo tempo, quantos bytes iniciais estavam certos.
 */
export function verifyState(state: string, cookieNonce: string): boolean {
  if (!state || !cookieNonce) return false;
  const [nonce, mac] = state.split('.');
  if (!nonce || !mac) return false;
  if (nonce !== cookieNonce) return false;

  let expected: string;
  try {
    expected = signState(nonce).split('.')[1];
  } catch {
    return false;
  }
  const a = Buffer.from(mac, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}
