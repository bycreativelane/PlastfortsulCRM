import { formatCurrencyExact } from '@/lib/currency';
import { fromISO } from '@/lib/calendar';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { formatPhone } from '@/lib/whatsapp/phone-format';
import type { Quote } from '@/lib/quotes/quote';

/**
 * O orçamento, como documento — e um só, para a tela e para o arquivo.
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
  products: string;
  lineDiscount: string;
  subtotal: string;
  shipping: string;
  total: string;
  delivery: string;
  owner: string;
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

      <section className="q-block">
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
      </section>

      {quote.lines.length > 0 && (
        <section className="q-block">
          <p className="q-eyebrow">{labels.products}</p>
          <ul className="q-lines">
            {quote.lines.map((linha, i) => (
              <li className="q-line" key={`${linha.name}-${i}`}>
                <div className="q-line-main">
                  <p className="q-line-name">{linha.name}</p>
                  <p className="q-line-math">
                    {linha.quantity} × {dinheiro(linha.unitPrice)}
                    {linha.discountPercent > 0
                      ? ` · ${labels.lineDiscount.replace(
                          '{percent}',
                          String(linha.discountPercent)
                        )}`
                      : ''}
                  </p>
                </div>
                <p className="q-line-total">{dinheiro(linha.total)}</p>
              </li>
            ))}
          </ul>
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
        {quote.shipping !== null && (
          <div className="q-sum-row">
            <span>{labels.shipping}</span>
            <span>{dinheiro(quote.shipping)}</span>
          </div>
        )}
        <div className="q-total">
          <span>{labels.total}</span>
          <strong>{dinheiro(quote.total)}</strong>
        </div>
      </section>

      {(quote.carrier || quote.owner) && (
        <section className="q-strip">
          {quote.carrier ? (
            <p>
              <span className="q-dim">{labels.delivery} </span>
              {quote.carrier}
            </p>
          ) : null}
          {quote.owner ? (
            <p className="q-dim">
              {labels.owner.replace('{name}', quote.owner)}
            </p>
          ) : null}
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

.q-lines { list-style: none; }
.q-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--rule);
}
.q-line:last-child { border-bottom: 0; }
.q-line-main { min-width: 0; }
.q-line-name { font-size: 12px; }
.q-line-math { font-size: 11px; color: var(--dim); font-variant-numeric: tabular-nums; }
.q-line-total { font-size: 12px; font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }

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

.q-strip {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 24px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
  font-size: 11px;
}
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
