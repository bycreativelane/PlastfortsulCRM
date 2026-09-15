'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * "PEDIDOS NO BLING" — a chave geral (086, Fase 7).
 *
 * Desligada, o CRM só LÊ do Bling: cadastros e produtos. Ligada, "Registrar no
 * Bling" aparece na oportunidade e o envio do orçamento cria o pedido (D2).
 * A frase de cima diz o efeito antes do clique; ligar pede confirmação.
 */

interface Resposta {
  state: 'ok' | 'pending';
  enabled?: boolean;
  blockers?: string[];
  health?: {
    lastWebhookAt: string | null;
    lastReconcileAt: string | null;
    webhookSilent: boolean;
    revoked: boolean;
    failing: boolean;
    stuckOperations: number;
    failedOperations24h: number;
  };
}

export function BlingOrdersFlag() {
  const t = useTranslations('Bling.orders');
  const { confirm } = useConfirm();
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [versao, setVersao] = React.useState(0);
  const [gravando, setGravando] = React.useState(false);

  React.useEffect(() => {
    let cancelado = false;
    (async () => {
      const res = await fetch('/api/bling/orders-enabled', { cache: 'no-store' }).catch(() => null);
      const corpo = res && res.ok ? ((await res.json().catch(() => null)) as Resposta | null) : null;
      if (!cancelado) setDados(corpo);
    })();
    return () => {
      cancelado = true;
    };
  }, [versao]);

  if (!dados || dados.state !== 'ok') return null;
  const ligado = dados.enabled === true;
  const bloqueios = dados.blockers ?? [];

  async function mudar(enabled: boolean) {
    if (
      enabled &&
      !(await confirm({
        title: t('confirmEnableTitle'),
        description: t('confirmEnable'),
        confirmLabel: t('turnOn'),
      }))
    ) {
      return;
    }
    setGravando(true);
    const res = await fetch('/api/bling/orders-enabled', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    setGravando(false);
    if (!res || !res.ok) {
      const corpo = (await res?.json().catch(() => null)) as { error?: string } | null;
      toast.error(corpo?.error === 'not_ready' ? t('notReady') : t('saveFailed'));
      return;
    }
    toast.success(enabled ? t('enabled') : t('disabled'));
    setVersao((v) => v + 1);
  }

  return (
    <section className="bg-card mt-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Send className="text-primary size-4" />
            {t('title')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{ligado ? t('onHint') : t('offHint')}</p>
        </div>
        <StatusBadge variant={ligado ? 'ok' : 'neutral'}>{ligado ? t('on') : t('off')}</StatusBadge>
      </div>
      {/* OS ALERTAS DE SAÚDE (Fase 6) — o roteiro de cada um está em
          docs/operacao-bling.md. */}
      {ligado && dados.health && (
        <div className="mt-3 grid gap-1.5 text-xs">
          {dados.health.revoked && <p className="bg-danger-soft text-danger-ink rounded-md px-2.5 py-1.5">{t('alerts.revoked')}</p>}
          {dados.health.webhookSilent && (
            <p className="bg-human-soft text-human-ink rounded-md px-2.5 py-1.5">{t('alerts.webhookSilent')}</p>
          )}
          {dados.health.failing && <p className="bg-danger-soft text-danger-ink rounded-md px-2.5 py-1.5">{t('alerts.failing')}</p>}
          {dados.health.stuckOperations > 0 && (
            <p className="bg-human-soft text-human-ink rounded-md px-2.5 py-1.5">
              {t('alerts.stuck', { count: dados.health.stuckOperations })}
            </p>
          )}
          {dados.health.failedOperations24h > 0 && (
            <p className="bg-danger-soft text-danger-ink rounded-md px-2.5 py-1.5">
              {t('alerts.failed', { count: dados.health.failedOperations24h })}
            </p>
          )}
          <p className="text-muted-foreground">
            {t('lastWebhook', {
              when: dados.health.lastWebhookAt ? new Date(dados.health.lastWebhookAt).toLocaleString() : t('never'),
            })}
            {' · '}
            {t('lastReconcile', {
              when: dados.health.lastReconcileAt ? new Date(dados.health.lastReconcileAt).toLocaleString() : t('never'),
            })}
          </p>
        </div>
      )}
      {!ligado && bloqueios.length > 0 && (
        <ul className="text-human-ink mt-3 list-disc space-y-0.5 pl-5 text-xs">
          {bloqueios.map((b) => (
            <li key={b}>{t(`blockers.${b}`)}</li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        {ligado ? (
          <Button variant="outline" size="sm" disabled={gravando} onClick={() => void mudar(false)}>
            {t('turnOff')}
          </Button>
        ) : (
          <Button size="sm" disabled={gravando || bloqueios.length > 0} onClick={() => void mudar(true)}>
            {t('turnOn')}
          </Button>
        )}
      </div>
    </section>
  );
}
