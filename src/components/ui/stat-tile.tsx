import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A count with a caption — the unit the dashboard is built out of.
 *
 *   ┌──────────────────────────────┐
 *   │  ▣                           │   icon
 *   │                              │
 *   │  5                           │   the number, at display size
 *   │  na fila, sem responsável    │   what it counts
 *   └──────────────────────────────┘
 *
 * ------------------------------------------------------------------
 * THE TILE THAT WANTS SOMETHING IS FILLED. THE OTHERS ARE NOT.
 * ------------------------------------------------------------------
 *
 * Every tile used to be the identical 1px frame on the identical card,
 * and the only difference between "five conversations have nobody on
 * them" and "zero automations failed" was the fill of a 36px icon
 * square in the corner. On a row of four that is a signal you have to
 * go looking for, in the section of the product whose entire promise is
 * that you do NOT have to go looking.
 *
 * The tone paints the ICON SQUARE AND THE FIGURE. Not the surface.
 *
 * A filled tile was the first answer and it over-corrected: six of them
 * on the broadcast report, two washed, reads as a striped grid, and the
 * eye sorts the stripes before it reads a digit. A 36px solid square
 * and a 32px figure carry the same signal in a fraction of the ink —
 * from two paces the row still answers "is there anything for me", and
 * a clear morning is a set of quiet cards with grey numbers on them.
 *
 * This needs no new prop, because the call sites already make the
 * decision: the dashboard passes `tone={queue?.unread ? 'human' :
 * 'auto'}` and the broadcast page passes `danger` only when something
 * actually failed. The tone was always the answer to "does this
 * matter"; it was just being shouted.
 *
 * Amber and red keep their existing meanings and the distinction
 * between them: amber is "your turn", red is "something broke".
 *
 * ------------------------------------------------------------------
 * VERTICAL, AND WHY THE NUMBER GREW
 * ------------------------------------------------------------------
 *
 * It was icon-left, number-and-label-right, with the number at 24px.
 * Four of those across a 1400px page spent most of their width on air
 * to the right of a two-word caption while the figure — the only thing
 * anybody reads at a glance — was the same size as a panel title.
 *
 * Stacked, the number gets `text-display` and the caption gets the full
 * width of the tile, so it wraps less. The tile is ~30px taller and
 * says its one thing at four times the volume.
 *
 * Renders as a plain div and is not focusable; the dashboard wraps it
 * in a link when a tile names a queue you can open.
 */

/**
 * `h-full` is what keeps a ROW of these aligned.
 *
 * A grid stretches its items, so the cell is as tall as the tallest
 * tile — but the tile itself was only `w-full`, so its bordered box
 * kept its own content height and sat at the top of a taller cell. One
 * label wrapping to two lines was enough: that tile grew, and the other
 * three drew their frames short of the row, which reads as three
 * misaligned boxes rather than as one long label.
 */
const tileVariants = cva(
  'flex h-full w-full flex-col items-start gap-3 rounded-xl border p-4 text-left',
  {
    variants: {
      // NO TONE ON THE SURFACE. Every tile is the same card on the same
      // border; the tone lives in the icon square and the figure, and
      // nowhere else. See the note above the component.
      interactive: {
        true: 'transition-shadow hover:shadow-sm',
        false: '',
      },
    },
    defaultVariants: { interactive: false },
  }
);

/**
 * The NUMBER's ink, following the same tone as the tile.
 *
 * A tile in the `auto` tone is reporting, not asking. It had a grey
 * icon and then printed its number in full-strength foreground — so on
 * a quiet morning the loudest things on the landing page were three
 * zeros, and the one tile with actual work in it carried no more weight
 * than they did.
 *
 * On the two filled tones the number takes the tint's own ink, which is
 * the pair `theme-contrast.test` measures (`--human-700` on
 * `--human-50`, `--danger-700` on `--danger-50`). Neither is a fill, so
 * neither needs a white.
 */
const tileValueVariants = cva(
  'text-display font-bold tracking-tight tabular-nums',
  {
    variants: {
      tone: {
        human: 'text-human-ink',
        danger: 'text-danger-ink',
        auto: 'text-muted-foreground',
        neutral: 'text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

/**
 * The caption. Neutral on every tone: it is the same sentence whether
 * the number is 0 or 7, and colouring it would be the tone saying a
 * third time what the square and the figure have already said.
 */
const tileLabelVariants = cva(
  'text-secondary-foreground text-sm leading-tight font-medium'
);

const tileIconVariants = cva(
  'grid size-9 shrink-0 place-items-center rounded-lg [&>svg]:size-4.5',
  {
    variants: {
      tone: {
        // The SOLID, not the tint. This square is now the only place
        // the tone exists on the tile, so it has to be unambiguous at
        // 36px — a wash would read as a smudge in the corner.
        human: 'bg-human-strong text-white',
        auto: 'bg-muted text-secondary-foreground',
        danger: 'bg-danger-solid text-white',
        neutral: 'bg-muted text-secondary-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

interface StatTileProps
  extends
    Omit<React.ComponentProps<'div'>, 'title'>,
    VariantProps<typeof tileIconVariants> {
  icon: React.ReactNode;
  /** The number. Kept as a node so a tile can show "R$ 14.800" too. */
  value: React.ReactNode;
  /** What the number counts. Two short lines read better than one long one. */
  label: React.ReactNode;
}

function StatTile({
  className,
  icon,
  value,
  label,
  tone,
  ...props
}: StatTileProps) {
  return (
    <div
      data-slot="stat-tile"
      data-tone={tone ?? 'neutral'}
      className={cn(tileVariants({ interactive: false }), className)}
      {...props}
    >
      <span className={tileIconVariants({ tone })}>{icon}</span>
      {/* `mt-auto` pins the pair to the bottom, so a caption that wraps
          to two lines in one tile does not lift its number above the
          others beside it. One row, one baseline. */}
      <div className="mt-auto w-full min-w-0">
        <div className={tileValueVariants({ tone })}>{value}</div>
        <div className={cn('mt-1.5', tileLabelVariants())}>{label}</div>
      </div>
    </div>
  );
}

export {
  StatTile,
  tileVariants,
  tileIconVariants,
  tileValueVariants,
  tileLabelVariants,
};
