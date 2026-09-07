'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarClock, RefreshCw, Unplug } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Connection {
  id: string;
  provider_email: string;
  status: 'connected' | 'revoked' | 'error';
  last_error: string | null;
  connected_at: string;
}

interface Source {
  id: string;
  external_id: string;
  summary: string | null;
  color: string | null;
  is_primary: boolean;
  direction: 'in' | 'out' | 'both';
  enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
}

/**
 * Configurações › Agendas.
 *
 * Uma conexão, a da empresa (§D0), e a lista de agendas dela com o que cada
 * uma faz. Quem conecta escolhe em nome de todo mundo, por isso a tela
 * inteira é de admin — e por isso ela diz de QUAL conta Google está falando,
 * em vez de só dizer "conectado".
 *
 * ------------------------------------------------------------------
 * A DIREÇÃO É POR AGENDA, E COMEÇA EM "SÓ LER"
 * ------------------------------------------------------------------
 *
 * Uma conta Google traz feriados, aniversários e agendas compartilhadas de
 * colegas. Importar tudo por padrão enche a agenda do CRM de ruído no
 * primeiro minuto, e escrever em tudo por padrão publica compromissos da
 * empresa na agenda pessoal de alguém sem que essa pessoa tenha pedido.
 * Então: só a principal já vem habilitada, e nenhuma vem publicando.
 */
export function CalendarsPanel() {
  const t = useTranslations('Calendars');
  const params = useSearchParams();

  const [connection, setConnection] = React.useState<Connection | null>(null);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [connRes, srcRes] = await Promise.all([
        fetch('/api/calendar/connections'),
        fetch('/api/calendar/sources'),
      ]);
      const conn = (await connRes.json()) as { connection: Connection | null };
      const src = (await srcRes.json()) as { sources: Source[] };
      setConnection(conn.connection ?? null);
      setSources(src.sources ?? []);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // O callback do OAuth volta com o desfecho na URL — é a única forma de o
  // servidor falar com esta tela depois de uma navegação de topo para fora
  // do app e de volta.
  const outcome = params.get('calendar');
  React.useEffect(() => {
    if (!outcome) return;
    if (outcome === 'connected') toast.success(t('connected'));
    else toast.error(t(`error.${outcome}`));
  }, [outcome, t]);

  const patchSource = async (id: string, patch: Partial<Source>) => {
    // Otimista: a lista muda antes da resposta. Uma chavinha que espera a
    // rede parece quebrada mesmo quando funciona.
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
    const response = await fetch('/api/calendar/sources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!response.ok) {
      toast.error(t('saveFailed'));
      void load();
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/calendar/sync', { method: 'POST' });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as {
        imported: number;
        failed: number;
      };
      if (result.failed > 0) toast.warning(t('syncPartial', result));
      else toast.success(t('syncDone', { count: result.imported }));
      void load();
    } catch {
      toast.error(t('syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    const response = await fetch('/api/calendar/connections', {
      method: 'DELETE',
    });
    if (response.ok) {
      toast.success(t('disconnected'));
      setConnection(null);
      setSources([]);
    } else {
      toast.error(t('disconnectFailed'));
    }
  };

  if (loading) {
    return <p className="text-muted-foreground p-4 text-sm">{t('loading')}</p>;
  }

  if (!connection) {
    return (
      <section className="space-y-4 p-4">
        <header className="space-y-1">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </header>
        {/*
          Um `<a>` de verdade, e não um `fetch`: a autorização é uma
          navegação de topo para outro domínio, e o cookie do `state` só
          sobrevive à volta se o navegador tratar isto como navegação. Um
          botão que buscasse a rota devolveria o HTML do consentimento da
          Google dentro de uma resposta que ninguém consegue mostrar.
        */}
        <a
          href="/api/calendar/google/authorize"
          className={buttonVariants({ className: 'gap-2' })}
        >
          <CalendarClock className="size-4" />
          {t('connect')}
        </a>
        <p className="text-muted-foreground text-xs">{t('connectHint')}</p>
      </section>
    );
  }

  return (
    <section className="space-y-5 p-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-muted-foreground text-sm">
          {t('connectedTo', { email: connection.provider_email })}
        </p>
        {connection.status !== 'connected' ? (
          <p className="text-danger-ink bg-danger-soft rounded-md px-2 py-1 text-xs">
            {t(`status.${connection.status}`)}
            {connection.last_error ? ` — ${connection.last_error}` : ''}
          </p>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
          <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
          {t('syncNow')}
        </Button>
        <Button variant="ghost" size="sm" onClick={disconnect}>
          <Unplug className="size-4" />
          {t('disconnect')}
        </Button>
      </div>

      <div className="divide-y rounded-lg border">
        {sources.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">{t('noSources')}</p>
        ) : (
          sources.map((source) => (
            <div key={source.id} className="flex flex-wrap items-center gap-3 p-3">
              <span
                className="size-3 shrink-0 rounded-full border"
                style={{ background: source.color ?? 'transparent' }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {source.summary || source.external_id}
                  {source.is_primary ? (
                    <span className="text-muted-foreground ml-2 text-2xs">
                      {t('primary')}
                    </span>
                  ) : null}
                </p>
                {source.last_error ? (
                  <p className="text-danger-ink text-2xs">{source.last_error}</p>
                ) : null}
              </div>

              <select
                value={source.direction}
                onChange={(e) =>
                  patchSource(source.id, {
                    direction: e.target.value as Source['direction'],
                  })
                }
                aria-label={t('directionLabel')}
                disabled={!source.enabled}
                className="border-input bg-background h-8 rounded-md border px-2 text-xs disabled:opacity-50"
              >
                <option value="in">{t('direction.in')}</option>
                <option value="out">{t('direction.out')}</option>
                <option value="both">{t('direction.both')}</option>
              </select>

              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={source.enabled}
                  onChange={(e) =>
                    patchSource(source.id, { enabled: e.target.checked })
                  }
                />
                {t('enabled')}
              </label>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
