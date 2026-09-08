import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ContextMenu,
  ContextMenuActionsTrigger,
  ContextMenuTrigger,
} from './context-menu';

/**
 * O botão de ações é um `<button>` comum, e isso é o contrato.
 *
 * ------------------------------------------------------------------
 * A ARMADILHA QUE ESTE ARQUIVO EVITA
 * ------------------------------------------------------------------
 *
 * Este repositório já foi mordido duas vezes pela mesma coisa: uma peça do
 * base-ui que lê um contexto obrigatório e **lança na renderização** quando
 * ele falta. O `ContextMenuLabel` derrubou a tela inteira num clique-direito,
 * e o `DropdownMenuLabel` recarregou a página no construtor de fluxos — os
 * dois com um teste igual a este ao lado, porque nem o compilador nem o lint
 * têm o que dizer sobre um contexto que só existe em tempo de execução.
 *
 * O `ContextMenuActionsTrigger` lê o mesmo contexto de cursor, mas **com
 * guarda**: sem um `ContextMenu` em volta ele desenha um botão que não abre
 * nada, em vez de quebrar. Isso é de propósito — a peça é decorativa até
 * alguém ligar o `onOpen` — e é o que estes testes prendem.
 *
 * ------------------------------------------------------------------
 * E POR QUE `type="button"` IMPORTA
 * ------------------------------------------------------------------
 *
 * Ele vive dentro do cartão de um quadro, e cartões vivem dentro de
 * formulários com frequência maior do que se espera. Um `<button>` sem
 * `type` é `submit`: clicar em "ações" enviaria o formulário e recarregaria
 * a página, que é exatamente o sintoma da issue #336.
 */
describe('ContextMenuActionsTrigger', () => {
  it('renders on its own, without a ContextMenu ancestor', () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(
          ContextMenuActionsTrigger,
          { onOpen: () => {} },
          'x'
        )
      )
    ).not.toThrow();
  });

  it('is a type="button", never a submit', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContextMenuActionsTrigger, { onOpen: () => {} }, 'x')
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('data-slot="context-menu-actions-trigger"');
  });

  it('renders beside the trigger inside a ContextMenu', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ContextMenu,
        null,
        React.createElement(ContextMenuTrigger, null, 'card'),
        React.createElement(
          ContextMenuActionsTrigger,
          { onOpen: () => {}, 'aria-label': 'Ações' },
          '⋯'
        )
      )
    );
    expect(html).toContain('aria-label="Ações"');
    expect(html).toContain('card');
  });
});
