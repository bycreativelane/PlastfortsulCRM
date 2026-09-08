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
 * E O DEGRAU DE 16px, QUE PARECE VIOLAR ISSO
 * ------------------------------------------------------------------
 *
 * `dot` é 16px, e o motivo de não ser uma terceira altura de chip é a razão
 * pela qual a lei existe. O `status-badge.tsx` a escreve assim: *"o olho
 * alinha uma linha pela peça mais alta, então um chip de 22px levanta o
 * ritmo da linha de 20 ao lado dele."* A lei é sobre chips que dividem uma
 * LINHA.
 *
 * O `dot` nunca divide uma. Ele pousa em cima de um ícone — a sineta, o
 * ícone da aba do celular — ou logo ao lado de um, e não tem vizinho com
 * quem se alinhar. Aos 18px ele encobre uma sineta de 18: o menu de
 * notificações tem um comentário inteiro sobre isso, escrito depois de o
 * ícone ser descrito como *"ofuscado"*.
 *
 * As quatro chamadas que usam esta medida a escreviam de quatro jeitos —
 * `font-bold` e `font-semibold`, `px-1` e nenhum padding, `min-w-4` e
 * `size-4`. A última delas, no painel de acessos, quebra com dois dígitos:
 * um disco de largura fixa não cresce, e onze exceções saem por fora do
 * círculo. `min-w-4 px-1` é o par que resolve, e agora é o único.
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
  'grid shrink-0 place-items-center rounded-full font-bold tabular-nums',
  {
    variants: {
      size: {
        /** 18px — o contador ao lado de um rótulo, numa linha de chips. */
        default: 'h-4.5 min-w-4.5 px-1.5 text-2xs',
        /** 16px — o que pousa SOBRE um ícone. Ver a nota acima. */
        dot: 'h-4 min-w-4 px-1 text-3xs',
      },
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
    defaultVariants: { size: 'default', tone: 'neutral' },
  }
);

export function CountBadge({
  size,
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof countBadgeVariants>) {
  return (
    <span
      data-slot="count-badge"
      className={cn(countBadgeVariants({ size, tone }), className)}
      {...props}
    >
      {children}
    </span>
  );
}

export { countBadgeVariants };
