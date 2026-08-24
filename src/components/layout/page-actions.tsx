'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lets a page put its own buttons in its own title row.
 *
 * These used to portal into the top bar, on the reasoning that the bar
 * was otherwise repeating the page title the sidebar already showed.
 * That reasoning was about the BAR. It said nothing about the buttons,
 * and putting them there separated every primary action from the thing
 * it acts on by the entire width of the window: "Automações" and its
 * subtitle sat at the far left of the page while "Nova automação" sat
 * beyond the search field, level with the notification bell and the
 * theme toggle — three controls that belong to the app, not the page.
 * You had to leave the page to act on it, and the eye had to cross
 * 1500px to find out an action existed at all.
 *
 * So the slot moved into `<PageHeader>`: title and description on the
 * left, actions on the right, one row, one object. The top bar keeps
 * the search and the app-level controls.
 *
 * Still a PORTAL, not lifted state. The buttons close over the page's
 * own handlers and state, and a portal moves only where they paint —
 * they stay inside the page's React tree, so context and closures keep
 * working. Lifting them would also mean a page setting parent state
 * from an effect on every render, which is a cascading-render bug
 * waiting to be written.
 *
 * The slot is a module-level store rather than context because a page
 * renders exactly one header, and a store can be written from a ref
 * callback — no effect, no extra render pass.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

function setSlot(node: HTMLElement | null) {
  slot = node;
  listeners.forEach((notify) => notify());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const getSnapshot = () => slot;
/** No DOM on the server, so nothing portals until hydration. */
const getServerSnapshot = () => null;

/**
 * Rendered once, by `PageHeader`.
 *
 * The ref uses React 19's cleanup form and clears the slot only if it
 * still holds THIS node. During a navigation both the outgoing and the
 * incoming header exist for a moment; whichever order React runs the
 * attach and the detach in, the outgoing one must not be able to null
 * out a slot the incoming one has already claimed — that would leave
 * the new page's buttons portalling into nothing.
 */
export function PageActionsSlot({ className }: { className?: string }) {
  return (
    <div
      ref={(node) => {
        setSlot(node);
        return () => {
          if (slot === node) setSlot(null);
        };
      }}
      className={className}
    />
  );
}

/** Rendered by a page. Whatever is inside appears in the page's title row. */
export function PageActions({ children }: { children: ReactNode }) {
  const node = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return node ? createPortal(children, node) : null;
}
