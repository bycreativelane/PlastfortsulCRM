import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The heading that splits a page into what needs a person and what does not.
 *
 * Small, uppercase, tracked out — it is a divider that happens to have words,
 * not a title competing with the content under it.
 *
 * The tone is the exception to the grey rule, and it earns it: on the dashboard
 * these headings are what tell you, before you have read a single row, which
 * half of the page is asking something of you. "Precisa de você" in amber over
 * "O CRM fez hoje" in grey IS the product's thesis, rendered.
 */
const sectionTitleVariants = cva(
  'mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider [&>svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'text-muted-foreground',
        human: 'text-human-ink',
        auto: 'text-auto-ink',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

function SectionTitle({
  className,
  tone,
  ...props
}: React.ComponentProps<'h2'> & VariantProps<typeof sectionTitleVariants>) {
  return (
    <h2
      data-slot="section-title"
      className={cn(sectionTitleVariants({ tone }), className)}
      {...props}
    />
  );
}

export { SectionTitle, sectionTitleVariants };
