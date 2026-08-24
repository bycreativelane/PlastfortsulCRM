'use client';

import * as React from 'react';
import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Right-click menus.
 *
 * A thin wrapper over Base UI's ContextMenu with the same parts and the same
 * names as `dropdown-menu.tsx`, so a menu written for one reads the same in
 * the other. Two things are deliberately different:
 *
 *   1. The popup takes the `glass` surface. A context menu opens ON the thing
 *      you clicked, and an opaque panel hides it at the exact moment you are
 *      deciding what to do with it.
 *   2. Rows are a step taller and the type a step larger than the dropdown's.
 *      A dropdown is read after a deliberate click on a labelled trigger; a
 *      context menu appears under a cursor that was aiming at something else,
 *      so the rows have to be easy to hit on the way past.
 */

type CursorPoint = { x: number; y: number; touch: boolean };

const CursorPointContext = React.createContext<{
  setPoint: (point: CursorPoint) => void;
  anchor: { getBoundingClientRect: () => DOMRect };
} | null>(null);

/**
 * The zoom the element is actually painted at.
 *
 * `currentCSSZoom` is the browser's own answer and is exact. The fallback —
 * painted width over layout width — is the same ratio for browsers that do
 * not have the property yet, and 1 for anything with no box to measure.
 */
function effectiveZoom(el: Element | null | undefined): number {
  if (!el) return 1;
  const own = (el as HTMLElement).currentCSSZoom;
  if (typeof own === 'number' && own > 0) return own;
  const painted = el.getBoundingClientRect().width;
  const layout = parseFloat(getComputedStyle(el).width);
  return painted > 0 && layout > 0 ? painted / layout : 1;
}

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  const pointRef = React.useRef<CursorPoint | null>(null);

  /**
   * Why this exists instead of Base UI's own cursor anchor.
   *
   * The whole app renders inside `body { zoom: var(--zoom) }`, and the menu is
   * portalled into that same zoomed subtree. Anything positioned inside it is
   * laid out in the body's OWN pixels, which the browser multiplies by the
   * zoom on paint — but `clientX`/`clientY` arrive in viewport pixels. Base UI
   * anchors the menu at the raw event coordinates, so the popup landed at 95%
   * of the cursor's position: right in the top-left corner of the screen, and
   * visibly detached — tens of pixels up and to the left — anywhere else.
   *
   * Dividing by the zoom converts the cursor back into the coordinate space
   * the popup is positioned in. It is read off the element that was actually
   * clicked, so a subtree that opts out of the global zoom still gets its menu
   * under the pointer.
   *
   * The 10px box on touch is Base UI's own behaviour, kept: a long press puts
   * a finger over the anchor, and a zero-size one opens the menu under it.
   */
  const anchor = React.useMemo(
    () => ({
      getBoundingClientRect() {
        const point = pointRef.current;
        const size = point?.touch ? 10 : 0;
        return DOMRect.fromRect({
          width: size,
          height: size,
          x: point?.x ?? 0,
          y: point?.y ?? 0,
        });
      },
    }),
    []
  );

  const setPoint = React.useCallback((point: CursorPoint) => {
    pointRef.current = point;
  }, []);

  const value = React.useMemo(() => ({ setPoint, anchor }), [setPoint, anchor]);

  return (
    <CursorPointContext.Provider value={value}>
      <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
    </CursorPointContext.Provider>
  );
}

function ContextMenuTrigger({
  onContextMenuCapture,
  onTouchStartCapture,
  ...props
}: ContextMenuPrimitive.Trigger.Props) {
  const cursor = React.useContext(CursorPointContext);

  // Capture phase, so the point is recorded before Base UI's own handler opens
  // the menu — the two land in the same React commit either way, but capture
  // makes that independent of how the merged handlers end up ordered.
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      onContextMenuCapture={(event) => {
        if (cursor) {
          const zoom = effectiveZoom(event.currentTarget);
          cursor.setPoint({
            x: event.clientX / zoom,
            y: event.clientY / zoom,
            touch: false,
          });
        }
        onContextMenuCapture?.(event);
      }}
      onTouchStartCapture={(event) => {
        const touch = event.touches[0];
        if (cursor && touch) {
          const zoom = effectiveZoom(event.currentTarget);
          cursor.setPoint({
            x: touch.clientX / zoom,
            y: touch.clientY / zoom,
            touch: true,
          });
        }
        onTouchStartCapture?.(event);
      }}
      {...props}
    />
  );
}

/** Shared popup surface — the root menu and every submenu are the same panel. */
const popupClass =
  'glass text-popover-foreground z-50 max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl p-1 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95';

function ContextMenuContent({
  className,
  ...props
}: ContextMenuPrimitive.Popup.Props) {
  const cursor = React.useContext(CursorPointContext);

  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        anchor={cursor?.anchor}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(popupClass, 'min-w-56', className)}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuGroup({ ...props }: ContextMenuPrimitive.Group.Props) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  );
}

function ContextMenuLabel({
  className,
  ...props
}: ContextMenuPrimitive.GroupLabel.Props) {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      className={cn(
        'text-muted-foreground truncate px-2 pt-1.5 pb-1 text-2xs font-semibold',
        className
      )}
      {...props}
    />
  );
}

const itemClass =
  "group/context-menu-item focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

function ContextMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ContextMenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        itemClass,
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20',
        className
      )}
      {...props}
    />
  );
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: ContextMenuPrimitive.CheckboxItem.Props) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(itemClass, 'pr-8', className)}
      checked={checked}
      {...props}
    >
      {children}
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-3.5" />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
    </ContextMenuPrimitive.CheckboxItem>
  );
}

function ContextMenuSub({ ...props }: ContextMenuPrimitive.SubmenuRoot.Props) {
  return (
    <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
  );
}

function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: ContextMenuPrimitive.SubmenuTrigger.Props) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      className={cn(
        itemClass,
        'data-popup-open:bg-accent data-popup-open:text-accent-foreground',
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="text-muted-foreground ml-auto size-3.5" />
    </ContextMenuPrimitive.SubmenuTrigger>
  );
}

function ContextMenuSubContent({
  className,
  ...props
}: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        side="inline-end"
        align="start"
        alignOffset={-4}
        sideOffset={2}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-sub-content"
          className={cn(popupClass, 'min-w-44', className)}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: ContextMenuPrimitive.Separator.Props) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn('bg-border/70 -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        'text-muted-foreground group-focus/context-menu-item:text-accent-foreground ml-auto pl-4 text-2xs tabular-nums',
        className
      )}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
