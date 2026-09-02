'use client';

import * as React from 'react';
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

// Root: primary token when checked or indeterminate (responds to the active
// color theme), `--control` when unchecked.
//
// `--control` and not `--input`: this is a 16px square with nothing
// inside it, so its border is the entire component — it carries the 3:1
// WCAG 1.4.11 asks of a boundary, and `theme-contrast.test.ts` pins it.
// A text field borrows the lighter `--input`, because it has a label
// over it, a placeholder in it and a fill under it. See the token note
// in globals.css.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer border-control bg-card size-4 shrink-0 cursor-pointer rounded-[4px] border shadow-sm transition-colors',
        'focus-visible:ring-primary focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground',
        'data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        {props.indeterminate ? (
          <Minus className="size-3.5" />
        ) : (
          <Check className="size-3.5" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
