'use client';

import * as React from 'react';
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
 * Horizontal rules only, dashed, in the border ink.
 *
 * Vertical gridlines on a time series draw a cage around data that is
 * already ordered left to right — the x position carries the reading, the
 * line adds only ink. Horizontals earn their place because they are how
 * you compare two points that are far apart.
 */
export const gridProps = {
  className: 'stroke-border',
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
}

/**
 * Series legend — a dot and a word, at metadata weight.
 *
 * It used to live in a bordered footer band under the line chart, which
 * gave one of the two panels in that row a horizontal rule the other did
 * not have. Two cards side by side with different anatomy is the cheapest
 * way to make a deliberate layout look assembled.
 */
export function ChartLegend({
  items,
  className,
}: {
  items: ChartLegendItem[];
  className?: string;
}) {
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
