'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        'bg-overlay fixed inset-0 z-50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm',
        className
      )}
      {...props}
    />
  );
}

/**
 * THE SHEET IS A FRAME, NOT A SCROLLER. Do not add `overflow-y-auto`
 * here.
 *
 * You will want to. `dialog.tsx` took exactly that fix — it had no
 * height limit and long forms ran off both ends of the screen — and the
 * symmetry is inviting. It is also wrong, and the difference is not
 * taste:
 *
 *   A Dialog is a box whose content decides its height, so the box has
 *   to cap itself.
 *
 *   A Sheet is already exactly the height of the viewport edge it is
 *   pinned to (`inset-y-0` + `h-full`). It has no height decision to
 *   make — only a DIVISION of it, into a header that stays and a body
 *   that moves — and that division belongs to the thing that knows what
 *   the parts are, which is the call site.
 *
 * So every call site owns `flex h-full flex-col` with one
 * `flex-1 overflow-y-auto` in the middle: `deal-form.tsx`,
 * `contact-detail-view.tsx` (per tab), `flow-canvas.tsx`. Adding a
 * scroller here would wrap each of those in a second one — a scrollbar
 * inside a scrollbar, which is the exact shape of the bug that produced
 * "barra de rolagem aparecendo na guia".
 *
 * Below `sm:` every side sheet is `w-full`, not `w-3/4`: three quarters
 * of a 360px phone is 270px, which is not a width anybody would choose
 * for a form. Above it, see the width note on `sheetContentVariants`.
 */
/**
 * THE WIDTH IS A VARIANT, and that is not a matter of taste.
 *
 * The base string used to carry `data-[side=left]:sm:max-w-sm
 * data-[side=right]:sm:max-w-sm` while every call site passed
 * `sm:max-w-lg` on top of it. The base won all three times: it compiles
 * to `.utility[data-side="right"]`, specificity (0,2,0) against a plain
 * utility's (0,1,0), same layer and same media query. So three sheets
 * asked for 32rem and every one of them rendered at 24rem.
 *
 * `cn()` cannot rescue that — tailwind-merge collapses two classes only
 * when their modifiers match, and `data-[side=right]:sm:` is not `sm:`.
 * Nothing in the diff looks wrong, no test can see it, and the only
 * symptom is a panel that feels tight. Which is how it survived long
 * enough for five tabs to get blamed for not fitting inside it.
 *
 * As a variant exactly one max-width class reaches the element, so the
 * name at the call site is what renders. The `data-[side=...]` prefix
 * stays: a bottom sheet must not inherit a side sheet's cap.
 *
 *   panel  (24rem) - a strip beside the thing it configures
 *   form   (32rem) - one column of fields
 *   record (42rem) - a record with tabs; two columns of fields at `sm:`
 */
const sheetContentVariants = cva(
  'fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-full data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-full data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem]',
  {
    variants: {
      size: {
        panel: 'data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm',
        form: 'data-[side=left]:sm:max-w-lg data-[side=right]:sm:max-w-lg',
        record: 'data-[side=left]:sm:max-w-2xl data-[side=right]:sm:max-w-2xl',
      },
    },
    defaultVariants: { size: 'panel' },
  }
);

function SheetContent({
  className,
  children,
  side = 'right',
  size,
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props &
  VariantProps<typeof sheetContentVariants> & {
    side?: 'top' | 'right' | 'bottom' | 'left';
    showCloseButton?: boolean;
  }) {
  // Same label, same reason, same namespace as `dialog.tsx`.
  const tCommon = useTranslations('Common');
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(sheetContentVariants({ size }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">{tCommon('close')}</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-0.5 p-4', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        'font-heading text-foreground text-base font-medium',
        className
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  sheetContentVariants,
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
