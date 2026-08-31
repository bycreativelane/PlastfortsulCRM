/**
 * The PWA icon set, rasterised from the brand mark.
 *
 * ------------------------------------------------------------------
 * WHY THESE ARE FILES AND NOT `next/og` ROUTES
 * ------------------------------------------------------------------
 *
 * `src/app/icon.tsx` already draws this mark through `next/og`, and the
 * obvious move is to add sizes there. It does not work for a manifest:
 * the metadata conventions publish their URLs with a content hash
 * appended (`/icon?f00b42`), and `manifest.ts` has to name the icon
 * paths as literal strings. A manifest that points at an unhashed URL
 * is a manifest whose icons 404 the day the hash changes.
 *
 * So these are written once, committed, and served straight from
 * `/public` at a stable path. Re-run after a rebrand:
 *
 *     node scripts/generate-app-icons.mjs
 *
 * ------------------------------------------------------------------
 * WHY FOUR FILES AND NOT ONE
 * ------------------------------------------------------------------
 *
 * `any` (192, 512)   — the plain icon. Chrome's install prompt requires
 *                      BOTH of these sizes to exist before it will offer
 *                      to install at all.
 * `maskable` (512)   — Android crops adaptive icons to whatever shape the
 *                      launcher uses (circle, squircle, teardrop), so the
 *                      artwork has to sit inside the middle 80%. Shipping
 *                      the `any` icon as maskable is what produces those
 *                      logos with their edges shaved off.
 * `apple-icon` (180) — iOS reads `apple-touch-icon` and nothing else, does
 *                      not accept SVG, and does not honour transparency:
 *                      an alpha background composites onto BLACK. Hence a
 *                      full-bleed navy ground rather than a transparent one.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The brand navy. Same value as `src/app/icon.tsx`. */
const GROUND = '#0E0A3A';

/**
 * The three arrows, verbatim from `src/components/brand-mark.tsx` but
 * in SVG attribute case (`stroke-width`, not `strokeWidth`) — librsvg
 * parses SVG, not JSX.
 *
 * Drawn on a 100 × 100 viewBox whose INK runs from about 12.6 to 90.3,
 * so the artwork is already inset ~12% inside its own box. The scale
 * factors below are chosen against the ink, not the box.
 */
const MARK = `
  <path d="M28.08 71.92 A31 31 0 0 1 22.63 35.45" fill="none" stroke="#FFD500" stroke-width="12"/>
  <path d="M28.08 28.08 L12.56 30.09 L32.69 40.80 Z" fill="#FFD500"/>
  <path d="M34.50 23.15 A31 31 0 0 1 73.75 30.07" fill="none" stroke="#E1121E" stroke-width="12"/>
  <path d="M78.54 37.89 L82.48 22.75 L65.01 37.40 Z" fill="#E1121E"/>
  <path d="M80.70 45.69 A31 31 0 0 1 40.42 79.48" fill="none" stroke="#00A14B" stroke-width="12"/>
  <path d="M32.22 75.39 L36.90 90.32 L43.94 68.64 Z" fill="#00A14B"/>
`;

/**
 * @param size    Output edge, in pixels.
 * @param inset   Fraction of the canvas the 100-unit mark box occupies.
 * @param radius  Corner radius in pixels, or 0 for a hard square.
 */
function compose(size, inset, radius = 0) {
  const box = size * inset;
  const offset = (size - box) / 2;
  const scale = box / 100;
  const ground = radius
    ? `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${GROUND}"/>`
    : `<rect width="${size}" height="${size}" fill="${GROUND}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${ground}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${MARK}</g>
</svg>`;
}

const TARGETS = [
  // Plain icons. Full bleed — the platform decides how to frame them.
  { file: 'public/icons/icon-192.png', size: 192, inset: 0.76 },
  { file: 'public/icons/icon-512.png', size: 512, inset: 0.76 },
  // Maskable. 0.56 keeps every arrow tip inside the 80% safe circle
  // even under the most aggressive launcher crop.
  { file: 'public/icons/icon-maskable-512.png', size: 512, inset: 0.56 },
  // iOS. Lives in `src/app` so Next's `apple-icon` file convention
  // emits the <link rel="apple-touch-icon"> for us. No radius: iOS
  // applies its own, and rounding it twice leaves grey corners.
  { file: 'src/app/apple-icon.png', size: 180, inset: 0.68 },
];

await mkdir(join(ROOT, 'public/icons'), { recursive: true });

for (const { file, size, inset, radius } of TARGETS) {
  const svg = compose(size, inset, radius ?? 0);
  const png = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(ROOT, file), png);
  console.log(
    `${file.padEnd(38)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`
  );
}
