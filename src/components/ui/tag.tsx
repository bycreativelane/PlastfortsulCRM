import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A label with a coloured dot.
 *
 * The default is a grey chip carrying a small dot in the tag's own colour. The
 * identity survives; the noise does not. Ten filled chips in a table row was
 * the single loudest thing in the old interface, and none of them was something
 * anyone was looking for.
 *
 * Two deliberate exceptions, both in `filled` form:
 *
 *   · the conversation list, where contact type and stage ARE what you scan for
 *   · anywhere the colour is computed to be legible (see `stageChip`)
 *
 * `filled` therefore takes explicit background and ink rather than deriving
 * them: the caller has already done the contrast work, and a tag must never
 * guess at a pairing it cannot verify.
 */
interface TagProps extends Omit<React.ComponentProps<'span'>, 'color'> {
  /**
   * Hex or CSS colour for the dot. Omit for a tag with no colour of its own.
   *
   * Shadows the DOM `color` attribute deliberately — nobody sets that on a
   * span, and `color` is what this prop is in every call site's head.
   */
  color?: string | null;
  size?: 'default' | 'sm';
  /** Solid treatment. Supply both halves — see the note above. */
  filled?: { background: string; ink: string };
}

function Tag({
  className,
  color,
  size = 'default',
  filled,
  children,
  style,
  ...props
}: TagProps) {
  return (
    <span
      data-slot="tag"
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-sm whitespace-nowrap',
        // 18 and 20, both on the spacing scale, both shared with
        // `Badge` and `StatusBadge`. See the note in status-badge.tsx:
        // the app has exactly two chip heights.
        size === 'sm' ? 'h-4.5 gap-1 px-1.5 text-3xs' : 'h-5 px-2 text-2xs',
        filled
          ? 'font-semibold'
          : 'bg-muted text-secondary-foreground font-medium',
        className
      )}
      style={
        filled
          ? { backgroundColor: filled.background, color: filled.ink, ...style }
          : style
      }
      {...props}
    >
      {color && !filled ? (
        <span
          aria-hidden
          // One dot, one size. It was 5px on the dense tag and 6px on
          // the standard one — a pixel apart, which reads as the same
          // object rendered inconsistently rather than as two sizes.
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * The dot on its own, label in the tooltip.
 *
 * For rows dense enough that the words cost more than they carry — the colour
 * already identifies the tag to anyone who works here all day, and this gives
 * the whole width back.
 */
function TagDot({
  className,
  color,
  label,
  ...props
}: React.ComponentProps<'span'> & { color: string; label: string }) {
  return (
    <span
      data-slot="tag-dot"
      title={label}
      aria-label={label}
      role="img"
      className={cn('size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color }}
      {...props}
    />
  );
}

export { Tag, TagDot };
