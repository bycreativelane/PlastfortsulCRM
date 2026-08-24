// ============================================================
// Tremor chartColors [v0.1.0] — copied from tremorlabs/tremor.
//
// The Tremor charts source uses these helpers to map a category
// name to a stable Tailwind color class (`bg-violet-500`,
// `fill-blue-500`, …). Tremor's "Raw" distribution is copy-paste
// — there is no `@tremor/raw` npm package — so the canonical
// approach is to vendor the file unchanged and customise locally.
//
// Source: https://github.com/tremorlabs/tremor/blob/main/src/utils/chartColors.ts
// License: Apache 2.0 (Tremor)
// ============================================================

export type ColorUtility = "bg" | "stroke" | "fill" | "text"

// The palette is the app's, not Tailwind's.
//
// Vendored, this file mapped every key to a raw Tailwind shade
// (`fill-violet-500`, `stroke-cyan-500`, …). None of those follow the
// mode or the accent, so a chart series stayed the same hue while the
// rest of the page changed underneath it — and `amber` in particular
// resolves to the doctrine's "a human must act" token, which a data
// series must never claim. The `gray` entry was already localised to
// `bg-muted` by an earlier pass; this extends the same treatment to
// the rest.
//
// The keys are kept verbatim so existing call sites (`colors={['violet']}`)
// keep compiling. What changes is where they point: --chart-1..5, which
// are defined per accent AND per mode in globals.css.
export const chartColors = {
  blue: {
    bg: "bg-chart-1",
    stroke: "stroke-chart-1",
    fill: "fill-chart-1",
    text: "text-chart-1",
  },
  violet: {
    bg: "bg-chart-1",
    stroke: "stroke-chart-1",
    fill: "fill-chart-1",
    text: "text-chart-1",
  },
  emerald: {
    bg: "bg-chart-2",
    stroke: "stroke-chart-2",
    fill: "fill-chart-2",
    text: "text-chart-2",
  },
  amber: {
    bg: "bg-chart-3",
    stroke: "stroke-chart-3",
    fill: "fill-chart-3",
    text: "text-chart-3",
  },
  gray: {
    bg: "bg-muted",
    stroke: "stroke-muted-foreground",
    fill: "fill-muted-foreground",
    text: "text-muted-foreground",
  },
  cyan: {
    bg: "bg-chart-2",
    stroke: "stroke-chart-2",
    fill: "fill-chart-2",
    text: "text-chart-2",
  },
  pink: {
    bg: "bg-chart-3",
    stroke: "stroke-chart-3",
    fill: "fill-chart-3",
    text: "text-chart-3",
  },
  lime: {
    bg: "bg-chart-4",
    stroke: "stroke-chart-4",
    fill: "fill-chart-4",
    text: "text-chart-4",
  },
  fuchsia: {
    bg: "bg-chart-5",
    stroke: "stroke-chart-5",
    fill: "fill-chart-5",
    text: "text-chart-5",
  },
} as const satisfies {
  [color: string]: {
    [key in ColorUtility]: string
  }
}

export type AvailableChartColorsKeys = keyof typeof chartColors

export const AvailableChartColors: AvailableChartColorsKeys[] = Object.keys(
  chartColors,
) as Array<AvailableChartColorsKeys>

export const constructCategoryColors = (
  categories: string[],
  colors: AvailableChartColorsKeys[],
): Map<string, AvailableChartColorsKeys> => {
  const categoryColors = new Map<string, AvailableChartColorsKeys>()
  categories.forEach((category, index) => {
    categoryColors.set(category, colors[index % colors.length])
  })
  return categoryColors
}

export const getColorClassName = (
  color: AvailableChartColorsKeys,
  type: ColorUtility,
): string => {
  const fallbackColor = {
    bg: "bg-muted",
    stroke: "stroke-muted-foreground",
    fill: "fill-muted-foreground",
    text: "text-muted-foreground",
  }
  return chartColors[color]?.[type] ?? fallbackColor[type]
}
