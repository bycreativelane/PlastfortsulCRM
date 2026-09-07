import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * O quadrado tingido que segura um ícone à esquerda de uma linha.
 *
 * ------------------------------------------------------------------
 * O QUE FAZ SEIS TELAS PARECEREM DA MESMA FAMÍLIA
 * ------------------------------------------------------------------
 *
 * O painel da agenda, a faixa do cabeçalho, o menu e a página de
 * notificações, a lista e os modelos de automações e o catálogo de produtos
 * abrem a linha com o mesmo objeto — e cada um o escreveu à mão. O resultado
 * é uma família visual que existe por coincidência, com quatro tamanhos e
 * quatro raios que ninguém escolheu de propósito.
 *
 * Este componente é a escada, e ela é curta por decisão: o raio ACOMPANHA o
 * tamanho em vez de ser um segundo eixo. Um ladrilho de 24px com
 * `rounded-lg` vira uma pastilha; um de 36px com `rounded-md` fica duro. As
 * combinações que sobravam eram digitação, não desenho.
 *
 * ------------------------------------------------------------------
 * DECORATIVO, NÃO CLICÁVEL
 * ------------------------------------------------------------------
 *
 * Se o ícone É a ação, isto é o componente errado — use
 * `<Button variant="ghost" size="icon">`, que já existe e já tem o hover, o
 * foco e o estado desabilitado. Doze arquivos escrevem esse botão à mão
 * hoje, e confundir os dois foi o que fez esta peça parecer maior do que é.
 *
 * Por ser decorativo, o ladrilho é `aria-hidden`: o significado dele já está
 * no texto ao lado, e um leitor de tela anunciando "imagem" antes de cada
 * linha é ruído puro.
 */
const iconTileVariants = cva(
  'grid shrink-0 place-items-center [&>svg]:shrink-0',
  {
    variants: {
      size: {
        /** 24px — linhas densas: a faixa do cabeçalho, o menu do sino. */
        xs: 'size-6 rounded-md [&>svg]:size-3.5',
        /** 28px — o padrão de linha de lista. */
        sm: 'size-7 rounded-md [&>svg]:size-4',
        /** 32px — item de catálogo, cartão de modelo. */
        md: 'size-8 rounded-md [&>svg]:size-4',
        /** 36px — cabeçalho de painel, item de lista com duas linhas. */
        lg: 'size-9 rounded-lg [&>svg]:size-4.5',
      },
      tone: {
        /** O padrão. Cinza é a resposta certa quase sempre. */
        neutral: 'bg-muted text-muted-foreground',
        /** Trabalho de máquina — cinza DE PROPÓSITO, ver a doutrina de cor. */
        auto: 'bg-auto-soft text-auto-ink',
        /** Uma pessoa precisa agir. O único "venha aqui" do sistema. */
        human: 'bg-human-soft text-human-ink',
        /** Confirmado. Com parcimônia. */
        ok: 'bg-ok-soft text-ok-ink',
        /** Falhou, quebrou, foi perdido. */
        danger: 'bg-danger-soft text-danger-ink',
        /** Onde você está, ou o que dá para apertar — nunca "importante". */
        primary: 'bg-primary-soft text-primary',
      },
    },
    defaultVariants: { size: 'sm', tone: 'neutral' },
  }
);

export function IconTile({
  size,
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof iconTileVariants>) {
  return (
    <span
      data-slot="icon-tile"
      aria-hidden
      className={cn(iconTileVariants({ size, tone }), className)}
      {...props}
    >
      {children}
    </span>
  );
}

export { iconTileVariants };
