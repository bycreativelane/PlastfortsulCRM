'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { FileDown, FolderOpen, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import type { Quote } from '@/lib/quotes/quote';
import {
  QUOTE_CSS,
  QuoteDocument,
  type QuoteBrand,
  type QuoteLabels,
} from '@/components/quotes/quote-document';
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
  brand,
  onGenerate,
  fileUrl,
  onPrinted,
  archiveHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: Quote;
  /** Quem emite. Sem ela, o documento imprime só o nome da conta. */
  brand: QuoteBrand;
  /**
   * Gera o documento no servidor. Devolve `false` quando não deu — e aí
   * o diálogo cai para a impressão do navegador.
   *
   * Recebe os rótulos porque quem os tem é este componente, que vive
   * dentro do provider de i18n; a rota renderiza o mesmo documento longe
   * dele.
   */
  onGenerate?: (labels: QuoteLabels) => Promise<boolean>;
  /**
   * Chamado quando o documento foi mandado para a impressora.
   *
   * É por aqui que o orçamento vai para o arquivo (Documentos →
   * Orçamentos). Fica FORA deste componente de propósito: ele desenha e
   * imprime, e quem sabe a conta, a oportunidade e o usuário é a gaveta
   * que o abriu. É também o que o mantém no `/chart-lab` — sem esta
   * prop, nada é gravado, e o bench continua sendo fixture e nunca uma
   * consulta.
   */
  onPrinted?: () => void;
  /** O caminho do arquivo, quando faz sentido oferecê-lo. */
  archiveHref?: string;
  /** O PDF que já existe, quando este documento é um arquivado. */
  fileUrl?: string | null;
}) {
  const t = useTranslations('Quote');
  const [gerando, setGerando] = useState(false);

  /**
   * Os rótulos, num objeto simples.
   *
   * `QuoteDocument` não tem hooks de propósito: ele é renderizado pelo
   * servidor fora de qualquer contexto do React, sem provider de i18n.
   * Aqui eles vêm do `useTranslations`; lá, do catálogo direto.
   */
  const labels: QuoteLabels = {
    title: t('title'),
    // `t.raw` NOS TRÊS COM VARIÁVEL, e não uma cópia à mão do texto.
    //
    // O documento faz o `replace` sozinho, porque ele também é renderizado
    // pelo servidor, longe do next-intl. Então ele precisa do molde e não
    // do resultado — e `t('owner', { name })` devolveria o resultado.
    //
    // Eu tinha escrito os moldes à mão aqui ('{name}', '{percent}%') e o
    // documento saiu com "Juliana Prestes" solto sob "Entrega:", e com
    // "10%" no lugar de "10% de desconto". Duas frases perdidas por
    // duplicar o que o catálogo já dizia.
    orderNumber: t.raw('orderNumber'),
    customer: t('customer'),
    products: t('products'),
    lineDiscount: t.raw('lineDiscount'),
    subtotal: t('subtotal'),
    shipping: t('shipping'),
    total: t('total'),
    delivery: t('delivery'),
    owner: t.raw('owner'),
    notes: t('notes'),
    footer: t('footer'),
  };

  /**
   * Pede o documento ao servidor, e cai para a impressão sem ele.
   *
   * Os TOTAIS não vão no corpo: a rota os recalcula com o mesmo
   * `buildQuote`. O que sobe são as linhas, o valor digitado e o frete
   * — insumo, não resultado. É isso que impede um total inventado de
   * entrar num documento que sai com a marca da empresa.
   */
  const gerar = useCallback(async () => {
    if (!onGenerate) return;
    setGerando(true);
    const ok = await onGenerate(labels);
    setGerando(false);
    if (!ok) toast.error(t('noBrowser'));
  }, [onGenerate, labels, t]);

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

        {/*
          O DOCUMENTO, e não um desenho próprio deste diálogo.

          Ele foi para `components/quotes/quote-document.tsx` com o CSS
          junto, porque agora desenha em dois lugares: aqui e num Chrome
          headless que recebe uma string de HTML e devolve PDF e PNG. O
          segundo não tem o bundle do app — mandar a folha do Tailwind
          junto de cada documento seria caro e frágil.

          A prévia e o arquivo passam a ser a MESMA marcação e a MESMA
          folha, e não duas coisas que se parecem.
        */}
        {/*
          O RECUO DO X MORA AQUI, e não no documento.

          O botão de fechar do diálogo é absoluto no canto e passava por
          cima da palavra ORÇAMENTO. Eu já tinha corrigido isso com um
          `pr-7` — e PERDI a correção ao extrair o documento para um
          arquivo com CSS próprio, que é o preço de mover uma peça: o
          conserto ficou na moldura antiga.

          Desta vez ele fica onde pertence. O documento não deve saber que
          existe um X: quem tem o botão é a moldura, então é a moldura que
          abre espaço para ele. No PDF e na imagem, gerados longe daqui,
          esta regra não existe e o cabeçalho usa a largura inteira.
        */}
        <style>{`${QUOTE_CSS}
          [data-quote-frame] .q-head { padding-right: 28px; }
        `}</style>
        <div data-quote-frame>
          <QuoteDocument quote={quote} labels={labels} brand={brand} />
        </div>

        {/* Fora do documento, e fora do papel. */}
        <div
          data-print-hide
          className="flex flex-wrap items-center justify-end gap-2 pt-2"
        >
          {/* A PORTA DO ARQUIVO, e ela fica aqui porque é aqui que a
              pergunta nasce: quem acabou de gerar um orçamento é quem se
              pergunta onde foi parar o anterior. A seção está fora do menu
              principal por pedido, então este link é como se chega nela. */}
          {archiveHref && (
            <Button
              variant="ghost"
              size="sm"
              render={<Link href={archiveHref} />}
              className="text-muted-foreground hover:text-foreground mr-auto"
            >
              <FolderOpen className="size-4" />
              {t('archive')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          {/*
            ARQUIVA E IMPRIME, nesta ordem.

            `window.print()` bloqueia a aba enquanto o diálogo do navegador
            está aberto, e o que acontece depois dele depende de a pessoa
            salvar ou cancelar — que é uma coisa que a página não fica
            sabendo. Gravar antes é o único momento em que se sabe, com
            certeza, que o documento existiu.

            O custo é um orçamento arquivado que a pessoa cancelou na hora
            de salvar. É o lado certo para errar: o pedido foi "todo
            orçamento gerado fica salvo", e um documento a mais no arquivo
            é barato perto de um que sumiu.
          */}
          {/*
            GERAR, e não imprimir.

            O botão pedia ao NAVEGADOR que imprimisse, e o navegador
            carimbava data, URL e número de página no arquivo — foi o que
            saiu no primeiro PDF real. Aquilo é opção do diálogo de
            impressão, do usuário; nenhum CSS remove.

            Agora quem desenha é o servidor, com o mesmo documento, e
            devolve dois arquivos: o PDF que fica guardado e a imagem que
            vai pela conversa. Quando não há navegador do lado de lá — a
            máquina de desenvolvimento sem `CHROMIUM_PATH` — ele cai de
            volta para a impressão, e a linha já foi arquivada de qualquer
            forma.
          */}
          {onGenerate && (
            <Button onClick={() => void gerar()} disabled={gerando}>
              {gerando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileDown className="size-4" />
              )}
              {t('generate')}
            </Button>
          )}
          {/* No arquivo, o PDF já existe: abrir o que foi enviado é o que
              se quer, e não desenhar um parecido de novo. */}
          {fileUrl && (
            <Button render={<Link href={fileUrl} target="_blank" />}>
              <FileDown className="size-4" />
              {t('openPdf')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
