import { ImageResponse } from 'next/og';

// The PlastfortSul mark on the brand navy, matching the sidebar logo
// in `src/components/brand-mark.tsx`. Next.js renders this at build
// time and auto-injects <link rel="icon"> into <head>.
//
// The arrow cycle is inlined as raw paths rather than importing
// BrandMark: this route runs through Satori (next/og), which renders a
// restricted SVG/flexbox subset and does not execute React components
// the way the DOM does. Keep the two in sync by hand — they change
// about once a rebrand.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

// No `runtime = 'edge'`.
//
// It was here, and the build said what it cost: "Using edge runtime on
// a page currently disables static generation for that page". This
// icon is three fixed arcs on a fixed navy square — it has no request,
// no data and no reason to be computed per visit. On Node it is
// rendered once at build time and served as a static asset, which is
// what the comment above always claimed it did.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0E0A3A', // brand navy
        borderRadius: 7,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 100 100">
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
    </div>,
    { ...size }
  );
}
