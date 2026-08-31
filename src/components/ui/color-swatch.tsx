'use client';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ColorPicker } from '@/components/ui/color-picker';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * The colour control, in the one shape that survives being inside a dialog.
 *
 * ------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL — the palette that "didn't appear"
 * ------------------------------------------------------------------
 *
 * Both call sites used to hand-roll the same popover: a `relative` wrapper,
 * an `absolute top-8` panel, and a `fixed inset-0` sheet behind it to catch
 * the outside click. In a static page that works. Inside `DialogContent`,
 * which is `max-h-vh-85 overflow-y-auto`, it does not — and the failure is
 * total rather than cosmetic:
 *
 *   · `overflow-y: auto` makes `overflow-x` compute to `auto` as well, so
 *     the dialog clips its descendants on BOTH axes. Measured in the running
 *     app: a panel opened on a row near the bottom lands 200px past the
 *     dialog's edge and `document.elementFromPoint` at its centre does not
 *     return it. It is not merely off-screen, it is not there.
 *
 *   · And the `fixed inset-0` catcher meant the first touch that tried to
 *     scroll it into view closed it instead.
 *
 * Which is exactly the report: "Pipeline não apareceu paleta de cores para
 * modificar." The palette was rendering the whole time, outside the box.
 *
 * A portalled popover cannot be clipped by an ancestor, because it has no
 * ancestor — it renders at the document root and is positioned against the
 * trigger. Base UI flips it above the row when there is no room below, which
 * is the case this bug was made of.
 *
 * ------------------------------------------------------------------
 * AND IT LOOKS LIKE A CONTROL NOW
 * ------------------------------------------------------------------
 *
 * The pipeline copy was a bare 16px dot with no border and no chevron: the
 * only thing separating it from the decorative colour dots elsewhere in the
 * app was that this one happened to be clickable. Somebody looking for a
 * colour palette had no reason to press it. The border and the caret cost
 * eight pixels and say "this opens".
 */
export function ColorSwatch({
  value,
  onChange,
  label,
  previewLabel,
  className,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** Accessible name — every call site owns its own wording. */
  label: string;
  /** Text shown in the picker's preview chip. */
  previewLabel?: string;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        // 36px on a coarse pointer, which is what the row can spare beside
        // a drag handle and a name field; the dot inside stays 16.
        className={cn(
          'border-border hover:bg-muted focus-visible:ring-ring/50 flex h-8 shrink-0 items-center gap-1 rounded-md border px-1.5 outline-none focus-visible:ring-2',
          className
        )}
        aria-label={label}
        title={label}
      >
        <span
          aria-hidden
          className="border-border/60 size-4 rounded-full border"
          style={{ backgroundColor: value }}
        />
        <ChevronDown className="text-muted-foreground size-3" aria-hidden />
      </PopoverTrigger>
      {/* `w-auto` because the picker owns its width (w-64) and the popover's
          default w-72 would leave it swimming. */}
      <PopoverContent align="start" className="w-auto">
        <ColorPicker
          value={value}
          onChange={onChange}
          previewLabel={previewLabel}
        />
      </PopoverContent>
    </Popover>
  );
}
