import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Geist_Mono, Inter } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { ThemeProvider } from '@/hooks/use-theme';
import { ThemedToaster } from '@/components/themed-toaster';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  NAV_STORAGE_KEY,
  STORAGE_KEY,
  THEME_IDS,
} from '@/lib/themes';

/**
 * The app's one text face.
 *
 * `adjustFontFallback` is OFF, and that is the whole point of this
 * block. Left on, Next synthesises a stand-in face — literally
 * `local("Arial")` with `size-adjust: 107.12%` — and puts it FIRST in
 * the stack, ahead of anything passed as `fallback`. So every load
 * before the woff2 lands paints the entire product in Arial stretched
 * 7% wider than it was drawn: letterforms nobody designed, at a width
 * nobody chose. It buys zero layout shift and pays for it in a typeface
 * that reads as broken — which is exactly the complaint that started
 * this ("a fonte tá estranha" on the sign-in screen, which is the first
 * screen anyone sees and the one most likely to be hit cold).
 *
 * With it off, the stack degrades to real faces: Segoe UI Variable on
 * Windows 11 (where this CRM is used all day), the platform UI face
 * elsewhere. Those are close enough to Inter's proportions that the
 * swap is a settle, not a jolt — and the frames before it are a
 * legitimate typeface rather than a distorted one.
 *
 * The shift that buys back is small and bounded: the file is preloaded
 * (`preload` defaults true and only the `latin` subset is cut), so on
 * anything but a cold cache the fallback is never painted at all.
 */
const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
  adjustFontFallback: false,
  fallback: [
    'Segoe UI Variable Text',
    'Segoe UI',
    'system-ui',
    '-apple-system',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
});

/**
 * The second family, and the only one — everything else in the app is
 * Inter.
 *
 * It exists for the places where a character has to line up under the
 * character above it: API keys, the `{{1}}` variables in a template,
 * phone numbers in the contacts table, run timestamps, raw JSON in the
 * automation builder. Those 26 call sites already asked for `font-mono`
 * and were silently rendering in Inter — the theme pointed `--font-mono`
 * at `--font-geist-mono`, a variable nothing ever defined.
 *
 * `fallback` is a real monospace stack rather than the automatic
 * metric-matched one. Next's default fallback is derived from Arial, so
 * a slow network would render a column of API keys in a PROPORTIONAL
 * face — the exact failure this font is here to prevent. Turning
 * `adjustFontFallback` off costs a hair of layout shift when the woff2
 * lands and buys a correct character grid from the first frame.
 */
const geistMono = Geist_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
  adjustFontFallback: false,
  // Not preloaded, and Inter is why. `preload` defaults to true, so
  // every route in the app — login included — shipped a
  // `<link rel=preload as=font>` for a face that appears on maybe six
  // screens, none of them above the fold, competing for the first-paint
  // connection with the ONE font every screen needs. The fallback here
  // is a real monospace stack (see above), so the pages that do use it
  // stay on a correct character grid while the woff2 arrives.
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: 'PlastfortSul',
    template: '%s — PlastfortSul',
  },
  description:
    'CRM comercial da PlastfortSul, operado sobre o WhatsApp Business.',
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: '/icon' }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  // Matches --background in light mode, which is now the default.
  themeColor: '#f5f6f7',
  colorScheme: 'light dark',
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
/**
 * The signature.
 *
 * Every studio leaves one somewhere. This one is in the console and in a
 * `data-` attribute on <html>, which means it costs nothing to render, cannot
 * shift a pixel, and is found only by someone who opened DevTools — which is
 * exactly the audience it is for.
 *
 * `beforeInteractive` alongside the theme boot so it is the first thing in the
 * log rather than the last, buried under a page of Fast Refresh notices.
 */
const SIGNATURE_SCRIPT = `
(function(){
  try {
    var line = 'a CL passou por aqui';
    document.documentElement.dataset.cl = line;
    console.log(
      '%c ' + line + ' ',
      'background:#2f63c9;color:#fff;padding:6px 12px;border-radius:6px;font-weight:600;letter-spacing:.02em'
    );
    console.log('%ccreativelane.io', 'color:#8a94a6;font-size:11px');
  } catch (_e) {}
})();
`;

const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;

    // Sidebar collapse. Same reasoning as theme: stamping the
    // attribute here is what keeps the menu from snapping shut on
    // every navigation for someone who collapsed it.
    d.dataset.nav =
      localStorage.getItem(${JSON.stringify(NAV_STORAGE_KEY)}) === 'collapsed'
        ? 'collapsed'
        : 'expanded';
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
    d.dataset.nav = 'expanded';
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      data-nav="expanded"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
        <Script
          id="cl"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: SIGNATURE_SCRIPT }}
        />
      </head>
      <body className="bg-background text-foreground min-h-full font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
