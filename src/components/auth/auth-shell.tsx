import type { CSSProperties, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { KanbanSquare, MessageSquare, Zap } from 'lucide-react';

import { BrandMark } from '@/components/brand-mark';

/**
 * The signed-out shell, shared by `(auth)` and by `/join/<token>`.
 *
 * It was only the `(auth)` layout, and the invitation page had its own —
 * a centred card on a flat background, no lockup, no photograph. Which
 * meant the FIRST screen a new colleague ever saw was the plain one and
 * the branded one came second, after they had already decided to sign
 * up. Exactly the wrong way round: the invite is the only screen here
 * whose reader has never seen the product.
 *
 * `/join` cannot simply live under the `(auth)` route group — it has to
 * render for signed-in visitors too, and that group's middleware rule
 * redirects them away (see `join/layout.tsx`). So the shell moves out of
 * the layout and both layouts render it.
 */

/**
 * Where the cover photo goes.
 *
 * Applied as a CSS background rather than an <img>, so an install that has
 * not dropped a file there degrades to the brand panel instead of showing a
 * broken-image glyph. Any photo works — the shop floor, the line, the
 * product. It sits under a scrim and is never the thing being read.
 */
const COVER = '/auth-cover.jpg';

/** The brand navy. Deliberately not a token — see the scrim note below. */
const NAVY = '#0E0A3A';

/**
 * What the product is, in three rows.
 *
 * Icons come from the dashboard's own set and point at the three routes
 * behind the login — inbox, pipeline, automations. That is the entire
 * reason they are here rather than a generic trio of checkmarks: the
 * panel is the last thing somebody sees before the sidebar, and these
 * are the first three things in it.
 */
const FEATURES = [
  { icon: MessageSquare, key: 'featureInbox' },
  { icon: KanbanSquare, key: 'featurePipeline' },
  { icon: Zap, key: 'featureAutomation' },
] as const;

/**
 * Shell for every signed-out screen.
 *
 * A single card floating on a tinted page, form on one side and the brand
 * panel on the other — both inside the same rounded container, with air
 * around it. Not a full-bleed split: edge-to-edge, the page reads as two
 * applications sharing a monitor, and the form loses the framing that makes
 * it feel like a discrete thing you are being handed.
 *
 * The split is `lg:grid-cols-2` — EQUAL halves. It was `1fr / 1.1fr`, which
 * is the kind of ratio that has a reason on a page with a dominant image and
 * none at all here: the two halves carry comparable amounts of content, the
 * seam sits 5% off the card's centre, and the eye reads that as a mistake
 * rather than as emphasis. The insets match on both sides for the same
 * reason (`p-6 → p-12` either way, where the old shell had `py-12/px-12`
 * against `p-10/xl:p-12`).
 *
 * The gradient is the app's own blue at very low saturation rather than a
 * decorative one. This is the only screen where the frame is allowed colour
 * at all — it is the branding moment, and the person looking has not signed
 * in yet — but it still has no business looking like a different product
 * from the one behind the login.
 *
 * The panel is `hidden lg:block`: below that width it would either crush the
 * form into a strip or push it under the fold. Nothing is lost with it — the
 * lockup sits on the form side and the copy it carries is marketing, not
 * instruction.
 */
export async function AuthShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('Auth');
  const tBrand = await getTranslations('Sidebar');

  // The page wash is built from `--primary-soft` / `--primary-soft-2`
  // rather than two literal oklch() stops. Two reasons: the literals were
  // light-mode blues sitting on a `via-background` that flips with the
  // theme, so in dark mode the page ran light → near-black → light; and
  // they ignored the accent the account had chosen, so a violet or
  // emerald install still got a blue login. The soft tokens are the accent
  // at 10–18% alpha, which is why the solid `bg-background` under them has
  // to stay.
  return (
    <div className="min-h-vh-100 bg-background from-primary-soft via-background to-primary-soft-2 flex items-center justify-center bg-gradient-to-br p-4 sm:p-8">
      <div className="bg-card border-border w-full max-w-5xl overflow-hidden rounded-3xl border shadow-2xl lg:grid lg:grid-cols-2">
        {/* Form side */}
        <div className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
          <div className="mx-auto w-full max-w-sm">
            {/* The lockup lives HERE, on the card, at every width.
                It spent a while on the photograph opposite and never
                worked there, in either of the two ways you can put it on
                a photograph. Bare, it disappeared — the mark is three
                thin arcs in yellow, red and green, and thin coloured
                strokes over a busy dark image are the first thing to go.
                On a tile, it stopped disappearing and started looking
                applied: a small panel of packaging sitting above the
                headline, competing with the one line the panel exists to
                say.

                The mark was drawn for a light background and this is the
                only light surface on the screen. Putting it here also
                puts it where the eye already starts — top-left of the
                column being read — instead of across a seam, and it
                makes the lockup identical to the sidebar's on the other
                side of the sign-in: same 40px mark, same 20px wordmark,
                same 10px gap. The photo panel keeps the words and gives
                up the logo. */}
            <div className="mb-8 flex items-center gap-2.5">
              <BrandMark className="size-10" />
              <span className="text-foreground text-xl font-bold tracking-tight">
                {tBrand('title')}
              </span>
            </div>
            {children}
          </div>
        </div>

        {/* Brand side */}
        <aside
          aria-hidden
          className="relative hidden bg-cover bg-center lg:block"
          style={{ backgroundColor: NAVY, backgroundImage: `url('${COVER}')` }}
        >
          {/* Scrim, in two layers.
              The photo is texture behind the words, not an image being
              presented — without it the copy sits on whatever happens to be
              in that corner of the frame and becomes unreadable on half the
              photos anyone might use. The flat 30% wash covers the whole
              panel so no part of it reads as a separate, brighter
              photograph; the vertical ramp on top of it adds depth and
              carries the composite past 80% navy through the middle band,
              which is where the list sits. Any photo anyone drops in has to
              survive both, which is the point of doing it in two parts
              rather than one aggressive gradient.

              Hard-coded navy and not a token: this panel must look identical
              in light and dark, because it is the brand, and a brand that
              changes colour with the operator's mode preference is not
              one. */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(to top, ${NAVY} 0%, ${NAVY}D9 42%, ${NAVY}4D 100%)`,
            }}
          />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: `${NAVY}4D` }}
          />

          {/* Three rows, centred, and nothing else.
              This panel carried a headline and a paragraph of product
              copy above the list. Both are gone, and the list says the
              same thing in a ninth of the words: somebody reading a
              login screen is not reading marketing prose, they are
              looking for the password field, and the copy was three
              lines of text competing for the one moment of attention the
              panel gets. The three labels ARE the argument.

              Centred on both axes now rather than anchored to the
              bottom: bottom-anchoring is what you do when there is a
              block of text that needs a floor to sit on. One short list
              in the middle of the frame is a composition; the same list
              pushed to the bottom edge is a leftover.

              `items-center` on the column with the list at its natural
              width — the block is centred, the ROWS are not. Centring
              the rows themselves would break the icon column, and that
              column is the only thing making three separate lines read
              as one list. */}
          <div className="relative flex h-full flex-col items-center justify-center p-12">
            <ul className="flex flex-col gap-4">
              {FEATURES.map(({ icon: Icon, key }, index) => (
                <li
                  key={key}
                  className="section-enter flex items-center gap-3.5 text-base font-medium text-white"
                  style={
                    {
                      '--enter-delay': `${60 + index * 60}ms`,
                    } as CSSProperties
                  }
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm">
                    <Icon className="size-5 text-white" strokeWidth={1.9} />
                  </span>
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
