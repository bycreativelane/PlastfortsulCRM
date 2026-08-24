import * as React from 'react';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

/**
 * The prototype's form-field pair — `.field` and `.field__l`.
 *
 * The label is deliberately smaller and heavier than shadcn's `Label`
 * (12px/650 secondary, not 14px/500 foreground). In a settings screen that is
 * mostly forms, a label at the same size as the value it describes makes every
 * row read as two competing lines; dropping it a step and weighting it up
 * turns it into a caption for the input rather than a peer of it.
 *
 * `FieldLabel` wraps shadcn's `Label` rather than rendering a bare `<label>`
 * so the htmlFor wiring, the peer-disabled styling, and the Radix behaviour
 * all survive the restyle.
 */

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="field" className={cn('mb-3.5', className)} {...props} />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'text-secondary-foreground mb-1 block text-xs font-semibold',
        className
      )}
      {...props}
    />
  );
}

export { Field, FieldLabel };
