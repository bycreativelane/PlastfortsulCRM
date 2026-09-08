import { describe, expect, it } from 'vitest';

import { buildQuote } from './quote';
import { quotePage } from './render';

/**
 * A PÁGINA, que é a metade testável sem navegador.
 *
 * `renderQuoteFiles` precisa de um Chromium e não roda na suíte — ela foi
 * exercitada à mão contra o Chrome da máquina em 8 de setembro, e o que
 * saiu está descrito no commit: PDF de uma página, 49 KB, sem carimbo do
 * navegador, e PNG de 1330×1266 recortado no documento.
 *
 * O que ESTE arquivo guarda é o contrato que a página tem de cumprir para
 * aquele Chromium produzir a coisa certa: documento dentro, folha junto, e
 * nada do app.
 */

const LABELS = {
  title: 'Orçamento',
  orderNumber: 'Pedido {number}',
  customer: 'Cliente',
  products: 'Produtos',
  lineDiscount: '{percent}% de desconto',
  subtotal: 'Produtos',
  shipping: 'Frete',
  total: 'Total',
  delivery: 'Entrega:',
  owner: 'Atendimento: {name}',
  notes: 'Observações',
  footer: 'Sujeito a confirmação.',
};

const MARCA = {
  name: 'PlastfortSul',
  legalName: 'Plastfort Sul Embalagens Ltda.',
  taxId: 'CNPJ 12.345.678/0001-90',
  phone: '+55 (47) 3333-4444',
  email: 'comercial@plastfortsul.com.br',
  site: 'plastfortsul.com.br',
  address: null,
  logoUrl: null,
};

const QUOTE = buildQuote({
  orderNumber: '14349',
  issuedOn: '2026-09-08',
  company: 'Plastfort Sul Embalagens Ltda.',
  customerName: 'Euclides Fernando Goncalves',
  items: [
    {
      productId: 'p1',
      name: 'Sacos para silagem 51x110 branco',
      quantity: 100,
      unitPrice: 4.25,
      discountPercent: 0,
    },
  ],
  currency: 'BRL',
  shipping: 120,
  owner: 'Juliana Prestes',
});

/** `Intl` separa símbolo e número com espaço NÃO-QUEBRÁVEL. */
const legivel = (html: string) => html.replace(/ /g, ' ');

describe('quotePage', async () => {
  const html = await quotePage(QUOTE, LABELS, MARCA);

  it('é uma página completa e autossuficiente', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // A folha VAI JUNTO. É a razão de o documento não usar Tailwind: o
    // Chrome headless não tem o bundle do app.
    expect(html).toContain('.q-total strong');
    expect(html).toContain('<article class="q">');
  });

  it('leva a conta pronta, e não uma para o navegador fazer', () => {
    const t = legivel(html);
    expect(t).toContain('R$ 425,00');
    expect(t).toContain('R$ 120,00');
    expect(t).toContain('R$ 545,00');
  });

  it('leva a identidade da empresa, que é o ponto do item 54', () => {
    expect(html).toContain('Plastfort Sul Embalagens Ltda.');
    expect(html).toContain('CNPJ 12.345.678/0001-90');
    expect(html).toContain('comercial@plastfortsul.com.br');
  });

  it('resolve os moldes com variável', () => {
    expect(html).toContain('Pedido 14349');
    expect(html).toContain('Atendimento: Juliana Prestes');
    expect(html).not.toContain('{number}');
    expect(html).not.toContain('{name}');
  });

  it('omite o que a empresa ainda não disse de si', async () => {
    const semMarca = await quotePage(QUOTE, LABELS, { name: 'PlastfortSul' });
    expect(semMarca).toContain('PlastfortSul');
    // `class="…"` E NÃO o nome da classe solto: a FOLHA sempre viaja
    // junto, então `q-tax` aparece na página mesmo quando o elemento não
    // é desenhado. A primeira versão desta asserção reprovava por isso —
    // ela olhava a página inteira quando a pergunta é sobre a marcação.
    expect(semMarca).not.toContain('class="q-tax"');
    expect(semMarca).not.toContain('class="q-logo"');
  });

  it('a logo entra como imagem quando existe', async () => {
    const comLogo = await quotePage(QUOTE, LABELS, {
      ...MARCA,
      logoUrl: 'https://exemplo/logo.png',
    });
    expect(comLogo).toContain('class="q-logo"');
    expect(comLogo).toContain('https://exemplo/logo.png');
  });
});
