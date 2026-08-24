'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  DARK_SURFACE,
  LIGHT_SURFACE,
  parseHex,
  stageChip,
} from '@/lib/stage-color';
import { clamp01, hexToHsv, hsvToHex, type Hsv } from '@/lib/color-convert';
import { useTheme } from '@/hooks/use-theme';
import { Input } from '@/components/ui/input';

/**
 * Any colour, in this product's own hands.
 *
 * Pipeline stages and tags both stored a free hex string and both offered a
 * fixed row of swatches — six for stages, eight for tags — so "a etiqueta da
 * cor da marca" was answerable only if that colour happened to be on the
 * list. The column never had the limit; the picker did.
 *
 * BUILT HERE RATHER THAN `<input type="color">`. The native control was the
 * obvious way to remove the limit and it hands the operator a panel drawn by
 * Chrome: a grey box with an eyedropper, a hue rail and three R/G/B spin
 * fields, in the browser's fonts and the browser's idea of dark mode, and
 * unstyleable by anything on this page. It is the one surface in the product
 * that would have looked like a different product. A square, a rail and a
 * hex field are not hard; matching the rest of the app is the reason to
 * write them.
 *
 * THE PRESETS STAY, and they come first. Most stages get named in ten
 * seconds and a palette that is already balanced is the fastest route to a
 * set of colours that look like they belong together; making everybody aim
 * at a gradient to pick blue would be worse than the limit it removes.
 *
 * THE PREVIEW IS THE POINT of letting anyone pick anything. `stageChip`
 * washes the hue toward the surface and walks the ink until it clears
 * 4.5:1, so no choice can produce an unreadable chip — but the operator
 * should still SEE what their colour becomes, because a lemon yellow that
 * reads as brown ink on cream is legible and surprising. It renders against
 * the mode the app is actually in.
 */

/**
 * A spread rather than a scale: one step of a dozen hues, so the row reads
 * as "pick a colour" instead of "pick a shade". Every value is a Tailwind
 * 500 so a set chosen from here stays visually even.
 */
export const COLOR_PRESETS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#f43f5e',
  '#64748b',
];

/** `#rrggbb`, which is what the database wants. */
export function normalizeHex(input: string): string | null {
  const rgb = parseHex(input);
  if (!rgb) return null;
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Arrow-key step on the square and the rail, as a fraction of the range. */
const KEY_STEP = 0.02;

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /** Text shown in the preview chip. Falls back to a generic sample. */
  previewLabel?: string;
  className?: string;
}

export function ColorPicker({
  value,
  onChange,
  previewLabel,
  className,
}: ColorPickerProps) {
  const t = useTranslations('Common.colorPicker');
  const { mode } = useTheme();

  /**
   * The picker's own HSV, which is NOT derived from `value` on every render.
   *
   * Two facts are lost going to hex and back: a fully desaturated colour has
   * no hue, and black has neither hue nor saturation. Recomputing from the
   * prop would send the rail snapping to red the moment somebody dragged
   * into the white corner, and the square would jump under the finger that
   * was moving it. So the geometry is held here and pushed outward; the prop
   * is only read back in when it changes from somewhere else.
   */
  const [hsv, setHsv] = React.useState<Hsv>(
    () => hexToHsv(value) ?? { h: 217, s: 0.76, v: 0.96 }
  );

  React.useEffect(() => {
    const incoming = hexToHsv(value);
    if (!incoming) return;
    // Only when the prop is a different COLOUR than the one this component
    // last emitted — otherwise the round trip clobbers the live hue.
    if (hsvToHex(hsv).toLowerCase() === value.toLowerCase()) return;
    setHsv(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = React.useCallback(
    (next: Hsv) => {
      setHsv(next);
      onChange(hsvToHex(next));
    },
    [onChange]
  );

  // What the operator is typing, which is NOT the committed value: a hex is
  // invalid for most of the time it takes to type one, and pushing every
  // keystroke up would repaint through four garbage colours before landing.
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

  const surface = mode === 'dark' ? DARK_SURFACE : LIGHT_SURFACE;
  const chip = stageChip(value, surface);
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  /** Drag on the saturation/brightness square. */
  const squareRef = React.useRef<HTMLDivElement>(null);
  const trackSquare = React.useCallback(
    (clientX: number, clientY: number) => {
      const box = squareRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return;
      emit({
        h: hsv.h,
        s: clamp01((clientX - box.left) / box.width),
        v: 1 - clamp01((clientY - box.top) / box.height),
      });
    },
    [emit, hsv.h]
  );

  /** Drag on the hue rail. */
  const railRef = React.useRef<HTMLDivElement>(null);
  const trackRail = React.useCallback(
    (clientX: number) => {
      const box = railRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      emit({ ...hsv, h: clamp01((clientX - box.left) / box.width) * 360 });
    },
    [emit, hsv]
  );

  /**
   * Pointer capture, so a drag that leaves the element keeps working.
   * Without it the handle stops at the edge and the colour freezes there,
   * which is exactly where somebody aiming for pure white lets go.
   */
  const dragProps = (track: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      track(e.clientX, e.clientY);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      track(e.clientX, e.clientY);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
  });

  return (
    <div className={cn('flex w-64 flex-col gap-3', className)}>
      {/* ---- Saturation / brightness ---- */}
      <div
        ref={squareRef}
        role="application"
        aria-label={t('squareLabel')}
        tabIndex={0}
        {...dragProps((x, y) => trackSquare(x, y))}
        onKeyDown={(e) => {
          const step = e.shiftKey ? KEY_STEP * 5 : KEY_STEP;
          if (e.key === 'ArrowLeft') emit({ ...hsv, s: clamp01(hsv.s - step) });
          else if (e.key === 'ArrowRight')
            emit({ ...hsv, s: clamp01(hsv.s + step) });
          else if (e.key === 'ArrowUp')
            emit({ ...hsv, v: clamp01(hsv.v + step) });
          else if (e.key === 'ArrowDown')
            emit({ ...hsv, v: clamp01(hsv.v - step) });
          else return;
          e.preventDefault();
        }}
        className="border-border focus-visible:ring-ring/50 relative h-32 w-full cursor-crosshair touch-none rounded-lg border outline-none focus-visible:ring-3"
        style={{
          // White across, black down, over the pure hue. Three layers and no
          // canvas: the browser composites gradients on the GPU, and a canvas
          // here would need a redraw on every hue step.
          backgroundImage:
            'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
          backgroundColor: hueColor,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: value,
          }}
        />
      </div>

      {/* ---- Hue ---- */}
      <div
        ref={railRef}
        role="slider"
        aria-label={t('hueLabel')}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        {...dragProps((x) => trackRail(x))}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 20 : 4;
          if (e.key === 'ArrowLeft')
            emit({ ...hsv, h: (hsv.h - step + 360) % 360 });
          else if (e.key === 'ArrowRight')
            emit({ ...hsv, h: (hsv.h + step) % 360 });
          else return;
          e.preventDefault();
        }}
        className="border-border focus-visible:ring-ring/50 relative h-3 w-full cursor-pointer touch-none rounded-full border outline-none focus-visible:ring-3"
        style={{
          backgroundImage:
            'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueColor }}
        />
      </div>

      {/* ---- Presets ---- */}
      <div className="grid grid-cols-8 gap-1">
        {COLOR_PRESETS.map((preset) => {
          const selected = preset.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              onClick={() => {
                const next = hexToHsv(preset);
                if (next) emit(next);
              }}
              aria-label={preset}
              aria-pressed={selected}
              title={preset}
              className="grid size-6 place-items-center rounded-md transition-transform hover:scale-110"
            >
              <span
                aria-hidden
                className="size-4.5 rounded-full border-2"
                style={{
                  backgroundColor: preset,
                  borderColor: selected ? 'var(--foreground)' : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>

      {/* ---- Hex, and what it will look like ---- */}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (!hex) return;
            const next = hexToHsv(hex);
            if (next) emit(next);
          }}
          onBlur={() => setDraft(value)}
          spellCheck={false}
          aria-label={t('hexLabel')}
          placeholder="#3b82f6"
          className="h-8 w-24 shrink-0 font-mono text-xs"
        />
        {/* Not decoration: the whole reason an unrestricted picker is safe is
            that the chip maths guarantees a readable result, and this is
            where that promise is kept in front of the person choosing. */}
        <span
          className="min-w-0 flex-1 truncate rounded-full px-2 py-1 text-center text-xs font-semibold"
          style={{ background: chip.background, color: chip.ink }}
        >
          {previewLabel?.trim() || t('sample')}
        </span>
      </div>
    </div>
  );
}
