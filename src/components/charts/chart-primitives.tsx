'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { CartesianGrid, ResponsiveContainer } from 'recharts';

import { cn } from '@/lib/utils';

/**
 * One grammar for every chart in the product.
 *
 * Before this file, /relatórios drew three charts with three unrelated
 * implementations, and it showed:
 *
 *   · Conversas             hand-rolled SVG, fixed viewBox 760×240
 *   · Funil                 hand-rolled SVG, fixed viewBox 200×200
 *   · Tempo de resposta     the vendored Tremor BarChart (Recharts)
 *
 * Three tooltips (one `text-2xs`/`px-2.5`, one `text-sm`/`px-4`, one that
 * did not exist), three ideas of what a gridline is, two legends built out
 * of different markup, and — the one that actually decides how the page
 * reads — three different sizes for the same 10px axis label.
 *
 * That last one is not a taste argument. An SVG with a fixed viewBox and
 * the default `preserveAspectRatio` scales its whole coordinate system to
 * the container, TEXT INCLUDED. `text-3xs` inside a 760-unit viewBox is
 * 10px only when the container happens to be 760px wide. In the
 * `lg:grid-cols-2` row on a capped 1440px page each column is ~690px, so
 * the axis rendered at 9.1px; on a 375px phone the same label rendered at
 * about 4px. A type scale that a test enforces at eight steps
 * (`type-scale.test.ts`) had two components quietly rendering off it at
 * every viewport.
 *
 * Recharts sizes its SVG 1:1 with the container and lays out in real
 * pixels, so a `text-3xs` tick is 10px at every width. It was already a
 * dependency and already drawing one of the three. Everything here is the
 * shared vocabulary the three now speak:
 *
 *   CHART_HEIGHT      one body height, so a row of panels lines up
 *   gridProps         one gridline
 *   axisProps         one axis, at one size, on the scale
 *   ChartSurface      the sized box Recharts measures itself against
 *   ChartTooltipCard  one readout
 *   ChartLegend       one legend
 *
 * Colour is deliberately NOT in here. Series colour comes from
 * `--chart-1..5` (per accent, per mode, in globals.css) and stage colour
 * comes from the row in the database, because a stage's colour is its
 * identity on the board and must not change between screens.
 */

/**
 * The body height every chart draws into.
 *
 * One number so the two panels in the `lg:grid-cols-2` row start their
 * charts on the same line, and — the part that was actually broken — so
 * the skeleton can be measured against it. The donut used to load as a
 * 224px skeleton (`h-56`) and resolve into a 192px ring (`h-48`), dropping
 * the page 32px on every visit to /relatórios. Same discipline as
 * `SkeletonCard`: the arithmetic has to live somewhere both sides read.
 */
export const CHART_HEIGHT = 260;

/**
 * The plot's inset inside the panel body.
 *
 * Both cartesian charts had this literal typed out at their call site and
 * they happened to agree; a constant is what keeps them agreeing. `bottom: 0`
 * because the axis supplies its own room, and `right: 8` so the last point of
 * a series is not clipped by the panel's own padding.
 */
export const CHART_MARGIN = { top: 4, right: 8, bottom: 0, left: 0 } as const;

/**
 * One width for every y-axis in the product.
 *
 * It was 36 on the conversations area and 40 on the response-time bars. Four
 * pixels, and nobody would ever name it — but it is four pixels of DIFFERENT
 * LEFT EDGE for the plot area of two panels stacked in the same column on the
 * same page, under headings that line up perfectly. That is the class of
 * misalignment you read as "this page was assembled" without being able to
 * say why.
 *
 * 40 rather than 36: it is the one that already fitted "120m" without the
 * tick sliding under the plot.
 */
export const Y_AXIS_WIDTH = 40;

/**
 * Horizontal rules only, dashed, in the border ink.
 *
 * Vertical gridlines on a time series draw a cage around data that is
 * already ordered left to right — the x position carries the reading, the
 * line adds only ink. Horizontals earn their place because they are how
 * you compare two points that are far apart.
 */
export const gridProps = {
  // `stroke-border` at full strength is the same ink as the card's own
  // outline, so the scaffolding under the data read as loudly as the frame
  // around it. A gridline exists to be measured against and then ignored.
  className: 'stroke-border/60',
  strokeDasharray: '3 3',
  horizontal: true,
  vertical: false,
} as const;

/** The scale's micro-label, in the muted ink. Nothing else goes on an axis. */
export const AXIS_TICK_CLASS = 'text-3xs fill-muted-foreground';

/**
 * Tick styling has to be handed to the TICK, not to the axis.
 *
 * This is the bug that made every chart in the app render its axis at the
 * browser default. The recipe everybody uses — the one the vendored Tremor
 * `BarChart` still uses on line 704 — puts `className="text-xs
 * fill-muted-foreground"` on `<XAxis>` and relies on SVG inheriting
 * `font-size` down to the tick `<text>`. That worked in Recharts 2, where
 * the ticks were children of the axis group.
 *
 * In Recharts 3 they are not. The ticks are hoisted into a sibling
 * `recharts-zIndex-layer_2000` group, so `closest('.recharts-cartesian-axis')`
 * from a tick returns null and there is no inheritance path at all. Measured
 * on this page before the fix: the axis `<g>` computed to 10px and carried
 * the class; the tick `<text>` inside it computed to **16px, fill
 * rgb(0, 0, 0)** — browser-default black at the size of body copy, on a
 * label that is meant to be the smallest, quietest type in the product.
 *
 * So the class goes on `tick`, which Recharts spreads onto the text element
 * itself. CSS beats the presentation attribute Recharts writes there, which
 * is also what finally lets `fill-muted-foreground` land.
 */
export function axisTick(transform?: string) {
  return transform
    ? { className: AXIS_TICK_CLASS, transform }
    : { className: AXIS_TICK_CLASS };
}

/**
 * Spread onto `<XAxis>` / `<YAxis>`. No rules and no ticks marks — the
 * gridlines already say where the values are, and an axis line under them
 * is a third statement of the same edge.
 *
 * The class is repeated here for the axis's own text (a `<Label>`, if one
 * is ever added); the ticks get theirs from `axisTick()` above.
 */
export const axisProps = {
  stroke: '',
  className: AXIS_TICK_CLASS,
  tickLine: false,
  axisLine: false,
} as const;

/**
 * The hover band under a bar, and the crosshair under a point.
 *
 * A wash of the surface's own ink rather than a fixed grey:
 * `--muted-foreground` resolves per mode, so the band is visible on the
 * white card and on the dark one without being two decisions.
 */
export const CURSOR_FILL = { fill: 'var(--muted-foreground)', opacity: 0.12 };

export const CURSOR_LINE = {
  stroke: 'var(--muted-foreground)',
  strokeDasharray: '3 3',
  strokeWidth: 1,
};

/** `<CartesianGrid>` with the shared look already applied. */
export function ChartGrid(props: React.ComponentProps<typeof CartesianGrid>) {
  return <CartesianGrid {...gridProps} {...props} />;
}

/**
 * The sized box a Recharts chart measures itself against.
 *
 * `ResponsiveContainer` reads its parent, so the parent needs a height
 * that does not depend on the chart — hence the explicit style rather
 * than a class the chart could collapse to zero.
 */
export function ChartSurface({
  height = CHART_HEIGHT,
  className,
  children,
}: {
  height?: number;
  className?: string;
  /** Exactly one Recharts chart element. */
  children: React.ReactElement;
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The vertical ramp a series is filled with, and the only fill in the
 * product.
 *
 * The area chart declared two of these by hand and the bar chart used a flat
 * `fill="var(--chart-1)"`, which is why the two panels read as charts from
 * two different products: one series dissolving into the card, the next one
 * a block of saturated accent sitting on top of it. A quantity is a quantity
 * on both, and it should be made of the same material.
 *
 * The stop at the bottom is what does the work. Reaching (or nearly
 * reaching) zero at the baseline means two areas can overlap without the
 * overlap becoming a third colour that means nothing, and it means a bar
 * sits ON the axis rather than being a rectangle that stops near it.
 *
 * `useId()` at the call site, not here: an SVG gradient is referenced by a
 * document-wide id, and two charts mounted on one page with the same
 * hard-coded id is the second one silently painting itself with the first
 * one's colours.
 */
export function ChartGradient({
  id,
  color,
  from = 0.28,
  to = 0,
}: {
  id: string;
  /** Any CSS colour — normally `var(--chart-N)`. */
  color: string;
  /** Opacity at the top of the plot. */
  from?: number;
  /** Opacity at the baseline. */
  to?: number;
}) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  );
}

/** `url(#id)`, so no call site has to remember the SVG syntax. */
export function gradientFill(id: string): string {
  return `url(#${id})`;
}

// ------------------------------------------------------------------
// The readout
// ------------------------------------------------------------------

export interface ChartTooltipRow {
  label: string;
  value: string;
  /** Any CSS colour — a token reference or the stage's own hex. */
  color?: string;
}

/**
 * One tooltip, shaped like the rest of the app.
 *
 * `rounded-md` and `px-3` are the app tooltip's own geometry, so a chart
 * readout and a hint chip read as the same object seen twice. It is
 * `bg-popover` with a border rather than the inverted `bg-foreground`
 * chip, because this one carries a table and inverted ink under four rows
 * of numbers is a wall.
 *
 * Not glass. The rule from the overhaul holds: glass goes on menus, not
 * on something sitting over content you are trying to read.
 *
 * Deliberately free of Recharts types — each chart maps its own payload
 * into rows. That is what keeps this shared rather than three-quarters
 * shared.
 */
export function ChartTooltipCard({
  heading,
  rows,
  footer,
}: {
  heading?: React.ReactNode;
  rows: ChartTooltipRow[];
  footer?: React.ReactNode;
}) {
  return (
    <div className="border-border bg-popover pointer-events-none rounded-md border px-3 py-2 shadow-lg">
      {heading ? (
        <div className="text-popover-foreground text-2xs font-semibold">
          {heading}
        </div>
      ) : null}
      <div className={cn('flex flex-col gap-1', heading && 'mt-1.5')}>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-3">
            {row.color ? (
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
            ) : null}
            <span className="text-muted-foreground text-2xs">{row.label}</span>
            <span className="text-popover-foreground text-2xs ml-auto font-semibold tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {footer ? (
        <div className="text-muted-foreground text-3xs mt-1.5">{footer}</div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// The legend
// ------------------------------------------------------------------

export interface ChartLegendItem {
  label: string;
  color: string;
  /**
   * The series' total for the period on screen.
   *
   * A LEGEND THAT ONLY MAPS COLOUR TO WORD IS RENT PAID FOR NOTHING.
   * The reader looks at it once, learns "blue = recebidas", and never
   * needs it again — but it keeps occupying the line directly above the
   * data, which is the most valuable line on the panel.
   *
   * Given a number it becomes a readout: the colour key still works
   * (same dot, same word) and the strip now answers the question people
   * actually arrive with — "how many, in total?" — without hovering a
   * single point. Optional, because a legend for a chart whose series
   * do not sum to anything meaningful should stay a legend.
   */
  total?: string;
  /**
   * Percent change against the previous period, when there is a basis.
   *
   * `null` and `undefined` both mean "no comparison was possible", and
   * neither draws anything — a zero would claim a measurement nobody
   * took. Only meaningful alongside `total`.
   */
  delta?: number | null;
}

/**
 * Series legend — a dot, a word, and (when there is one) the number.
 *
 * It used to live in a bordered footer band under the line chart, which
 * gave one of the two panels in that row a horizontal rule the other did
 * not have. Two cards side by side with different anatomy is the cheapest
 * way to make a deliberate layout look assembled.
 *
 * With `total` set it stops being a key and becomes a readout — see the
 * note on `ChartLegendItem.total`. The number is the loud part: it is
 * what somebody came to the panel for, and the word beside it is the
 * label on a figure rather than an entry in a table of contents.
 */
export function ChartLegend({
  items,
  className,
}: {
  items: ChartLegendItem[];
  className?: string;
}) {
  const hasTotals = items.some((i) => i.total !== undefined);

  if (!hasTotals) {
    return (
      <div
        className={cn(
          'text-muted-foreground text-2xs flex flex-wrap items-center gap-x-4 gap-y-1',
          className
        )}
      >
        {items.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-start gap-x-6 gap-y-2', className)}>
      {items.map((item) => (
        <span key={item.label} className="min-w-0">
          <span className="text-muted-foreground text-2xs flex items-center gap-1.5">
            {/* The dot stays the same size and shape it was: this is
                still the colour key, and changing the mark would break
                the one thing the reader already learned. */}
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: item.color }}
            />
            <span className="truncate">{item.label}</span>
          </span>
          <span className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-foreground text-lg leading-none font-semibold tabular-nums">
              {item.total}
            </span>
            {item.delta != null && (
              // Grey, not green and red. On this panel "more messages"
              // is not good news and "fewer" is not bad — a quiet week
              // and a broken integration look identical from here, and
              // colouring it would have the chart cheering for volume.
              // The arrow carries the direction; the reader supplies the
              // judgement.
              <span className="text-muted-foreground flex items-center gap-0.5 text-2xs tabular-nums">
                {item.delta > 0 ? (
                  <ArrowUp className="size-2.5" aria-hidden />
                ) : item.delta < 0 ? (
                  <ArrowDown className="size-2.5" aria-hidden />
                ) : null}
                {Math.abs(item.delta)}%
              </span>
            )}
          </span>
        </span>
      ))}
    </div>
  );
}
