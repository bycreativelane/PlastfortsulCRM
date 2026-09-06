'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { ArrowRight, Sparkle, Wrench, Zap } from 'lucide-react';

import { dateLocale } from '@/lib/i18n/dates';
import {
  RELEASES,
  countByKind,
  type Release,
  type ReleaseChangeKind,
} from '@/lib/releases';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * O changelog — a MESMA lista que Configurações › Novidades mostra,
 * numa forma diferente.
 *
 * Uma fonte só (`lib/releases.ts`) e duas leituras, porque as duas
 * perguntas são diferentes. Lá dentro do produto, a pergunta é "o que
 * mudou desde ontem": a versão nova vem aberta, as velhas dobradas.
 * Aqui a pergunta é "quando foi que isso mudou": tudo aberto, em ordem,
 * para ser varrido com Ctrl+F por alguém que veio de fora tentando
 * descobrir em que versão o comportamento que ele integrou virou outro.
 *
 * DE PROPÓSITO, ESTA PÁGINA NÃO MARCA AS NOTAS COMO LIDAS. O ponto
 * daquele indicador é levar um ATENDENTE ao painel de novidades; um
 * integrador lendo a doc pública não deveria apagá-lo do navegador de
 * quem senta na mesma máquina.
 */
const KIND_META: Record<
  ReleaseChangeKind,
  { variant: 'ok' | 'auto' | 'neutral'; icon: typeof Zap }
> = {
  new: { variant: 'ok', icon: Sparkle },
  improved: { variant: 'auto', icon: Zap },
  fixed: { variant: 'neutral', icon: Wrench },
};

export function ReleasesView({ summary }: { summary: string }) {
  const t = useTranslations('WhatsNew');
  const tDocs = useTranslations('Docs');

  return (
    <article className="max-w-3xl space-y-8">
      <header className="space-y-3">
        <p className="text-primary eyebrow">{tDocs('badge')}</p>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          {tDocs('releasesTitle')}
        </h1>
        <p className="text-muted-foreground text-sm leading-[1.7]">{summary}</p>
      </header>

      <div className="space-y-10">
        {RELEASES.map((release, i) => (
          <ReleaseEntry
            key={release.version}
            release={release}
            latest={i === 0}
            t={t}
          />
        ))}
      </div>
    </article>
  );
}

function ReleaseEntry({
  release,
  latest,
  t,
}: {
  release: Release;
  latest: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const counts = countByKind(release);

  return (
    <section
      // A âncora que torna uma versão citável: alguém pode mandar
      // `/developers/releases#v0.9.0` num chamado.
      id={`v${release.version}`}
      className="scroll-mt-24 space-y-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-foreground text-lg font-semibold tracking-tight">
          {t('versionLabel', { version: release.version })}
        </h2>
        <time
          dateTime={release.date}
          className="text-muted-foreground text-xs tabular-nums"
        >
          {format(new Date(`${release.date}T12:00:00`), 'PPP', {
            locale: dateLocale,
          })}
        </time>
        {latest ? (
          <StatusBadge variant="human" size="sm">
            {t('latest')}
          </StatusBadge>
        ) : null}
      </div>

      {release.highlights.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {release.highlights.map((highlight) => (
            <div
              key={highlight.key}
              className="border-border bg-card flex flex-col gap-1.5 rounded-xl border p-3.5"
            >
              <p className="text-foreground text-sm font-semibold">
                {t(`highlights.${highlight.key}.title`)}
              </p>
              <p className="text-secondary-foreground text-xs leading-relaxed">
                {t(`highlights.${highlight.key}.body`)}
              </p>
              {highlight.href ? (
                <Link
                  href={highlight.href}
                  className="text-primary hover:text-primary-hover mt-auto inline-flex w-fit items-center gap-1 pt-2 text-xs font-semibold"
                >
                  {t('seeIt')}
                  <ArrowRight className="size-3.5" />
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-muted-foreground text-xs">
        {t('summary', {
          total: release.changes.length,
          new: counts.new,
          improved: counts.improved,
          fixed: counts.fixed,
        })}
      </p>

      <ul className="divide-border/70 border-border divide-y rounded-xl border px-3.5">
        {release.changes.map((change) => {
          const meta = KIND_META[change.kind];
          const Icon = meta.icon;
          return (
            <li key={change.key} className="flex items-start gap-2.5 py-2.5">
              <StatusBadge
                variant={meta.variant}
                size="sm"
                title={t(`kind.${change.kind}`)}
                className="mt-0.5 size-4.5 shrink-0 justify-center px-0"
              >
                <Icon className="size-2.5" aria-hidden />
                <span className="sr-only">{t(`kind.${change.kind}`)}</span>
              </StatusBadge>
              <span className="text-secondary-foreground min-w-0 text-sm leading-relaxed">
                {t(`items.${change.key}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
