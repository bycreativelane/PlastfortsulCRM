'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DOC_GROUPS,
  SEARCH_INDEX,
  fold,
  pageHref,
} from '@/lib/api-docs/registry';
import { MethodBadge } from './method-badge';

/**
 * A trilha da esquerda: busca em cima, grupos embaixo.
 *
 * A busca filtra um índice de algumas dezenas de linhas montado em
 * tempo de compilação — sem rota, sem debounce, sem estado de
 * carregamento. Um índice desse tamanho cabe no bundle e responde a
 * cada tecla; qualquer coisa mais cerimoniosa aqui seria arquitetura
 * para um problema que a página não tem.
 *
 * Enquanto há busca, os grupos SOMEM e a lista vira resultados planos.
 * Filtrar dentro dos grupos deixaria cabeçalhos vazios e a pessoa
 * contando quantos grupos sobraram em vez de lendo o que achou.
 */
export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('Docs');
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);

  /**
   * Ctrl/Cmd+K foca a busca — o atalho que todo mundo já tenta.
   * `preventDefault` porque no Firefox ele é a barra de endereços.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return null;
    const terms = needle.split(/\s+/);
    return SEARCH_INDEX.filter((entry) =>
      terms.every((term) => entry.haystack.includes(term))
    );
  }, [query]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          placeholder={t('search')}
          aria-label={t('search')}
          spellCheck={false}
          className="border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring/30 h-8 w-full rounded-lg border pr-8 pl-8 text-xs outline-none focus-visible:ring-2"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('clearSearch')}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="text-muted-foreground border-border text-3xs pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1 py-px font-mono lg:block">
            ⌘K
          </kbd>
        )}
      </div>

      <nav
        aria-label={t('navAria')}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-8"
      >
        {results ? (
          results.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-xs">
              {t('noResults', { query: query.trim() })}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {results.map((entry) => (
                <li key={entry.href}>
                  <Row
                    href={entry.href}
                    active={pathname === entry.href}
                    method={entry.method}
                    label={entry.title}
                    hint={entry.group}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          )
        ) : (
          DOC_GROUPS.map((group, i) => (
            <div key={group.label ?? `top-${i}`} className="space-y-0.5">
              {group.label ? (
                <p className="text-muted-foreground eyebrow px-2 pb-1">
                  {group.label}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {group.pages.map((page) => {
                  const href = pageHref(page);
                  return (
                    <li key={page.slug}>
                      <Row
                        href={href}
                        active={pathname === href}
                        method={
                          page.type === 'endpoint' ? page.method : undefined
                        }
                        label={page.title}
                        onNavigate={onNavigate}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}

function Row({
  href,
  active,
  method,
  label,
  hint,
  onNavigate,
}: {
  href: string;
  active: boolean;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  label: string;
  hint?: string | null;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors',
        active
          ? 'bg-primary-soft text-primary font-semibold'
          : 'text-secondary-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {method ? <MethodBadge method={method} size="sm" /> : null}
      <span className="truncate">{label}</span>
      {hint ? (
        <span className="text-muted-foreground text-3xs ml-auto truncate">
          {hint}
        </span>
      ) : null}
    </Link>
  );
}
