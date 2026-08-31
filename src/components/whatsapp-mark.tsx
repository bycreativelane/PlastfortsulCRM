/**
 * The WhatsApp glyph.
 *
 * Inline SVG for the same three reasons `BrandMark` is: it inherits the
 * page's `currentColor` and font-size sizing, it costs no extra request,
 * and it cannot flash in late on a rail that renders on every route.
 *
 * WHY A LOGO AND NOT A LUCIDE ICON. Every place this replaces was
 * drawing a generic stand-in — a plug (`PlugZap`) for the connection, a
 * speech bubble (`MessageCircle`) for the share link — and a stand-in is
 * a thing you have to read the label to identify. This one is recognised
 * before it is read, which is the entire job of the row it sits in.
 *
 * CURRENTCOLOR, NOT #25D366. The mark takes whatever ink its context
 * gives it: muted in the settings rail, the accent inside a tinted tile,
 * the amber of a warning row. Painting it the brand green would put a
 * sixth colour into a product where colour is load-bearing — green here
 * means "connected", and it is already spoken for by the status dot that
 * sits in the very tile this icon heads. The SHAPE carries the
 * recognition; the colour keeps meaning what it means.
 *
 * `BrandMark` does the opposite and keeps its three brand colours, which
 * is not a contradiction: that mark IS the product, drawn once, at the
 * top of the rail, with nothing around it to disagree with.
 */
export function WhatsAppMark({ className }: { className?: string }) {
  return (
    <svg
      // NOT `0 0 24 24`, and the 2.4 is measured rather than taste.
      //
      // A lucide icon draws inside roughly 20 of its 24 units — the
      // 2-unit margin is what makes a row of them look like one row. The
      // official WhatsApp path fills its 24×24 box edge to edge, so at
      // `size-4` beside lucide icons it renders ~20% larger and the rail
      // reads as one icon that got bigger. Padding the viewBox by 2.4 on
      // each side (24 × 24/20 = 28.8) puts the glyph on the same optical
      // size as its neighbours without touching the path.
      viewBox="-2.4 -2.4 28.8 28.8"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}
