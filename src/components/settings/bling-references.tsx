'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { OptionSelect } from '@/components/ui/option-select';
import { StatusBadge } from '@/components/ui/status-badge';
import type { CheckState, HealthReport, RoleCheck, StatusRole } from '@/lib/bling/health';
import { nextPaymentMethodIds, STATUS_ROLES } from '@/lib/bling/health';
import type { ReferenceOptions } from '@/lib/bling/settings';
import { cn } from '@/lib/utils';

interface Resposta {
  connected: boolean;
  pending: number | null;
  connectionStatus?: 'connected' | 'revoked' | 'error';
  job?: {
    status: 'running' | 'ok' | 'partial' | 'error';
    running: boolean;
    finished_at: string | null;
    last_success_at: string | null;
    error: string | null;
    stats: Record<string, { count?: number; error?: { code: string; message: string } } | unknown>;
  } | null;
  counts?: Record<string, number>;
  health?: HealthReport;
  options?: ReferenceOptions;
}

const VARIANTE: Record<CheckState, 'ok' | 'human' | 'danger' | 'neutral'> = {
  ok: 'ok',
  unconfirmed: 'human',
  missing: 'danger',
  inactive: 'danger',
  removed: 'danger',
  incompatible: 'danger',
};

/**
 * Configurações › Bling › Cadastros: a sincronização e a matriz de saúde.
 *
 * Fica logo abaixo da conexão, porque é a pergunta seguinte: conectou — o
 * Bling tem o que o pedido vai precisar? Cada papel mostra a sugestão pelo
 * nome e só fica verde quando um admin confirma (ver `lib/bling/health.ts`).
 *
 * Âmbar é "alguém precisa confirmar"; vermelho é "confirmado, mas não serve
 * mais" (removido, inativo, forma que não recebe).
 */
export function BlingReferences() {
  const t = useTranslations('Bling.references');
  const locale = useLocale();
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [falhou, setFalhou] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const quando = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }),
    [locale]
  );

  const load = React.useCallback(async () => {
    try {
      const response = await fetch('/api/bling/references');
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

  // Enquanto sincroniza, a tela pergunta de três em três segundos. Parar
  // quando termina é o que evita uma aba esquecida batendo na rota o dia todo.
  const rodando = Boolean(dados?.job?.running);
  React.useEffect(() => {
    if (!rodando) return;
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [rodando, load]);

  const sincronizar = async () => {
    const response = await fetch('/api/bling/references/sync', { method: 'POST' });
    if (response.status === 202) {
      toast.success(t('syncStarted'));
    } else {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'running') toast.info(t('syncBusy'));
      else toast.error(t('syncFailed'));
    }
    void load();
  };

  const salvar = async (patch: Record<string, unknown>) => {
    setSalvando(true);
    try {
      const response = await fetch('/api/bling/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(String(response.status));
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSalvando(false);
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
        {t('pending', { migration: dados.pending })}
      </section>
    );
  }

  const { job, health, options } = dados;
  if (!health || !options) return null;

  const nuncaSincronizou = !job?.last_success_at && !rodando;
  const errosPorTipo = Object.entries(job?.stats ?? {}).flatMap(([kind, valor]) => {
    const erro = (valor as { error?: { message: string } })?.error;
    return erro ? [{ kind, message: erro.message }] : [];
  });

  const sugestoes: Record<string, string> = {};
  if (health.orderModule.state === 'unconfirmed' && health.orderModule.suggestion) {
    sugestoes.order_module_id = health.orderModule.suggestion.id;
  }
  for (const role of STATUS_ROLES) {
    const check = health.statuses[role];
    if (check.state === 'unconfirmed' && check.suggestion) sugestoes[`status_${role}_id`] = check.suggestion.id;
  }
  if (health.revenueRoot.state === 'unconfirmed' && health.revenueRoot.suggestion) {
    sugestoes.revenue_root_category_id = health.revenueRoot.suggestion.id;
  }
  const quantasSugestoes = Object.keys(sugestoes).length;

  const linhaDePapel = (rotulo: string, campo: string, check: RoleCheck, opcoes: { id: string; label: string }[]) => (
    <div key={campo} className="grid items-center gap-2 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
      <span className="text-foreground text-sm">{rotulo}</span>
      <div className="min-w-0">
        <OptionSelect
          value={check.confirmed?.id ?? ''}
          onValueChange={(valor) => void salvar({ [campo]: valor || null })}
          disabled={salvando || rodando}
          aria-label={rotulo}
          className="h-8 w-full text-xs"
        >
          <option value="">{t('choose')}</option>
          {/* Confirmado e depois removido (ou desativado) no Bling: sem esta
              opção o seletor desenhava o id cru. */}
          {check.confirmed && !opcoes.some((o) => o.id === check.confirmed?.id) ? (
            <option value={check.confirmed.id}>
              {t('removedOption', { label: check.confirmed.label })}
            </option>
          ) : null}
          {opcoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </OptionSelect>
        {check.state === 'unconfirmed' && check.suggestion ? (
          <p className="text-muted-foreground text-2xs mt-1">
            {t('suggestion', { label: check.suggestion.label })}
          </p>
        ) : null}
      </div>
      <StatusBadge variant={VARIANTE[check.state]} size="sm">
        {t(`state.${check.state}`)}
      </StatusBadge>
    </div>
  );

  const formasLiberadas = new Set(health.paymentMethods.map((p) => p.id));
  /*
   * AS FORMAS QUE SUMIRAM DO BLING. Confirmadas antes, sem opção na lista:
   * a caixa delas não existia, então não dava para desmarcar — e a matriz
   * nunca ficava verde. E cada clique em outra forma regravava o id morto.
   * Aparecem marcadas, para desmarcar, e nenhuma gravação as carrega.
   */
  const formasVivas = new Set(options.paymentMethods.map((f) => f.id));
  const formasRemovidas = health.paymentMethods.filter((p) => !formasVivas.has(p.id));
  const gravarFormas = (id: string, marcar: boolean) =>
    void salvar({
      payment_method_ids: nextPaymentMethodIds({
        confirmed: [...formasLiberadas],
        alive: formasVivas,
        id,
        checked: marcar,
      }),
    });

  return (
    <section className="bg-card mt-6 rounded-lg border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h3 className="text-foreground text-base font-semibold">{t('title')}</h3>
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-xs">{t('description')}</p>
          <p className="text-muted-foreground text-2xs mt-2 tabular-nums">
            {rodando
              ? t('syncing')
              : job?.last_success_at
                ? t('lastSync', { when: quando.format(new Date(job.last_success_at)) })
                : t('neverSynced')}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge variant={health.green ? 'ok' : 'human'}>
            {health.green ? t('green') : t('pendingItems', { count: health.pending })}
          </StatusBadge>
          <Button variant="outline" size="sm" onClick={() => void sincronizar()} disabled={rodando}>
            <RefreshCw className={cn('size-4', rodando && 'animate-spin')} />
            {t('syncNow')}
          </Button>
        </div>
      </header>

      {job?.status === 'error' && job.error ? (
        <p className="bg-danger-soft text-danger-ink mx-4 mt-4 rounded-md px-3 py-2 text-xs">
          {t('syncError', { message: job.error })}
        </p>
      ) : null}
      {errosPorTipo.length > 0 ? (
        <div className="bg-human-soft text-human-ink mx-4 mt-4 rounded-md px-3 py-2 text-xs">
          <p className="font-medium">{t('kindErrors')}</p>
          <ul className="mt-1 space-y-0.5">
            {errosPorTipo.map((e) => (
              <li key={e.kind}>
                {t(`kinds.${e.kind}`)}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {health.settingsFromOtherCompany ? (
        <p className="bg-human-soft text-human-ink mx-4 mt-4 rounded-md px-3 py-2 text-xs">
          {t('otherCompany')}
        </p>
      ) : null}

      {nuncaSincronizou ? (
        <p className="text-muted-foreground p-4 text-sm">{t('syncFirst')}</p>
      ) : (
        <div className="divide-y">
          {/* Situações */}
          <div className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-foreground text-sm font-semibold">{t('statusesTitle')}</h4>
              {quantasSugestoes > 0 ? (
                <Button size="sm" variant="outline" disabled={salvando} onClick={() => void salvar(sugestoes)}>
                  {t('confirmSuggestions', { count: quantasSugestoes })}
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">{t('statusesDescription')}</p>
            <div className="mt-2 divide-y">
              {linhaDePapel(t('orderModule'), 'order_module_id', health.orderModule, options.orderModules)}
              {STATUS_ROLES.map((role: StatusRole) =>
                linhaDePapel(t(`roles.${role}`), `status_${role}_id`, health.statuses[role], options.statuses)
              )}
            </div>
          </div>

          {/* Transições */}
          <div className="p-4">
            <h4 className="text-foreground text-sm font-semibold">{t('transitionsTitle')}</h4>
            <ul className="mt-2 divide-y">
              {health.transitions.map((tr) => (
                <li key={`${tr.from}-${tr.to}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-foreground text-sm">
                      {t(`roles.${tr.from}`)} → {t(`roles.${tr.to}`)}
                    </p>
                    <p className="text-muted-foreground text-2xs">
                      {tr.actions.length ? tr.actions.join(' · ') : t('noActions')}
                    </p>
                  </div>
                  <StatusBadge
                    size="sm"
                    variant={tr.state === 'ok' ? 'ok' : tr.state === 'unmapped' ? 'human' : 'danger'}
                  >
                    {t(`transitionState.${tr.state}`)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-2xs mt-2">{t('actionsNote')}</p>
          </div>

          {/* Categoria de receita */}
          <div className="p-4">
            <h4 className="text-foreground text-sm font-semibold">{t('revenueTitle')}</h4>
            <p className="text-muted-foreground mt-1 text-xs">{t('revenueDescription')}</p>
            <div className="mt-2">
              {linhaDePapel(t('revenueRoot'), 'revenue_root_category_id', health.revenueRoot, options.revenueRoots)}
            </div>
            {health.revenueCategories.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {health.revenueCategories.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-xs" style={{ paddingLeft: `${(c.depth - 1) * 16}px` }}>
                    <span className="text-foreground min-w-0 truncate">{c.label}</span>
                    <StatusBadge size="sm" variant={c.state === 'ok' ? 'ok' : 'danger'}>
                      {t(`state.${c.state}`)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            ) : health.revenueRoot.state === 'ok' ? (
              <p className="text-danger-ink mt-2 text-xs">{t('noChildren')}</p>
            ) : null}
          </div>

          {/* Formas de pagamento */}
          <div className="p-4">
            <h4 className="text-foreground text-sm font-semibold">{t('paymentsTitle')}</h4>
            <p className="text-muted-foreground mt-1 text-xs">{t('paymentsDescription')}</p>
            {options.paymentMethods.length === 0 && formasRemovidas.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-xs">{t('noPayments')}</p>
            ) : (
              <ul className="mt-2 divide-y">
                {formasRemovidas.map((forma) => {
                  const inputId = `bling-forma-removida-${forma.id}`;
                  return (
                    <li key={forma.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <label htmlFor={inputId} className="flex min-w-0 items-center gap-2 text-sm">
                        <Checkbox
                          id={inputId}
                          checked
                          disabled={salvando || rodando}
                          onCheckedChange={() => gravarFormas(forma.id, false)}
                        />
                        <span className="min-w-0">
                          <span className="text-foreground block truncate">{forma.label}</span>
                          <span className="text-muted-foreground text-2xs block">{t('paymentRemovedHint')}</span>
                        </span>
                      </label>
                      <StatusBadge size="sm" variant="danger">
                        {t(`state.${forma.state}`)}
                      </StatusBadge>
                    </li>
                  );
                })}
                {options.paymentMethods.map((forma) => {
                  const marcada = formasLiberadas.has(forma.id);
                  const check = health.paymentMethods.find((p) => p.id === forma.id);
                  const inputId = `bling-forma-${forma.id}`;
                  return (
                    <li key={forma.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <label htmlFor={inputId} className="flex min-w-0 items-center gap-2 text-sm">
                        <Checkbox
                          id={inputId}
                          checked={marcada}
                          disabled={salvando || rodando}
                          onCheckedChange={(valor) => gravarFormas(forma.id, valor === true)}
                        />
                        <span className="min-w-0">
                          <span className="text-foreground block truncate">{forma.label}</span>
                          <span className="text-muted-foreground text-2xs block">
                            {forma.destination ? t(`destination.${forma.destination}`) : t('destinationUnknown')}
                            {' · '}
                            {forma.purpose ? t(`purpose.${forma.purpose}`) : '—'}
                            {forma.active ? '' : ` · ${t('state.inactive')}`}
                          </span>
                        </span>
                      </label>
                      {check ? (
                        <StatusBadge size="sm" variant={check.state === 'ok' ? 'ok' : 'danger'}>
                          {t(`state.${check.state}`)}
                        </StatusBadge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* O resto */}
          <div className="grid gap-2 p-4 text-xs sm:grid-cols-2">
            <p className="text-foreground">{t('sellers', { count: health.counts.sellers })}</p>
            <p className="text-foreground">{t('warehouses', { count: health.counts.warehouses })}</p>
            <p className="text-foreground">{t('logistics', { count: health.counts.logistics })}</p>
            <p className={health.customerContactType ? 'text-ok-ink' : 'text-danger-ink'}>
              {health.customerContactType ? t('customerTypeOk') : t('customerTypeMissing')}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
