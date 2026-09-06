import Link from 'next/link';
import {
  ArrowRight,
  Coins,
  Info,
  KeyRound,
  Megaphone,
  OctagonAlert,
  Send,
  TriangleAlert,
  UsersRound,
  Webhook,
  Workflow,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { applyBaseUrl } from '@/lib/api-docs/base-url';
import type { Block, DocCard } from '@/lib/api-docs/types';
import { CodeBlock } from './code-block';
import { RichText } from './rich-text';

/**
 * O renderizador de `Block[]` — a prosa das páginas de conceito e as
 * notas dos endpoints passam todas por aqui.
 *
 * Server component: nada nele tem estado. O único pedaço interativo é
 * o `CodeBlock` (o botão de copiar), que carrega o próprio `use client`
 * e é a fronteira mais estreita possível — o resto da página continua
 * sendo HTML que o servidor já resolveu.
 */
export function Blocks({
  blocks,
  baseUrl,
}: {
  blocks: Block[];
  baseUrl: string;
}) {
  const sub = (text: string) => applyBaseUrl(text, baseUrl);

  return (
    <div className="space-y-5">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'p':
            return (
              <p
                key={i}
                className="text-secondary-foreground text-sm leading-[1.75]"
              >
                <RichText text={sub(block.text)} />
              </p>
            );

          case 'h2':
            return (
              <Heading key={i} id={block.id} level={2}>
                {block.text}
              </Heading>
            );

          case 'h3':
            return (
              <Heading key={i} id={block.id} level={3}>
                {block.text}
              </Heading>
            );

          case 'list':
            return <BlockList key={i} block={block} sub={sub} />;

          case 'code':
            return (
              <CodeBlock
                key={i}
                code={sub(block.code)}
                language={block.language}
                title={block.title}
              />
            );

          case 'table':
            return <BlockTable key={i} block={block} sub={sub} />;

          case 'callout':
            return <Callout key={i} block={block} sub={sub} />;

          case 'cards':
            return <CardGrid key={i} items={block.items} sub={sub} />;
        }
      })}
    </div>
  );
}

/**
 * Um título com âncora.
 *
 * `scroll-mt` porque a barra do topo é fixa: sem ele, um link para
 * `#assinatura` para com o título escondido atrás dela, e quem clicou
 * acha que o link está quebrado. O `#` só aparece no hover — é para
 * quem quer mandar o link a alguém, não para quem está lendo.
 */
function Heading({
  id,
  level,
  children,
}: {
  id: string;
  level: 2 | 3;
  children: string;
}) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <Tag
      id={id}
      className={cn(
        'group text-foreground scroll-mt-24 font-semibold tracking-tight',
        level === 2 ? 'pt-3 text-base' : 'pt-1 text-sm'
      )}
    >
      <a href={`#${id}`} className="no-underline">
        {children}
        <span className="text-muted-foreground ml-2 opacity-0 transition-opacity group-hover:opacity-100">
          #
        </span>
      </a>
    </Tag>
  );
}

function BlockList({
  block,
  sub,
}: {
  block: Extract<Block, { kind: 'list' }>;
  sub: (text: string) => string;
}) {
  const Tag = block.ordered ? 'ol' : 'ul';
  return (
    <Tag
      className={cn(
        'text-secondary-foreground marker:text-muted-foreground space-y-2 pl-5 text-sm leading-[1.7]',
        block.ordered ? 'list-decimal' : 'list-disc'
      )}
    >
      {block.items.map((item, i) => (
        <li key={i} className="pl-1">
          <RichText text={sub(item)} />
        </li>
      ))}
    </Tag>
  );
}

/**
 * Tabelas rolam dentro do próprio contêiner.
 *
 * Uma tabela de escopos tem três colunas de texto e não cabe num
 * telefone; sem o `overflow-x-auto` aqui, quem rola é a PÁGINA, e aí
 * o texto do parágrafo de cima também sai da tela.
 */
function BlockTable({
  block,
  sub,
}: {
  block: Extract<Block, { kind: 'table' }>;
  sub: (text: string) => string;
}) {
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-border bg-card-2 border-b">
            {block.head.map((cell, i) => (
              <th
                key={i}
                // `normal-case` no código dentro do cabeçalho: uma coluna
                // chamada `/api/v1` virava `/API/V1` em maiúsculas, que é
                // um caminho que não existe. O texto ao redor continua em
                // caixa alta; o que é literal fica como está escrito.
                className="text-muted-foreground text-2xs px-3 py-2 font-semibold tracking-wide uppercase [&_code]:normal-case"
              >
                <RichText text={sub(cell)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-border/60 border-b last:border-0">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={cn(
                    'px-3 py-2.5 align-top leading-[1.6]',
                    c === 0
                      ? 'text-foreground font-medium'
                      : 'text-secondary-foreground'
                  )}
                >
                  <RichText text={sub(cell)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CALLOUT_META = {
  note: {
    icon: Info,
    frame: 'border-primary/25 bg-primary-soft',
    ink: 'text-primary',
  },
  warn: {
    icon: TriangleAlert,
    frame: 'border-human-ink/25 bg-human-soft',
    ink: 'text-human-ink',
  },
  danger: {
    icon: OctagonAlert,
    frame: 'border-danger-ink/25 bg-danger-soft',
    ink: 'text-danger-ink',
  },
} as const;

function Callout({
  block,
  sub,
}: {
  block: Extract<Block, { kind: 'callout' }>;
  sub: (text: string) => string;
}) {
  const meta = CALLOUT_META[block.tone];
  const Icon = meta.icon;
  return (
    <div className={cn('flex gap-3 rounded-xl border p-3.5', meta.frame)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', meta.ink)} />
      <div className="space-y-1">
        {block.title ? (
          <p className="text-foreground text-sm font-semibold">{block.title}</p>
        ) : null}
        <p className="text-secondary-foreground text-sm leading-[1.7]">
          <RichText text={sub(block.text)} />
        </p>
      </div>
    </div>
  );
}

const CARD_ICONS = {
  key: KeyRound,
  send: Send,
  webhook: Webhook,
  contacts: UsersRound,
  deals: Coins,
  releases: Megaphone,
  hook: Workflow,
} as const;

function CardGrid({
  items,
  sub,
}: {
  items: DocCard[];
  sub: (text: string) => string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((card) => {
        const Icon = CARD_ICONS[card.icon];
        return (
          <Link
            key={card.href}
            href={card.href}
            className="border-border bg-card hover:border-primary/40 hover:bg-card-2 group flex flex-col gap-2 rounded-xl border p-4 transition-colors"
          >
            <Icon className="text-primary size-5" />
            <span className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
              {card.title}
              <ArrowRight className="text-muted-foreground size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="text-muted-foreground text-xs leading-[1.6]">
              <RichText text={sub(card.text)} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
