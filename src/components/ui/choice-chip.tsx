'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Uma escolha entre poucas, e exatamente uma vale por vez.
 *
 * ------------------------------------------------------------------
 * POR QUE NÃO É O `FilterChip`
 * ------------------------------------------------------------------
 *
 * A forma é o que separa os dois, e ela é significado nesta casa: pílula é
 * ESTADO, retângulo é ESCOLHA. O `FilterChip` é `rounded-full` e a sua nota
 * o define como a resposta a "quais não" — uma fileira onde vários podem
 * estar ligados ao mesmo tempo.
 *
 * Aqui a pergunta é outra: o resultado de uma ligação, o prazo de uma compra
 * futura. São opções mutuamente exclusivas, e o que estava escrito à mão em
 * três arquivos era o mesmo retângulo:
 *
 *   'h-7 rounded-md border px-2.5 text-xs font-semibold transition-colors'
 *
 * idêntico, caractere por caractere, em `call-log-dialog`, em
 * `future-purchase-dialog` e na agenda da visão geral.
 *
 * ------------------------------------------------------------------
 * O QUE MUDA DE FATO
 * ------------------------------------------------------------------
 *
 * `size="sm"` do `Button` JÁ é `h-7 px-2.5 text-xs rounded-md`, então a
 * geometria é a mesma que estava lá. O que entra é o que só o `Button` traz:
 * o anel de foco de 3px da casa e o escudo de toque de 44px que o
 * `globals.css` concede a `[data-slot='button']` — e o `aria-pressed`, que
 * hoje só um dos três chamadores escrevia. Nos outros, quem usa leitor de
 * tela não tinha como saber qual opção estava escolhida.
 */
export function ChoiceChip({
  active,
  onClick,
  disabled,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'rounded-md font-semibold',
        active &&
          'border-primary bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
        className
      )}
    >
      {children}
    </Button>
  );
}
