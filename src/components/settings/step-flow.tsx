'use client';

import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A settings screen as a sequence rather than as a wall.
 *
 * The AI agent's setup was eleven fields on one page: provider, model,
 * key, embeddings key, system prompt, master switch, auto-reply switch,
 * a cap, a handoff target, media understanding, and a knowledge base
 * underneath. Every one of them is necessary and the page was still the
 * wrong shape, because the eleven are not eleven settings — they are six
 * QUESTIONS, in an order, and four of them only make sense once the one
 * before is answered. Somebody who has never configured an LLM cannot
 * tell which field is the one to start with, and the page does not say.
 *
 * ------------------------------------------------------------------
 * WHY AN ACCORDION AND NOT A WIZARD WITH NEXT BUTTONS
 * ------------------------------------------------------------------
 *
 * A modal wizard is right for something you do once. This is something
 * you do once and then come back to six times to change one line, and a
 * wizard makes the sixth visit worse than the wall did — four Next
 * clicks to reach the guardrails.
 *
 * So: every step is on the page, collapsed, in order, with its state
 * visible. First run reads top to bottom; the sixth visit opens step
 * four directly. Nothing is ever more than one click away, and the order
 * is still stated.
 *
 * ------------------------------------------------------------------
 * AND WHY IT NEEDS NO MOBILE DESIGN
 * ------------------------------------------------------------------
 *
 * One column of full-width rows is already the phone layout. A stepper
 * rail beside a content pane would have needed a second arrangement
 * below `md`, which is the class of thing this codebase keeps having to
 * go back and fix. This has one arrangement.
 */

export interface Step {
  id: string;
  title: string;
  /** One line, in the collapsed row. What the step is FOR. */
  summary: string;
  /** Right-hand hint in the collapsed row — the current answer. */
  status?: ReactNode;
  /**
   * Whether this step has been answered. Drives the check, and nothing
   * else: an unanswered step is never blocked, because a settings screen
   * that will not let you jump to the field you came for is a settings
   * screen people work around.
   */
  done?: boolean;
  icon?: ReactNode;
  content: ReactNode;
}

export function StepFlow({
  steps,
  openId,
  onOpen,
  className,
}: {
  steps: Step[];
  /** The open step, or null for all collapsed. */
  openId: string | null;
  onOpen: (id: string | null) => void;
  className?: string;
}) {
  return (
    <div className={cn('border-border divide-border divide-y rounded-lg border', className)}>
      {steps.map((step, index) => {
        const open = step.id === openId;
        return (
          <section key={step.id} className={cn(open && 'bg-card-2/40')}>
            <button
              type="button"
              onClick={() => onOpen(open ? null : step.id)}
              aria-expanded={open}
              // 56px at rest and the whole row is the target. On a phone
              // this is the only control on the line, so anything less
              // than the full width is a smaller target for no reason.
              className="hover:bg-muted/60 flex w-full items-center gap-3 px-3 py-3 text-left transition-colors sm:px-4"
            >
              {/* The number, or the tick. One disc, two states — a
                  separate check column would leave a gap on every step
                  nobody has done yet. */}
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors',
                  step.done
                    ? 'bg-ok text-white'
                    : open
                      ? 'bg-primary text-white'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {step.done ? <Check className="size-3.5" /> : index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm font-semibold',
                    open ? 'text-primary' : 'text-foreground'
                  )}
                >
                  {step.title}
                </span>
                {/* The summary is what makes the collapsed list readable
                    as a sequence rather than as a table of contents. It
                    goes away when the step is open, because the content
                    below says it better. */}
                {!open && (
                  <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                    {step.summary}
                  </span>
                )}
              </span>

              {step.status && !open ? (
                <span className="text-muted-foreground text-2xs hidden shrink-0 sm:block">
                  {step.status}
                </span>
              ) : null}

              <ChevronDown
                aria-hidden
                className={cn(
                  'text-muted-foreground size-4 shrink-0 transition-transform duration-(--dur-2)',
                  open && 'rotate-180'
                )}
              />
            </button>

            {open ? (
              <div className="space-y-4 px-3 pb-4 sm:px-4 sm:pl-14">
                <p className="text-muted-foreground max-w-prose text-xs">
                  {step.summary}
                </p>
                {step.content}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
