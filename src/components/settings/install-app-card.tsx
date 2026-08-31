'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Check, MonitorSmartphone, Share } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

/**
 * "Install this on your phone", and the three different answers the
 * three platforms give to it.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS NOT ONE BUTTON
 * ------------------------------------------------------------------
 *
 * Chrome (Android and desktop) fires `beforeinstallprompt` when a page
 * qualifies — manifest, icons at 192 and 512, `start_url`, `display`,
 * a secure origin. Hold that event and `prompt()` on it from a click:
 * it is the only way to open the native install sheet, and it is
 * single-use.
 *
 * Safari on iOS has no such event and never will. Adding to the home
 * screen there is a menu item the person performs themselves, so the
 * honest UI is an INSTRUCTION — a button that cannot do what it says
 * is worse than a sentence that can.
 *
 * A browser that neither fires the event nor is iOS Safari gets nothing
 * at all: Firefox on Android installs through its own menu with no
 * web-facing hook, and a card offering something the browser will not
 * do reads as a broken feature.
 *
 * ------------------------------------------------------------------
 * WHY `useSyncExternalStore` AND NOT AN EFFECT
 * ------------------------------------------------------------------
 *
 * Two reasons, and the second is the one that decides it.
 *
 * The house lint (`react-hooks/set-state-in-effect`) rejects the
 * effect-then-setState shape, and it is right to here: every one of
 * these facts is external browser state, which is precisely what this
 * hook is for.
 *
 * And the event ARRIVES BEFORE THIS COMPONENT EXISTS. Chrome fires
 * `beforeinstallprompt` once, right after it reads the manifest — long
 * before hydration, and very long before somebody navigates to this
 * settings section. So the listener lives in the boot script in
 * `layout.tsx` and parks the event on `window.__pwaInstallPrompt`; this
 * reads it, and subscribes to the `pwa:installability` event that
 * script dispatches. An effect here would subscribe to something that
 * already happened.
 *
 * `display-mode: standalone` is the browser telling us the app is
 * already installed and running. That is the truth; a flag in
 * localStorage would be a guess that outlives an uninstall.
 */

/** The event Chrome fires. Not in lib.dom, so it is spelled here. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallWindow = Window & {
  __pwaInstallPrompt?: InstallPromptEvent | null;
};

type Surface = 'unknown' | 'prompt' | 'ios' | 'installed';

const STANDALONE_QUERY = '(display-mode: standalone)';

function isStandalone(): boolean {
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    // iOS never adopted `display-mode` for this; it puts the same fact
    // on `navigator.standalone`, which is non-standard and iOS-only.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac. A Mac with a touchscreen is
    // the tell.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Every browser on iOS is WebKit underneath, but only Safari has the
  // "Adicionar à Tela de Início" item — the instruction would be wrong
  // in Chrome or Firefox there.
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iOS && safari;
}

function subscribe(onChange: () => void) {
  window.addEventListener('pwa:installability', onChange);
  const media = window.matchMedia(STANDALONE_QUERY);
  media.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('pwa:installability', onChange);
    media.removeEventListener('change', onChange);
  };
}

/**
 * Order is the logic. Installed wins over everything — a standalone
 * window has nothing to offer — and a live prompt beats the iOS
 * instruction, so a hypothetical WebKit that grows the event stops
 * being told to use a menu.
 */
function getSnapshot(): Surface {
  if (isStandalone()) return 'installed';
  if ((window as InstallWindow).__pwaInstallPrompt) return 'prompt';
  if (isIOSSafari()) return 'ios';
  return 'unknown';
}

/** No browser on the server, and nothing to say until there is one. */
const getServerSnapshot = (): Surface => 'unknown';

export function InstallAppCard() {
  const t = useTranslations('Settings.appearance.install');
  const surface = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const install = useCallback(async () => {
    const deferred = (window as InstallWindow).__pwaInstallPrompt;
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // Single-use, whatever they chose. Clearing it and re-notifying is
    // what takes the button away; Chrome offers a fresh event on a later
    // visit if they declined.
    (window as InstallWindow).__pwaInstallPrompt = null;
    window.dispatchEvent(new Event('pwa:installability'));
  }, []);

  // `unknown` covers two cases that look identical from here and want
  // the same answer: a browser that will never fire the event, and one
  // that has not fired it yet. Rendering nothing is right for both —
  // the card appears the moment the event lands.
  if (surface === 'unknown') return null;

  return (
    // `mb-6` lives here and not on the block below it: this card is
    // absent on most desktop browsers, and a margin owned by the next
    // section would leave 24px of hole where it never rendered.
    <div className="border-border bg-card mb-6 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="bg-muted text-primary grid size-9 shrink-0 place-items-center rounded-lg">
          {surface === 'installed' ? (
            <Check className="size-4" />
          ) : (
            <MonitorSmartphone className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-semibold">
            {surface === 'installed' ? t('installedTitle') : t('title')}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {surface === 'installed'
              ? t('installedBody')
              : surface === 'ios'
                ? t('iosBody')
                : t('promptBody')}
          </p>

          {surface === 'ios' ? (
            // The menu path, drawn rather than described, because
            // "Compartilhar" is an icon on that toolbar and not a word.
            <p className="text-muted-foreground mt-3 flex flex-wrap items-center gap-1.5 text-sm">
              <Share className="text-foreground size-4 shrink-0" />
              <span className="text-foreground font-medium">
                {t('iosStep1')}
              </span>
              <span aria-hidden>→</span>
              <span className="text-foreground font-medium">
                {t('iosStep2')}
              </span>
            </p>
          ) : null}

          {surface === 'prompt' ? (
            <Button size="sm" onClick={install} className="mt-3">
              {t('action')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
