/**
 * The disc behind somebody's initials, when there is no photo.
 *
 * Ported from the design prototype, which states the rule in a comment above
 * its palette (`assets/css/app.css:391`):
 *
 *   "Dessaturados e de luminosidade parecida: ajudam a reconhecer pessoas
 *    sem virar sinal. Avatar é textura, não alerta."
 *
 * Eight fills in one lightness band, seeded from the NAME so the same person
 * keeps the same colour across the conversation list, the thread header, the
 * contact sheet and a deal card — which is the entire point. It is what makes
 * a wall of rows scannable without any of them shouting.
 *
 * What it replaces: every avatar in the app filled itself with `bg-muted`.
 * That is 1.14:1 against a card and exactly 1.00:1 against a SELECTED
 * conversation row, whose fill is also `--muted` — the disc did not have poor
 * contrast there, it had none.
 *
 * The colours live in `globals.css` as `--avatar-1…8` so they can flip per
 * mode; see the block there for the measured ratios.
 */

/**
 * Written out, never built.
 *
 * `bg-avatar-${n}` is invisible to Tailwind v4's scanner, which reads source
 * files as text: the rule is never generated and the disc renders
 * transparent — a failure that looks like "no colour yet" rather than an
 * error. The array is the eight literals the scanner needs to see.
 */
const AVATAR_CLASSES = [
  'bg-avatar-1',
  'bg-avatar-2',
  'bg-avatar-3',
  'bg-avatar-4',
  'bg-avatar-5',
  'bg-avatar-6',
  'bg-avatar-7',
  'bg-avatar-8',
] as const;

export type AvatarClass = (typeof AVATAR_CLASSES)[number];

/** Every class this module can return — for the guard test. */
export const AVATAR_CLASS_LIST: readonly AvatarClass[] = AVATAR_CLASSES;

/**
 * Which of the eight, for this name.
 *
 * The prototype's own seed (`assets/js/app.js:245`):
 *
 *     const avatarClass = seed => 'av-' + ((seed.charCodeAt(0) + seed.length) % 8 + 1)
 *
 * Seeded on the display NAME and not on the id on purpose: a UUID is always
 * 36 characters and always starts with a hex digit, so the distribution
 * collapses onto two or three buckets. It does mean renaming a contact
 * changes their colour, which the prototype accepts and so does this.
 */
export function avatarClass(seed: string | null | undefined): AvatarClass {
  const s = (seed ?? '').trim();
  if (!s) return AVATAR_CLASSES[0];
  return AVATAR_CLASSES[(s.charCodeAt(0) + s.length) % AVATAR_CLASSES.length];
}

/**
 * Up to two initials, the prototype's way (`assets/js/app.js:243`).
 *
 * "Marcos Antunes" → MA. The app had five copies of this, most of them
 * `.charAt(0)`, so the same contact showed one letter in the list and two on
 * their record.
 */
export function avatarInitials(
  name: string | null | undefined,
  fallback = ''
): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
