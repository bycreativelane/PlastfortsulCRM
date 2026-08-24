import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * SIDE PADDING IS PROPORTIONAL TO HEIGHT. It was not: `xs` (24px tall),
 * `default` (32) and `lg` (36) all carried 10px of side padding, so the
 * taller a button got the more cramped it looked — a 36px control with
 * a 24px control's gutters reads as a label someone stretched. The ramp
 * is now 8 · 10 · 12 · 14 against heights 24 · 28 · 32 · 36.
 *
 * The `has-data-[icon=inline-start]` optical compensations are gone.
 * They were the right idea — an icon has less optical mass than a
 * letter, so the padding on its side should be tighter — and they were
 * wired to a `data-icon` attribute that ZERO call sites in this
 * codebase ever set. A rule that never fires is not a subtlety, it is
 * four dead selectors in the class string of every button in the app.
 * If the compensation comes back it has to come back with the attribute
 * that triggers it.
 *
 * The three `rounded-[min(var(--radius-md),Npx)]` clamps are gone too:
 * `--radius-md` is `--radius × 0.8` = 6.4px, permanently below both
 * clamps, so `min()` returned the same value the plain utility does.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // `--primary-hover` and not `bg-primary/80`: the accent blocks in
        // globals.css already define a hover value per accent AND per
        // mode, tuned so the dark-mode button (which is light ink on a
        // light accent) gets BRIGHTER on hover instead of washing out.
        // An alpha ramp would go the wrong way there.
        //
        // This used to read `[a]:hover:bg-primary/80`, which Tailwind
        // compiles to `:is(a):hover` — the element itself must be an
        // anchor. Every primary button in the app that renders as a real
        // `<button>` therefore had no hover state at all: the main call
        // to action on every screen was the one control that did not
        // answer the pointer.
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 gap-1.5 px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-2xs in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-2 px-3.5',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7 rounded-md in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
