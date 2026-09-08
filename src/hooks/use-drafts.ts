'use client';

import { useSyncExternalStore } from 'react';

import {
  NO_DRAFTS,
  getDrafts,
  subscribeDrafts,
  type Drafts,
} from '@/lib/inbox/drafts';

/**
 * Os rascunhos não enviados, para quem só quer LER.
 *
 * Hoje é a lista de conversas, que desenha o selo "Rascunho:" (item 14 do
 * pacote). Quem escreve é o compositor, e ele guarda o próprio texto em
 * `useState` — este gancho é o espelho, não a fonte.
 *
 * `useSyncExternalStore` e não um efeito: o valor já existe antes do
 * primeiro render, e ler num efeito faria a lista pintar uma vez sem os
 * selos e outra com. No servidor a resposta é o mapa vazio congelado, que é
 * a verdade — `localStorage` é do navegador.
 */
export function useDrafts(): Drafts {
  return useSyncExternalStore(subscribeDrafts, getDrafts, () => NO_DRAFTS);
}
