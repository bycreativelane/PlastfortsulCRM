/**
 * The PlastfortSul mark — three arrows chasing each other in a cycle.
 *
 * Drawn as inline SVG rather than loaded from /public so it inherits
 * the page's currentColor sizing, needs no extra request, and can't
 * flash in late on the sidebar. The three colours are the brand's own
 * and are deliberately NOT tokens: they don't change with the theme,
 * they don't participate in the colour doctrine, and they must look
 * the same in light and dark.
 *
 * Decorative by default — the sidebar puts the readable name next to
 * it. Pass a `title` where the mark stands alone.
 */
export function BrandMark({
  className = 'size-8',
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`shrink-0 ${className}`}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M28.08 71.92 A31 31 0 0 1 22.63 35.45"
        fill="none"
        stroke="#FFD500"
        strokeWidth="12"
      />
      <path d="M28.08 28.08 L12.56 30.09 L32.69 40.80 Z" fill="#FFD500" />
      <path
        d="M34.50 23.15 A31 31 0 0 1 73.75 30.07"
        fill="none"
        stroke="#E1121E"
        strokeWidth="12"
      />
      <path d="M78.54 37.89 L82.48 22.75 L65.01 37.40 Z" fill="#E1121E" />
      <path
        d="M80.70 45.69 A31 31 0 0 1 40.42 79.48"
        fill="none"
        stroke="#00A14B"
        strokeWidth="12"
      />
      <path d="M32.22 75.39 L36.90 90.32 L43.94 68.64 Z" fill="#00A14B" />
    </svg>
  );
}
