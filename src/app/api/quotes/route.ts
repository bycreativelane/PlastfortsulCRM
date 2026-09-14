import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { buildQuote } from '@/lib/quotes/quote';
import { brandFromAccount } from '@/lib/quotes/brand';
import { quoteFingerprint } from '@/lib/quotes/fingerprint';
import { archiveLayers } from '@/lib/quotes/archive';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import {
  NoBrowserError,
  quotePage,
  renderQuoteFiles,
} from '@/lib/quotes/render';
import type { QuoteLabels } from '@/components/quotes/quote-document';
import type { DealItemDraft } from '@/lib/products/catalog';
import type { InstallmentDraft } from '@/lib/deals/installments';

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
  paymentTerms?: string | null;
  installments?: InstallmentDraft[];
  carrier?: string | null;
  freightMode?: string | null;
  freightVolumes?: number | null;
  grossWeight?: number | null;
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
      paymentTerms: body.paymentTerms,
      installments: body.installments ?? [],
      carrier: body.carrier,
      freightMode: body.freightMode,
      freightVolumes: body.freightVolumes ?? null,
      grossWeight: body.grossWeight ?? null,
      owner: body.owner,
      notes: body.notes,
    });

    /*
     * O MESMO DOCUMENTO NÃO VIRA DUAS LINHAS.
     *
     * Apertar "Gerar PDF" oito vezes produzia oito linhas idênticas no
     * arquivo — mesmo cliente, mesmo total, mesmo segundo. A 071 guarda
     * por GERAÇÃO porque o que o cliente recebeu foi a versão daquele
     * dia, e isso continua certo; o que faltava era notar que oito
     * documentos iguais não são oito versões.
     *
     * Se já existe um com esta impressão digital E com arquivo, a
     * resposta é ele. Sem Chromium, sem upload, sem linha nova.
     *
     * Se existe SEM arquivo, é uma tentativa anterior que morreu no meio
     * — provavelmente sem navegador. Essa é reaproveitada e preenchida,
     * em vez de deixar um registro manco para sempre.
     */
    const fingerprint = quoteFingerprint(quote, body.dealId ?? null);

    const { data: existente } = await supabase
      .from('deal_quotes')
      .select('id, pdf_url, image_url')
      .eq('account_id', accountId)
      .eq('fingerprint', fingerprint)
      .maybeSingle();

    if (existente?.pdf_url) {
      return NextResponse.json({
        id: existente.id,
        pdfUrl: existente.pdf_url,
        imageUrl: existente.image_url,
        reused: true,
      });
    }

    /*
     * A LINHA, em camadas — uma por migração que pode faltar.
     *
     * Um insert que cite UMA coluna inexistente é recusado inteiro, e a
     * versão anterior deste recuo ainda citava `fingerprint` (074) na
     * camada de baixo: com as migrações por aplicar, nenhum orçamento
     * saía. As camadas moram em `lib/quotes/archive.ts`, e um teste lê as
     * migrações para conferir que cada uma só cita o que a dela criou.
     */
    const camadas = archiveLayers({
      accountId,
      dealId: body.dealId ?? null,
      userId,
      quote,
      fingerprint,
    });

    const arquivar = (linhaNova: Record<string, unknown>) =>
      supabase.from('deal_quotes').insert(linhaNova).select('id').single();

    // ARQUIVA PRIMEIRO. O registro é o que faz o orçamento existir; o
    // arquivo é a cópia entregável. Sem navegador, o primeiro sobrevive.
    let { data: linha, error: erroLinha } = existente
      ? { data: { id: existente.id }, error: null }
      : await arquivar(camadas[0].row);

    for (const camada of camadas.slice(1)) {
      if (!erroLinha || !isUnknownColumn(erroLinha)) break;
      ({ data: linha, error: erroLinha } = await arquivar(camada.row));
    }

    /*
     * A CORRIDA QUE O ÍNDICE PEGA.
     *
     * Procurar-e-inserir não é atômico: dois cliques rápidos passam os
     * dois pela consulta acima antes de qualquer um gravar. O índice
     * único da 074 transforma o segundo insert num `23505` em vez de
     * numa duplicata — e a resposta certa não é um erro na tela, é
     * reler a linha que ganhou e devolver ela.
     *
     * Sem isto, o segundo clique diria "não foi possível gerar" sobre um
     * documento que existe e está pronto.
     */
    if (erroLinha?.code === '23505') {
      const { data: vencedora } = await supabase
        .from('deal_quotes')
        .select('id, pdf_url, image_url')
        .eq('account_id', accountId)
        .eq('fingerprint', fingerprint)
        .maybeSingle();
      if (vencedora) {
        return NextResponse.json({
          id: vencedora.id,
          pdfUrl: vencedora.pdf_url,
          imageUrl: vencedora.image_url,
          reused: true,
        });
      }
    }

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
    const pasta = `account-${accountId}/${linha.id}`;
    const enviar = async (nome: string, corpo: Buffer, tipo: string) => {
      const caminho = `${pasta}/${nome}`;
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
