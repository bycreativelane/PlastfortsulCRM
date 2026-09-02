'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
 * The tallest a `ChartSurface fill` plot may grow to. See the note on
 * the `fillMax` prop for why a ceiling exists at all — in one line: a
 * near-square time series reports the panel's height rather than the
 * data's shape.
 */
export const CHART_FILL_MAX = 380;

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
 * The mark specs, in one place, because they are the difference between
 * three charts and one chart system.
 *
 * `BAR_RADIUS` rounds the DATA END only — `[4, 4, 0, 0]` on a vertical
 * bar. The other end is anchored to the baseline and a rounded corner
 * there would lift the bar off the axis it is measured against.
 *
 * `STACK_STROKE` is the 2px gap between stacked segments, drawn as a
 * stroke in the surface colour rather than as a real gap: Recharts
 * stacks segments edge to edge, and two adjacent fills with no seam read
 * as one mark with a colour change in the middle. Painting the seam in
 * `--card` makes it read as two segments with the panel showing through.
 *
 * `DOT_R` is 4 and not 3.5, because a hover marker is a hit target as
 * well as a mark and 8px across is the floor for one.
 */
export const BAR_RADIUS = [4, 4, 0, 0] as const;
export const STACK_STROKE = {
  stroke: 'var(--card)',
  strokeWidth: 2,
} as const;
export const LINE_WIDTH = 2;
export const DOT_R = 4;

/**
 * A round scale whose labels are drawn WHERE THEY SAY THEY ARE.
 *
 * The bug this replaces: the conversations chart built its ticks as
 * `[0, ceil/4, ceil/2, 3*ceil/4, ceil].map(Math.round)`. With a ceiling
 * of 10 that prints 0 · 3 · 5 · 8 · 10 — and draws them at 0 · 2.5 · 5 ·
 * 7.5 · 10, because rounding the LABEL does not move the LINE. The
 * gridline captioned "3" sat at two and a half, so anybody measuring a
 * point against it read 20% high. `allowDecimals={false}` on the axis is
 * no defence: it only governs ticks Recharts picks for itself, and these
 * were handed to it.
 *
 * The fix is to round the STEP instead of the label. Pick a step from
 * 1 · 2 · 2.5 · 5 · 10 × a power of ten, raise the ceiling to a whole
 * number of steps, and every tick is then both round and exactly where
 * it is drawn — by construction, not by luck.
 *
 * `integer` drops 2.5 from the candidates. A count axis labelled 2.5 is
 * a different kind of lie: there is no such thing as two and a half
 * conversations.
 */
export function niceScale(
  rawMax: number,
  {
    targetTicks = 4,
    integer = false,
  }: { targetTicks?: number; integer?: boolean } = {}
): { max: number; ticks: number[] } {
  if (!(rawMax > 0)) return { max: 4, ticks: [0, 1, 2, 3, 4] };

  const rough = rawMax / targetTicks;
  // The floor at 1 is what actually makes `integer` true. Dropping 2.5
  // from the candidates is not enough on its own: the DECADE can be
  // fractional too, and a peak of 1 gives `rough = 0.25`, a power of
  // 0.1, and a step of 0.5 — a count axis labelled 0 · 0.5 · 1 built
  // entirely out of integer candidates.
  const pow = Math.max(
    integer ? 1 : Number.MIN_VALUE,
    Math.pow(10, Math.floor(Math.log10(rough)))
  );
  const norm = rough / pow;
  const candidates = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = (candidates.find((c) => norm <= c) ?? 10) * pow;

  const max = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  // The half-step slack absorbs the float error that would otherwise
  // drop the top tick when `max / step` lands on 4.999999999999999.
  for (let v = 0; v <= max + step / 2; v += step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return { max, ticks };
}

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
  fill = false,
  fillMax = CHART_FILL_MAX,
  className,
  children,
}: {
  /** Fixed plot height, or — with `fill` — the floor it may not go under. */
  height?: number;
  /**
   * Grow to whatever height the panel has left.
   *
   * ------------------------------------------------------------------
   * THE DEAD SPACE THIS EXISTS TO CLOSE
   * ------------------------------------------------------------------
   *
   * On /relatórios the conversations chart sits in a `lg:grid-cols-2`
   * row beside the funnel, and both panels are `h-full` — so the row is
   * as tall as the funnel, which on an eight-stage pipeline is around
   * 500px. The chart's plot was a fixed 260. The remaining ~240px was
   * empty card, every single load, and it was the largest blank region
   * on the page.
   *
   * `flex-1` on a `min-h-0` track lets the plot take it. The `height`
   * prop stops being a size and becomes a FLOOR (`min-height`), because
   * the same panel on a phone, or beside a two-stage funnel, must not
   * be allowed to collapse to nothing.
   *
   * Requires the ancestor chain to be a column flexbox with a real
   * height — `Panel` → `PanelBody` on that page both are. Without one,
   * `flex-1` resolves to auto and the floor is what renders, which is
   * exactly the old behaviour rather than a broken one.
   */
  fill?: boolean;
  /**
   * The ceiling `fill` may not grow past. Ignored without `fill`.
   *
   * ------------------------------------------------------------------
   * BECAUSE "USE ALL THE SPACE" IS NOT THE SAME AS "BE BIGGER"
   * ------------------------------------------------------------------
   *
   * Uncapped, the plot beside an eight-stage funnel came out roughly
   * 690 × 500 — very nearly square. Aspect ratio is not decoration on a
   * time series: it is the slope of every segment, and a series that
   * peaks at ten messages drawn half as tall as it is wide turns a
   * quiet fortnight and one busy Tuesday into a cliff. The chart would
   * have been reporting the panel's height, not the data.
   *
   * 380 against the ~690px column of a `lg:grid-cols-2` row on a capped
   * page is a shade under 2:1, which is the proportion every dashboard
   * in the reference set draws a trend at, and the shape the eye reads
   * a slope correctly in.
   *
   * The space left over stays panel padding. That is a real cost and it
   * is the smaller one: a bit of white under a plot reads as breathing
   * room, and 240px of it — which is what this replaced — reads as a
   * bug.
   */
  fillMax?: number;
  className?: string;
  /** Exactly one Recharts chart element. */
  children: React.ReactElement;
}) {
  return (
    <div
      className={cn('w-full', fill && 'min-h-0 flex-1', className)}
      style={fill ? { minHeight: height, maxHeight: fillMax } : { height }}
    >
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
    <div
      className={cn('flex flex-wrap items-start gap-x-6 gap-y-2', className)}
    >
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
              <span className="text-muted-foreground text-2xs flex items-center gap-0.5 tabular-nums">
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

// ------------------------------------------------------------------
// The horizontal bar — the shape this product draws most, and drew
// four different ways
// ------------------------------------------------------------------

/**
 * One row: a label, its number, and a bar for the number.
 *
 * Counted before this existed, four implementations of the same idea:
 *
 *   · the funnel on /relatórios    28px bar, stage colour, share of PEAK
 *   · the mini funnel on /          6px bar, flat accent, share of TOTAL
 *   · "por categoria" on Custo      6px bar, flat `bg-chart-1`
 *   · `ProgressBar` in metric.tsx   6px bar, five tones
 *
 * They disagreed about height, colour, rounding, what the width is a
 * share OF, and whether the number goes before or after the count. Two
 * of them sat on the same page.
 *
 * WIDTH IS A SHARE OF THE BIGGEST ROW, NEVER OF THE TOTAL. Against the
 * total, eight rows draw eight stubs and the bars stop encoding "how big
 * is this" — they encode "what fraction of everything is this", which is
 * a pie chart's question rendered as a worse pie chart. `peakPercent`
 * below does that arithmetic so no call site has to choose again.
 *
 * ZERO DRAWS NOTHING. There is no minimum-width floor here. A floor is
 * tempting — it keeps a tiny-but-real row visible — but it cannot tell
 * "almost nothing" from "nothing", so it paints a bar for R$ 0 and the
 * reader has no way to know. The label already carries the value; a row
 * with no bar reads as zero, correctly.
 */
export function ChartBarRow({
  label,
  sublabel,
  value,
  meta,
  chip,
  percent,
  color = 'var(--chart-1)',
  density = 'full',
  muted = false,
  ariaLabel,
  className,
}: {
  label: React.ReactNode;
  /** A second line under the label — a category, an owner, a kind. */
  sublabel?: React.ReactNode;
  /** The number this row is about. Rendered as the loud part. */
  value: React.ReactNode;
  /** A second, quieter number — a count, a share, a subtotal. */
  meta?: React.ReactNode;
  /** A pill at the far right — a share, a delta. Tinted with `color`. */
  chip?: React.ReactNode;
  /** 0–100, a share of the biggest row. Clamped here. */
  percent: number;
  /** The row's own colour: a stage's colour on the board, or the accent. */
  color?: string;
  /** `full` for a panel that is only this list; `compact` inside a card. */
  density?: 'full' | 'compact';
  /** Draw the mark in the neutral ink — for a row that is not the point. */
  muted?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const full = density === 'full';
  const ink = muted ? 'var(--muted-foreground)' : color;

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="text-secondary-foreground block truncate text-xs font-medium">
            {label}
          </span>
          {sublabel != null ? (
            <span className="text-muted-foreground text-3xs block truncate">
              {sublabel}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="text-foreground text-xs font-semibold tabular-nums">
            {value}
          </span>
          {meta != null ? (
            <span className="text-muted-foreground text-3xs tabular-nums">
              {meta}
            </span>
          ) : null}
          {/* NEUTRAL, and deliberately not tinted with the row's colour.
              Tinting it is what the reference dashboards do, and they can:
              their palettes are three or four controlled hues. `color`
              here is whatever hex somebody picked for a stage on the
              Kanban board, so a chip tinted with it is arbitrary ink on
              an arbitrary wash — a pale amber stage lands around 2:1,
              which is unreadable text, and no amount of care at this end
              can fix a colour chosen at the other.
              The bar beside it already carries the identity. The chip
              only has to carry a number. */}
          {chip != null ? (
            <span className="bg-muted text-secondary-foreground text-2xs inline-flex h-5 shrink-0 items-center rounded-full px-1.5 font-semibold whitespace-nowrap tabular-nums">
              {chip}
            </span>
          ) : null}
        </span>
      </div>

      {/* A THIN PILL ON A HAIRLINE RAIL.
          The bar was 28px of solid fill on a full-strength track, which
          is a progress widget, not a chart row: eight of them stacked
          read as sixteen slabs, and eight database stage colours at that
          weight became a rainbow you had to translate before you could
          compare any two lengths.
          At 8px the same eight colours stop competing and start doing
          the job colour is for here — telling you WHICH row you are
          looking at, in the same hue it has on the board — while length
          goes back to being the thing you read. Same move every ranked
          list in a well-made dashboard makes. */}
      <div
        className={cn(
          'bg-muted/60 w-full overflow-hidden rounded-full',
          full ? 'mt-2 h-2' : 'mt-1.5 h-1.5'
        )}
      >
        <div
          role="img"
          aria-label={ariaLabel}
          className="h-full rounded-full transition-[width] duration-(--dur-2)"
          style={{ width: `${pct}%`, background: ink }}
        />
      </div>
    </div>
  );
}

/**
 * Share of the biggest value in the set — the scaling every bar row uses.
 *
 * Exported because the alternative is each call site writing
 * `Math.max(...values)` inline, and one of them eventually writing
 * `total` instead, which is exactly how the two funnels drifted apart.
 */
export function peakPercent(value: number, values: number[]): number {
  const peak = Math.max(0, ...values);
  return peak > 0 ? (value / peak) * 100 : 0;
}

/**
 * A ranked list that shows its ranking.
 *
 * "Top templates" and "por origem" on Custo de envio were bordered lists
 * of right-aligned numbers — a table with no visual encoding at all, on
 * a page made of charts. Reading which of six templates dominates meant
 * comparing "1.284" against "980" as STRINGS, which is the comparison
 * human vision is worst at and the one a 6px bar makes free.
 */
export function ChartRankList({
  rows,
  density = 'compact',
  className,
}: {
  rows: {
    key: string;
    label: React.ReactNode;
    sublabel?: React.ReactNode;
    value: React.ReactNode;
    meta?: React.ReactNode;
    chip?: React.ReactNode;
    /** The raw number the bar is drawn from. */
    amount: number;
    color?: string;
    ariaLabel?: string;
  }[];
  density?: 'full' | 'compact';
  className?: string;
}) {
  const amounts = rows.map((r) => r.amount);
  return (
    <ol className={cn('flex flex-col gap-3', className)}>
      {rows.map((row) => (
        <li key={row.key}>
          <ChartBarRow
            label={row.label}
            sublabel={row.sublabel}
            value={row.value}
            meta={row.meta}
            chip={row.chip}
            percent={peakPercent(row.amount, amounts)}
            color={row.color}
            density={density}
            ariaLabel={row.ariaLabel}
          />
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------
// The vertical bar chart
// ------------------------------------------------------------------

export interface ChartSeries {
  /** Key into each row of `data`. */
  key: string;
  label: string;
  /** Any CSS colour — normally `var(--chart-1)` / `var(--chart-2)`. */
  color: string;
}

/**
 * The product's bar chart, and the end of the second charting library.
 *
 * `components/tremor/bar-chart.tsx` was 904 vendored lines carrying its
 * own tooltip (`text-sm`, `px-4`, `shadow-md`), its own legend, its own
 * axis defaults and its own idea of a gridline — all of it sitting next
 * to `chart-primitives`, which exists to be the single answer to those
 * four questions. Two panels on /relatórios used it and two used this
 * file, so one page drew two kinds of chart.
 *
 * Everything Tremor was actually doing for those call sites — stacked
 * bars, a legend, a y-axis — is thirty lines against primitives that
 * were already here.
 */
export function ChartBars({
  data,
  index,
  series,
  stacked = false,
  height = CHART_HEIGHT,
  integer = true,
  formatValue = (n: number) => String(n),
  formatIndex,
  ariaLabel,
  legendTotals,
}: {
  data: Record<string, string | number>[];
  /** Key holding the category label for each row. */
  index: string;
  series: ChartSeries[];
  stacked?: boolean;
  height?: number;
  /** Count axes cannot be labelled 2.5 — see `niceScale`. */
  integer?: boolean;
  formatValue?: (n: number) => string;
  /** Long form of the x label, for the tooltip heading. */
  formatIndex?: (v: string) => string;
  ariaLabel: string;
  /** Per-series totals for the legend. Same contract as `ChartLegend`. */
  legendTotals?: Record<string, string>;
}) {
  const gradientId = React.useId();

  const { max, ticks } = React.useMemo(() => {
    const peak = data.reduce((m, row) => {
      // A stack is measured by its SUM; grouped bars by their tallest
      // member. Measuring a stack by its tallest member puts the top of
      // the tallest column above the axis it is drawn against.
      const vals = series.map((s) => Number(row[s.key] ?? 0));
      const rowPeak = stacked
        ? vals.reduce((a, b) => a + b, 0)
        : Math.max(0, ...vals);
      return Math.max(m, rowPeak);
    }, 0);
    return niceScale(peak, { integer });
  }, [data, series, stacked, integer]);

  return (
    <>
      {series.length > 1 ? (
        <ChartLegend
          className="mb-3"
          items={series.map((s) => ({
            label: s.label,
            color: s.color,
            total: legendTotals?.[s.key],
          }))}
        />
      ) : null}
      <ChartSurface height={height}>
        <BarChart
          data={data}
          margin={CHART_MARGIN}
          barCategoryGap="34%"
          accessibilityLayer
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            {series.map((s) => (
              <ChartGradient
                key={s.key}
                id={`${gradientId}-${s.key}`}
                color={s.color}
                from={0.9}
                to={0.42}
              />
            ))}
          </defs>

          <ChartGrid />

          <XAxis
            {...axisProps}
            dataKey={index}
            minTickGap={16}
            tick={axisTick('translate(0, 6)')}
          />
          <YAxis
            {...axisProps}
            width={Y_AXIS_WIDTH}
            domain={[0, max]}
            ticks={ticks}
            tickFormatter={formatValue}
            tick={axisTick('translate(-3, 0)')}
          />

          <Tooltip
            cursor={CURSOR_FILL}
            wrapperStyle={{ outline: 'none' }}
            animationDuration={120}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const byKey = new Map(
                payload.map((p) => [p.dataKey as string, Number(p.value ?? 0)])
              );
              return (
                <ChartTooltipCard
                  heading={
                    formatIndex ? formatIndex(String(label)) : String(label)
                  }
                  rows={series.map((s) => ({
                    label: s.label,
                    value: formatValue(byKey.get(s.key) ?? 0),
                    color: s.color,
                  }))}
                  footer={
                    stacked
                      ? formatValue(
                          series.reduce(
                            (n, s) => n + (byKey.get(s.key) ?? 0),
                            0
                          )
                        )
                      : undefined
                  }
                />
              );
            }}
          />

          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? 'a' : undefined}
              fill={gradientFill(`${gradientId}-${s.key}`)}
              // Only the top of a stack is rounded. Rounding every
              // segment turns one column into a stack of pills with gaps
              // the data does not have.
              radius={
                !stacked || i === series.length - 1
                  ? [...BAR_RADIUS]
                  : undefined
              }
              maxBarSize={34}
              isAnimationActive={false}
              {...(stacked ? STACK_STROKE : {})}
            />
          ))}
        </BarChart>
      </ChartSurface>
    </>
  );
}
