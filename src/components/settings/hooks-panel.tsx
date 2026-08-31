'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Plus,
  Trash2,
  Webhook,
} from 'lucide-react';

import { dateLocale } from '@/lib/i18n/dates';
import { formatDistanceToNow } from 'date-fns';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { Switch } from '@/components/ui/switch';
import { HookDeliveries } from '@/components/settings/hook-deliveries';
import { cn } from '@/lib/utils';

/**
 * The doors Typebot, n8n and a landing page knock on.
 *
 * ------------------------------------------------------------------
 * THE SCREEN'S JOB IS TO MAKE THE DANGEROUS CHOICE VISIBLE
 * ------------------------------------------------------------------
 *
 * Creating a hook is two fields. What deserves the space is the ONE
 * switch that changes what a leaked URL can do: whether this hook may
 * make the account's WhatsApp number send messages. Off by default, and
 * turning it on says out loud what it costs — because the failure it
 * guards against is not a data leak, it is the number getting banned by
 * Meta, and nobody reads that consequence off the word "messages".
 *
 * The IP list sits next to it, framed as what it is: the cheapest lock,
 * free when both ends are self-hosted, and useless against the sender's
 * own runaway loop — which is why it is not presented as the answer.
 */

interface Hook {
  id: string;
  name: string;
  token_hint: string | null;
  scopes: string[];
  allowed_ips: string[];
  enabled: boolean;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

export function HooksPanel() {
  const t = useTranslations('Settings.hooks');
  /**
   * `t.raw`, not `t`. The copy names the template syntax literally —
   * `{{vars.campo}}` — and next-intl parses `{` as an ICU placeholder,
   * so a plain `t()` renders the keypath instead of the sentence. The
   * `icu-safety` test catches this; it caught this one.
   */
  const description = t.raw('description') as string;
  const { confirm } = useConfirm();

  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [allowMessages, setAllowMessages] = useState(false);
  const [ips, setIps] = useState('');

  /**
   * The plaintext token, held for exactly as long as this screen is
   * open. It is never stored and there is no endpoint that can return
   * it again — the panel below says so, because somebody who closes
   * this card without copying has to create another hook.
   */
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  /**
   * Which hook's deliveries are open. One at a time: the panel fetches
   * on mount, and expanding three would be three requests for a screen
   * where somebody is looking at one integration.
   */
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/account/hooks');
    if (!res.ok) return { hooks: [] as Hook[], pending: false };
    const json = (await res.json()) as { hooks: Hook[]; pending?: boolean };
    return { hooks: json.hooks ?? [], pending: json.pending === true };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      setHooks(result.hooks);
      setPending(result.pending);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/account/hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          scopes: allowMessages ? ['data', 'messages'] : ['data'],
          allowed_ips: ips
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { hook: Hook; token: string };
      setHooks((prev) => [json.hook, ...prev]);
      setFresh({ id: json.hook.id, token: json.token });
      setName('');
      setIps('');
      setAllowMessages(false);
    } catch {
      toast.error(t('createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function patch(hook: Hook, body: Record<string, unknown>) {
    setBusyId(hook.id);
    try {
      const res = await fetch(`/api/account/hooks/${hook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { hook: Hook };
      setHooks((prev) => prev.map((h) => (h.id === hook.id ? json.hook : h)));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(hook: Hook) {
    if (
      !(await confirm({
        title: t('revokeConfirm', { name: hook.name }),
        description: t('revokeConfirmDesc'),
        destructive: true,
      }))
    ) {
      return;
    }
    setBusyId(hook.id);
    try {
      const res = await fetch(`/api/account/hooks/${hook.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(String(res.status));
      setHooks((prev) => prev.filter((h) => h.id !== hook.id));
      if (fresh?.id === hook.id) setFresh(null);
      toast.success(t('revoked'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SettingsPanelHead title={t('title')} description={description} />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (pending) {
    return (
      <div className="space-y-4">
        <SettingsPanelHead title={t('title')} description={description} />
        <StatePanel
          icon={Webhook}
          title={t('pending')}
          description={t('pendingHint')}
        />
      </div>
    );
  }

  const url = fresh ? `${window.location.origin}/api/hooks/${fresh.token}` : '';

  return (
    <div className="space-y-4">
      <SettingsPanelHead title={t('title')} description={description} />

      {/* The token, once. Above everything else while it is on screen,
          because it is the only thing here that cannot be recovered. */}
      {fresh && (
        <Panel className="border-primary">
          <PanelHeader>
            <PanelTitle>{t('tokenTitle')}</PanelTitle>
            <PanelSub>{t('tokenOnce')}</PanelSub>
          </PanelHeader>
          <PanelBody className="space-y-2">
            <code className="bg-card-2 border-border block overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs break-all">
              {url}
            </code>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFresh(null)}>
                {t('tokenDone')}
              </Button>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {t('copy')}
              </Button>
            </div>
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader>
          <PanelTitle>{t('newTitle')}</PanelTitle>
          <PanelSub>{t('newDesc')}</PanelSub>
        </PanelHeader>
        <PanelBody className="space-y-3">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="hook-name">{t('nameLabel')}</FieldLabel>
            <Input
              id="hook-name"
              value={name}
              maxLength={60}
              placeholder={t('namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="hook-ips">{t('ipsLabel')}</FieldLabel>
            <Input
              id="hook-ips"
              value={ips}
              placeholder="187.1.2.3, 10.0.0.4"
              onChange={(e) => setIps(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t('ipsHint')}</p>
          </div>

          {/* THE SWITCH THAT MATTERS. */}
          <div
            className={cn(
              'rounded-lg border p-3 transition-colors',
              allowMessages
                ? 'border-human-strong bg-human-soft'
                : 'border-border'
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">
                  {t('messagesTitle')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('messagesDesc')}
                </p>
              </div>
              <Switch
                checked={allowMessages}
                onCheckedChange={setAllowMessages}
                aria-label={t('messagesTitle')}
              />
            </div>
            {allowMessages && (
              <p className="text-human-ink mt-2 flex items-start gap-1.5 text-xs">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>{t('messagesWarning')}</span>
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={create} disabled={creating || !name.trim()}>
              {creating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {t('create')}
            </Button>
          </div>
        </PanelBody>
      </Panel>

      {hooks.length > 0 && (
        <Panel>
          <PanelHeader>
            <PanelTitle>{t('listTitle')}</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-2">
            {hooks.map((hook) => (
              <div key={hook.id} className="border-border rounded-lg border">
                <div className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {hook.name}
                  </p>
                  <p className="text-muted-foreground truncate font-mono text-2xs">
                    {hook.token_hint}…
                  </p>
                  <p className="text-muted-foreground mt-1 text-2xs">
                    {/* "Nunca usado" is the answer to "did I paste the
                        right URL?", and it is the first thing somebody
                        looks for when an integration is quiet. */}
                    {hook.last_used_at
                      ? t('lastUsed', {
                          when: formatDistanceToNow(
                            new Date(hook.last_used_at),
                            { addSuffix: true, locale: dateLocale }
                          ),
                        })
                      : t('neverUsed')}
                    {hook.allowed_ips.length > 0
                      ? ` · ${t('ipCount', { count: hook.allowed_ips.length })}`
                      : ` · ${t('anyIp')}`}
                  </p>
                </div>

                {hook.scopes.includes('messages') && (
                  <span className="bg-human-soft text-human-ink rounded-full px-2 py-0.5 text-2xs font-semibold">
                    {t('canSend')}
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <Switch
                    checked={hook.enabled}
                    disabled={busyId === hook.id}
                    onCheckedChange={(v) => patch(hook, { enabled: v })}
                    aria-label={t('enabled')}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={busyId === hook.id}
                    onClick={() => revoke(hook)}
                    aria-label={t('revoke')}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  </div>
                </div>

                {/* The log, behind a click. It is what somebody opens
                    when an integration is quiet — not something to
                    render for every hook on every visit. */}
                <div className="border-border border-t px-3 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setOpenDeliveries(
                        openDeliveries === hook.id ? null : hook.id
                      )
                    }
                  >
                    {openDeliveries === hook.id
                      ? t('hideDeliveries')
                      : t('showDeliveries')}
                  </Button>
                  {openDeliveries === hook.id && (
                    <div className="mt-2">
                      <HookDeliveries hookId={hook.id} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
