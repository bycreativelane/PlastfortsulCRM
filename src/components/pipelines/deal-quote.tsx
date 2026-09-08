'use client';

import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';

import { formatCurrencyExact } from '@/lib/currency';
import { fromISO } from '@/lib/calendar';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { formatPhone } from '@/lib/whatsapp/phone-format';
import type { Quote } from '@/lib/quotes/quote';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * O orçamento, desenhado.
 *
 * ------------------------------------------------------------------
 * O QUE ESTE DOCUMENTO NÃO É
 * ------------------------------------------------------------------
 *
 * O item 53 do pacote abre com "não copiar literalmente o layout antigo
 * do Bling" e fecha a lista de prioridades com "sem aparência de
 * formulário administrativo antigo; sem excesso de linhas e grades".
 *
 * O documento que ele descreve no item 52 tem código de barras, tabela
 * com seis colunas emolduradas, quadro de parcelas e área de assinatura
 * do recebedor. Nada disso está aqui, e o item 54 diz por quê em duas
 * frases: a assinatura física não faz sentido num arquivo que chega pelo
 * WhatsApp, e o código de barras não tem função nesta etapa.
 *
 * O que ficou é o que responde à pergunta que o cliente faz ao abrir:
 * quanto é, do que se trata, e quando chega.
 *
 * ------------------------------------------------------------------
 * UMA COLUNA ESTREITA, PORQUE É NUM CELULAR QUE ISTO É LIDO
 * ------------------------------------------------------------------
 *
 * `max-w-md`. Não é uma folha A4 que alguém encolheu: é um documento
 * pensado para a largura de um telefone, que no papel vira uma coluna
 * confortável em vez de uma linha de 18cm que o olho perde no meio.
 *
 * Os itens não são uma tabela. Numa coluna de 380px, seis colunas de
 * tabela viram seis palavras cortadas; cada linha aqui é um bloco — o
 * nome em cima, a conta embaixo, o subtotal à direita — que é como um
 * recibo de celular se lê.
 *
 * ------------------------------------------------------------------
 * IMPRIMIR É O PDF
 * ------------------------------------------------------------------
 *
 * `data-print-root` liga a folha de impressão de `globals.css`, que faz
 * o resto do app sumir e deixa este ramo sozinho na página. "Salvar como
 * PDF" no diálogo do navegador é a segunda saída que o item 55 pede — e
 * ela sai do MESMO desenho e do MESMO cálculo, que é a condição que ele
 * impõe.
 */
export function DealQuote({
  open,
  onOpenChange,
  quote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: Quote;
}) {
  const t = useTranslations('Quote');

  const dia = fromISO(quote.issuedOn);
  const dataLegivel = dia
    ? dia.toLocaleDateString(APP_LOCALE, {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : quote.issuedOn;

  // COM CENTAVOS. Este documento é conferido contra uma nota, não
  // escaneado num quadro — ver a nota nas duas funções em `lib/currency`.
  const dinheiro = (valor: number) =>
    formatCurrencyExact(valor, quote.currency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-print-root
        className="bg-card border-border text-foreground max-h-[90vh] overflow-y-auto sm:max-w-md"
      >
        {/* O cabeçalho do DIÁLOGO, que não é o cabeçalho do documento: ele
            existe para a pessoa saber o que abriu e para o leitor de tela
            ter um nome. No papel, some. */}
        <DialogHeader data-print-hide className="sr-only">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <article className="space-y-6">
          {/* ---- Cabeçalho -------------------------------------------
              A empresa em cima, a palavra ORÇAMENTO como sobrancelha, e
              o número do pedido do lado da data. Sem logo: este CRM não
              guarda nenhuma — ver a nota em `lib/quotes/quote.ts`. */}
          {/*
            `pr-7` NA TELA, E ZERO NO PAPEL.

            O X de fechar do diálogo é posicionado em absoluto no canto
            superior direito, e o número do pedido estava passando por baixo
            dele — medido pelo Gabriel num pedido de treze dígitos, com o X
            em cima do último. O documento não deveria precisar saber que a
            moldura tem um botão ali, mas ele tem, e o custo de conviver é
            um recuo.

            No papel o botão não existe (`[data-print-hide]`), então o recuo
            também não: `print:pr-0` devolve a largura inteira ao número.

            E o número QUEBRA. `break-all` porque um pedido não tem espaços
            para quebrar; sem isso, um número comprido empurra a coluna e
            volta a esbarrar no X em vez de descer uma linha.
          */}
          <header className="border-border/60 flex items-start justify-between gap-4 border-b pr-7 pb-4 print:pr-0">
            <div className="min-w-0">
              <p className="eyebrow text-muted-foreground">{t('title')}</p>
              <p className="text-foreground truncate text-lg font-semibold">
                {quote.company || t('untitledCompany')}
              </p>
            </div>
            <div className="min-w-0 shrink-0 text-right">
              {quote.orderNumber && (
                <p className="text-foreground text-sm font-semibold break-all tabular-nums">
                  {t('orderNumber', { number: quote.orderNumber })}
                </p>
              )}
              <p className="text-muted-foreground text-xs">{dataLegivel}</p>
            </div>
          </header>

          {/* ---- Cliente ---------------------------------------------- */}
          <section className="space-y-0.5">
            <p className="eyebrow text-muted-foreground">{t('customer')}</p>
            <p className="text-foreground font-medium">{quote.customer.name}</p>
            {quote.customer.company && (
              <p className="text-secondary-foreground text-sm">
                {quote.customer.company}
              </p>
            )}
            {quote.customer.phone && (
              <p className="text-muted-foreground text-xs">
                {formatPhone(quote.customer.phone)}
              </p>
            )}
          </section>

          {/* ---- Produtos ---------------------------------------------
              Uma lista de blocos e não uma tabela. O separador é o
              espaço, com uma régua fininha entre linhas — "sem excesso
              de linhas e grades" é literal no item 53. */}
          {quote.lines.length > 0 && (
            <section className="space-y-3">
              <p className="eyebrow text-muted-foreground">{t('products')}</p>
              <ul className="divide-border/50 divide-y">
                {quote.lines.map((linha, i) => (
                  <li
                    key={`${linha.name}-${i}`}
                    className="flex items-start justify-between gap-3 py-2 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground text-sm">{linha.name}</p>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {t('lineMath', {
                          quantity: String(linha.quantity),
                          price: dinheiro(linha.unitPrice),
                        })}
                        {linha.discountPercent > 0
                          ? ` · ${t('lineDiscount', {
                              percent: String(linha.discountPercent),
                            })}`
                          : ''}
                      </p>
                    </div>
                    <p className="text-foreground shrink-0 text-sm font-medium tabular-nums">
                      {dinheiro(linha.total)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---- Resumo financeiro ------------------------------------
              O TOTAL É A COISA MAIS PESADA DA PÁGINA, que é o que o item
              54 pede em uma frase ("o Total deve ter destaque visual").
              Produtos e frete ficam em cinza pequeno acima dele: são a
              conta, e a conta explica o número sem competir com ele.

              O frete só aparece quando foi definido. Imprimir "Frete
              R$ 0,00" num orçamento em que ninguém decidiu o frete é
              afirmar uma coisa que não foi combinada. */}
          <section className="border-border/60 space-y-1 border-t pt-4">
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span>{t('subtotal')}</span>
              <span className="tabular-nums">{dinheiro(quote.products)}</span>
            </div>
            {quote.shipping !== null && (
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                <span>{t('shipping')}</span>
                <span className="tabular-nums">{dinheiro(quote.shipping)}</span>
              </div>
            )}
            <div className="text-foreground flex items-baseline justify-between pt-1">
              <span className="text-sm font-semibold">{t('total')}</span>
              <span className="text-xl font-semibold tabular-nums">
                {dinheiro(quote.total)}
              </span>
            </div>
          </section>

          {/* ---- Entrega e responsável --------------------------------
              Duas linhas curtas, e cada uma só existe se tiver conteúdo.
              O item 54 pede o responsável "de forma discreta": ele é a
              menor letra do documento, ao lado de quem entrega. */}
          {(quote.carrier || quote.owner) && (
            <section className="border-border/60 flex flex-wrap justify-between gap-x-6 gap-y-1 border-t pt-4">
              {quote.carrier && (
                <p className="text-secondary-foreground text-xs">
                  <span className="text-muted-foreground">
                    {t('delivery')}{' '}
                  </span>
                  {quote.carrier}
                </p>
              )}
              {quote.owner && (
                <p className="text-muted-foreground text-xs">
                  {t('owner', { name: quote.owner })}
                </p>
              )}
            </section>
          )}

          {/* ---- Observações ------------------------------------------
              "Mostrar apenas se existir conteúdo" — item 54, literal. */}
          {quote.notes && (
            <section className="border-border/60 space-y-1 border-t pt-4">
              <p className="eyebrow text-muted-foreground">{t('notes')}</p>
              <p className="text-secondary-foreground text-xs whitespace-pre-wrap">
                {quote.notes}
              </p>
            </section>
          )}

          <footer className="text-muted-foreground border-border/60 text-2xs border-t pt-4 text-center">
            {t('footer')}
          </footer>
        </article>

        {/* Fora do documento, e fora do papel. */}
        <div data-print-hide className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" />
            {t('print')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
