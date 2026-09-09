import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A GAVETA DA OPORTUNIDADE SEGUE A ORDEM DO PEDIDO DE VENDA DO BLING.
 *
 * ------------------------------------------------------------------
 * POR QUE ISTO É UM GUARDA E NÃO UM COMENTÁRIO
 * ------------------------------------------------------------------
 *
 * O Gabriel terminou o pedido de 8 de setembro de 2026 com duas palavras:
 * "nesta ordem". A ordem não é gosto — enquanto a integração com o Bling
 * não existe (o item 59 do pacote a proíbe agora), alguém transcreve esta
 * tela naquela, campo a campo. Transcrever fora de ordem é onde se troca
 * um campo por outro.
 *
 * E é a espécie de coisa que se desfaz sozinha: mover um bloco de JSX para
 * cima porque "fica melhor perto do outro" não quebra teste nenhum, não
 * muda o tipo de nada, e passa em qualquer revisão que não tenha o print
 * do Bling aberto ao lado. Foi assim que o Responsável tinha ido parar no
 * rodapé do documento antes desta rodada.
 *
 * ------------------------------------------------------------------
 * COMO ELE MEDE
 * ------------------------------------------------------------------
 *
 * Pela posição dos `id=` no arquivo, que é o mais próximo da ordem VISUAL
 * que dá para afirmar sem renderizar — a gaveta é uma coluna só, então a
 * ordem do documento é a ordem da tela. Um `id` também é o que sobrevive a
 * mudar classe, rótulo e componente.
 *
 * O que ele NÃO garante: que o campo esteja visível. `deal-stage` só é
 * desenhado ao editar, e isso está no teste ao lado.
 */

const FORM = join(
  process.cwd(),
  'src',
  'components',
  'pipelines',
  'deal-form.tsx'
);

/**
 * A ordem que o Gabriel ditou, traduzida em campos:
 *
 *     pedido de venda → cliente e, do lado, o responsável → produto →
 *     condição de pagamento → transportadora, volumes, peso bruto e o
 *     valor do frete
 *
 * O produto não tem `id` aqui — ele é um componente inteiro — então entra
 * pelo nome da tag. As parcelas idem.
 */
const ORDEM = [
  'id="deal-order"',
  'id="deal-contact"',
  'id="deal-assignee"',
  '<DealItemsEditor',
  'id="deal-value"',
  '<DealInstallments',
  'id="deal-carrier"',
  'id="deal-freight-mode"',
  'id="deal-shipping"',
  'id="deal-volumes"',
  'id="deal-weight"',
  'id="deal-notes"',
];

describe('a ordem dos campos da oportunidade', () => {
  const fonte = readFileSync(FORM, 'utf8');

  it('é a do pedido de venda do Bling, campo a campo', () => {
    const posicoes = ORDEM.map((marca) => [marca, fonte.indexOf(marca)] as const);

    const ausentes = posicoes.filter(([, i]) => i < 0).map(([m]) => m);
    expect(ausentes, 'campo sumiu do formulário').toEqual([]);

    const foraDeOrdem: string[] = [];
    for (let i = 1; i < posicoes.length; i++) {
      if (posicoes[i][1] < posicoes[i - 1][1]) {
        foraDeOrdem.push(`${posicoes[i][0]} veio antes de ${posicoes[i - 1][0]}`);
      }
    }

    expect(
      foraDeOrdem,
      'A gaveta segue a ordem do pedido de venda do Bling: pedido → ' +
        'cliente e responsável → produto → condição de pagamento → ' +
        'transporte. Ver o comentário no topo deste arquivo e o do bloco ' +
        'em deal-form.tsx.'
    ).toEqual([]);
  });

  it('não pede a etapa ao CRIAR — ela entra em Em Aberto sozinha', () => {
    // "se estamos criando oportunidade já vai automático para em aberto,
    // não precisa escolher". O select existe, e só quando há `deal`.
    expect(fonte).toContain('entryStage(stages)?.id');
    expect(fonte).toMatch(/\{deal \?[\s\S]{0,400}id="deal-stage"/);
  });

  it('o número do pedido vem do último criado', () => {
    expect(fonte).toContain('loadLastOrderNumber');
    expect(fonte).toContain('nextOrderNumber');
  });
});
