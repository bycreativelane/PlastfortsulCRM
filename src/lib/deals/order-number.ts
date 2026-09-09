import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * O PRÓXIMO NÚMERO DE PEDIDO, a partir do último que saiu.
 *
 * Pedido do Gabriel em 8 de setembro de 2026: "pedido de venda puxando do
 * último que foi criado". É o que o Bling faz — o campo já vem preenchido
 * com o próximo, e quem quiser outro digita por cima.
 *
 * ------------------------------------------------------------------
 * É UMA SUGESTÃO, E NÃO UMA SEQUÊNCIA
 * ------------------------------------------------------------------
 *
 * A numeração de verdade é do Bling, do outro lado, e este CRM não a
 * controla: dois pedidos podem sair de lá enquanto ninguém abriu esta
 * gaveta. Uma coluna `SERIAL` aqui daria um número autoritativo e ERRADO,
 * e a operação descobriria na hora de lançar.
 *
 * Então o campo continua sendo texto digitável, e isto só poupa a digitação
 * do caso comum. É também por isso que a falha é silenciosa: quando não dá
 * para adivinhar, o campo fica VAZIO — nunca com um palpite que pareça
 * confirmado.
 */

/**
 * `14349` → `14350`. `PV-0099` → `PV-0100`.
 *
 * Incrementa o último grupo de dígitos e preserva a largura, porque um
 * pedido `0099` numa operação que zera à esquerda vira `0100` e não `100`.
 * O que vem antes dos dígitos é copiado como está: prefixos como `PV-` ou
 * `2026/` são o jeito de a empresa separar séries, e reescrevê-los seria
 * inventar uma regra que ninguém contou.
 *
 * Devolve `''` quando não há dígito nenhum para incrementar.
 */
export function nextOrderNumber(last: string | null | undefined): string {
  const texto = (last ?? '').trim();
  if (!texto) return '';

  const m = texto.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return '';

  const [, prefixo, digitos, sufixo] = m;
  const proximo = String(BigInt(digitos) + BigInt(1));
  // `padStart` e não `slice`: `999` vira `1000`, e cortar para caber na
  // largura antiga daria `000` — o único jeito de esta função devolver um
  // número MENOR do que o último.
  return prefixo + proximo.padStart(digitos.length, '0') + sufixo;
}

/**
 * O último pedido digitado nesta conta.
 *
 * Por `created_at` e não pelo maior número: o que a pessoa quer é o
 * próximo do que ela acabou de lançar, e ordenar por texto poria `9` na
 * frente de `14349`. Ordenar numericamente exigiria que a coluna FOSSE um
 * número, e ela não é — ver o cabeçalho.
 */
export async function loadLastOrderNumber(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('deals')
    .select('sales_order_number')
    .eq('account_id', accountId)
    .not('sales_order_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Silêncio de propósito: um banco anterior à 070 não tem a coluna, e a
  // gaveta abre igual — só sem a sugestão.
  if (error || !data) return null;
  return (data as { sales_order_number: string | null }).sales_order_number;
}
