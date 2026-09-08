'use client';

import { QuotesArea } from '@/components/quotes/quotes-area';

/**
 * Documentos → Orçamentos.
 *
 * Casca fina, como toda rota deste app: o trabalho vive no componente.
 *
 * E esta rota, ao contrário das outras, NÃO está na barra lateral — o
 * pedido foi explícito ("isso pode ficar fora do menu principal"). Chega-se
 * aqui pelo rodapé do próprio documento de orçamento, que é onde a pergunta
 * "cadê o que a gente mandou?" nasce.
 */
export default function OrcamentosPage() {
  return <QuotesArea />;
}
