'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * PRENDER A CONVERSA NO FIM — E CONTINUAR PRESA ENQUANTO A MÍDIA CHEGA.
 *
 * ------------------------------------------------------------------
 * O DEFEITO, COMO ELE APARECE
 * ------------------------------------------------------------------
 *
 * Gabriel, 14 de setembro: *"quando abre o chat da equipe ele nao carrega
 * em baixo, tem que arrastar na ultima mensagem"*. E o print mostra por
 * quê: as últimas mensagens da sala eram um PDF, um áudio e uma FOTO.
 *
 * As duas telas de conversa faziam a mesma coisa, e ela está certa por um
 * instante só:
 *
 *     useEffect(() => { el.scrollTop = el.scrollHeight }, [messages])
 *
 * No momento em que esse efeito roda, a foto ainda não chegou. O navegador
 * não sabe a altura dela, reserva zero, e `scrollHeight` é a altura de uma
 * lista SEM a foto — então prender "no fim" prende no fim de uma lista
 * menor do que a que a pessoa vai ver. Meio segundo depois a imagem chega,
 * empurra tudo para baixo, e o `scrollTop` continua onde estava: agora no
 * meio. Quanto mais mídia no final da sala, mais longe do fim ele para.
 *
 * Não é o carregamento das mensagens que está atrasado — é a ALTURA delas.
 *
 * ------------------------------------------------------------------
 * COMO ESTE GANCHO RESOLVE
 * ------------------------------------------------------------------
 *
 * Prendendo de novo toda vez que o conteúdo muda de tamanho, e não só
 * quando a lista muda. Um `ResizeObserver` no contêiner e nos filhos vê a
 * foto chegar, o player de áudio montar, o compositor crescer de uma para
 * quatro linhas — e reprende.
 *
 * Com uma condição, que é o que separa "prender" de "sequestrar": só
 * reprende QUEM JÁ ESTAVA no fim. Quem rolou para cima para reler algo de
 * ontem não pode ser puxado de volta porque uma imagem terminou de
 * carregar — isso seria trocar um defeito por um pior.
 *
 * A chegada de mensagem nova continua prendendo sem perguntar, que é o que
 * as duas telas já faziam antes deste gancho. Este arquivo conserta a
 * mídia; não muda o que a lista sempre fez.
 */

/** Quanto pode faltar para o fim e ainda contar como "está no fim". */
export const PIN_SLACK = 80;

/**
 * Está no fim?
 *
 * Com folga, e não com igualdade: o zoom do navegador e as alturas
 * fracionárias fazem `scrollTop + clientHeight` parar um ou dois pixels
 * antes de `scrollHeight`, e uma conta exata diria "saiu do fim" para
 * quem não saiu do lugar. A folga também cobre quem rolou meia linha.
 */
export function estaNoFim(
  m: { scrollTop: number; scrollHeight: number; clientHeight: number },
  folga: number = PIN_SLACK
): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= folga;
}

export function usePinToBottom(
  ref: RefObject<HTMLElement | null>,
  /** A lista. Mudou, prende — como antes deste gancho existir. */
  dep: unknown,
  folga: number = PIN_SLACK
): void {
  // Um ref, e não estado: isto é lido dentro de ouvintes e nunca desenha
  // nada. Como estado, cada rolagem viraria um render da conversa inteira.
  const grudado = useRef(true);

  /*
   * TUDO NUMA EFETIVAÇÃO SÓ, E ISSO É O CONSERTO DENTRO DO CONSERTO.
   *
   * O ouvinte de rolagem — o único que sabe dizer "esta pessoa subiu" —
   * estava numa efetivação própria, com `[ref, folga]` por dependência.
   * Parece certo: o contêiner não muda, então basta atar uma vez.
   *
   * Só que nas primeiras passadas o contêiner NÃO EXISTE. As duas telas
   * desenham um estado de carregamento enquanto a lista não chega, e
   * `ref.current` é nulo. Medido na sala do Gabriel, as passadas da
   * efetivação foram:
   *
   *     SEM-EL, SEM-EL, com-el, com-el, com-el, com-el, com-el
   *
   * As duas primeiras são as únicas que `[ref, folga]` teria rodado — e
   * nelas não há elemento em que atar nada. A efetivação desiste na
   * primeira linha e, como as dependências dela nunca mudam, nunca mais
   * roda. O ouvinte jamais é atado, `grudado` fica `true` para sempre, e
   * o gancho passa a puxar de volta justamente quem subiu para reler.
   *
   * Com a lista na dependência, a efetivação roda de novo quando a lista
   * chega — que é quando o contêiner passa a existir. Reatar os ouvintes
   * a cada mensagem nova é barato, e é o preço de atá-los na hora certa.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prender = () => {
      if (grudado.current) el.scrollTop = el.scrollHeight;
    };

    // A lista mudou: prende agora, com a altura que existe neste instante.
    grudado.current = true;
    prender();

    const aoRolar = () => {
      grudado.current = estaNoFim(el, folga);
    };
    el.addEventListener('scroll', aoRolar, { passive: true });

    const ro = new ResizeObserver(prender);
    ro.observe(el);
    // Os filhos também: o contêiner é `flex-1` e não muda de altura quando
    // o que está DENTRO dele cresce — que é exatamente o caso da foto.
    for (const filho of Array.from(el.children)) ro.observe(filho);

    // `load` não borbulha, daí a fase de captura. E não é redundância com
    // o observador: medido na sala do Gabriel, a abertura dispara CATORZE
    // `load` — um por mídia — e é esse o sinal que chega primeiro.
    el.addEventListener('load', prender, true);

    return () => {
      el.removeEventListener('scroll', aoRolar);
      ro.disconnect();
      el.removeEventListener('load', prender, true);
    };
  }, [ref, dep, folga]);
}
