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

/**
 * A LINHA de formulário: rótulo, controle, e a dica embaixo.
 *
 * Nasceu dentro do `product-catalog.tsx` com o nome `Field`, que já era o
 * nome de outra coisa neste arquivo — um `div` de margem, sem rótulo
 * nenhum. Duas assinaturas incompatíveis sob a mesma palavra é o tipo de
 * coisa que só dá errado no dia em que alguém importa a errada.
 *
 * A DICA VEM DEPOIS DO CONTROLE. No catálogo ela vinha antes, e o efeito é
 * o que o cabeçalho deste arquivo descreve ao contrário: entre o rótulo e
 * o campo, a dica separa os dois e vira mais um par de linhas
 * competindo; embaixo, ela é legenda do que acabou de ser lido. É a ordem
 * que o formulário de contato já usava.
 */
function FieldRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export { Field, FieldLabel, FieldRow };
