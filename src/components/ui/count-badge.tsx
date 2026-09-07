import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Um número numa pílula.
 *
 * ------------------------------------------------------------------
 * SEIS CÓPIAS, UMA ASSINATURA
 * ------------------------------------------------------------------
 *
 * Este objeto já existia em `seg-bar`, na lista de conversas (duas vezes),
 * no funil e na lista de contatos (duas vezes), sempre com a mesma medida —
 * `h-4.5 min-w-4.5 rounded-full px-1.5` — e nunca com a mesma escrita:
 * `grid place-items-center` num, `inline-flex items-center justify-center`
 * noutro; `text-2xs font-bold` num, `text-3xs font-semibold` noutro.
 *
 * A medida é o consenso e vem daqui em diante. As divergências eram
 * acidente de digitação, não decisão: nenhuma delas tinha comentário
 * defendendo o desvio.
 *
 * `h-4.5` e não outra altura porque o app tem **duas alturas de chip**, 20px
 * e 18px, e um contador é a família de 18 — o mesmo degrau do
 * `StatusBadge size="sm"`. Um contador de 22px levantaria o ritmo da linha
 * inteira em que ele pousasse.
 *
 * ------------------------------------------------------------------
 * O TOM DIZ O QUE O NÚMERO QUER
 * ------------------------------------------------------------------
 *
 * `neutral` conta; `human` chama. É a doutrina de cor da casa: âmbar é a
 * única "venha aqui" do sistema, e por isso as não-lidas da caixa de entrada
 * usam `human` enquanto a contagem de um grupo usa `neutral`. Um contador
 * âmbar para "quantos itens existem" gastaria o único sinal que o produto
 * tem.
 */
const countBadgeVariants = cva(
  'grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-full px-1.5 text-2xs font-bold tabular-nums',
  {
    variants: {
      tone: {
        /** O padrão: quantos são. */
        neutral: 'bg-muted text-secondary-foreground',
        /** Sobre uma superfície escura ou já tingida — a pastilha do quadro. */
        card: 'bg-card text-secondary-foreground',
        /** Um filtro ligado, uma aba selecionada: onde você está. */
        primary: 'bg-primary text-primary-foreground',
        /** Trabalho esperando por uma pessoa. Não-lidas, e pouco mais. */
        human: 'bg-human-strong text-white',
        /** Invertido, para chamar sem usar cor. */
        inverse: 'bg-foreground text-background',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

export function CountBadge({
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof countBadgeVariants>) {
  return (
    <span
      data-slot="count-badge"
      className={cn(countBadgeVariants({ tone }), className)}
      {...props}
    >
      {children}
    </span>
  );
}

export { countBadgeVariants };
