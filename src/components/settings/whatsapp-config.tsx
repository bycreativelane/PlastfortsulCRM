'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import {
  Panel,
  PanelHeader,
  PanelTitle,
  PanelSub,
  PanelBody,
} from '@/components/ui/panel';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';
import { APP_LOCALE } from '@/lib/i18n/locale';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

export function WhatsAppConfig() {
  const t = useTranslations('Settings.whatsapp');
  const supabase = createClient();
  // After multi-user, whatsapp_config is one-row-per-account, not
  // one-row-per-user. We pull `accountId` straight off the auth
  // context and key every read off it — so a teammate who just
  // joined an account sees the inviter's saved config without
  // having to re-enter anything.
  const {
    user,
    accountId,
    loading: authLoading,
    profileLoading,
    canEditSettings,
  } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  // Guards against re-hydrating the form when the load effect below
  // re-runs for reasons unrelated to actually switching accounts —
  // e.g. Supabase's onAuthStateChange fires a token refresh (new
  // `user` object, profileLoading flips true/false) when the browser
  // tab regains focus. Without this, that churn calls fetchConfig()
  // again and overwrites whatever the user typed but hadn't saved yet.
  const loadedAccountIdRef = useRef<string | null>(null);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  // Inbound-media mirror (issue #466). Unlike everything else on this
  // page it is NOT part of handleSave: that path insists on re-entering
  // the access token so it can re-verify with Meta, which is a silly
  // toll to pay for flipping a boolean. The switch writes straight to
  // the row instead — RLS (migration 017) restricts whatsapp_config
  // UPDATE to admins, hence the canEditSettings gate below; without it
  // a viewer's toggle would match zero rows and appear to work.
  const [mirrorMedia, setMirrorMedia] = useState(true);
  const [savingMirror, setSavingMirror] = useState(false);

  // True once /register has succeeded on Meta's side (timestamp set
  // in the row). When false, the saved config is metadata-only and
  // Meta will silently drop every inbound event — that's the
  // multi-number bug that prompted this work.
  const isRegistered = Boolean(config?.registered_at);
  const lastRegistrationError = config?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    errors?: string[];
    last_registration_error?: string | null;
    registered_at?: string | null;
    subscribed_apps_at?: string | null;
  };
  const [registrationProbe, setRegistrationProbe] =
    useState<RegistrationProbe | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfig = useCallback(
    async (acctId: string) => {
      setLoading(true);
      try {
        // Load form values from Supabase (shows what's in DB).
        // Switched from `user_id` (which would only match the row's
        // original author) to `account_id` so every member of the
        // account sees the same saved configuration. UNIQUE(account_id)
        // on the table guarantees the .maybeSingle() return type
        // remains accurate.
        const { data, error } = await supabase
          .from('whatsapp_config')
          .select('*')
          .eq('account_id', acctId)
          .maybeSingle();

        if (error) {
          console.error('Failed to load config row:', error);
        }

        if (data) {
          setConfig(data);
          setPhoneNumberId(data.phone_number_id || '');
          setWabaId(data.waba_id || '');
          setAccessToken(MASKED_TOKEN);
          setVerifyToken('');
          setPin('');
          setTokenEdited(false);
          // Undefined on a row read before migration 039 — treat that as
          // on, matching the webhook's own default.
          setMirrorMedia(data.mirror_inbound_media !== false);
        } else {
          setConfig(null);
          setPhoneNumberId('');
          setWabaId('');
          setAccessToken('');
          setVerifyToken('');
          setPin('');
          setTokenEdited(false);
          setMirrorMedia(true);
        }
        // Clear any stale probe result when reloading the row.
        setRegistrationProbe(null);

        // Then verify health via the API (decrypts token + pings Meta)
        if (data) {
          try {
            const res = await fetch('/api/whatsapp/config', { method: 'GET' });
            const payload = await res.json();

            if (payload.connected) {
              setConnectionStatus('connected');
              setResetReason(null);
              setStatusMessage('');
            } else {
              setConnectionStatus('disconnected');
              setResetReason(
                payload.needs_reset
                  ? 'token_corrupted'
                  : payload.reason === 'meta_api_error'
                    ? 'meta_api_error'
                    : null
              );
              setStatusMessage(payload.message || '');
            }
          } catch (err) {
            console.error('Health check failed:', err);
            setConnectionStatus('disconnected');
          }
        } else {
          setConnectionStatus('disconnected');
          setResetReason(null);
          setStatusMessage('');
        }
      } catch (err) {
        console.error('fetchConfig error:', err);
        toast.error(t('toastFailedLoad'));
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    // Need both the auth session (`!authLoading`) AND the profile
    // (`!profileLoading`, which carries `accountId`). Without the
    // second guard, the effect would fire with `accountId === null`
    // for the first render window and bail without ever retrying
    // once the profile arrives.
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleToggleMirrorMedia(next: boolean) {
    if (!config || !accountId || savingMirror) return;
    // Optimistic — the switch should feel instant; a failure rolls it
    // back rather than leaving the UI ahead of the row.
    const previous = mirrorMedia;
    setMirrorMedia(next);
    setSavingMirror(true);
    try {
      const { error } = await supabase
        .from('whatsapp_config')
        .update({ mirror_inbound_media: next })
        .eq('account_id', accountId);
      if (error) throw new Error(error.message);
      setConfig({ ...config, mirror_inbound_media: next });
    } catch (error) {
      console.error('Failed to update media retention setting:', error);
      setMirrorMedia(previous);
      toast.error(t('mirrorInboundSaveFailed'));
    } finally {
      setSavingMirror(false);
    }
  }

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast.error(t('toastPhoneRequired'));
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error(t('toastTokenRequired'));
      return;
    }

    try {
      setSaving(true);

      // Always POST through the API — it verifies with Meta and encrypts
      // the access_token server-side with ENCRYPTION_KEY. Skipping this
      // and writing direct to Supabase stores the token in plaintext,
      // which then fails decryption on every subsequent health check.
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        // Optional — only sent when the user filled it in. The server
        // requires it on first save or when changing numbers; for a
        // simple token rotation, leaving it blank skips re-register.
        pin: pin.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        // Existing config — reuse stored encrypted token by decrypting on the
        // server. But our POST handler requires an access_token to verify
        // with Meta. If the user didn't change the token, we need to signal
        // that. Simplest: require token re-entry if they're updating.
        toast.error(t('toastReenterToken'));
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        // The route's own `error` is English prose. It goes to the
        // console for whoever is debugging; the operator gets their own
        // language. Same trade at every call site in this file.
        console.error('Save config failed:', data.error);
        toast.error(t('toastFailedSave'));
        setSaving(false);
        return;
      }

      // The route now returns a structured outcome:
      //   * registered=true   → number is live, events will flow
      //   * registered=false  → credentials saved but /register
      //                         failed; UI shows the specific error
      //                         and a retry path. registration_error
      //                         is human-readable from Meta.
      if (data.registered === false && data.registration_error) {
        toast.error(
          t('toastRegisterFailed', { reason: data.registration_error }),
          { duration: 12000 }
        );
      } else if (data.registration_skipped) {
        // Credentials saved + verified, but /register was skipped
        // because no PIN was supplied (e.g. a Meta test number).
        // Don't claim the number is "Live" — point at the
        // Registration status banner instead.
        toast.success(t('toastSavedNoPin'), { duration: 10000 });
        setPin('');
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `Live — ${data.phone_info.verified_name} can now receive events.`
            : 'WhatsApp connected. Events will start flowing within a minute.'
        );
        // Clear the PIN so subsequent saves don't accidentally
        // re-register (which would void the active subscription if
        // the PIN became stale).
        setPin('');
      }

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error(t('toastFailedSave'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? t('toastConnectedTo', { name: payload.phone_info.verified_name })
            : t('toastConnectionOk')
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(
          payload.needs_reset
            ? 'token_corrupted'
            : payload.reason === 'meta_api_error'
              ? 'meta_api_error'
              : null
        );
        setStatusMessage(payload.message || '');
        console.error('Connection test failed:', payload.message);
        toast.error(t('toastConnectionFailed'));
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error(t('toastTestFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch('/api/whatsapp/config/verify-registration', {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success(t('toastFullyWired'));
      } else {
        toast.error(t('toastNotRegistered'), { duration: 8000 });
      }
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error(t('toastVerifyUnreachable'));
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleReset() {
    if (!confirm(t('resetConfirm'))) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        console.error('Reset config failed:', data.error);
        toast.error(t('toastFailedReset'));
        return;
      }

      toast.success(t('toastCleared'));
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
    } catch (err) {
      console.error('Reset error:', err);
      toast.error(t('toastFailedReset'));
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success(t('toastWebhookCopied'));
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-(--dur-3)">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      </section>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <section className="animate-in fade-in-50 duration-(--dur-3)">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      {/* Container query, not `lg:`. This panel does not get the viewport:
          at 1024px the settings rail becomes a 236px column at the very
          same breakpoint, leaving the panel ~460px — so a viewport `lg:`
          split of `1fr 380px` gave the form 56px and overflowed. Measuring
          the panel itself (the `@container` lives on the panel wrapper in
          settings/page.tsx) means the second column only appears once
          there is genuinely room for it. Same pattern as
          automation-builder.tsx. */}
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main config form */}
        <div className="space-y-6">
          {/* Corrupted-token reset banner */}
          {showResetBanner && (
            <Alert className="bg-human-soft border-human-border">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-human-ink mt-0.5 size-5 shrink-0" />
                <div className="flex-1">
                  <AlertTitle className="text-human-ink mb-1">
                    {t('tokenCorruptedTitle')}
                  </AlertTitle>
                  <AlertDescription className="text-human-ink/90 text-sm">
                    {statusMessage}
                  </AlertDescription>
                  <Button
                    onClick={handleReset}
                    disabled={resetting}
                    size="sm"
                    className="bg-human-strong hover:bg-human-strong/90 mt-3 text-white"
                  >
                    {resetting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {t('resetting')}
                      </>
                    ) : (
                      <>
                        <RotateCcw className="size-4" />
                        {t('resetConfig')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Alert>
          )}

          {/* Connection Status */}
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <CheckCircle2 className="text-primary size-4" />
              ) : (
                <XCircle className="text-danger size-4" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {connectionStatus === 'connected'
                  ? t('credentialsValid')
                  : t('notConnected')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {connectionStatus === 'connected'
                ? t('connectedDesc')
                : statusMessage || t('notConnectedDesc')}
            </AlertDescription>
          </Alert>

          {/* Registration Status — the "is it actually live?" check.
            Credentials being valid is necessary but not sufficient;
            without a successful /register call the number won't
            receive inbound events. Surface this dimension separately
            so users don't trust a misleading green banner. */}
          {config && (
            <Alert
              className={
                isRegistered
                  ? 'bg-ok-soft border-ok/25'
                  : 'bg-human-soft border-human-border'
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isRegistered ? (
                    <CheckCircle2 className="text-ok-ink size-4" />
                  ) : (
                    <AlertTriangle className="text-human-ink size-4" />
                  )}
                  <AlertTitle
                    className={
                      'mb-0 ' +
                      (isRegistered ? 'text-ok-ink' : 'text-human-ink')
                    }
                  >
                    {isRegistered ? t('registered') : t('notRegistered')}
                  </AlertTitle>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleVerifyRegistration}
                  disabled={verifyingRegistration}
                  className="border-border text-foreground hover:bg-muted h-7 bg-transparent"
                >
                  {verifyingRegistration ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Zap className="size-3.5" />
                  )}
                  {t('verifyWithMeta')}
                </Button>
              </div>
              <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {isRegistered ? (
                  <span
                    dangerouslySetInnerHTML={{
                      __html: t('subscribedSince', {
                        date: config.registered_at
                          ? new Date(config.registered_at).toLocaleString(
                              APP_LOCALE
                            )
                          : t('unknownDate'),
                      }),
                    }}
                  />
                ) : lastRegistrationError ? (
                  <>
                    {t('lastAttemptFailed')}
                    <span className="text-danger-ink">
                      &quot;{lastRegistrationError}&quot;
                    </span>
                    . {t('retryHint')}
                  </>
                ) : (
                  <>{t('noRegistrationHint')}</>
                )}
              </AlertDescription>

              {registrationProbe && (
                <div className="border-border bg-card/60 text-2xs mt-3 space-y-1.5 rounded border px-3 py-2">
                  <p className="text-foreground font-medium">
                    {t('diagnosticLastRun')}
                    <span
                      className={
                        registrationProbe.live
                          ? 'text-ok-ink'
                          : 'text-human-ink'
                      }
                    >
                      {registrationProbe.live ? t('live') : t('notLive')}
                    </span>
                  </p>
                  <ul className="text-muted-foreground space-y-0.5">
                    {Object.entries(registrationProbe.checks).map(([k, v]) => (
                      <li key={k} className="flex items-center gap-1.5">
                        {v === true ? (
                          <CheckCircle2 className="text-ok size-3 shrink-0" />
                        ) : v === false ? (
                          <XCircle className="text-danger size-3 shrink-0" />
                        ) : (
                          <span className="border-border size-3 shrink-0 rounded-full border" />
                        )}
                        <code className="text-muted-foreground">{k}</code>
                      </li>
                    ))}
                  </ul>
                  {(registrationProbe.errors ?? []).length > 0 && (
                    <ul className="text-danger-ink space-y-0.5 pt-1">
                      {registrationProbe.errors?.map((e, i) => (
                        <li key={i}>• {e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Alert>
          )}

          {/* API Credentials */}
          <Panel>
            <PanelHeader>
              <div className="min-w-0">
                <PanelTitle>{t('apiCredentialsTitle')}</PanelTitle>
                <PanelSub>{t('apiCredentialsDesc')}</PanelSub>
              </div>
            </PanelHeader>
            <PanelBody className="space-y-4">
              <div className="space-y-2">
                <FieldLabel>{t('phoneNumberId')}</FieldLabel>
                <Input
                  placeholder={t('phoneNumberIdPlaceholder')}
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <FieldLabel>{t('wabaId')}</FieldLabel>
                <Input
                  placeholder={t('wabaIdPlaceholder')}
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <FieldLabel>{t('accessToken')}</FieldLabel>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    placeholder={t('accessTokenPlaceholder')}
                    value={accessToken}
                    onChange={(e) => {
                      setAccessToken(e.target.value);
                      setTokenEdited(true);
                    }}
                    onFocus={() => {
                      if (accessToken === MASKED_TOKEN) {
                        setAccessToken('');
                        setTokenEdited(true);
                      }
                    }}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                  />
                  {/* `after:-inset-3.5` is a hit shield, not padding: a raw
                    <button> gets none of the coarse-pointer expansion that
                    [data-slot="button"] does, and a bare 16px icon inside a
                    36px input is a quarter of the 44px touch minimum. */}
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    aria-label={t('toggleTokenVisibility')}
                    aria-pressed={showToken}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 transition-colors duration-(--dur-1) after:absolute after:-inset-3.5"
                  >
                    {showToken ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {config && !tokenEdited && (
                  <p className="text-muted-foreground text-xs">
                    {t('tokenHidden')}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <FieldLabel>{t('webhookVerifyToken')}</FieldLabel>
                <Input
                  placeholder={t('webhookVerifyTokenPlaceholder')}
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-muted-foreground text-xs">
                  {t('webhookVerifyTokenHint')}
                </p>
              </div>

              <div className="space-y-2">
                <FieldLabel>
                  {t('twoStepPin')}
                  <span className="text-muted-foreground ml-1">
                    {t('optional')}
                  </span>
                </FieldLabel>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t('pinPlaceholder')}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground tracking-widest"
                />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  <span dangerouslySetInnerHTML={{ __html: t('pinHint') }} />
                </p>
              </div>
            </PanelBody>
          </Panel>

          {/* Webhook URL */}
          <Panel>
            <PanelHeader>
              <div className="min-w-0">
                <PanelTitle>{t('webhookTitle')}</PanelTitle>
                <PanelSub>{t('webhookDesc')}</PanelSub>
              </div>
            </PanelHeader>
            <PanelBody>
              <div className="space-y-2">
                <FieldLabel>{t('webhookUrl')}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="bg-muted border-border text-muted-foreground font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyWebhookUrl}
                    className="border-border text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            </PanelBody>
          </Panel>

          {/* Attachment retention. Only meaningful once a number is
            connected, since it governs what the webhook does with
            inbound media. */}
          {config && (
            <Panel>
              <PanelHeader>
                <div className="min-w-0">
                  <PanelTitle>{t('mediaTitle')}</PanelTitle>
                  <PanelSub>{t('mediaDesc')}</PanelSub>
                </div>
              </PanelHeader>
              <PanelBody>
                <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      {t('mirrorInbound')}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('mirrorInboundDesc')}
                    </p>
                    {!mirrorMedia && (
                      <p className="text-human-ink mt-1 text-xs">
                        {t('mirrorInboundOffWarning')}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={mirrorMedia}
                    onCheckedChange={handleToggleMirrorMedia}
                    disabled={savingMirror || !canEditSettings}
                    aria-label={t('mirrorInbound')}
                  />
                </div>
              </PanelBody>
            </Panel>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('saveConfig')
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !config}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {testing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('testing')}
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  {t('testConnection')}
                </>
              )}
            </Button>
            {config && (
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={resetting}
                className="border-danger/30 text-danger-ink hover:bg-danger-soft hover:text-danger-ink"
              >
                {resetting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('resetting')}
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-4" />
                    {t('resetConfig')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Setup Instructions Sidebar */}
        <div>
          <Panel>
            <PanelHeader>
              <div className="min-w-0">
                <PanelTitle>{t('setupInstructions')}</PanelTitle>
                <PanelSub>{t('setupInstructionsDesc')}</PanelSub>
              </div>
            </PanelHeader>
            <PanelBody>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                        1
                      </span>
                      {t('step1')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-inside list-decimal space-y-1 text-sm">
                      <li dangerouslySetInnerHTML={{ __html: t('step1_1') }} />
                      <li>{t('step1_2')}</li>
                      <li>{t('step1_3')}</li>
                      <li>{t('step1_4')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                        2
                      </span>
                      {t('step2')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-inside list-decimal space-y-1 text-sm">
                      <li>{t('step2_1')}</li>
                      <li>{t('step2_2')}</li>
                      <li>{t('step2_3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                        3
                      </span>
                      {t('step3')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-inside list-decimal space-y-1 text-sm">
                      <li>{t('step3_1')}</li>
                      <li
                        dangerouslySetInnerHTML={{ __html: t.raw('step3_2') }}
                      />
                      <li
                        dangerouslySetInnerHTML={{ __html: t.raw('step3_3') }}
                      />
                      <li
                        dangerouslySetInnerHTML={{ __html: t.raw('step3_4') }}
                      />
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                        4
                      </span>
                      {t('step4')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-inside list-decimal space-y-1 text-sm">
                      <li>{t('step4_1')}</li>
                      <li>{t('step4_2')}</li>
                      <li
                        dangerouslySetInnerHTML={{ __html: t.raw('step4_3') }}
                      />
                      <li
                        dangerouslySetInnerHTML={{ __html: t.raw('step4_4') }}
                      />
                      <li>{t('step4_5')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="border-border mt-4 border-t pt-4">
                <a
                  href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-sm transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  {t('metaDocs')}
                </a>
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </section>
  );
}
