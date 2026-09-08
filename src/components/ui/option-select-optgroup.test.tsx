import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { OptionSelect } from './option-select';

/**
 * Regression: "não estou conseguindo selecionar para mover oportunidade para
 * x etapa".
 *
 * The stage pickers in the automation builder group their stages by funnel,
 * so every stage row is written inside an <optgroup>. OptionSelect used to
 * walk only its DIRECT <option> children, which dropped the groups whole:
 * the list offered nothing but "Escolha uma etapa...", and a stage saved on
 * an existing automation showed in the closed field as its raw UUID, because
 * base-ui's Select.Value resolves a label out of `items` and the option
 * carrying the name never got there.
 *
 * The popup lives in a portal and does not server-render, so these assert on
 * the trigger — which is exactly where the UUID was showing.
 */

const FOLLOW_UP = '8f1c0d6e-1b7a-4a53-9c2e-3f5a7d9b0c11';
const GELADEIRA = 'b2d4e6f8-0a1c-4e35-8d7b-6c9a1f2e3d40';

/** The shape StageSelect writes: a loose placeholder, then a funnel's stages
 *  inside an <optgroup> — the rows that used to vanish. */
function stagePicker(value: string) {
  return renderToStaticMarkup(
    <OptionSelect value={value} onValueChange={() => {}}>
      <option value="">Escolha uma etapa...</option>
      <optgroup key="comercial" label="Comercial">
        <option key={FOLLOW_UP} value={FOLLOW_UP}>
          Follow-up
        </option>
        <option key={GELADEIRA} value={GELADEIRA}>
          Geladeira 30D
        </option>
      </optgroup>
    </OptionSelect>
  );
}

/** What the closed field reads out. The id also appears in base-ui's hidden
 *  form input, which is the point of it — this is only the visible half. */
function shownLabel(html: string) {
  return html.match(/data-slot="select-value"[^>]*>([^<]*)</)?.[1] ?? '';
}

/** The value base-ui would submit — the id the automation stores. */
function submittedValue(html: string) {
  return html.match(/hidden-input[\s\S]*?value="([^"]*)"/)?.[1] ?? '';
}

describe('OptionSelect reads <optgroup> rows', () => {
  it('shows the saved stage by name, not by id', () => {
    expect(shownLabel(stagePicker(FOLLOW_UP))).toBe('Follow-up');
  });

  it('resolves a second row of the same group', () => {
    expect(shownLabel(stagePicker(GELADEIRA))).toBe('Geladeira 30D');
  });

  it('still resolves an ungrouped row', () => {
    expect(shownLabel(stagePicker(''))).toBe('Escolha uma etapa...');
  });

  it('keeps the stored id untouched behind the name', () => {
    expect(submittedValue(stagePicker(FOLLOW_UP))).toBe(FOLLOW_UP);
  });
});

/**
 * Item 12 do pacote: "o campo Contato mostra `eb8d692a-…`".
 *
 * O mecanismo é o mesmo do item 30 e está descrito no topo deste arquivo —
 * `Select.Value` resolve o rótulo entre os `items` e, quando não acha,
 * desenha o valor. A diferença é que ali o valor sumia por causa de um
 * `<optgroup>` e aqui ele some porque a LISTA ainda não chegou: o id vem do
 * registro no primeiro render, os contatos vêm de um efeito.
 *
 * O conserto, em `deal-form.tsx`, é uma opção que sempre existe para o
 * valor que existe. Estas duas asserções são o antes e o depois dela.
 */
const CONTATO = 'eb8d692a-4f2e-4229-beb0-a2c33985b569';

function campoContato(rows: React.ReactNode) {
  return renderToStaticMarkup(
    <OptionSelect value={CONTATO} onValueChange={() => {}}>
      <option value="">Escolha um contato</option>
      {rows}
    </OptionSelect>
  );
}

describe('um valor sem opção que case', () => {
  it('desenha o UUID — é o defeito do item 12', () => {
    // A lista ainda vazia, que é o primeiro quadro de toda edição.
    expect(shownLabel(campoContato(null))).toBe(CONTATO);
  });

  it('com a opção de espera, desenha o rótulo', () => {
    expect(
      shownLabel(campoContato(<option value={CONTATO}>Carregando…</option>))
    ).toBe('Carregando…');
  });

  it('e o id continua sendo o que o formulário grava', () => {
    expect(
      submittedValue(campoContato(<option value={CONTATO}>Carregando…</option>))
    ).toBe(CONTATO);
  });

  it('quando a lista chega, quem manda é o nome de verdade', () => {
    expect(
      shownLabel(
        campoContato(
          <>
            <option value={CONTATO}>Euclides Fernando Goncalves</option>
          </>
        )
      )
    ).toBe('Euclides Fernando Goncalves');
  });
});
