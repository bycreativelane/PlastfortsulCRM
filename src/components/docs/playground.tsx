'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Play, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldLabel } from '@/components/ui/field';
import type { Method } from '@/lib/api-docs/types';
import { CodeBlock } from './code-block';
import { MethodBadge } from './method-badge';

/**
 * O "Try it" da referência do Chatwoot, e ele funciona de verdade aqui
 * porque esta página é servida pela MESMA origem que a API — não há
 * CORS a atravessar, nem proxy a escrever.
 *
 * ------------------------------------------------------------------
 * A CHAVE NÃO É GUARDADA. EM LUGAR NENHUM.
 * ------------------------------------------------------------------
 *
 * Nem localStorage, nem sessionStorage, nem cookie. Ela vive no estado
 * deste componente e some quando a aba fecha ou a página recarrega —
 * o que é chato para quem vai testar dez rotas seguidas, e é a escolha
 * certa mesmo assim: uma credencial de servidor com escopo de envio,
 * deixada no armazenamento de um navegador, sai de lá no primeiro XSS
 * ou no primeiro notebook emprestado. Digitar de novo custa cinco
 * segundos.
 *
 * A requisição vai por caminho RELATIVO, e não pela URL absoluta dos
 * exemplos: quem abriu esta doc por um endereço interno deve testar
 * contra esse mesmo endereço, não contra o que está configurado em
 * `NEXT_PUBLIC_SITE_URL`.
 */
export function Playground({
  method,
  path,
  requestExample,
  scope,
}: {
  method: Method;
  path: string;
  requestExample?: string;
  scope: string | null;
}) {
  const t = useTranslations('Docs');
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [body, setBody] = useState(requestExample ?? '');
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    status: number;
    ms: number;
    text: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** `/api/v1/contacts/{id}` → ['id'] */
  const placeholders = useMemo(
    () => Array.from(path.matchAll(/\{(\w+)\}/g)).map((m) => m[1]),
    [path]
  );

  const resolvedPath = useMemo(() => {
    let out = path;
    for (const name of placeholders) {
      out = out.replace(`{${name}}`, pathValues[name]?.trim() || `{${name}}`);
    }
    return out;
  }, [path, placeholders, pathValues]);

  const writes = method !== 'GET';
  const ready =
    token.trim().length > 0 &&
    placeholders.every((name) => (pathValues[name] ?? '').trim().length > 0);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    const started = performance.now();

    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          ...(writes && body.trim()
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
      };

      if (writes && body.trim()) {
        // Valida aqui para que um JSON torto vire uma mensagem clara em
        // vez de um 400 do servidor que parece problema da rota.
        try {
          JSON.parse(body);
        } catch {
          setError(t('playgroundBadJson'));
          setRunning(false);
          return;
        }
        init.body = body;
      }

      const res = await fetch(resolvedPath, init);
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Resposta não-JSON (um proxy no meio, por exemplo): mostra crua.
      }

      setResult({
        status: res.status,
        ms: Math.round(performance.now() - started),
        text: pretty,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="shrink-0"
      >
        <Play className="size-3.5" />
        {t('tryIt')}
      </Button>
    );
  }

  return (
    <div className="border-border bg-card-2 mt-3 w-full space-y-3 rounded-xl border p-3.5">
      <div className="flex items-start gap-2">
        <MethodBadge method={method} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-mono text-xs break-all">
            {resolvedPath}
          </p>
          <p className="text-muted-foreground text-2xs mt-1 leading-[1.6]">
            {writes ? t('playgroundWarnWrite') : t('playgroundWarnRead')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 rounded-md p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="pg-token">
          {t('playgroundToken')}
          {scope ? (
            <span className="text-muted-foreground text-2xs ml-1.5 font-mono font-normal">
              {scope}
            </span>
          ) : null}
        </FieldLabel>
        <Input
          id="pg-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="wacrm_live_…"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
        <p className="text-muted-foreground text-3xs">
          {t('playgroundTokenHint')}
        </p>
      </div>

      {placeholders.map((name) => (
        <div key={name} className="space-y-1.5">
          <FieldLabel htmlFor={`pg-${name}`}>{name}</FieldLabel>
          <Input
            id={`pg-${name}`}
            value={pathValues[name] ?? ''}
            onChange={(e) =>
              setPathValues((prev) => ({ ...prev, [name]: e.target.value }))
            }
            placeholder="uuid"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>
      ))}

      {writes ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="pg-body">{t('playgroundBody')}</FieldLabel>
          <Textarea
            id="pg-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(14, Math.max(4, body.split('\n').length + 1))}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>
      ) : null}

      <Button
        type="button"
        size="sm"
        onClick={run}
        disabled={!ready || running}
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        {t('playgroundRun', { method })}
      </Button>

      {error ? <p className="text-danger-ink text-xs">{error}</p> : null}

      {result ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-2xs inline-flex h-5 items-center rounded-full px-2 font-mono font-semibold',
                result.status < 300
                  ? 'bg-ok-soft text-ok-ink'
                  : result.status < 500
                    ? 'bg-human-soft text-human-ink'
                    : 'bg-danger-soft text-danger-ink'
              )}
            >
              {result.status}
            </span>
            <span className="text-muted-foreground text-2xs">
              {result.ms} ms
            </span>
          </div>
          <CodeBlock code={result.text} language="json" />
        </div>
      ) : null}
    </div>
  );
}
