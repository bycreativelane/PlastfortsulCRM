'use client';

import type { ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The parts the four signed-out screens are built from.
 *
 * They live together because their whole reason for existing is that
 * login, signup and forgot-password kept drifting apart: three
 * `<CardHeader className="px-0 pb-1 text-center">`s that were meant to
 * be the same block, three copies of the red error strip, and a title
 * scale that matched neither the dashboard's `PageHeader` nor itself.
 * One module, four screens, one answer each.
 */

/**
 * The block every auth screen opens with.
 *
 * The scale is `PageHeader`'s, exactly — 24px bold with the tracking
 * pulled in over a 14px grey line. Moving from the sign-in screen to
 * the first dashboard page should not feel like moving between two
 * products, and the title is the one element both screens have.
 *
 * LEFT aligned, where it used to be centred. A centred title over
 * left-aligned labels and left-aligned inputs gives the column two
 * different axes and the eye has to find the second one; the form is
 * the content here, so the heading lines up with the form.
 *
 * `eyebrow` is the one personal note on the page — the time-of-day
 * greeting. It is optional because two of the four screens (reset,
 * check-your-email) are not greetings, they are receipts.
 */
export function AuthHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <header className="mb-7">
      {/* The row is rendered whether or not there is a greeting, and
          reserves its own height. The greeting can only be computed on
          the client — the server has no idea what time it is where the
          operator is — so it arrives one frame late, and without the
          reserved line the whole form would step down 22px on hydration. */}
      <p className="eyebrow text-primary mb-2 flex h-3.5 items-center">
        {eyebrow}
      </p>
      <h1 className="text-foreground text-2xl font-bold tracking-tight">
        {title}
      </h1>
      {description ? (
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {description}
        </p>
      ) : null}
    </header>
  );
}

/**
 * The failure strip.
 *
 * `role="alert"` because it appears after a submit the user is waiting
 * on: without it a screen reader announces nothing and the form simply
 * seems not to have worked. The icon is there for the same reason the
 * colour is not enough anywhere else in this app.
 */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="bg-danger-soft text-danger-ink flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm"
    >
      <AlertCircle className="mt-px size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/**
 * The step rail for the signup wizard.
 *
 * Deliberately the same object as the broadcast composer's — numbered
 * circle, a check once it is behind you, a rule connecting it to the
 * next one, and the same three states in the same three colours. The
 * app already taught its users what a multi-step form looks like on
 * `/broadcasts/new`; teaching them a second vocabulary on the way in
 * would be the strangest possible place to do it.
 *
 * `transition-colors` and not `transition-all`: the active step carries
 * `border-2` and the others `border`, so animating everything animates
 * the border width too and the circle breathes a pixel on every step
 * change.
 */
export function AuthSteps({
  steps,
  current,
}: {
  steps: readonly string[];
  current: number;
}) {
  return (
    <ol className="mb-7 flex items-center">
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <li
            key={label}
            className="flex flex-1 items-center last:flex-none"
            aria-current={active ? 'step' : undefined}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors duration-(--dur-1)',
                  done
                    ? 'bg-primary text-primary-foreground'
                    : active
                      ? 'border-primary bg-primary/10 text-primary border-2'
                      : 'border-border bg-muted text-muted-foreground border'
                )}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'text-xs font-semibold transition-colors duration-(--dur-1)',
                  active
                    ? 'text-foreground'
                    : done
                      ? 'text-primary'
                      : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            </div>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'mx-3 h-px flex-1 transition-colors duration-(--dur-2)',
                  done ? 'bg-primary' : 'bg-border'
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * How good the password is, scored 0–4.
 *
 * Length first and length heaviest, because it is the only input that
 * actually costs an attacker anything — the character-class rules are
 * here because people expect to see them move, not because a symbol is
 * worth as much as four more characters. Anything under the 6-character
 * floor the form enforces scores 0 and says so.
 */
export function scorePassword(value: string): number {
  if (value.length < 6) return 0;

  let score = 1;
  if (value.length >= 10) score += 1;
  if (value.length >= 14) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^\w\s]/.test(value)) score += 1;

  return Math.min(score, 4);
}

/**
 * The meter under the password field.
 *
 * Four segments and a word. The word is what people read; the segments
 * are what makes typing another character feel like it did something,
 * which is the entire behavioural point of a strength meter — it is
 * feedback on a keystroke, not a verdict.
 *
 * Colours come off the doctrine tokens rather than a red/yellow/green
 * of their own: danger for "this will be guessed", human-amber for
 * "you could do better" (amber is the app's one come-here colour, and
 * this is the one moment on the screen that is asking for something),
 * ok-green for done. `aria-hidden` on the bars — the label beside them
 * already says it in words, and eight nested spans announced one at a
 * time is noise.
 */
export function PasswordStrength({
  value,
  labels,
  hint,
}: {
  value: string;
  /** Four words, weakest first. */
  labels: readonly [string, string, string, string];
  /** Shown while the field is still under the minimum length. */
  hint: string;
}) {
  const score = scorePassword(value);
  const tone = score <= 1 ? 'bg-danger' : score === 2 ? 'bg-human' : 'bg-ok';
  const ink =
    score <= 1
      ? 'text-danger-ink'
      : score === 2
        ? 'text-human-ink'
        : 'text-ok-ink';

  return (
    <div className="mt-2">
      <div aria-hidden className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-(--dur-2)',
              i < score ? tone : 'bg-border'
            )}
          />
        ))}
      </div>
      {/* Reserved height, not a conditional render: the line appears the
          moment the field is touched and disappears when it is cleared,
          and letting it collapse would bounce the confirm field and the
          submit button under it on every backspace to empty. */}
      <p className="mt-1.5 flex h-4 items-center text-xs">
        {value.length === 0 ? (
          <span className="text-muted-foreground">{hint}</span>
        ) : (
          <span className={cn('font-medium', ink)}>
            {labels[Math.max(0, score - 1)]}
          </span>
        )}
      </p>
    </div>
  );
}
