import type { MetadataRoute } from 'next';

/**
 * What turns this from a site into an app you install.
 *
 * ------------------------------------------------------------------
 * WHAT WAS MISSING, AND WHAT EACH PLATFORM DID ABOUT IT
 * ------------------------------------------------------------------
 *
 * There was no manifest at all — `/manifest.json` and
 * `/manifest.webmanifest` both 404'd. That is not a small gap with a
 * small consequence; it is the single file each platform looks for
 * before deciding whether "install" is even on the menu:
 *
 *   Android / Chrome — refuses to offer installation without a manifest
 *     carrying `name`, `start_url`, `display`, and icons at BOTH 192 and
 *     512. Missing any one of them and the prompt never fires; there is
 *     no error, the option simply is not there.
 *
 *   iPhone / Safari — "Adicionar à Tela de Início" always worked, but
 *     without `display: standalone` it produced a BOOKMARK: it opened
 *     inside Safari with the address bar and the tab bar, about 110px of
 *     an app that budgets its height to the pixel, and the home-screen
 *     icon was a screenshot of the page rather than the mark.
 *
 *   Windows / Chrome, Edge — the desk this CRM actually runs on all day.
 *     Installed, it gets its own window with no address bar and a real
 *     entry on the taskbar.
 *
 * ------------------------------------------------------------------
 * THE VALUES THAT ARE DECISIONS
 * ------------------------------------------------------------------
 *
 * `start_url` is `/dashboard`, not `/`. Both land in the same place —
 * `app/page.tsx` redirects — but the redirect costs a round trip on
 * every single cold launch of the installed app, and a launch is the
 * one moment the user is watching an empty screen.
 *
 * `background_color` is the app's LIGHT ground and not the brand navy.
 * It paints the splash while the bundle loads, so it is a promise about
 * what appears next: navy would flash a colour the app never shows.
 * `DEFAULT_MODE` is light (see `lib/themes.ts`), so this is right for a
 * first launch; a returning user in dark mode gets one light frame,
 * which is the same frame the browser already gives them today.
 *
 * `theme_color` here is only the install-time default. At runtime the
 * `<meta name="theme-color">` written by the boot script in `layout.tsx`
 * wins, and that one follows the app's own `data-mode` rather than the
 * operating system's — see the note there.
 *
 * `orientation: 'portrait'` because every screen in this app was laid
 * out against a vertical budget and two of them (the board, the thread)
 * would be actively worse turned sideways on a phone. It is advisory:
 * a tablet still rotates.
 *
 * NO `id`. It defaults to `start_url`, and setting it wrong on a second
 * pass creates a SECOND installed app beside the first rather than
 * updating it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PlastfortSul CRM',
    // Eleven characters. Android truncates the home-screen label at
    // roughly twelve, so the long name would have read "PlastfortSu…"
    // on the one surface where the name is the whole of the branding.
    short_name: 'PlastfortSul',
    description:
      'CRM comercial da PlastfortSul, operado sobre o WhatsApp Business.',
    lang: 'pt-BR',
    dir: 'ltr',
    start_url: '/dashboard',
    // The pages the installed window keeps to itself. Anything outside
    // it — an external link a customer sent — opens in the real browser
    // instead of stranding the user in a chromeless window with no
    // address bar and no way back.
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f6f7',
    theme_color: '#f5f6f7',
    categories: ['business', 'productivity'],
    icons: [
      // Written by `scripts/generate-app-icons.mjs` from the same mark
      // as `src/app/icon.tsx`. Static paths on purpose: the metadata
      // file conventions publish hashed URLs, which a manifest cannot
      // name. See the header of that script.
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // Separate file, not the same one listed twice. A launcher
        // crops a maskable icon to its own shape, so this one is drawn
        // with the artwork pulled into the middle 56% — declaring the
        // full-bleed icon as maskable is what shaves the corners off a
        // logo on an Android home screen.
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
