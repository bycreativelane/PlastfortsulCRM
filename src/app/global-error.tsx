'use client';

/**
 * The last boundary: a failure in the ROOT layout itself.
 *
 * `(dashboard)/error.tsx` catches everything that happens inside a
 * page and keeps the shell. This one catches the case where the shell
 * never existed — the root layout threw — and Next replaces the whole
 * document with it. That is why it renders its own `<html>` and
 * `<body>`: there is no layout above it to provide them.
 *
 * Which is also why it cannot use anything the app owns. No
 * `NextIntlClientProvider` (it lives in the layout that just failed),
 * so no `useTranslations`. No `globals.css` guarantee, so no Tailwind
 * classes and no design tokens — the styles here are inline and
 * self-contained, and the two colour schemes are a `prefers-color-
 * scheme` block rather than the app's `data-mode`, because the boot
 * script that stamps `data-mode` never ran either.
 *
 * The strings are inlined for the same reason, picked from the build-
 * time locale. Three sentences in three languages is a cheaper price
 * than a screen that fails to render the message about the failure.
 */
const COPY = {
  'pt-BR': {
    title: 'O sistema não conseguiu iniciar',
    body: 'Recarregue a página. Se falhar de novo, o problema é do nosso lado.',
    retry: 'Recarregar',
  },
  ko: {
    title: '앱을 시작할 수 없습니다',
    body: '페이지를 새로고침하세요. 다시 실패하면 서버 측 문제입니다.',
    retry: '새로고침',
  },
  en: {
    title: 'The app could not start',
    body: 'Reload the page. If it fails again, the problem is on our side.',
    retry: 'Reload',
  },
} as const;

const copy =
  COPY[(process.env.NEXT_PUBLIC_APP_LOCALE as keyof typeof COPY) || 'en'] ??
  COPY.en;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang={process.env.NEXT_PUBLIC_APP_LOCALE || 'en'}>
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: '#f9f9f9',
          color: '#1a1c1f',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <style>{`@media (prefers-color-scheme: dark){body{background:#131416 !important;color:#fafafa !important}button{background:#fafafa !important;color:#131416 !important}p{color:#a1a1aa !important}}`}</style>
        <main style={{ maxWidth: '24rem', textAlign: 'center' }}>
          <h1
            style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            {copy.title}
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '14px',
              lineHeight: 1.6,
              color: '#71717a',
            }}
          >
            {copy.body}
          </p>
          {error.digest ? (
            <p
              style={{
                margin: '8px 0 0',
                fontSize: '12px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#a1a1aa',
              }}
            >
              {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '24px',
              height: '36px',
              padding: '0 16px',
              border: 0,
              borderRadius: '8px',
              background: '#1a1c1f',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {copy.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
