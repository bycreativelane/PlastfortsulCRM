'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, BookOpen } from 'lucide-react';

/**
 * A porta para `/developers`, a partir das duas telas onde alguém já
 * está com a pergunta na cabeça.
 *
 * Quem abre Chaves de API está prestes a entregar uma credencial a uma
 * integração e não sabe quais rotas existem; quem abre Webhooks quer
 * mandar um payload de fora. Os dois estavam a uma pergunta de
 * distância da resposta, e a resposta morava num `.md` no repositório
 * — ou seja, fora do alcance de todo mundo que não abre o código.
 *
 * ABRE EM OUTRA ABA, de propósito: a doc é para consultar ENQUANTO se
 * configura a chave, e mandar a pessoa embora da tela em que ela estava
 * trabalhando é perder o que ela já tinha digitado.
 */
export function ApiDocsLink({
  variant = 'api',
}: {
  variant?: 'api' | 'hooks';
}) {
  const t = useTranslations('Docs');
  const href =
    variant === 'hooks' ? '/developers/hooks-de-entrada' : '/developers';

  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="border-border bg-card-2 hover:border-primary/40 hover:bg-card group flex items-center gap-3 rounded-xl border p-3 transition-colors"
    >
      <BookOpen className="text-primary size-4 shrink-0" />
      <span className="min-w-0">
        <span className="text-foreground block text-sm font-semibold">
          {variant === 'hooks' ? t('hookLinkTitle') : t('linkTitle')}
        </span>
        <span className="text-muted-foreground block text-xs">
          {variant === 'hooks' ? t('hookLinkHint') : t('linkHint')}
        </span>
      </span>
      <ArrowUpRight className="text-muted-foreground ml-auto size-4 shrink-0 transition-transform group-hover:-translate-y-0.5" />
    </Link>
  );
}
