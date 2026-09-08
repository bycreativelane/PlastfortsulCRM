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
 * DUAS PINTURAS, E A REGRA QUE ESCOLHE
 * ------------------------------------------------------------------
 *
 * O `fill` não é gosto. `soft` é o padrão e serve a quase tudo: o ladrilho
 * abre a linha e o texto ao lado é que carrega o conteúdo.
 *
 * `solid` existe para o caso em que **o quadrado é o único lugar onde o tom
 * aparece na peça inteira** — o ladrilho do `StatTile` e o da linha de
 * atenção do painel. O comentário original dos dois já dizia a mesma coisa
 * com as mesmas palavras, cada um no seu arquivo: *"a wash would read as a
 * smudge in the corner"*. Uma regra escrita duas vezes em dois lugares é uma
 * regra do sistema que ainda não tinha casa.
 *
 * `ok` não tem sólido, e isso é do desenho, não um esquecimento: não existe
 * `--ok-solid` no `globals.css` porque confirmado é a informação menos
 * urgente do produto e nunca precisou gritar. Pedir `fill="solid"
 * tone="ok"` devolve o lavado.
 *
 * Toda a cor mora nos `compoundVariants` e as variantes de `tone` são
 * vazias de propósito. A alternativa — tom pintando o lavado e o composto
 * pintando por cima — só funciona porque o `cn` passa por `twMerge`, e daria
 * a cor errada para quem chamasse `iconTileVariants` cru, como o `StatTile`
 * faz. Uma peça não deve depender de quem a chama lembrar de limpá-la.
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
      /** A cor vem dos compostos abaixo — ver a nota no topo. */
      tone: { neutral: '', auto: '', human: '', ok: '', danger: '', primary: '' },
      fill: { soft: '', solid: '' },
    },
    compoundVariants: [
      /* O LAVADO. Cinza é a resposta certa quase sempre. */
      { fill: 'soft', tone: 'neutral', class: 'bg-muted text-muted-foreground' },
      /* Trabalho de máquina — cinza DE PROPÓSITO, ver a doutrina de cor. */
      { fill: 'soft', tone: 'auto', class: 'bg-auto-soft text-auto-ink' },
      /* Uma pessoa precisa agir. O único "venha aqui" do sistema. */
      { fill: 'soft', tone: 'human', class: 'bg-human-soft text-human-ink' },
      /* Confirmado. Com parcimônia. */
      { fill: 'soft', tone: 'ok', class: 'bg-ok-soft text-ok-ink' },
      /* Falhou, quebrou, foi perdido. */
      { fill: 'soft', tone: 'danger', class: 'bg-danger-soft text-danger-ink' },
      /* Onde você está, ou o que dá para apertar — nunca "importante". */
      { fill: 'soft', tone: 'primary', class: 'bg-primary-soft text-primary' },

      /* O SÓLIDO. Só quando o quadrado é o único portador do tom na peça. */
      { fill: 'solid', tone: 'human', class: 'bg-human-strong text-white' },
      { fill: 'solid', tone: 'danger', class: 'bg-danger-solid text-white' },
      {
        fill: 'solid',
        tone: 'primary',
        class: 'bg-primary text-primary-foreground',
      },
      /* Não existe cinza sólido: o quieto continua lavado nos dois modos, e
         é assim que ele se distingue do que grita ao lado. */
      {
        fill: 'solid',
        tone: ['neutral', 'auto'],
        class: 'bg-muted text-secondary-foreground',
      },
      { fill: 'solid', tone: 'ok', class: 'bg-ok-soft text-ok-ink' },
    ],
    defaultVariants: { size: 'sm', tone: 'neutral', fill: 'soft' },
  }
);

export function IconTile({
  size,
  tone,
  fill,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof iconTileVariants>) {
  return (
    <span
      data-slot="icon-tile"
      aria-hidden
      className={cn(iconTileVariants({ size, tone, fill }), className)}
      {...props}
    >
      {children}
    </span>
  );
}

export { iconTileVariants };
