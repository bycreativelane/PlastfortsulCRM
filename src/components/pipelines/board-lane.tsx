'use client';

import type { ReactNode } from 'react';

import { CountBadge } from '@/components/ui/count-badge';
import { cn } from '@/lib/utils';

/**
 * A raia de uma etapa do funil: cabeçalho e corpo, sem o arrasto.
 *
 * ------------------------------------------------------------------
 * POR QUE ELA SAIU DO `pipeline-board.tsx`
 * ------------------------------------------------------------------
 *
 * O quadro inteiro vive atrás do login, e é por isso que um redesenho dele
 * vinha sendo feito sobre maquetes. O `chart-lab.tsx` explica o problema em
 * três parágrafos: *"uma maquete reproduz a marcação em que o próprio autor
 * já acredita; ela não mostra o defeito que vem da forma real do dado, da
 * largura real ou do que o componente de verdade emite."*
 *
 * Separar a raia do arrasto é o que deixa o `/chart-lab` montar a PEÇA REAL
 * contra fixtures. O `pipeline-board` continua dono do droppable, do sensor
 * e da ordenação; o que mora aqui é só o desenho.
 */
export interface BoardLaneProps {
  /**
   * A bolinha do cabeçalho, de um jeito ou de outro.
   *
   * O funil guarda a cor da etapa como hex no banco, então ela só pode vir
   * por `style`. O quadro de tarefas não tem cor de dado nenhuma: as três
   * colunas são estados do sistema, e a cor deles é um token (`bg-human`,
   * `bg-ok`). Forçar um dos dois no formato do outro significaria ou
   * resolver token para hex em JS, ou inventar uma classe por etapa.
   */
  color?: string;
  colorClass?: string;
  name: string;
  count: number;
  /** A segunda linha do cabeçalho — o total em dinheiro, quando há um. */
  subtitle?: ReactNode;
  /** Aceso enquanto um cartão está sendo arrastado sobre a raia. */
  isOver?: boolean;
  /** O `ref` do droppable, que pertence ao CORPO e não à raiz — assim um
   *  arrasto sobre o cabeçalho não acende a coluna inteira. */
  bodyRef?: (node: HTMLElement | null) => void;
  /** Preso ao pe da raia, fora da rolagem: o "+ adicionar". */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function BoardLane({
  color,
  colorClass,
  name,
  count,
  subtitle,
  isOver = false,
  bodyRef,
  footer,
  children,
  className,
}: BoardLaneProps) {
  return (
    // Uma raia rebaixada, e não um cartão. A coluna é o recipiente em que os
    // cartões estão, então ela toma a superfície apagada e eles tomam o
    // branco — o contrário de uma caixa com borda segurando caixas com
    // borda, que achata a pilha num retângulo cinza só.
    <div
      className={cn(
        'bg-muted flex w-[85vw] max-w-[320px] min-w-[260px] shrink-0 snap-start flex-col overflow-hidden rounded-xl lg:w-auto lg:max-w-none lg:flex-1 lg:shrink lg:basis-[260px] lg:snap-none',
        className
      )}
    >
      {/*
        A BOLINHA NA COR DA ETAPA, e não mais a régua de 2px no topo.

        As referências fazem isto sem exceção — o cabeçalho é bolinha + nome
        + contagem, e nenhuma delas põe uma faixa colorida presa ao topo da
        coluna. A régua respondia à mesma pergunta ("onde eu estou, com dez
        etapas rolando de lado") e cobrava uma banda inteira por ela, além de
        prender a cor no canto mais distante do nome que ela qualifica.

        A bolinha fica ao lado do nome, que é onde o olho já está.
      */}
      <div className="shrink-0 px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", colorClass)}
            style={color ? { backgroundColor: color } : undefined}
          />
          <h3 className="text-foreground min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
            {name}
          </h3>
          <CountBadge tone="card">{count}</CountBadge>
        </div>
        {subtitle ? (
          <p className="text-muted-foreground text-2xs mt-0.5 pl-4 font-medium tabular-nums">
            {subtitle}
          </p>
        ) : null}
      </div>

      {/* `overflow-y-auto`: a COLUNA rola, não a página. */}
      <div
        ref={bodyRef}
        className={cn(
          'flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors duration-(--dur-1)',
          isOver && 'bg-primary-soft'
        )}
      >
        {children}
      </div>

      {/* O "+ adicionar" fica FORA do corpo que rola, e nao no fim da lista.
          As referencias o poem no fim da coluna, mas elas mostram colunas
          curtas: numa com trinta negocios ele viraria um botao que so existe
          depois de rolar ate o fundo. Preso embaixo, ele esta sempre a um
          clique de distancia — a forma e a das referencias, o lugar nao. */}
      {footer}
    </div>
  );
}
