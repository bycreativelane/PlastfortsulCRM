'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { List } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * "Nesta página" — a coluna da direita nas páginas de conceito.
 *
 * O item ativo é resolvido por `IntersectionObserver` com uma margem
 * superior negativa: um título só conta como "onde eu estou" depois de
 * subir uns 100px do topo, senão o destaque pula para o próximo título
 * no instante em que a borda dele encosta na tela e volta atrás — um
 * piscar que chama mais atenção que a leitura.
 *
 * `rootMargin` inferior bem negativa deixa só uma faixa fina no terço
 * de cima da janela sendo observada, que é onde a vista está.
 */
export function DocsToc({ items }: { items: TocItem[] }) {
  const t = useTranslations('Docs');
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 }
    );

    for (const item of items) {
      const node = document.getElementById(item.id);
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav aria-label={t('onThisPage')} className="space-y-2">
      <p className="text-muted-foreground eyebrow flex items-center gap-1.5">
        <List className="size-3" />
        {t('onThisPage')}
      </p>
      <ul className="border-border/70 space-y-0.5 border-l">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                '-ml-px block border-l py-1 text-xs leading-[1.5] transition-colors',
                item.level === 2 ? 'pl-3' : 'pl-6',
                item.id === active
                  ? 'border-primary text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
