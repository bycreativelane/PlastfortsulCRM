/**
 * O que foi digitado e não foi enviado, por conversa.
 *
 * ------------------------------------------------------------------
 * O DEFEITO QUE ISTO CONSERTA
 * ------------------------------------------------------------------
 *
 * Item 13 do pacote de correções, com print: você digita "Ola Ana, pode
 * botar para estas mensagens irem pro numero" na conversa da Ana, não
 * envia, abre a conversa do João — e o texto está lá, no compositor do
 * João, pronto para ir para a pessoa errada.
 *
 * A causa era uma linha que não existia. `MessageThread` montava
 * `<MessageComposer conversationId={…}>` SEM `key`, então o React
 * reaproveitava a mesma instância entre conversas e o `useState('')` do
 * texto atravessava a troca. Trocar de conversa não desmontava nada: só
 * trocava um prop.
 *
 * A `key` sozinha conserta o vazamento e cria o segundo defeito, que o
 * mesmo item 13 proíbe: desmontar joga o rascunho fora, e "voltar para X
 * e o texto ainda estar lá" é metade do pedido. Por isso a `key` vem
 * acompanhada deste arquivo.
 *
 * ------------------------------------------------------------------
 * POR QUE `localStorage`, E NÃO O BANCO
 * ------------------------------------------------------------------
 *
 * Um rascunho é um pensamento pela metade, não um registro. Ele não
 * precisa sobreviver a uma troca de máquina, ninguém mais na equipe
 * precisa vê-lo, e sincronizá-lo custaria uma tabela, uma migração e uma
 * escrita por tecla. O que ele precisa é sobreviver a trocar de conversa
 * e a um F5, que é exatamente o que `localStorage` faz de graça.
 *
 * O formato é UM mapa numa chave só, e não uma chave por conversa: a
 * lista de conversas precisa desenhar o selo "Rascunho:" em todas as
 * linhas de uma vez (item 14), e enumerar `localStorage` inteiro para
 * montar essa resposta seria pior do que ler um objeto.
 *
 * `localStorage` não é reativo — o padrão da casa para isso é o evento de
 * janela, o mesmo de `lib/team/messages.ts`. `storage` sozinho não serve
 * porque ele dispara nas OUTRAS abas e nunca na que escreveu; então os
 * dois: o evento próprio para esta aba, o `storage` para as outras.
 */

const KEY = 'wacrm:drafts';

/**
 * Quantas conversas guardam rascunho.
 *
 * Sem teto isto cresce para sempre: cada conversa em que alguém digitou e
 * desistiu deixa uma linha, e uma caixa de entrada movimentada acumula
 * milhares em um ano. Cinquenta é generoso para "as conversas em que
 * estou no meio de alguma coisa" e some antes de virar um problema de
 * cota. A saída é por menos-recentemente-escrito.
 */
export const MAX_DRAFTS = 50;

/** Disparado nesta aba quando um rascunho muda. */
export const DRAFTS_EVENT = 'wacrm:drafts';

export type Drafts = Readonly<Record<string, string>>;

/** Uma referência estável, para `useSyncExternalStore` não entrar em laço. */
export const NO_DRAFTS: Drafts = Object.freeze({});

/**
 * Lê o mapa gravado, tolerante a qualquer lixo.
 *
 * O conteúdo veio de uma versão anterior deste código, de outra aba, ou de
 * alguém mexendo no DevTools. Nenhuma dessas hipóteses vale uma tela
 * quebrada: o que não for um mapa de texto por texto é descartado campo a
 * campo, e não de uma vez — uma entrada corrompida não leva junto os
 * rascunhos bons ao lado dela.
 */
export function parseDrafts(raw: string | null): Drafts {
  if (!raw) return NO_DRAFTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_DRAFTS;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NO_DRAFTS;
  }
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(parsed)) {
    if (typeof text === 'string' && text.trim() !== '') out[id] = text;
  }
  return Object.keys(out).length ? out : NO_DRAFTS;
}

/**
 * Grava (ou apaga) um rascunho, e devolve o mapa novo.
 *
 * Puro, e é aqui que moram as três regras do item 13:
 *
 * 1. **Texto em branco APAGA.** "Apagar o que escrevi" é uma das três
 *    formas de descartar que o item lista, e um rascunho de espaços em
 *    branco é um selo "Rascunho:" na lista sem nada atrás dele.
 * 2. **Sem mudança, mesma referência.** Cada tecla passa por aqui; devolver
 *    um objeto novo a cada uma faria a lista de conversas inteira
 *    re-renderizar por nada.
 * 3. **Teto por menos-recente.** A chave é reinserida a cada escrita, então
 *    a ordem do objeto é a ordem de uso e o corte tira da frente.
 */
export function putDraft(
  drafts: Drafts,
  conversationId: string,
  text: string,
  max: number = MAX_DRAFTS
): Drafts {
  const vazio = text.trim() === '';
  const atual = drafts[conversationId];

  if (vazio) {
    if (atual === undefined) return drafts;
    const out = { ...drafts };
    delete out[conversationId];
    return Object.keys(out).length ? out : NO_DRAFTS;
  }

  if (atual === text) return drafts;

  // Reinserido no fim mesmo quando já existia: é isso que faz da ordem do
  // objeto uma ordem de uso.
  const out: Record<string, string> = { ...drafts };
  delete out[conversationId];
  out[conversationId] = text;

  const ids = Object.keys(out);
  for (let i = 0; i < ids.length - max; i++) delete out[ids[i]];
  return out;
}

/**
 * O rascunho como uma linha só, para a lista de conversas.
 *
 * A linha da lista é uma linha: um rascunho de três parágrafos entra ali
 * com as quebras viradas em espaço, senão o `truncate` corta no primeiro
 * enter e a prévia fica mentindo sobre o tamanho do que está escrito.
 *
 * Sem cortar por contagem de caracteres: quem corta é o CSS, que sabe a
 * largura real da coluna e é o mesmo mecanismo das outras prévias.
 */
export function draftPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── A ponte com o navegador ───────────────────────────────────────────

/**
 * Espelho em memória.
 *
 * `getSnapshot` do `useSyncExternalStore` é chamado a cada render e tem
 * que devolver a MESMA referência enquanto nada mudou — ler e reparsear
 * `localStorage` ali devolveria um objeto novo toda vez e o React
 * acusaria laço infinito. Então o disco é a verdade durável e isto é a
 * verdade da renderização.
 */
let cache: Drafts | null = null;

function read(): Drafts {
  if (typeof window === 'undefined') return NO_DRAFTS;
  try {
    return parseDrafts(window.localStorage.getItem(KEY));
  } catch {
    // Safari em janela privada estoura no ACESSO, não na escrita.
    return NO_DRAFTS;
  }
}

export function getDrafts(): Drafts {
  if (cache === null) cache = read();
  return cache;
}

export function getDraft(conversationId: string): string {
  return getDrafts()[conversationId] ?? '';
}

function commit(next: Drafts): void {
  if (next === cache) return;
  cache = next;
  try {
    if (next === NO_DRAFTS || Object.keys(next).length === 0) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    }
  } catch {
    /* Cota cheia ou armazenamento bloqueado. O rascunho segue em memória
       nesta aba, que é melhor do que derrubar o compositor por causa de
       um texto que ninguém pediu para guardar. */
  }
  window.dispatchEvent(new CustomEvent(DRAFTS_EVENT));
}

export function setDraft(conversationId: string, text: string): void {
  if (typeof window === 'undefined') return;
  commit(putDraft(getDrafts(), conversationId, text));
}

/** Enviou, ou descartou. As duas outras formas de limpar do item 13. */
export function clearDraft(conversationId: string): void {
  setDraft(conversationId, '');
}

/**
 * Assina as mudanças — as desta aba e as das outras.
 *
 * `storage` nunca dispara na aba que escreveu, e o evento próprio nunca
 * atravessa abas. Cada um cobre o buraco do outro. Na chegada de um
 * `storage` o espelho é invalidado, porque quem escreveu foi outra aba e
 * o que está em memória aqui é velho.
 */
export function subscribeDrafts(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const local = () => onChange();
  const remote = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return;
    cache = null;
    onChange();
  };
  window.addEventListener(DRAFTS_EVENT, local);
  window.addEventListener('storage', remote);
  return () => {
    window.removeEventListener(DRAFTS_EVENT, local);
    window.removeEventListener('storage', remote);
  };
}

/** Só para os testes: devolve o módulo ao estado de aba recém-aberta. */
export function resetDraftCacheForTests(): void {
  cache = null;
}
