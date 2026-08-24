'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Replays an element's CSS entrance animation whenever `token` changes.
 *
 * The obvious way to re-run an entrance is `key={token}`, which makes
 * React throw the subtree away and build it again. That works, and it
 * also silently resets the state of anything inside — a page navigated
 * to from itself (`/broadcasts/1` → `/broadcasts/2` is one component,
 * not two), a settings panel with a half-filled form. Restarting the
 * animation directly gets the identical picture and touches nothing
 * else.
 *
 * Skips the first run on purpose: the class on the element has already
 * animated it on mount, and replaying it there would play twice.
 *
 * Nothing here asks about `prefers-reduced-motion`. The global override
 * in globals.css collapses every duration to 0.01ms, so this still
 * runs, still completes, and is simply invisible — one place decides
 * for the whole app, including the animations we do not own.
 */
export function useReplayAnimation(
  ref: RefObject<HTMLElement | null>,
  token: string,
  className: string
) {
  const mounted = useRef(false);

  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const node = ref.current;
    if (!node) return;

    // While an animation is still running it is its own handle: cancel
    // + play rewinds it to frame zero with no reflow. This is the path
    // taken when you navigate again mid-fade.
    const running = node.getAnimations();
    if (running.length > 0) {
      for (const animation of running) {
        animation.cancel();
        animation.play();
      }
      return;
    }

    // The usual path, though. These animations fill `backwards`, not
    // `both` — a forwards fill would pin `transform: matrix(1,0,0,1,0,0)`
    // on the page wrapper permanently and make it a containing block for
    // every `position: fixed` descendant (globals.css `@keyframes
    // page-in` has the full story) — so a finished one detaches itself
    // and `getAnimations()` comes back empty. Removing and re-adding the
    // class only replays if a style recalculation lands in between —
    // reading `offsetWidth` is what forces one.
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }, [ref, token, className]);
}
