'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, PlugZap, RefreshCw, Unplug } from 'lucide-react';

import { BlingOrdersFlag } from '@/components/settings/bling-orders-flag';
import { BlingProducts } from '@/components/settings/bling-products';
import { BlingReferences } from '@/components/settings/bling-references';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { sectionHref } from '@/components/settings/settings-sections';
import { Button, buttonVariants } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import type { BlingConnectionView } from '@/lib/bling/status';
import { cn } from '@/lib/utils';

interface Estado {
  configured: boolean;
  pending: boolean;
  connection: BlingConnectionView | null;
}

/** Os desfechos que o callback escreve em `?bling=`. */
const DESFECHOS = [
  'connected',
  'denied',
  'invalid_state',
  'not_configured',
  'duplicate',
  'exchange_failed',
  'company_failed',
  'company_mismatch',
  'company_in_use',
  'save_failed',
  'failed',
] as const;
type Desfecho = (typeof DESFECHOS)[number];

const AVISO_DE_VENCIMENTO_DIAS = 5;

/**
 * Configurações › Bling.
 *
 * Fase 1 do plano: conectar, ver o estado, testar, desconectar. Nada de
 * pedido ainda — e a tela diz isso, para ninguém procurar aqui o que só chega
 * nas próximas fases.
 *
 * ------------------------------------------------------------------
 * O QUE ELA MOSTRA, E POR QUÊ
 * ------------------------------------------------------------------
 *
 * - QUAL empresa, com CNPJ: a homologação é numa conta Bling separada (D9),
 *   e "conectado" sem dizer a qual das duas é a pergunta errada respondida.
 * - Até quando a autorização vale. O refresh token dura 30 dias, e o Bling
 *   não diz se ele se renova sozinho. A data vem de quando o refresh token
 *   ATUAL foi emitido; se ela andar depois de uma renovação, é a prova de
 *   que ele gira. Faltando cinco dias, a linha fica âmbar: alguém precisa
 *   agir.
 * - A última resposta do Bling e o último erro, já limpos de token e de dado
 *   pessoal no servidor.
 */
export function BlingPanel() {
  const t = useTranslations('Bling');
  const locale = useLocale();
  const params = useSearchParams();
  const router = useRouter();
  const { confirm } = useConfirm();

  const [estado, setEstado] = React.useState<Estado | null>(null);
  const [falhou, setFalhou] = React.useState(false);
  const [testando, setTestando] = React.useState(false);
  const [desconectando, setDesconectando] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch('/api/bling/connection');
      if (!response.ok) throw new Error(String(response.status));
      setEstado((await response.json()) as Estado);
      setFalhou(false);
    } catch {
      setFalhou(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // O desfecho do OAuth chega na URL, é mostrado uma vez e sai dela. A
  // Google deixa o parâmetro, e recarregar a página repete o aviso.
  const desfecho = params.get('bling');
  React.useEffect(() => {
    if (!desfecho) return;
    const conhecido = (DESFECHOS as readonly string[]).includes(desfecho)
      ? (desfecho as Desfecho)
      : 'failed';
    if (conhecido === 'connected') toast.success(t('outcome.connected'));
    else toast.error(t(`outcome.${conhecido}`));
    router.replace(sectionHref('bling'), { scroll: false });
  }, [desfecho, router, t]);

  const quando = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }),
    [locale]
  );
  const dia = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }),
    [locale]
  );
  const hora = (iso: string | null) => (iso ? quando.format(new Date(iso)) : t('never'));

  const testar = async () => {
    setTestando(true);
    try {
      const response = await fetch('/api/bling/connection/test', { method: 'POST' });
      const body = (await response.json()) as
        | { ok: true; company: { name: string | null } }
        | { ok: false; error: { code: string; message: string } };
      if (body.ok) {
        toast.success(t('testOk', { company: body.company.name ?? '—' }));
      } else {
        toast.error(t('testFailed', { message: body.error.message || body.error.code }));
      }
    } catch {
      toast.error(t('testFailed', { message: '—' }));
    } finally {
      setTestando(false);
      void load();
    }
  };

  const desconectar = async (company: string) => {
    const ok = await confirm({
      title: t('disconnectConfirm'),
      description: t('disconnectConfirmDesc', { company }),
      confirmLabel: t('disconnect'),
      destructive: true,
    });
    if (!ok) return;

    setDesconectando(true);
    try {
      const response = await fetch('/api/bling/connection', { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { revoked: boolean };
      if (body.revoked) toast.success(t('disconnected'));
      else toast.warning(t('disconnectedNotRevoked'));
      await load();
    } catch {
      toast.error(t('disconnectFailed'));
    } finally {
      setDesconectando(false);
    }
  };

  const cabecalho = <SettingsPanelHead title={t('title')} description={t('description')} />;

  if (falhou) {
    return (
      <div>
        {cabecalho}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
          <p className="text-danger-ink text-sm">{t('loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t('retry')}
          </Button>
        </div>
      </div>
    );
  }

  if (!estado) {
    return (
      <div>
        {cabecalho}
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </p>
      </div>
    );
  }

  if (estado.pending) {
    return (
      <div>
        {cabecalho}
        <p className="bg-muted text-muted-foreground rounded-lg p-4 text-sm">{t('pending')}</p>
      </div>
    );
  }

  const conexao = estado.connection;

  if (!conexao) {
    return (
      <div>
        {cabecalho}
        {estado.configured ? (
          <div className="space-y-3 rounded-lg border p-4">
            {/* Um `<a>` de verdade: a autorização é uma navegação de topo para
                outro domínio, e o cookie do `state` só volta se o navegador
                tratar isto como navegação (ver `calendars-panel.tsx`). */}
            <a href="/api/bling/oauth/authorize" className={buttonVariants({ className: 'gap-2' })}>
              <PlugZap className="size-4" />
              {t('connect')}
            </a>
            <p className="text-muted-foreground max-w-[62ch] text-xs">{t('connectHint')}</p>
          </div>
        ) : (
          <div className="bg-muted space-y-1 rounded-lg p-4">
            <p className="text-foreground text-sm font-medium">{t('notConfigured')}</p>
            <p className="text-muted-foreground max-w-[62ch] text-xs">{t('notConfiguredHint')}</p>
          </div>
        )}
      </div>
    );
  }

  const venceEm = Date.parse(conexao.refreshExpiresAt);
  const diasRestantes = Number.isNaN(venceEm)
    ? null
    : Math.floor((venceEm - Date.now()) / 86_400_000);
  const vencendo = diasRestantes !== null && diasRestantes <= AVISO_DE_VENCIMENTO_DIAS;
  const empresa = conexao.companyName ?? t('companyUnknown');

  return (
    <div>
      {cabecalho}
      <section className="bg-card rounded-lg border">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">{t('company')}</p>
            <p className="text-foreground truncate text-base font-semibold">{empresa}</p>
            {conexao.companyCnpj ? (
              <p className="text-muted-foreground text-xs tabular-nums">
                {t('cnpj', { cnpj: conexao.companyCnpj })}
              </p>
            ) : null}
          </div>
          {/* Revogada é âmbar e não vermelha: não quebrou nada, alguém
              precisa reconectar. Vermelho é para as renovações falhando. */}
          <StatusBadge
            variant={
              conexao.status === 'connected'
                ? 'ok'
                : conexao.status === 'revoked'
                  ? 'human'
                  : 'danger'
            }
          >
            {t(`status.${conexao.status}`)}
          </StatusBadge>
        </div>

        {conexao.status !== 'connected' ? (
          <div
            className={cn(
              'mx-4 mb-4 rounded-md px-3 py-2 text-xs',
              conexao.status === 'revoked'
                ? 'bg-human-soft text-human-ink'
                : 'bg-danger-soft text-danger-ink'
            )}
          >
            <p className="font-medium">{t(`statusHint.${conexao.status}`)}</p>
            {conexao.lastError ? <p className="mt-1 break-words">{conexao.lastError}</p> : null}
          </div>
        ) : null}

        <dl className="grid gap-x-6 gap-y-3 border-t p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t('connectedBy')}</dt>
            <dd className="text-foreground">
              {conexao.connectedByName ?? t('unknownPerson')}
              <span className="text-muted-foreground"> · {hora(conexao.connectedAt)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('lastSuccess')}</dt>
            <dd className="text-foreground tabular-nums">{hora(conexao.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('authorizationUntil')}</dt>
            <dd className={cn('tabular-nums', vencendo ? 'text-human-ink font-medium' : 'text-foreground')}>
              {Number.isNaN(venceEm) ? '—' : dia.format(new Date(venceEm))}
            </dd>
            <dd className="text-muted-foreground text-2xs">
              {t('authorizationIssued', { when: hora(conexao.refreshIssuedAt) })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('accessUntil')}</dt>
            <dd className="text-foreground tabular-nums">{hora(conexao.accessExpiresAt)}</dd>
            <dd className="text-muted-foreground text-2xs">{t('accessUntilHint')}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('scopes')}</dt>
            <dd className="text-foreground">{t('scopeCount', { count: conexao.scopeCount })}</dd>
          </div>
          {conexao.status === 'connected' && conexao.lastError ? (
            <div>
              <dt className="text-muted-foreground text-xs">{t('lastError')}</dt>
              <dd className="text-foreground break-words">{conexao.lastError}</dd>
              <dd className="text-muted-foreground text-2xs tabular-nums">{hora(conexao.lastErrorAt)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-wrap items-center gap-2 border-t p-4">
          {conexao.status === 'connected' || conexao.status === 'error' ? (
            <Button variant="outline" size="sm" onClick={testar} disabled={testando}>
              <RefreshCw className={cn('size-4', testando && 'animate-spin')} />
              {t('test')}
            </Button>
          ) : null}
          {conexao.status !== 'connected' || vencendo ? (
            <a
              href="/api/bling/oauth/authorize"
              className={buttonVariants({ size: 'sm', className: 'gap-2' })}
            >
              <PlugZap className="size-4" />
              {t('reconnect')}
            </a>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void desconectar(empresa)}
            disabled={desconectando}
          >
            <Unplug className="size-4" />
            {t('disconnect')}
          </Button>
        </div>
      </section>
      {conexao.status !== 'revoked' ? (
        <>
          <BlingReferences />
          <BlingProducts />
          <BlingOrdersFlag />
        </>
      ) : null}
    </div>
  );
}
