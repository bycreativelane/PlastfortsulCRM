'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  ChevronDown,
  FileDown,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Send,
} from 'lucide-react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
/**
 * ENVIAR PELO WHATSAPP — o que o diálogo precisa saber para oferecer.
 *
 * O pedido do Gabriel: "envia no whatsapp ou envia como imagem e fica o
 * PDF salvo na plataforma". As duas formas, e não uma, porque elas servem
 * a coisas diferentes do lado de quem recebe: a IMAGEM abre direto na
 * conversa, sem ninguém tocar em nada; o PDF chega como um cartão de
 * arquivo, que é o que se guarda, imprime e encaminha para o financeiro.
 *
 * Quem sabe PARA QUEM e SE DÁ é a gaveta que abriu o diálogo — ela tem o
 * contato, a conversa e a janela de 24h. O diálogo só desenha a escolha
 * e devolve os rótulos, que só ele tem (vive dentro do provider de i18n).
 *
 * Ausente no `/chart-lab` e no arquivo, e é por isso que é opcional: sem
 * conversa para onde mandar, o botão simplesmente não existe.
 */
export interface QuoteSend {
  /** Quem recebe — o nome do contato, para a primeira linha do menu. */
  recipient: string;
  /**
   * Por que não dá para mandar AGORA, ou `null` quando dá.
   *
   * As duas razões têm a mesma consequência — só um template chega — e são
   * fatos diferentes, então são frases diferentes: uma janela que FECHOU
   * não é um contato que nunca escreveu.
   */
  blocked: 'window' | 'noConversation' | null;
  /** A conversa, para ir lá usar um template quando está bloqueado. */
  conversationHref?: string | null;
  onSend: (labels: QuoteLabels, as: 'image' | 'document') => Promise<boolean>;
}

export function DealQuote({
  open,
  onOpenChange,
  quote,
  brand,
  onGenerate,
  send,
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
  /** Enviar pelo WhatsApp. Ver `QuoteSend`. */
  send?: QuoteSend;
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
  const [enviando, setEnviando] = useState<'image' | 'document' | null>(null);

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
    //
    // Sobrou UM molde: `lineDiscount`. `owner` deixou de ser
    // "Atendimento: {name}" no rodapé e virou uma sobrancelha ao lado do
    // cliente, no lugar em que o Bling põe o vendedor.
    orderNumber: t.raw('orderNumber'),
    customer: t('customer'),
    owner: t('owner'),
    products: t('products'),
    colDescription: t('colDescription'),
    colUnit: t('colUnit'),
    colQuantity: t('colQuantity'),
    colUnitPrice: t('colUnitPrice'),
    colTotal: t('colTotal'),
    lineDiscount: t.raw('lineDiscount'),
    subtotal: t('subtotal'),
    shipping: t('shipping'),
    total: t('total'),
    payment: t('payment'),
    installment: t('installment'),
    dueDate: t('dueDate'),
    method: t('method'),
    amount: t('amount'),
    transport: t('transport'),
    carrier: t('carrier'),
    freightMode: t('freightMode'),
    volumes: t('volumes'),
    grossWeight: t('grossWeight'),
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

  /**
   * Manda para a conversa, e fecha o diálogo quando foi.
   *
   * Fechar é a resposta certa ao sucesso: quem mandou o orçamento terminou
   * o que veio fazer aqui, e o documento continua a um clique — no arquivo
   * e, agora, na própria conversa. Na falha ele fica aberto, com o toast
   * dizendo por quê, para a pessoa tentar a outra forma ou ir à conversa.
   */
  const enviar = async (como: 'image' | 'document') => {
    if (!send || enviando) return;
    setEnviando(como);
    const ok = await send.onSend(labels, como);
    setEnviando(null);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        O DIÁLOGO É UM VISUALIZADOR, e o documento é a folha dentro dele.

        Antes a folha branca ocupava a área inteira e encostava nas bordas.
        No tema claro isso não se via — o cartão do diálogo também é branco
        —, mas no escuro quebrava: o X de fechar herda a cor do tema, então
        virava um glifo CLARO em cima de papel BRANCO. Invisível.

        A correção não é pintar o X: é a folha parar de ir até a borda. Com
        respiro em volta, o botão cai sobre a superfície do diálogo, que é
        escura no escuro e clara no claro, e volta a ser legível nos dois —
        sem o documento precisar saber que existe um botão ali.

        E ganha o que todo leitor de PDF faz: fundo em volta, página com
        contorno e sombra. A borda é o que separa papel de cartão no tema
        claro, onde os dois são brancos.
      */}
      <DialogContent
        data-print-root
        className="bg-muted/60 border-border text-foreground max-h-[90vh] overflow-y-auto p-3 sm:max-w-md"
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
          Sem recuo para o X, e isso é o conserto de verdade.

          A versão anterior empurrava o cabeçalho do documento 28px para
          dentro, para o botão de fechar não passar por cima da palavra
          ORÇAMENTO. Funcionava e estava errado: fazia o DOCUMENTO pagar
          por um botão que é da moldura, e no PDF — onde botão nenhum
          existe — o cabeçalho saía com um recuo sem motivo.

          Agora a folha tem respiro em volta e o X cai fora dela.
        */}
        <style>{QUOTE_CSS}</style>
        <div
          data-quote-frame
          className="border-border/60 rounded-lg border bg-white p-5 shadow-sm"
        >
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
              nativeButton={false}
              className="text-muted-foreground hover:text-foreground mr-auto"
            >
              <FolderOpen className="size-4" />
              {t('archive')}
            </Button>
          )}
          {/*
            "FECHAR" CEDE O LUGAR QUANDO HÁ ENVIO — medido, e não por gosto.

            O rodapé tem 412px. Com o link do arquivo, Fechar, Gerar PDF e
            Enviar, a soma passava disso e o botão principal quebrava
            SOZINHO para uma segunda linha, que lê como acidente. O diálogo
            já tem o X no canto, o Esc e o clique fora; um quarto jeito de
            fechar não vale a linha que custa. Sem envio — o bench, o
            arquivo — o rodapé tem folga e ele continua ali.
          */}
          {!send && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('close')}
            </Button>
          )}
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
            <Button
              // O azul cheio é de UMA ação por tela. Quando dá para mandar
              // pela conversa, ela é a principal — o orçamento existe para
              // chegar ao cliente — e gerar o PDF desce para contorno.
              variant={send ? 'outline' : 'default'}
              onClick={() => void gerar()}
              disabled={gerando || enviando !== null}
            >
              {gerando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileDown className="size-4" />
              )}
              {t('generate')}
            </Button>
          )}
          {send && (
            <DropdownMenu>
              {/* "Enviar", curto, com o nome inteiro no `title` e no
                  leitor de tela: a primeira linha do menu já diz para quem,
                  e as duas opções dizem como. Pelo WhatsApp é a única
                  saída que este CRM tem. */}
              <DropdownMenuTrigger
                render={
                  <Button
                    disabled={gerando || enviando !== null}
                    title={t('send')}
                    aria-label={t('send')}
                  />
                }
              >
                {enviando ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {t('sendShort')}
                <ChevronDown className="size-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {send.blocked ? (
                  /*
                   * BLOQUEADO, E DIZENDO POR QUÊ — dentro do menu, e não
                   * como um botão apagado.
                   *
                   * Um botão desabilitado não explica nada, e um tooltip em
                   * botão desabilitado não chega a quem usa teclado ou
                   * leitor de tela. A frase aparece onde a pessoa foi
                   * procurar a ação, e a única saída que existe — um
                   * template, na conversa — vem logo abaixo dela.
                   */
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-foreground px-2 py-1.5 leading-snug font-normal">
                      {send.blocked === 'window'
                        ? t('sendBlockedWindow')
                        : t('sendBlockedNoConversation')}
                    </DropdownMenuLabel>
                    {send.conversationHref && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          render={<Link href={send.conversationHref} />}
                        >
                          <MessageSquare />
                          {t('openConversation')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuGroup>
                ) : (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {t('sendTo', { name: send.recipient })}
                    </DropdownMenuLabel>
                    {/* Cada forma com a frase do que ela FAZ do lado de
                        lá. "Imagem" e "PDF" dizem o formato; quem escolhe
                        precisa saber o que o cliente vai ver. */}
                    <DropdownMenuItem
                      onClick={() => void enviar('image')}
                      className="items-start py-1.5"
                    >
                      <ImageIcon className="mt-0.5" />
                      <span className="grid">
                        <span>{t('sendAsImage')}</span>
                        <span className="text-muted-foreground text-2xs">
                          {t('sendAsImageHint')}
                        </span>
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void enviar('document')}
                      className="items-start py-1.5"
                    >
                      <FileText className="mt-0.5" />
                      <span className="grid">
                        <span>{t('sendAsPdf')}</span>
                        <span className="text-muted-foreground text-2xs">
                          {t('sendAsPdfHint')}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* No arquivo, o PDF já existe: abrir o que foi enviado é o que
              se quer, e não desenhar um parecido de novo. */}
          {fileUrl && (
            <Button
              render={<Link href={fileUrl} target="_blank" />}
              nativeButton={false}
            >
              <FileDown className="size-4" />
              {t('openPdf')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
