import { formatCurrencyExact } from '@/lib/currency';
import { fromISO } from '@/lib/calendar';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { formatPhone } from '@/lib/whatsapp/phone-format';
import type { Quote } from '@/lib/quotes/quote';

/**
 * O orçamento, como documento — e um só, para a tela e para o arquivo.
 *
 * ------------------------------------------------------------------
 * A ORDEM É A DO PEDIDO DE VENDA DO BLING
 * ------------------------------------------------------------------
 *
 * Pedido do Gabriel em 8 de setembro de 2026, com prints do Bling ao
 * lado, e ele terminou a lista com "nesta ordem":
 *
 *     pedido de venda → cliente e, do lado, o responsável → produto com
 *     descrição, quantidade, preço e preço total → condição de pagamento
 *     → transportadora, quantidade, peso bruto e valor do frete
 *
 * A ordem não é estética: é a sequência em que a operação já preenche o
 * pedido do outro lado, e é a sequência em que ela vai conferir este
 * papel contra aquela tela. Um documento que diz as mesmas coisas em
 * outra ordem obriga a procurar cada uma.
 *
 * O RESPONSÁVEL SUBIU por causa disso — ele estava no rodapé, numa tira
 * junto com o transportador ("Atendimento: Fulano"), e no Bling é o
 * VENDEDOR do pedido, ao lado do cliente. É a mesma informação lida como
 * outra coisa: no rodapé ela é uma assinatura, ao lado do cliente ela é
 * uma das duas partes do negócio.
 *
 * ------------------------------------------------------------------
 * POR QUE ELE NÃO USA TAILWIND
 * ------------------------------------------------------------------
 *
 * Porque ele precisa desenhar em dois lugares: no diálogo, dentro do app,
 * e num Chrome headless que recebe uma string de HTML e devolve PDF e
 * PNG. O segundo não tem o bundle do app — mandar a folha inteira do
 * Tailwind junto de cada documento seria caro e frágil.
 *
 * Então o documento carrega o próprio CSS (`QUOTE_CSS`), e as duas saídas
 * usam a MESMA marcação e a MESMA folha. É o mesmo princípio do
 * `buildQuote` um andar abaixo: layout expresso duas vezes é dívida,
 * cálculo expresso duas vezes é defeito — e aqui nenhum dos dois é.
 *
 * ------------------------------------------------------------------
 * ELE É CLARO SEMPRE, e isso é de propósito
 * ------------------------------------------------------------------
 *
 * Papel branco, tinta escura, independente do tema do app. Um orçamento
 * não é cromo de interface: ele vira PDF, imagem e impressão, e nenhuma
 * dessas três tem modo escuro. As cores são valores fixos e não tokens
 * do tema pela mesma razão — um documento que muda de cor conforme quem
 * o gerou estava no claro ou no escuro é um documento que não se pode
 * conferir contra outro.
 *
 * ------------------------------------------------------------------
 * SEM HOOKS
 * ------------------------------------------------------------------
 *
 * `renderToStaticMarkup` roda isto fora de qualquer contexto do React —
 * sem provider de i18n, sem tema, sem sessão. Por isso os rótulos entram
 * por prop: o diálogo os tira do `useTranslations`, a rota do servidor
 * os lê do catálogo direto, e o componente não sabe a diferença.
 */

export interface QuoteLabels {
  title: string;
  orderNumber: string;
  customer: string;
  /** A sobrancelha ao lado do cliente. No Bling, "Vendedor". */
  owner: string;
  products: string;
  /** Os cabeçalhos da tabela de produtos, na ordem em que ela sai. */
  colDescription: string;
  colUnit: string;
  colQuantity: string;
  colUnitPrice: string;
  colTotal: string;
  lineDiscount: string;
  subtotal: string;
  /** Outras despesas do pedido (078). */
  otherExpenses: string;
  shipping: string;
  /** O desconto geral (078) — o de item fica na linha. */
  discount: string;
  total: string;
  payment: string;
  installment: string;
  dueDate: string;
  method: string;
  /** "Valor" — o da parcela, que não é o preço total de uma linha. */
  amount: string;
  transport: string;
  carrier: string;
  freightMode: string;
  volumes: string;
  grossWeight: string;
  notes: string;
  footer: string;
}

/** A empresa que emite. Tudo opcional — o documento omite o que falta. */
export interface QuoteBrand {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  site?: string | null;
  address?: string | null;
  logoUrl?: string | null;
}

/** Data curta, para caber numa célula: `08/10/2026`. */
function dataCurta(iso: string | null): string {
  if (!iso) return '—';
  const dia = fromISO(iso);
  return dia
    ? dia.toLocaleDateString(APP_LOCALE, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : iso;
}

/**
 * Quantidade sem casas inventadas.
 *
 * `100` sai `100`, e `12,5` sai `12,5`. O banco guarda `NUMERIC(12,3)`,
 * então uma quantidade inteira chega como `100.000` — imprimir três zeros
 * em toda linha de todo orçamento é ruído que ninguém pediu.
 */
function quantidade(v: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    maximumFractionDigits: 3,
  }).format(v);
}

export function QuoteDocument({
  quote,
  labels,
  brand,
}: {
  quote: Quote;
  labels: QuoteLabels;
  brand: QuoteBrand;
}) {
  const dia = fromISO(quote.issuedOn);
  const data = dia
    ? dia.toLocaleDateString(APP_LOCALE, {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : quote.issuedOn;

  const dinheiro = (v: number) => formatCurrencyExact(v, quote.currency);

  /* O rodapé é o que a empresa souber dizer de si, separado por ponto —
     e não uma grade de rótulos vazios quando ela ainda não preencheu. */
  const contato = [brand.phone, brand.email, brand.site, brand.address]
    .map((v) => (v ?? '').trim())
    .filter(Boolean);

  /* Alguma linha tem unidade? Se nenhuma tem, a coluna inteira sai — uma
     coluna de travessões em todas as linhas é pior do que não tê-la. */
  const temUnidade = quote.lines.some((l) => l.unit);
  const temDesconto = quote.lines.some((l) => l.discountPercent > 0);

  const transporte: [string, string][] = [];
  if (quote.carrier) transporte.push([labels.carrier, quote.carrier]);
  if (quote.freightMode)
    transporte.push([labels.freightMode, quote.freightMode]);
  if (quote.freightVolumes !== null)
    transporte.push([labels.volumes, quantidade(quote.freightVolumes)]);
  if (quote.grossWeight !== null)
    transporte.push([labels.grossWeight, `${quantidade(quote.grossWeight)} kg`]);
  /* O FRETE APARECE DUAS VEZES, e é de propósito: uma no total, porque ele
     faz parte do que se vai pagar, e outra aqui, porque quem lê o bloco de
     transporte está conferindo o combinado com a transportadora. É o mesmo
     `quote.shipping` nas duas — não há segundo cálculo, que é o que o item
     55 do pacote proíbe. O Gabriel pediu o valor neste grupo, com estas
     palavras: "transportadora, quantidade e peso bruto e o valor do frete". */
  if (quote.shipping !== null)
    transporte.push([labels.shipping, dinheiro(quote.shipping)]);

  return (
    <article className="q">
      <header className="q-head">
        <div className="q-emitter">
          {brand.logoUrl ? (
            /* `<img>` e não `next/image`, por dois motivos que se somam:
               a URL é de um bucket e varia por conta, o que exigiria
               configurar domínio no build; e este componente também é
               renderizado FORA do Next, por `renderToStaticMarkup`, para
               virar PDF — e lá `next/image` não existe. */
            // eslint-disable-next-line @next/next/no-img-element
            <img className="q-logo" src={brand.logoUrl} alt="" />
          ) : null}
          <div className="q-emitter-text">
            <p className="q-company">{brand.legalName || brand.name}</p>
            {brand.taxId ? <p className="q-tax">{brand.taxId}</p> : null}
          </div>
        </div>
        <div className="q-meta">
          <p className="q-kind">{labels.title}</p>
          {quote.orderNumber ? (
            <p className="q-order">
              {labels.orderNumber.replace('{number}', quote.orderNumber)}
            </p>
          ) : null}
          <p className="q-date">{data}</p>
        </div>
      </header>

      {/* CLIENTE E, DO LADO, O RESPONSÁVEL — a segunda linha do pedido de
          venda. Duas colunas de largura fixa e não uma grade que se
          reparte: sem o responsável, o cliente ocupa a folha inteira em
          vez de deixar metade em branco. */}
      <section className="q-parties">
        <div className="q-party">
          <p className="q-eyebrow">{labels.customer}</p>
          <p className="q-customer">{quote.customer.name}</p>
          {(quote.customer.company || quote.customer.phone) && (
            <p className="q-sub">
              {[
                quote.customer.company,
                quote.customer.phone ? formatPhone(quote.customer.phone) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
        {quote.owner ? (
          <div className="q-party q-party-right">
            <p className="q-eyebrow">{labels.owner}</p>
            <p className="q-customer">{quote.owner}</p>
          </div>
        ) : null}
      </section>

      {quote.lines.length > 0 && (
        <section className="q-block">
          <p className="q-eyebrow">{labels.products}</p>
          {/* UMA TABELA, e não uma lista com o total à direita.
              O Gabriel pediu "descrição, quantidade preço, preço total" —
              quatro grandezas por linha, que é o que uma tabela é. E numa
              tabela as colunas de número alinham entre si, que é o que
              torna conferível uma coluna de preços. */}
          <table className="q-table">
            <thead>
              <tr>
                <th className="q-th">{labels.colDescription}</th>
                {temUnidade && <th className="q-th q-c">{labels.colUnit}</th>}
                <th className="q-th q-r">{labels.colQuantity}</th>
                <th className="q-th q-r">{labels.colUnitPrice}</th>
                <th className="q-th q-r">{labels.colTotal}</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((linha, i) => (
                <tr key={`${linha.name}-${i}`}>
                  <td className="q-td">
                    <span className="q-line-name">{linha.name}</span>
                    {(linha.sku ||
                      (temDesconto && linha.discountPercent > 0)) && (
                      <span className="q-line-sub">
                        {[
                          linha.sku,
                          linha.discountPercent > 0
                            ? labels.lineDiscount.replace(
                                '{percent}',
                                String(linha.discountPercent)
                              )
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </td>
                  {temUnidade && (
                    <td className="q-td q-c q-dim">{linha.unit ?? '—'}</td>
                  )}
                  <td className="q-td q-r q-num">
                    {quantidade(linha.quantity)}
                  </td>
                  <td className="q-td q-r q-num">
                    {dinheiro(linha.unitPrice)}
                  </td>
                  <td className="q-td q-r q-num q-strong">
                    {dinheiro(linha.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* O TOTAL É A COISA MAIS PESADA DA PÁGINA — item 54, literal. As
          parcelas ficam em cinza pequeno acima: elas explicam o número
          sem disputar com ele. */}
      <section className="q-sum">
        <div className="q-sum-row">
          <span>{labels.subtotal}</span>
          <span>{dinheiro(quote.products)}</span>
        </div>
        {/* A ORDEM DA FÓRMULA: produtos, outras despesas, frete, desconto,
            total. Quem confere de cima para baixo refaz a conta do Bling
            sem pular linha. */}
        {quote.otherExpenses !== null && (
          <div className="q-sum-row">
            <span>{labels.otherExpenses}</span>
            <span>{dinheiro(quote.otherExpenses)}</span>
          </div>
        )}
        {quote.shipping !== null && (
          <div className="q-sum-row">
            <span>{labels.shipping}</span>
            <span>{dinheiro(quote.shipping)}</span>
          </div>
        )}
        {quote.discount !== null && (
          <div className="q-sum-row">
            {/* Em percentual, a porcentagem vai no rótulo e o valor em
                reais na coluna: o cliente lê "Desconto (10 %)" e confere
                o número que saiu dela. */}
            <span>
              {quote.discount.unit === 'PERCENTUAL'
                ? `${labels.discount} (${new Intl.NumberFormat(APP_LOCALE, {
                    maximumFractionDigits: 2,
                  }).format(quote.discount.value)}%)`
                : labels.discount}
            </span>
            <span>−{dinheiro(quote.discount.amount)}</span>
          </div>
        )}
        <div className="q-total">
          <span>{labels.total}</span>
          <strong>{dinheiro(quote.total)}</strong>
        </div>
      </section>

      {(quote.paymentTerms || quote.installments.length > 0) && (
        <section className="q-block">
          <p className="q-eyebrow">{labels.payment}</p>
          {quote.paymentTerms ? (
            <p className="q-terms">{quote.paymentTerms}</p>
          ) : null}
          {quote.installments.length > 0 && (
            <table className="q-table q-table-tight">
              <thead>
                <tr>
                  <th className="q-th q-c">{labels.installment}</th>
                  <th className="q-th">{labels.dueDate}</th>
                  <th className="q-th">{labels.method}</th>
                  <th className="q-th q-r">{labels.amount}</th>
                </tr>
              </thead>
              <tbody>
                {quote.installments.map((p, i) => (
                  <tr key={i}>
                    <td className="q-td q-c q-dim">{i + 1}</td>
                    <td className="q-td q-num">{dataCurta(p.dueOn)}</td>
                    <td className="q-td">{p.method ?? '—'}</td>
                    <td className="q-td q-r q-num q-strong">
                      {dinheiro(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {transporte.length > 0 && (
        <section className="q-block">
          <p className="q-eyebrow">{labels.transport}</p>
          <dl className="q-facts">
            {transporte.map(([rotulo, valor]) => (
              <div className="q-fact" key={rotulo}>
                <dt className="q-dim">{rotulo}</dt>
                <dd className="q-num">{valor}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {quote.notes && (
        <section className="q-block">
          <p className="q-eyebrow">{labels.notes}</p>
          <p className="q-notes">{quote.notes}</p>
        </section>
      )}

      <footer className="q-foot">
        {contato.length > 0 && <p>{contato.join(' · ')}</p>}
        <p>{labels.footer}</p>
      </footer>
    </article>
  );
}

/**
 * A folha do documento.
 *
 * Uma string e não um arquivo `.css`, porque ela viaja: a rota do PDF
 * costura marcação e estilo numa página só e entrega ao Chrome headless.
 * Um import de CSS não atravessa esse caminho.
 *
 * `mm` no que é papel e `px` no que é tipografia. A largura de 148mm é
 * meia folha A4 — a coluna estreita que o item 53 pede para ser lida no
 * celular, que no papel vira uma medida confortável em vez de uma linha
 * de 18cm que o olho perde no meio.
 */
export const QUOTE_CSS = `
.q {
  --ink: #18181b;
  --dim: #71717a;
  --rule: #e4e4e7;
  box-sizing: border-box;
  width: 100%;
  max-width: 148mm;
  margin: 0 auto;
  padding: 0;
  background: #fff;
  color: var(--ink);
  font-family: Inter, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
    Arial, "Noto Sans", sans-serif;
  font-size: 12px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
.q * { box-sizing: border-box; margin: 0; padding: 0; }

.q-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--rule);
}
.q-emitter { display: flex; align-items: center; gap: 10px; min-width: 0; }
/* \`contain\` e não \`cover\`: uma logo cortada é pior do que uma logo
   pequena, e cada empresa manda a sua na proporção que tem. */
.q-logo { width: 44px; height: 44px; object-fit: contain; flex-shrink: 0; }
.q-emitter-text { min-width: 0; }
.q-company { font-size: 15px; font-weight: 600; line-height: 1.25; }
.q-tax { font-size: 11px; color: var(--dim); }

.q-meta { text-align: right; flex-shrink: 0; }
.q-kind {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dim);
}
/* \`break-all\` porque um número de pedido não tem espaço onde quebrar. */
.q-order { font-size: 13px; font-weight: 600; word-break: break-all; }
.q-date { font-size: 11px; color: var(--dim); }

.q-block { margin-top: 18px; }
.q-eyebrow {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dim);
  margin-bottom: 4px;
}
.q-customer { font-size: 14px; font-weight: 500; }
.q-sub { font-size: 11px; color: var(--dim); }

/* Cliente à esquerda, responsável à direita. \`gap\` grande o bastante
   para os dois blocos não lerem como uma frase só. */
.q-parties {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-top: 18px;
}
.q-party { min-width: 0; }
.q-party-right { text-align: right; flex-shrink: 0; }

.q-table { width: 100%; border-collapse: collapse; }
.q-th {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dim);
  text-align: left;
  padding: 0 0 4px;
  border-bottom: 1px solid var(--rule);
  white-space: nowrap;
}
.q-td {
  font-size: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}
/* A última linha não precisa de régua: a soma logo abaixo já tem a dela,
   e duas linhas cinzas a 12px de distância leem como um erro. */
.q-table tbody tr:last-child .q-td { border-bottom: 0; }
.q-table-tight .q-td { padding: 5px 0; }
/* As colunas de número recebem o respiro à ESQUERDA — encostar no texto
   da descrição é o que faz uma tabela estreita parecer apertada. */
.q-td + .q-td, .q-th + .q-th { padding-left: 10px; }
.q-r { text-align: right; }
.q-c { text-align: center; }
.q-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.q-strong { font-weight: 600; }
.q-line-name { display: block; }
.q-line-sub { display: block; font-size: 10px; color: var(--dim); }

.q-sum {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
}
.q-sum-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}
.q-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;
}
.q-total strong { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }

.q-terms { font-size: 12px; margin-bottom: 6px; }

/* Rótulo em cima, valor embaixo, em colunas que se acomodam. Uma lista de
   definição e não uma tabela: são cinco fatos independentes, não cinco
   linhas comparáveis entre si. */
.q-facts { display: flex; flex-wrap: wrap; gap: 10px 28px; }
.q-fact dt { font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; }
.q-fact dd { font-size: 12px; }

.q-dim { color: var(--dim); }
.q-notes { font-size: 11px; color: #3f3f46; white-space: pre-wrap; }

.q-foot {
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
  text-align: center;
  font-size: 10px;
  color: var(--dim);
}
`;
