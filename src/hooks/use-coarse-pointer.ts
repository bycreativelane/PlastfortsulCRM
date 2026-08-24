'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Is this a finger?
 *
 * `(pointer: coarse)` is already the signal this app sizes hit targets with
 * — `[@media(pointer:coarse)]:h-11` appears throughout — and it is the right
 * question here for the same reason it is there: what changes is not the
 * width of the screen but who is operating it. A 1024px tablet is touch and
 * a 1024px laptop is not, and they need different answers.
 *
 * WHY A HOOK AND NOT A CSS CLASS. CSS can hide and show elements, and that
 * covers almost everything. What it cannot do is swap the value of an
 * attribute, and the one place this is needed is a `placeholder` — whose
 * desktop copy ends in "(Shift+Enter quebra linha)", a keyboard shortcut
 * that does not exist on the device that cannot fit the sentence.
 *
 * `useSyncExternalStore` rather than state-plus-effect: `matchMedia` IS an
 * external store, the server snapshot is `false` so hydration cannot
 * mismatch, and React handles the subscription itself. A pointer can also
 * change without a reload — a tablet with a keyboard attached and detached
 * is the ordinary case, not a curiosity — and the subscription covers that
 * for free.
 */
const QUERY = '(pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function useCoarsePointer(): boolean {
  const getSnapshot = useCallback(
    () =>
      typeof window !== 'undefined' && !!window.matchMedia
        ? window.matchMedia(QUERY).matches
        : false,
    []
  );

  // The server has no pointer. Answering `false` there means a phone paints
  // the desktop string for one frame, which is invisible next to a field
  // nobody has focused yet — and it is the only answer that cannot cause a
  // hydration mismatch.
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
