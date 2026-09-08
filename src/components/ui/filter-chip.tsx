'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Um chip de filtro: ligado ou desligado, e nada além disso.
 *
 * ------------------------------------------------------------------
 * DUAS TELAS, DUAS ESCRITAS
 * ------------------------------------------------------------------
 *
 * O funil tinha o `OwnerChip` e `/tasks` tinha um `<button>` cru com
 * `rounded-full border px-2.5 py-1`. O mesmo objeto — uma linha de opções
 * onde clicar liga e desliga — e três diferenças que ninguém decidiu:
 *
 *   altura       32px (do `Button`) · a que o `line-height` desse
 *   foco         anel do `Button`   · nenhum
 *   toque        alvo de 44px       · 26px
 *
 * As duas últimas não são estética. Abaixo de `sm` estes chips vivem numa
 * gaveta e são a única coisa que alguém toca ali; um alvo de 26px num dedo é
 * o que faz a pessoa errar e fechar a gaveta. O `Button` já carrega o escudo
 * de ponteiro grosso, o anel de foco e o estado de pressionado — é por isso
 * que este componente é um `Button` e não um `<button>` estilizado, e a
 * decisão já estava escrita no `OwnerChip`.
 *
 * ------------------------------------------------------------------
 * AZUL LAVADO QUANDO LIGADO, E POR QUE NÃO ÂMBAR
 * ------------------------------------------------------------------
 *
 * "Onde eu estou" é estado, e a doutrina de cor reserva `primary` para
 * exatamente isso — onde você está e o que dá para apertar. Âmbar é a única
 * "venha aqui" do sistema e uma fileira de chips âmbar competiria com o
 * trabalho de verdade que o quadro sinaliza.
 *
 * O desligado não some: ele fica na superfície do cartão, legível. Em
 * `/tasks` o desligado vinha com `opacity-60`, o que apagava o rótulo
 * exatamente quando ele é a informação que interessa — qual filtro está
 * fora.
 */
export function FilterChip({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-2.5 font-semibold',
        active
          ? 'border-primary-soft-2 bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary'
          : 'bg-card dark:bg-card text-secondary-foreground',
        className
      )}
    >
      {children}
    </Button>
  );
}
