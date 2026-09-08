'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Search } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrencyExact } from '@/lib/currency';
import { fromISO } from '@/lib/calendar';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { loadQuotes, matchesQuote, type StoredQuote } from '@/lib/quotes/store';
import { DealQuote } from '@/components/pipelines/deal-quote';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/ui/panel';
import { StatePanel } from '@/components/ui/state-panel';
import { Skeleton } from '@/components/dashboard/skeleton';

/**
 * Documentos → Orçamentos.
 *
 * Pedido do Gabriel em 8 de setembro: "todo orçamento gerado em PDF
 * precisa ficar salvo em uma seção de documentos > orçamentos, e isso
 * pode ficar fora do menu principal".
 *
 * FORA DO MENU, literalmente: esta rota não entra na barra lateral. Ela é
 * consultada quando alguém pergunta "o que a gente mandou para o
 * Euclides em setembro?", que é uma pergunta de arquivo, não de trabalho
 * do dia. O caminho até aqui é o link no rodapé do próprio documento —
 * que é onde a pergunta nasce.
 *
 * O QUE ESTÁ GUARDADO É O DOCUMENTO, e não o arquivo PDF. O PDF nasce no
 * navegador de quem imprimiu; o servidor nunca o vê. Então cada linha
 * aqui redesenha pelo MESMO `DealQuote` e pelo MESMO cálculo — e é por
 * isso que reabrir um orçamento de junho mostra o que foi enviado em
 * junho, e não o que a oportunidade virou depois.
 *
 * A busca é no cliente, como a do Playbook e pelo mesmo motivo: os
 * documentos já estão todos carregados, e uma ida ao servidor por tecla
 * custa mais do que vale.
 */
export function QuotesArea() {
  const t = useTranslations('Quotes');
  const { accountId } = useAuth();

  const [quotes, setQuotes] = useState<StoredQuote[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [query, setQuery] = useState('');
  const [aberto, setAberto] = useState<StoredQuote | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelado = false;
    void loadQuotes(createClient(), accountId).then((r) => {
      if (cancelado) return;
      setMissing(r === 'missing-table');
      setQuotes(r === 'missing-table' ? [] : r);
    });
    return () => {
      cancelado = true;
    };
  }, [accountId]);

  const visiveis = useMemo(
    () => (quotes ?? []).filter((q) => matchesQuote(q, query)),
    [quotes, query]
  );

  const quando = (iso: string) => {
    const d = fromISO(iso.slice(0, 10));
    return d
      ? d.toLocaleDateString(APP_LOCALE, {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : iso.slice(0, 10);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      {/* A busca só aparece quando há o que buscar. Uma caixa de pesquisa
          sobre uma lista vazia é um controle que só pode decepcionar. */}
      {(quotes?.length ?? 0) > 0 && (
        <div className="relative min-w-0 sm:max-w-80">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="pl-8"
          />
        </div>
      )}

      {quotes === null ? (
        <Panel className="space-y-3 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Panel>
      ) : missing ? (
        // Um banco sem a 071. A mesma cortesia que o Playbook faz sem a
        // 064: dizer o que falta, em vez de uma lista vazia que mente.
        <StatePanel
          framed
          icon={FileText}
          title={t('pendingTitle')}
          description={t('pendingBody')}
        />
      ) : visiveis.length === 0 ? (
        <StatePanel
          framed
          icon={query ? Search : FileText}
          title={query ? t('noResults', { query }) : t('empty')}
          description={query ? undefined : t('emptyBody')}
        />
      ) : (
        <Panel>
          <ul className="divide-border divide-y">
            {visiveis.map((q) => (
              <li key={q.id}>
                {/*
                  A LINHA INTEIRA ABRE, e não um botão "ver" na ponta. O
                  que se faz com um documento arquivado é olhar; um alvo
                  do tamanho da linha é o que o quadro e a lista de
                  conversas já fazem para a mesma intenção.
                */}
                <button
                  type="button"
                  data-slot="button"
                  onClick={() => setAberto(q)}
                  className="hover:bg-muted flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--dur-1)"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-foreground truncate text-sm font-medium">
                        {q.customer.name || t('noCustomer')}
                      </span>
                      {q.orderNumber && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {t('orderNumber', { number: q.orderNumber })}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {quando(q.createdAt)}
                      {q.customer.company ? ` · ${q.customer.company}` : ''}
                      {q.lines.length > 0
                        ? ` · ${t('lineCount', { count: q.lines.length })}`
                        : ''}
                    </span>
                  </span>
                  <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
                    {formatCurrencyExact(q.total, q.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* O MESMO componente que gerou. Reabrir um orçamento de junho tem
          de mostrar junho — inclusive o botão de imprimir, porque
          reenviar o que já foi prometido é metade do motivo de guardar. */}
      {aberto && (
        <DealQuote
          open
          onOpenChange={(v) => !v && setAberto(null)}
          quote={aberto}
        />
      )}
    </div>
  );
}
