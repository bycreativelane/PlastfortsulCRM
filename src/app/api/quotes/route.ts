import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { buildQuote } from '@/lib/quotes/quote';
import { brandFromAccount } from '@/lib/quotes/brand';
import {
  NoBrowserError,
  quotePage,
  renderQuoteFiles,
} from '@/lib/quotes/render';
import type { QuoteLabels } from '@/components/quotes/quote-document';
import type { DealItemDraft } from '@/lib/products/catalog';

/**
 * Gera o orçamento: arquiva a linha, produz o PDF e a imagem, devolve os
 * links.
 *
 * ------------------------------------------------------------------
 * A CONTA É REFEITA AQUI, com o que o cliente mandou de INSUMO
 * ------------------------------------------------------------------
 *
 * O corpo traz as linhas, o valor digitado e o frete — nunca os totais.
 * Eles são recalculados pelo mesmo `buildQuote` que a tela usa, e é isso
 * que impede um total inventado de entrar num documento que sai com a
 * marca da empresa.
 *
 * A MARCA TAMBÉM É DAQUI. Razão social, CNPJ e logo saem da linha de
 * `accounts`, nunca do corpo da requisição: quem emite o documento é a
 * conta, não quem apertou o botão.
 *
 * ------------------------------------------------------------------
 * DUAS SAÍDAS, UMA PÁGINA
 * ------------------------------------------------------------------
 *
 * O PDF é o que fica guardado; o PNG é o que vai pelo WhatsApp, porque
 * uma imagem abre na conversa e um PDF vira um cartão que alguém precisa
 * tocar. Os dois saem da mesma renderização, então não têm como
 * divergir — que é a condição do item 55 do pacote.
 *
 * ------------------------------------------------------------------
 * SEM NAVEGADOR, A LINHA AINDA É ARQUIVADA
 * ------------------------------------------------------------------
 *
 * `502 no_browser` quando o Chromium não está lá — mas o registro já foi
 * gravado antes de tentar renderizar. Quem chamou cai para a impressão do
 * navegador e o orçamento não some do arquivo por causa de um binário
 * ausente na máquina de desenvolvimento.
 */

export const runtime = 'nodejs';
// O Chrome leva alguns segundos para abrir e desenhar. O padrão de 10s
// mataria a requisição no meio e deixaria uma linha sem arquivo.
export const maxDuration = 60;

interface Corpo {
  dealId?: string | null;
  orderNumber?: string | null;
  issuedOn?: string;
  customerName?: string | null;
  customerCompany?: string | null;
  customerPhone?: string | null;
  items?: DealItemDraft[];
  value?: number | null;
  currency?: string;
  shipping?: number | null;
  carrier?: string | null;
  owner?: string | null;
  notes?: string | null;
  labels?: QuoteLabels;
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const body = (await request.json()) as Corpo;

    if (!body.issuedOn || !body.labels) {
      return NextResponse.json(
        { error: 'issuedOn and labels are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: conta } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .maybeSingle();
    const brand = brandFromAccount(conta ?? null);

    const quote = buildQuote({
      orderNumber: body.orderNumber,
      issuedOn: body.issuedOn,
      company: conta?.legal_name || conta?.name,
      customerName: body.customerName,
      customerCompany: body.customerCompany,
      customerPhone: body.customerPhone,
      items: body.items ?? [],
      value: body.value ?? null,
      currency: body.currency || 'BRL',
      shipping: body.shipping ?? null,
      carrier: body.carrier,
      owner: body.owner,
      notes: body.notes,
    });

    // ARQUIVA PRIMEIRO. O registro é o que faz o orçamento existir; o
    // arquivo é a cópia entregável. Sem navegador, o primeiro sobrevive.
    const { data: linha, error: erroLinha } = await supabase
      .from('deal_quotes')
      .insert({
        account_id: accountId,
        deal_id: body.dealId ?? null,
        user_id: userId,
        order_number: quote.orderNumber,
        issued_on: quote.issuedOn,
        company: quote.company,
        customer_name: quote.customer.name,
        customer_company: quote.customer.company,
        customer_phone: quote.customer.phone,
        lines: quote.lines,
        currency: quote.currency,
        products: quote.products,
        shipping: quote.shipping,
        total: quote.total,
        carrier: quote.carrier,
        owner: quote.owner,
        notes: quote.notes,
      })
      .select('id')
      .single();

    if (erroLinha || !linha) {
      return NextResponse.json(
        { error: erroLinha?.message ?? 'could not archive the quote' },
        { status: 500 }
      );
    }

    let arquivos;
    try {
      arquivos = await renderQuoteFiles(
        await quotePage(quote, body.labels, brand)
      );
    } catch (err) {
      if (err instanceof NoBrowserError) {
        return NextResponse.json(
          { id: linha.id, error: 'no_browser' },
          { status: 502 }
        );
      }
      throw err;
    }

    /*
     * `account-<id>/<orçamento>`, e o prefixo não é enfeite.
     *
     * É o que a política de escrita da 073 lê para autorizar o upload:
     * `(storage.foldername(name))[1]` tem de ser a conta de quem está
     * gravando. Sem o prefixo, a primeira pasta seria um UUID cru e a
     * política não casaria — o PDF simplesmente não subiria.
     *
     * A convenção é a da 023, e o produto passa a ter uma só: a primeira
     * pasta diz de quem é o arquivo.
     *
     * A LEITURA é pública, e vale dizer sem rodeio: o que protege um
     * orçamento é este UUID ser impossível de adivinhar, não a RLS. É
     * obrigatório — a Meta busca o arquivo pelo link para entregá-lo ao
     * cliente — e é a mesma troca que `chat-media` já faz para toda foto
     * que este CRM manda ou recebe.
     */
    const base = `account-${accountId}/${linha.id}`;
    const enviar = async (nome: string, corpo: Buffer, tipo: string) => {
      const caminho = `${base}/${nome}`;
      const { error } = await supabase.storage
        .from('quotes')
        .upload(caminho, corpo, { contentType: tipo, upsert: true });
      if (error) {
        // ELE DIZ O QUE ACONTECEU, porque este `return null` era mudo.
        //
        // A 072 não deu política de escrita ao bucket e a rota usa o
        // cliente do USUÁRIO — não a service key, como o comentário dela
        // afirmava. O upload seria recusado pela RLS, a linha ficaria
        // arquivada com as URLs nulas, e a tela diria só "não foi
        // possível gerar". Um defeito que só aparece na primeira vez que
        // alguém usa a função, sem nada no log para explicá-lo.
        //
        // A política veio na 073; a linha de log fica de qualquer forma.
        console.error(`[quotes] upload de ${nome} falhou:`, error.message);
        return null;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from('quotes').getPublicUrl(caminho);
      return { caminho, url: publicUrl };
    };

    const pdf = await enviar('orcamento.pdf', arquivos.pdf, 'application/pdf');
    const png = await enviar('orcamento.png', arquivos.png, 'image/png');

    await supabase
      .from('deal_quotes')
      .update({
        pdf_path: pdf?.caminho ?? null,
        pdf_url: pdf?.url ?? null,
        image_path: png?.caminho ?? null,
        image_url: png?.url ?? null,
      })
      .eq('id', linha.id);

    return NextResponse.json({
      id: linha.id,
      pdfUrl: pdf?.url ?? null,
      imageUrl: png?.url ?? null,
    });
  } catch (err) {
    // `toErrorResponse` já devolve a resposta pronta e registra o que
    // não souber classificar.
    return toErrorResponse(err);
  }
}
