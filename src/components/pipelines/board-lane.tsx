'use client';

import type { ReactNode } from 'react';

import { Plus } from 'lucide-react';

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
  /**
   * O slot tracejado do pé da coluna. Sem isto ele não aparece — a coluna
   * "concluída" do quadro de tarefas não tem "adicionar", porque criar uma
   * tarefa já concluída não é uma ação que exista.
   */
  onAdd?: () => void;
  addLabel?: string;
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
  onAdd,
  addLabel,
  children,
  className,
}: BoardLaneProps) {
  return (
    /*
     * A COLUNA NÃO TEM FUNDO.
     *
     * Ela era uma raia cinza preenchida, com o argumento de que a superfície
     * apagada faz os cartões brancos saltarem. Seis das oito referências
     * fazem o contrário: a coluna é transparente sobre o canvas da página e
     * quem separa o cartão é a SOMBRA dele. A sétima (o Bond CRM) tinge a
     * coluna, mas com um tom por etapa — creme, rosa, lavanda — que a
     * doutrina de cor daqui veta.
     *
     * Enquanto o cartão tinha borda e nenhuma sombra, a raia era o que dava
     * separação e o argumento se sustentava. Com o `--card-shadow` ela
     * virou um segundo retângulo em volta de retângulos — e é exatamente o
     * "caixas cinzas contendo caixas brancas" que aquelas telas evitam.
     *
     * O que segura a coluna sem o fundo é a régua fina sob o cabeçalho, que
     * é o que as imagens 6, 7 e 8 usam no lugar dele.
     */
    <div
      className={cn(
        'flex w-[85vw] max-w-[320px] min-w-[260px] shrink-0 snap-start flex-col rounded-xl lg:w-auto lg:max-w-none lg:flex-1 lg:shrink lg:basis-[260px] lg:snap-none',
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
      {/*
        Mais quieto do que era. O cabeçalho estava em `text-sm font-bold`
        com uma pílula de contagem, o que numa coluna sem fundo vira a coisa
        mais pesada da tela. Nas referências ele é uma linha pequena —
        "● To Do · 26" — e o que ele tem de fazer é dizer onde você está, não
        competir com os cartões que ele encima.

        A régua embaixo é o que dá borda à coluna agora que ela não tem
        fundo; `px-1` porque ela tem de alinhar com a borda dos cartões, e
        eles vivem num corpo com `px-1` de folga.
      */}
      <div className="border-border/70 mx-1 shrink-0 border-b px-1 pt-1 pb-2">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn('size-2 shrink-0 rounded-full', colorClass)}
            style={color ? { backgroundColor: color } : undefined}
          />
          <h3 className="text-foreground min-w-0 truncate text-xs font-semibold">
            {name}
          </h3>
          <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
            · {count}
          </span>
          {subtitle ? (
            <span className="text-muted-foreground text-2xs ml-auto shrink-0 font-semibold tabular-nums">
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>

      {/* `overflow-y-auto`: a COLUNA rola, não a página. */}
      <div
        ref={bodyRef}
        className={cn(
          // `gap-2.5` e não `gap-2`: sem o fundo da raia, o que agrupa uma
          // coluna é o espaçamento, e ele tem de ser maior do que o espaço
          // interno do cartão para a pilha ler como pilha.
          'flex flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl px-1 pt-2.5 pb-2 transition-colors duration-(--dur-1)',
          isOver && 'bg-primary-soft'
        )}
      >
        {children}
      </div>

      {/*
        O SLOT TRACEJADO das referências, e ele fica FORA do corpo que rola.

        As imagens o põem no fim da coluna, mas elas mostram colunas curtas:
        numa com trinta negócios ele viraria um botão que só existe depois de
        rolar até o fundo. Preso embaixo, está sempre a um clique — a forma é
        a das referências, o lugar não.

        Tracejado e na cor da etapa porque é um lugar VAZIO esperando um
        cartão, e não uma ação secundária qualquer; era um botão fantasma
        cinza, indistinguível de qualquer outro. É o único ponto do quadro
        onde a cor da etapa reaparece depois da bolinha, e aqui ela diz "aqui
        dentro", não "olhe para mim".
      */}
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="text-muted-foreground hover:text-foreground mx-1 mb-1 flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl border border-dashed text-xs font-medium transition-colors duration-(--dur-1)"
          style={color ? { borderColor: color } : undefined}
        >
          <Plus className="size-3.5" />
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}
