import type { Block, GuidePage } from '@/lib/api-docs/types';
import { Blocks } from './blocks';
import { DocsToc, type TocItem } from './docs-toc';

/**
 * Uma página de conceito: prosa à esquerda, "Nesta página" à direita.
 *
 * O índice sai dos PRÓPRIOS blocos — os títulos já carregam `id`
 * porque o link `#assinatura` da prosa precisa dele. Um índice montado
 * à mão ao lado do conteúdo é a estrutura que envelhece primeiro:
 * alguém acrescenta uma seção, esquece do índice, e a página passa a
 * mentir sobre si mesma.
 */
export function GuideView({
  page,
  baseUrl,
  group,
}: {
  page: GuidePage;
  baseUrl: string;
  group: string | null;
}) {
  const toc = tocFrom(page.blocks);

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_13rem]">
      <article className="max-w-3xl min-w-0 space-y-6">
        <header className="space-y-3">
          {group ? <p className="text-primary eyebrow">{group}</p> : null}
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            {page.title}
          </h1>
          <p className="text-muted-foreground text-sm leading-[1.7]">
            {page.summary}
          </p>
        </header>

        <Blocks blocks={page.blocks} baseUrl={baseUrl} />
      </article>

      {toc.length > 0 ? (
        <div className="hidden xl:sticky xl:top-20 xl:block xl:self-start">
          <DocsToc items={toc} />
        </div>
      ) : null}
    </div>
  );
}

function tocFrom(blocks: Block[]): TocItem[] {
  return blocks.flatMap((block) =>
    block.kind === 'h2' || block.kind === 'h3'
      ? [{ id: block.id, text: block.text, level: block.kind === 'h2' ? 2 : 3 }]
      : []
  ) as TocItem[];
}
