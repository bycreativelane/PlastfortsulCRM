import { renderToStaticMarkup } from 'react-dom/server';

import {
  QUOTE_CSS,
  QuoteDocument,
  type QuoteBrand,
  type QuoteLabels,
} from '@/components/quotes/quote-document';
import type { Quote } from './quote';

/**
 * O documento como uma página inteira, e depois como arquivo.
 *
 * ------------------------------------------------------------------
 * POR QUE UM CHROME, E NÃO UMA BIBLIOTECA DE PDF
 * ------------------------------------------------------------------
 *
 * Porque o documento já existe, em HTML, conferido, e é o mesmo que a
 * pessoa vê na tela antes de mandar. Uma biblioteca de PDF pediria que
 * ele fosse escrito uma segunda vez no vocabulário dela — e duas
 * descrições do mesmo desenho divergem, sempre, na terceira alteração.
 *
 * Isto roda num VPS, não numa função sem estado com limite de 250 MB, e
 * essa é a diferença que torna a escolha barata: o Chromium é um pacote
 * do sistema, instalado uma vez na imagem.
 *
 * ------------------------------------------------------------------
 * `setContent` E NÃO `goto`
 * ------------------------------------------------------------------
 *
 * O navegador nunca visita o app. Ele recebe a página pronta, com o CSS
 * costurado dentro. Isso apaga de uma vez três problemas que a outra
 * abordagem teria: autenticar o navegador headless numa rota protegida,
 * expor uma rota pública com os dados de um orçamento, e depender de o
 * app estar de pé para gerar o documento dele mesmo.
 *
 * ------------------------------------------------------------------
 * E ACABA COM O CARIMBO DO NAVEGADOR
 * ------------------------------------------------------------------
 *
 * O caminho anterior era "Salvar como PDF" no diálogo de impressão, e o
 * Chrome carimbava data, URL e número de página no arquivo — `08/09/2026,
 * 19:21` e `localhost:3000/pipelines` saíram no primeiro PDF que o
 * Gabriel gerou. Aquilo é opção do usuário no diálogo, não da página:
 * nenhum CSS remove. Aqui não existe diálogo, e `displayHeaderFooter`
 * é `false` por escolha nossa.
 */

/** A página que vai para o navegador: marcação + folha, nada mais. */
export function quotePage(
  quote: Quote,
  labels: QuoteLabels,
  brand: QuoteBrand
): string {
  const corpo = renderToStaticMarkup(QuoteDocument({ quote, labels, brand }));
  return [
    '<!doctype html>',
    '<html lang="pt-BR"><head><meta charset="utf-8">',
    // 14mm de margem no papel, e o mesmo respiro na captura da imagem —
    // é o que faz o PNG parecer um documento e não um recorte de tela.
    `<style>${QUOTE_CSS}
      html, body { margin: 0; padding: 0; background: #fff; }
      body { padding: 14mm; }
    </style>`,
    '</head><body>',
    corpo,
    '</body></html>',
  ].join('');
}

export interface QuoteFiles {
  pdf: Buffer;
  png: Buffer;
}

/**
 * Onde está o Chromium.
 *
 * Na imagem, `apk add chromium` o põe em `/usr/bin/chromium-browser`. Em
 * desenvolvimento, o Chrome da máquina serve — e é por isso que isto é
 * uma variável e não um caminho fixo: sem ela, este código só poderia ser
 * exercitado dentro do container, que é onde ninguém depura.
 */
function chromiumPath(): string | null {
  return process.env.CHROMIUM_PATH?.trim() || null;
}

/** Sem navegador, o app diz isso em vez de estourar. */
export class NoBrowserError extends Error {
  constructor() {
    super('CHROMIUM_PATH não está configurado ou o navegador não abriu.');
    this.name = 'NoBrowserError';
  }
}

/**
 * O documento em PDF e em PNG, da MESMA renderização.
 *
 * As duas saídas de uma página só: o item 55 do pacote pede "imagem
 * vertical de boa resolução" e "PDF profissional", e diz que os dois têm
 * de usar os mesmos dados. Aqui eles usam a mesma PÁGINA — não há como
 * divergirem.
 *
 * `deviceScaleFactor: 2` porque o PNG é lido num celular: em 1x o texto
 * de 11px do rodapé fica ilegível depois que o WhatsApp recomprime.
 */
export async function renderQuoteFiles(html: string): Promise<QuoteFiles> {
  const executablePath = chromiumPath();
  if (!executablePath) throw new NoBrowserError();

  // Import dinâmico: `puppeteer-core` só é carregado quando alguém gera um
  // documento, e não em todo arranque do servidor.
  const puppeteer = (await import('puppeteer-core')).default;

  const browser = await puppeteer.launch({
    executablePath,
    // `--no-sandbox` porque dentro do container o processo já roda como um
    // usuário sem privilégio e não há namespace de usuário para o sandbox
    // usar; `--disable-dev-shm-usage` porque o /dev/shm padrão do Docker
    // tem 64 MB e o Chrome trava calado ao estourá-lo.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    // 794px é A4 a 96dpi. A largura importa para o PNG, que é um recorte
    // da página; o PDF usa o `format` abaixo e ignora isto.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    // `load` e não `domcontentloaded`: o evento `load` só dispara depois
    // das sub-requisições, e a logo vem de um bucket. Capturar antes dela
    // chegar produziria um documento sem logo — em silêncio, que é o
    // pior jeito de um documento sair errado.
    await page.setContent(html, { waitUntil: 'load' });

    const pdf = Buffer.from(
      await page.pdf({
        format: 'a4',
        printBackground: true,
        // Sem cabeçalho e sem rodapé do navegador. É o defeito que este
        // caminho inteiro existe para consertar.
        displayHeaderFooter: false,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      })
    );

    /*
     * A IMAGEM É RECORTADA NO DOCUMENTO, e não numa folha A4.
     *
     * A primeira versão capturava a página inteira no formato do papel, e
     * o resultado — olhado, não suposto — era o orçamento na metade de
     * cima de uma folha com um vazio enorme embaixo. Numa folha impressa
     * isso é normal; numa conversa de WhatsApp é um documento perdido no
     * meio do branco, e o telefone ainda encolhe tudo para caber.
     *
     * Então a viewport encolhe para a largura do documento mais a margem
     * (148mm + 2 × 14mm ≈ 176mm ≈ 665px a 96dpi) e a captura é do
     * `body`, cuja altura é a do conteúdo. O PDF acima não é afetado:
     * `page.pdf` usa o `format` e ignora a viewport.
     */
    await page.setViewport({ width: 665, height: 900, deviceScaleFactor: 2 });
    const corpo = await page.$('body');
    if (!corpo) throw new Error('a página não tem corpo');
    const png = Buffer.from(await corpo.screenshot({ type: 'png' }));

    return { pdf, png };
  } finally {
    await browser.close();
  }
}
