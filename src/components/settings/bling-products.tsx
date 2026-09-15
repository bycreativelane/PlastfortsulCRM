'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';
import type { FamilyRow, ProductsCounts } from '@/lib/bling/product-admin';
import { cn } from '@/lib/utils';

interface Pendencia {
  id: string;
  blingProductId: string;
  code: string | null;
  name: string;
  reason: 'no_sku' | 'sku_linked_elsewhere' | 'sku_too_long';
  candidate: { id: string; name: string; sku: string | null } | null;
}

interface ProdutoVinculado {
  id: string;
  name: string;
  sku: string | null;
  family: string | null;
  missingWeight: boolean;
  exceptionCategoryId: string | null;
  definesOrderCategory: boolean;
  category: { id: string; label: string } | null;
  categorySource: 'product' | 'family' | 'default' | null;
}

interface Resposta {
  connected: boolean;
  pending?: number | null;
  job?: {
    status: 'running' | 'ok' | 'partial' | 'error';
    running: boolean;
    last_success_at: string | null;
    error: string | null;
    stats: Record<string, unknown>;
  } | null;
  rootConfirmed?: boolean;
  counts?: ProductsCounts;
  families?: FamilyRow[];
  categoryOptions?: Array<{ id: string; label: string }>;
  defaultCategoryId?: string | null;
  matches?: Pendencia[];
  unlinkedProducts?: Array<{ id: string; name: string; sku: string | null }>;
  linkedProducts?: ProdutoVinculado[];
}

const POR_PAGINA = 50;

/**
 * Configurações › Bling › Produtos (D6 e D7).
 *
 * Três perguntas, na ordem em que um admin as responde: o catálogo veio
 * inteiro (contagens e pendências)? cada família cai em qual categoria de
 * receita? algum produto foge da regra da família (exceção, item auxiliar)?
 *
 * "Sem peso" é vermelho: na Fase 3 produto físico sem peso bloqueia a emissão.
 * "Sem categoria" é âmbar: é mapeamento que falta, e um admin resolve aqui.
 */
export function BlingProducts() {
  const t = useTranslations('Bling.products');
  const locale = useLocale();
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [falhou, setFalhou] = React.useState(false);
  const [ocupado, setOcupado] = React.useState(false);
  const [busca, setBusca] = React.useState('');
  const [mostrar, setMostrar] = React.useState(POR_PAGINA);
  const [vincularA, setVincularA] = React.useState<Record<string, string>>({});

  const quando = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }),
    [locale]
  );

  const load = React.useCallback(async () => {
    try {
      const response = await fetch('/api/bling/products');
      if (!response.ok) throw new Error(String(response.status));
      setDados((await response.json()) as Resposta);
      setFalhou(false);
    } catch {
      setFalhou(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const rodando = Boolean(dados?.job?.running);
  React.useEffect(() => {
    if (!rodando) return;
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [rodando, load]);

  const enviar = async (url: string, init: RequestInit, sucesso: string) => {
    setOcupado(true);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
      if (!response.ok && response.status !== 202) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? String(response.status));
      }
      toast.success(sucesso);
    } catch (erro) {
      toast.error(t('actionFailed', { message: erro instanceof Error ? erro.message : '—' }));
    } finally {
      setOcupado(false);
      void load();
    }
  };

  if (falhou) {
    return (
      <section className="mt-6 rounded-lg border p-4">
        <p className="text-danger-ink text-sm">{t('loadFailed')}</p>
      </section>
    );
  }
  if (!dados) {
    return (
      <p className="text-muted-foreground mt-6 flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t('loading')}
      </p>
    );
  }
  if (!dados.connected) return null;
  if (dados.pending) {
    return (
      <section className="bg-muted text-muted-foreground mt-6 rounded-lg p-4 text-sm">
        {t('pendingMigration', { migration: dados.pending })}
      </section>
    );
  }

  const { job, counts, families = [], categoryOptions = [], matches = [], linkedProducts = [] } = dados;
  const restante = typeof job?.stats?.remaining === 'number' ? job.stats.remaining : 0;
  const sugestoesDeFamilia = families.filter((f) => !f.mapping && f.suggestion);
  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? linkedProducts.filter(
        (p) =>
          p.name.toLowerCase().includes(termo) ||
          (p.sku ?? '').toLowerCase().includes(termo) ||
          (p.family ?? '').toLowerCase().includes(termo)
      )
    : linkedProducts;

  return (
    <section className="bg-card mt-6 rounded-lg border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h3 className="text-foreground text-base font-semibold">{t('title')}</h3>
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-xs">{t('description')}</p>
          <p className="text-muted-foreground text-2xs mt-2 tabular-nums">
            {rodando
              ? t('importing')
              : job?.last_success_at
                ? t('lastImport', { when: quando.format(new Date(job.last_success_at)) })
                : t('neverImported')}
          </p>
          {restante > 0 && !rodando ? <p className="text-human-ink text-2xs mt-1">{t('remaining', { count: restante })}</p> : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={rodando || ocupado}
          onClick={() => void enviar('/api/bling/products/sync', { method: 'POST' }, t('importStarted'))}
        >
          <RefreshCw className={cn('size-4', rodando && 'animate-spin')} />
          {t('importNow')}
        </Button>
      </header>

      {job?.status === 'error' && job.error ? (
        <p className="bg-danger-soft text-danger-ink mx-4 mt-4 rounded-md px-3 py-2 text-xs">
          {t('importError', { message: job.error })}
        </p>
      ) : null}

      {counts ? (
        <div className="flex flex-wrap gap-2 p-4">
          <StatusBadge variant="neutral">{t('countLinked', { count: counts.active })}</StatusBadge>
          <StatusBadge variant={counts.missingWeight > 0 ? 'danger' : 'ok'}>
            {t('countMissingWeight', { count: counts.missingWeight })}
          </StatusBadge>
          <StatusBadge variant={counts.unresolvedCategory > 0 ? 'human' : 'ok'}>
            {t('countUnresolved', { count: counts.unresolvedCategory })}
          </StatusBadge>
          <StatusBadge variant="neutral">{t('countAuxiliary', { count: counts.auxiliary })}</StatusBadge>
        </div>
      ) : null}

      <div className="divide-y border-t">
        {/* Pendências */}
        {matches.length > 0 ? (
          <div className="p-4">
            <h4 className="text-foreground text-sm font-semibold">{t('matchesTitle', { count: matches.length })}</h4>
            <p className="text-muted-foreground mt-1 text-xs">{t('matchesDescription')}</p>
            <ul className="mt-2 divide-y">
              {matches.map((m) => {
                const escolhido = vincularA[m.id] ?? m.candidate?.id ?? '';
                return (
                  <li key={m.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-foreground truncate text-sm">{m.name}</p>
                        <p className="text-muted-foreground text-2xs">
                          {m.code ? t('code', { code: m.code }) : t('noCode')} · {t(`reason.${m.reason}`)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <OptionSelect
                        value={escolhido}
                        onValueChange={(v) => setVincularA((atual) => ({ ...atual, [m.id]: v }))}
                        aria-label={t('linkTo')}
                        className="h-8 min-w-48 text-xs"
                        disabled={ocupado}
                      >
                        <option value="">{t('chooseProduct')}</option>
                        {m.candidate ? (
                          <option value={m.candidate.id}>
                            {m.candidate.name} {m.candidate.sku ? `(${m.candidate.sku})` : ''}
                          </option>
                        ) : null}
                        {(dados.unlinkedProducts ?? [])
                          .filter((p) => p.id !== m.candidate?.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} {p.sku ? `(${p.sku})` : ''}
                            </option>
                          ))}
                      </OptionSelect>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado || !escolhido}
                        onClick={() =>
                          void enviar(
                            `/api/bling/products/matches/${m.id}`,
                            { method: 'POST', body: JSON.stringify({ action: 'link', productId: escolhido }) },
                            t('linked')
                          )
                        }
                      >
                        {t('link')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() =>
                          void enviar(
                            `/api/bling/products/matches/${m.id}`,
                            { method: 'POST', body: JSON.stringify({ action: 'create' }) },
                            t('created')
                          )
                        }
                      >
                        {t('create')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={ocupado}
                        onClick={() =>
                          void enviar(
                            `/api/bling/products/matches/${m.id}`,
                            { method: 'POST', body: JSON.stringify({ action: 'ignore' }) },
                            t('ignored')
                          )
                        }
                      >
                        {t('ignore')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* Famílias */}
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-foreground text-sm font-semibold">{t('familiesTitle')}</h4>
            {dados.rootConfirmed && sugestoesDeFamilia.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={ocupado}
                onClick={() =>
                  void enviar(
                    '/api/bling/families',
                    {
                      method: 'PUT',
                      body: JSON.stringify({
                        mappings: sugestoesDeFamilia.map((f) => ({ familyId: f.id, categoryId: f.suggestion?.id })),
                      }),
                    },
                    t('saved')
                  )
                }
              >
                {t('confirmSuggestions', { count: sugestoesDeFamilia.length })}
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">{t('familiesDescription')}</p>

          {!dados.rootConfirmed ? (
            <p className="bg-human-soft text-human-ink mt-2 rounded-md px-3 py-2 text-xs">{t('confirmRootFirst')}</p>
          ) : (
            <>
              <div className="mt-3 grid items-center gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <span className="text-foreground text-sm">{t('defaultCategory')}</span>
                <OptionSelect
                  value={dados.defaultCategoryId ?? ''}
                  onValueChange={(v) =>
                    void enviar(
                      '/api/bling/settings',
                      { method: 'PATCH', body: JSON.stringify({ default_revenue_category_id: v || null }) },
                      t('saved')
                    )
                  }
                  aria-label={t('defaultCategory')}
                  disabled={ocupado}
                  className="h-8 w-full text-xs"
                >
                  <option value="">{t('noDefault')}</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </OptionSelect>
              </div>
              {families.length === 0 ? (
                <p className="text-muted-foreground mt-2 text-xs">{t('noFamilies')}</p>
              ) : (
                <ul className="mt-2 divide-y">
                  {families.map((f) => (
                    <li
                      key={f.id}
                      className="grid items-center gap-2 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
                      style={{ paddingLeft: `${f.depth * 16}px` }}
                    >
                      <span className="min-w-0">
                        <span className="text-foreground block truncate text-sm">{f.label}</span>
                        <span className="text-muted-foreground text-2xs">{t('familyProducts', { count: f.productCount })}</span>
                      </span>
                      <span className="min-w-0">
                        <OptionSelect
                          value={f.mapping?.id ?? ''}
                          onValueChange={(v) =>
                            void enviar(
                              '/api/bling/families',
                              { method: 'PUT', body: JSON.stringify({ mappings: [{ familyId: f.id, categoryId: v || null }] }) },
                              t('saved')
                            )
                          }
                          aria-label={f.label}
                          disabled={ocupado}
                          className="h-8 w-full text-xs"
                        >
                          <option value="">{t('inheritOrDefault')}</option>
                          {categoryOptions.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </OptionSelect>
                        {f.suggestion ? (
                          <span className="text-muted-foreground text-2xs mt-1 block">
                            {t('suggestion', { label: f.suggestion.label })}
                          </span>
                        ) : null}
                      </span>
                      <StatusBadge
                        size="sm"
                        variant={f.mappingState === 'ok' ? 'ok' : f.mappingState ? 'danger' : f.suggestion ? 'human' : 'neutral'}
                      >
                        {f.mappingState ? t(`mappingState.${f.mappingState}`) : f.suggestion ? t('mappingState.suggested') : t('mappingState.none')}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Exceções por produto */}
        {dados.rootConfirmed ? (
          <div className="p-4">
            <h4 className="text-foreground text-sm font-semibold">{t('exceptionsTitle')}</h4>
            <p className="text-muted-foreground mt-1 text-xs">{t('exceptionsDescription')}</p>
            <Input
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setMostrar(POR_PAGINA);
              }}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="mt-2 h-8 text-sm"
            />
            {filtrados.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-xs">{t('noLinkedProducts')}</p>
            ) : (
              <ul className="mt-2 divide-y">
                {filtrados.slice(0, mostrar).map((p) => {
                  const idAuxiliar = `bling-aux-${p.id}`;
                  return (
                    <li key={p.id} className="grid items-center gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]">
                      <span className="min-w-0">
                        <span className="text-foreground block truncate text-sm">{p.name}</span>
                        <span className="text-muted-foreground text-2xs block truncate">
                          {[p.sku, p.family].filter(Boolean).join(' · ') || '—'}
                          {' · '}
                          {p.category
                            ? t('resolvedCategory', { label: p.category.label, source: t(`source.${p.categorySource ?? 'default'}`) })
                            : t('noCategory')}
                        </span>
                        {p.missingWeight ? (
                          <StatusBadge size="sm" variant="danger" className="mt-1">
                            {t('missingWeight')}
                          </StatusBadge>
                        ) : null}
                      </span>
                      <OptionSelect
                        value={p.exceptionCategoryId ?? ''}
                        onValueChange={(v) =>
                          void enviar(
                            `/api/bling/products/${p.id}`,
                            { method: 'PATCH', body: JSON.stringify({ revenueCategoryId: v || null }) },
                            t('saved')
                          )
                        }
                        aria-label={t('exceptionFor', { name: p.name })}
                        disabled={ocupado}
                        className="h-8 w-full text-xs"
                      >
                        <option value="">{t('noException')}</option>
                        {categoryOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </OptionSelect>
                      <label htmlFor={idAuxiliar} className="flex items-center gap-2 text-xs">
                        <Switch
                          id={idAuxiliar}
                          checked={!p.definesOrderCategory}
                          disabled={ocupado}
                          onCheckedChange={(auxiliar) =>
                            void enviar(
                              `/api/bling/products/${p.id}`,
                              { method: 'PATCH', body: JSON.stringify({ definesOrderCategory: !auxiliar }) },
                              t('saved')
                            )
                          }
                        />
                        {t('auxiliary')}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {filtrados.length > mostrar ? (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setMostrar((m) => m + POR_PAGINA)}>
                {t('showMore', { count: filtrados.length - mostrar })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
