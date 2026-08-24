'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/**
 * A password field you can look at.
 *
 * Worth the button: the most common reason a sign-in fails is a typo nobody
 * can see, and the usual response — retype it, fail again, reset the password
 * — costs an email round trip over a mistyped character. Being able to check
 * turns that into two seconds.
 *
 * The toggle is `type="button"`; without that it submits the form on click,
 * which in a login form means attempting a sign-in with whatever is typed so
 * far. It is also `tabIndex={-1}` — tabbing from the password field should
 * reach the submit button, not a decoration.
 *
 * State is local on purpose. Remembering "shown" across fields or across
 * sessions would leave a password visible on a screen somebody walked away
 * from, and the whole point is that revealing it is a deliberate act.
 */
function PasswordInput({
  className,
  showLabel,
  hideLabel,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'> & {
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        className="text-muted-foreground hover:text-foreground absolute top-0 right-0 grid h-full w-10 place-items-center transition-colors"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export { PasswordInput };
