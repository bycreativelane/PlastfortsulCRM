'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { Language, ResponseExample } from '@/lib/api-docs/types';
import { CodeBlock } from './code-block';

export interface Sample {
  id: string;
  label: string;
  syntax: Language;
  code: string;
}

/**
 * O painel da direita, metade de cima: a mesma chamada em três
 * linguagens, com abas.
 *
 * As abas guardam a escolha em estado local e não em localStorage — de
 * propósito, por enquanto. Persistir "esta pessoa lê Python" entre
 * páginas é uma gentileza real, mas escrever no armazenamento durante a
 * hidratação é a receita conhecida de um flash de conteúdo trocado, e
 * uma doc que pisca na primeira pintura parece quebrada.
 */
export function RequestPanel({
  title,
  samples,
}: {
  title: string;
  samples: Sample[];
}) {
  const [active, setActive] = useState(samples[0]?.id);
  const sample = samples.find((s) => s.id === active) ?? samples[0];

  return (
    <section className="border-border bg-card overflow-hidden rounded-xl border">
      <header className="border-border bg-card-2 flex items-center gap-2 border-b px-3 py-2">
        <span className="text-foreground truncate text-xs font-semibold">
          {title}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={cn(
                'text-2xs rounded-md px-2 py-1 font-medium transition-colors',
                s.id === sample?.id
                  ? 'bg-primary-soft-2 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {sample ? (
        <CodeBlock
          code={sample.code}
          language={sample.syntax}
          className="rounded-none border-0"
        />
      ) : null}
    </section>
  );
}

/** Verde 2xx, âmbar 4xx, vermelho 5xx — a leitura de sempre. */
function statusClass(status: number, active: boolean): string {
  if (!active) return 'text-muted-foreground hover:text-foreground';
  if (status < 300) return 'text-ok-ink bg-ok-soft';
  if (status < 500) return 'text-human-ink bg-human-soft';
  return 'text-danger-ink bg-danger-soft';
}

/**
 * Metade de baixo: uma aba por status que a rota realmente devolve.
 *
 * Os erros ficam ao lado do sucesso, e não numa página de erros à
 * parte, porque o momento em que alguém precisa saber a cara de um
 * `403` é o momento em que acabou de receber um — com o endpoint
 * aberto na tela.
 */
export function ResponsePanel({ responses }: { responses: ResponseExample[] }) {
  const t = useTranslations('Docs');
  const [index, setIndex] = useState(0);
  const current = responses[index] ?? responses[0];

  return (
    <section className="border-border bg-card overflow-hidden rounded-xl border">
      <header className="border-border bg-card-2 flex items-center gap-2 border-b px-3 py-2">
        <span className="text-muted-foreground eyebrow">{t('response')}</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-0.5">
          {responses.map((response, i) => (
            <button
              key={`${response.status}-${i}`}
              type="button"
              onClick={() => setIndex(i)}
              title={response.label}
              className={cn(
                'text-2xs rounded-md px-1.5 py-1 font-mono font-semibold transition-colors',
                statusClass(response.status, i === index)
              )}
            >
              {response.status}
            </button>
          ))}
        </div>
      </header>

      {current ? (
        <>
          {current.label ? (
            <p className="border-border/70 text-muted-foreground text-2xs border-b px-3 py-1.5">
              {current.label}
            </p>
          ) : null}
          <CodeBlock
            code={current.json}
            language="json"
            className="rounded-none border-0"
          />
        </>
      ) : null}
    </section>
  );
}
