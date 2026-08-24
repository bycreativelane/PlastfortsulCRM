'use client';

import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';

import { cn } from '@/lib/utils';

/**
 * IN A FLEX COLUMN THIS NEEDS `min-h-0`, not just `flex-1`.
 *
 * A flex item's `min-height` is `auto`, which means it will not shrink
 * below its content. Give this `flex-1` on its own inside a
 * `flex flex-col` parent and the Root grows to the full height of the
 * children instead of to the space available — the Viewport is
 * `size-full`, so it matches, `scrollHeight === clientHeight`, and the
 * component scrolls nothing while an ancestor with `overflow-hidden`
 * quietly clips whatever did not fit.
 *
 * It is silent in exactly the way that matters: no error, no scrollbar,
 * and a panel that looks finished at whatever row the fold landed on.
 * The contact sidebar shipped like that.
 *
 *     <ScrollArea className="min-h-0 flex-1">   ✅
 *     <ScrollArea className="flex-1">           ❌ clips
 */
function ScrollArea({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
