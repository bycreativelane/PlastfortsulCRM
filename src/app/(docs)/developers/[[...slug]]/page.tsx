import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { currentBaseUrl } from '@/lib/api-docs/base-url';
import {
  ALL_PAGES,
  groupOf,
  neighbours,
  pageHref,
  resolvePage,
  type DocPage,
} from '@/lib/api-docs/registry';
import { EndpointView } from '@/components/docs/endpoint-view';
import { GuideView } from '@/components/docs/guide-view';
import { ReleasesView } from '@/components/docs/releases-view';

/**
 * Uma rota para toda a documentação.
 *
 * `[[...slug]]` opcional para que `/developers` (a introdução),
 * `/developers/autenticacao` (um guia) e
 * `/developers/endpoints/enviar-mensagem` (uma rota da API) sejam a
 * mesma página resolvendo o mesmo registro — em vez de três arquivos
 * repetindo a mesma moldura e divergindo com o tempo.
 *
 * `generateStaticParams` enumera tudo, então o roteador conhece cada
 * URL na build; a renderização ainda é dinâmica porque `currentBaseUrl`
 * lê os cabeçalhos da requisição — a doc mostra o endereço de quem a
 * abriu, e esse é o único jeito honesto de saber qual é.
 */
interface Props {
  params: Promise<{ slug?: string[] }>;
}

export function generateStaticParams(): { slug?: string[] }[] {
  return ALL_PAGES.map((page) => {
    const href = pageHref(page);
    const segments = href.replace('/developers', '').split('/').filter(Boolean);
    return segments.length ? { slug: segments } : { slug: [] };
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = resolvePage(slug);
  if (!page) return {};

  const t = await getTranslations('Docs');
  return {
    title: `${page.title} — ${t('badge')}`,
    description: page.summary,
  };
}

export default async function DevelopersPage({ params }: Props) {
  const { slug } = await params;
  const page = resolvePage(slug);
  if (!page) notFound();

  const baseUrl = await currentBaseUrl();
  const group = groupOf(page);
  const { prev, next } = neighbours(page);

  return (
    <div className="space-y-12">
      {page.type === 'endpoint' ? (
        <EndpointView endpoint={page} baseUrl={baseUrl} group={group} />
      ) : page.type === 'releases' ? (
        <ReleasesView summary={page.summary} />
      ) : (
        <GuideView page={page} baseUrl={baseUrl} group={group} />
      )}

      <PageNav prev={prev} next={next} />
    </div>
  );
}

/**
 * O rodapé de navegação.
 *
 * Existe porque a barra lateral responde "onde eu estou" e não "o que
 * vem depois" — e a ordem em que estas páginas foram escritas É uma
 * leitura: introdução, início rápido, fundamentos, referência. Quem
 * está aprendendo desce por ela; quem veio consultar usa a busca.
 */
async function PageNav({
  prev,
  next,
}: {
  prev: DocPage | null;
  next: DocPage | null;
}) {
  const t = await getTranslations('Docs');
  if (!prev && !next) return null;

  return (
    <nav className="border-border grid gap-3 border-t pt-6 sm:grid-cols-2">
      {prev ? (
        <Link
          href={pageHref(prev)}
          className="border-border hover:border-primary/40 hover:bg-card-2 group flex flex-col gap-1 rounded-xl border p-3.5 transition-colors"
        >
          <span className="text-muted-foreground text-2xs flex items-center gap-1.5">
            <ArrowLeft className="size-3 transition-transform group-hover:-translate-x-0.5" />
            {t('previous')}
          </span>
          <span className="text-foreground text-sm font-semibold">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}

      {next ? (
        <Link
          href={pageHref(next)}
          className="border-border hover:border-primary/40 hover:bg-card-2 group flex flex-col items-end gap-1 rounded-xl border p-3.5 text-right transition-colors sm:col-start-2"
        >
          <span className="text-muted-foreground text-2xs flex items-center gap-1.5">
            {t('next')}
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="text-foreground text-sm font-semibold">
            {next.title}
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
