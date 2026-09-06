import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

/**
 * O subconjunto de Markdown que a prosa do spec pode usar — e só ele.
 *
 *   `código`            → <code>
 *   **forte**           → <strong>
 *   [rótulo](/destino)  → link
 *
 * Um parser de trinta linhas em vez de uma dependência de Markdown, e a
 * razão não é peso: é que um `.md` completo aceita tabelas, títulos e
 * listas, que já são BLOCOS neste modelo. Duas gramáticas para a mesma
 * coisa terminam com metade das tabelas escritas de um jeito e metade
 * do outro. Aqui, o que não está nesta lista precisa virar um bloco.
 *
 * Links que começam com `/` são internos e passam pelo `Link` (sem
 * recarregar a página); o resto abre fora, com `rel` fechado — a doc é
 * pública e nada nela deve emprestar a aba de quem está lendo.
 */
const PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;

export function RichText({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];

    if (token.startsWith('`')) {
      out.push(
        <code
          key={key++}
          className="bg-muted text-foreground rounded-[4px] px-1 py-px font-mono text-xs"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**')) {
      out.push(
        <strong key={key++} className="text-foreground font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      // O RÓTULO PASSA PELO PARSER DE NOVO.
      //
      // Metade dos links desta documentação aponta para uma rota e se
      // chama pelo nome dela — ``[`POST /broadcasts`](…)``. Sem esta
      // recursão o rótulo saía com as crases impressas na tela, que é
      // exatamente o defeito que a marcação existe para evitar. A
      // recursão termina sozinha: o rótulo não pode conter `]`, logo
      // não pode conter outro link.
      const inner = <RichText text={label} />;
      out.push(
        href.startsWith('/') ? (
          <Link
            key={key++}
            href={href}
            className="text-primary [&_code]:bg-primary-soft underline decoration-current/30 underline-offset-2 hover:decoration-current [&_code]:text-current"
          >
            {inner}
          </Link>
        ) : (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary [&_code]:bg-primary-soft underline decoration-current/30 underline-offset-2 hover:decoration-current [&_code]:text-current"
          >
            {inner}
          </a>
        )
      );
    }

    last = index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));

  return (
    <>
      {out.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </>
  );
}
