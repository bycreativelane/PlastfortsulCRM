'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { highlight, type TokenKind } from '@/lib/api-docs/highlight';
import type { Language } from '@/lib/api-docs/types';

/**
 * Cada espécie de token vira uma variável CSS, e não uma classe do
 * Tailwind, porque as seis cores precisam trocar juntas entre claro e
 * escuro sem que este arquivo saiba qual modo está ativo. Definidas no
 * fim de `globals.css`, junto das outras.
 */
const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: '',
  str: 'text-(--code-str)',
  num: 'text-(--code-num)',
  kw: 'text-(--code-kw)',
  com: 'text-(--code-com) italic',
  key: 'text-(--code-key)',
  punc: 'text-(--code-punc)',
};

export function CodeBlock({
  code,
  language,
  title,
  className,
  copyable = true,
}: {
  code: string;
  language: Language;
  title?: string;
  className?: string;
  copyable?: boolean;
}) {
  const t = useTranslations('Docs');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limpa o temporizador na desmontagem: navegar para outro endpoint
  // enquanto o "Copiado" está aceso deixaria um setState órfão.
  useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    []
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Sem área de transferência (http em rede local, permissão negada):
      // o texto continua selecionável, que é o plano B de sempre.
    }
  }, [code]);

  const tokens = highlight(code, language);

  return (
    <div
      className={cn(
        'border-border group relative overflow-hidden rounded-xl border bg-(--code-bg)',
        className
      )}
    >
      {title ? (
        <div className="border-border/70 text-muted-foreground flex items-center gap-2 border-b px-3 py-1.5">
          <span className="eyebrow">{title}</span>
        </div>
      ) : null}

      {copyable ? (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? t('copied') : t('copy')}
          className={cn(
            'text-muted-foreground hover:text-foreground hover:bg-muted text-2xs absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors',
            // Sempre visível no toque, discreto no mouse: `group-hover`
            // sozinho esconderia o botão em telas sem cursor.
            'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
            title && 'top-9'
          )}
        >
          {copied ? (
            <Check className="text-ok-ink size-3" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? t('copied') : t('copy')}
        </button>
      ) : null}

      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-xs leading-[1.7]">
        <code>
          {tokens.map((token, i) => (
            <span key={i} className={TOKEN_CLASS[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
