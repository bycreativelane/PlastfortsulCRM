'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_NAV, NAV_STORAGE_KEY, type NavState } from '@/lib/themes';

/**
 * Sidebar collapsed / expanded, persisted across navigations.
 *
 * The visual state does NOT come from this hook — it comes from
 * `data-nav` on <html>, which the boot script in `layout.tsx` stamps
 * before first paint and which `globals.css` styles. That split is the
 * point: React can hydrate a frame late without the menu visibly
 * snapping open, because CSS already put it in the right place.
 *
 * What the hook owns is the toggle: the button's own label, icon
 * direction and `aria-expanded`, plus writing the choice back to
 * localStorage and to the attribute.
 *
 * The attribute is therefore the source of truth, and this reads it as
 * an external store rather than mirroring it into state. Mirroring
 * would mean a setState inside an effect on every mount — a second
 * render pass for a value that was already correct in the DOM before
 * React booted.
 */

/** Subscribers to notify when `toggle` flips the attribute. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): NavState {
  return document.documentElement.dataset.nav === 'collapsed'
    ? 'collapsed'
    : 'expanded';
}

/**
 * The server has no <html> to read and no localStorage, so it always
 * renders the default. The boot script corrects the DOM before paint;
 * only the toggle button's own label reconciles at hydration.
 */
function getServerSnapshot(): NavState {
  return DEFAULT_NAV;
}

export function useNavCollapsed() {
  const nav = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: NavState =
      document.documentElement.dataset.nav === 'collapsed'
        ? 'expanded'
        : 'collapsed';
    document.documentElement.dataset.nav = next;
    try {
      localStorage.setItem(NAV_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled. The attribute is already set,
      // so the toggle still works for this session — it just won't
      // survive a reload. Not worth surfacing to the user.
    }
    listeners.forEach((notify) => notify());
  }, []);

  return { collapsed: nav === 'collapsed', toggle };
}
