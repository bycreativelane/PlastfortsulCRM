'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/**
 * "Tem certeza?", asked by the product instead of by Chrome.
 *
 * ------------------------------------------------------------------
 * WHY `window.confirm` HAD TO GO
 * ------------------------------------------------------------------
 *
 * Eight of them were scattered across the app — deleting a flow, a
 * custom field, a team message, a quick reply, archiving a room,
 * resetting the WhatsApp connection — plus a `window.prompt` for naming
 * a quick reply. Somebody hit one and reported it, which is the point:
 * a grey OS box saying "localhost:3000 diz" in the middle of a product
 * that has spent this much care on its own dialogs reads as a bug even
 * when it works.
 *
 * And it is not only how it looks:
 *
 *   · IT BLOCKS THE MAIN THREAD. Everything stops while the box is up —
 *     the realtime subscription, the presence heartbeat, the unread
 *     poller. Leave one open and the inbox quietly falls behind.
 *   · IT CAN BE SUPPRESSED. Browsers let a user tick "prevent this page
 *     from creating more dialogs", and several in-app webviews block
 *     them outright. `confirm()` then returns FALSE with no dialog at
 *     all: the delete silently does nothing, forever, and nothing in
 *     the product can tell.
 *   · `window.prompt` IS WORSE — blocked by default in more places, and
 *     it returns a raw string with no validation surface.
 *
 * ------------------------------------------------------------------
 * PROMISE-SHAPED ON PURPOSE
 * ------------------------------------------------------------------
 *
 * `await confirm({...})` keeps the call site the exact shape the native
 * one had:
 *
 *     if (!(await confirm({ title }))) return;
 *
 * That is what made replacing eight of them a one-line edit each,
 * instead of eight components learning to hold an `open` state and
 * split their handler in half around it.
 */

interface ConfirmOptions {
  title: string;
  description?: string;
  /** Defaults to the shared "Confirmar". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red button, for anything that destroys something. */
  destructive?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  placeholder?: string;
  defaultValue?: string;
}

type Pending =
  | {
      kind: 'confirm';
      options: ConfirmOptions;
      resolve: (value: boolean) => void;
    }
  | {
      kind: 'prompt';
      options: PromptOptions;
      resolve: (value: string | null) => void;
    };

interface ConfirmApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Common');
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ kind: 'confirm', options, resolve });
      }),
    []
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(options.defaultValue ?? '');
        setPending({ kind: 'prompt', options, resolve });
      }),
    []
  );

  // Focus the field when a prompt opens. Without this the dialog steals
  // focus to its own container and the first keystroke goes nowhere,
  // which the native prompt never did.
  useEffect(() => {
    if (pending?.kind !== 'prompt') return;
    const id = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [pending]);

  const settle = useCallback(
    (accepted: boolean) => {
      if (!pending) return;
      if (pending.kind === 'confirm') pending.resolve(accepted);
      // An empty prompt is a cancel. The native one returned "" here and
      // every caller had to remember to check; answering `null` makes
      // "they typed nothing" and "they pressed Escape" the same thing,
      // which is what they mean.
      else pending.resolve(accepted && value.trim() ? value.trim() : null);
      setPending(null);
    },
    [pending, value]
  );

  const options = pending?.options;

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      <Dialog
        open={pending !== null}
        // Escape, the backdrop and the close button all land here, and
        // all three mean no. Resolving rather than leaving the promise
        // hanging matters: an unresolved one is a handler that never
        // returns and a button that stays disabled forever.
        onOpenChange={(next) => {
          if (!next) settle(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
            {options?.description ? (
              <DialogDescription>{options.description}</DialogDescription>
            ) : null}
          </DialogHeader>

          {pending?.kind === 'prompt' ? (
            <Input
              ref={inputRef}
              value={value}
              placeholder={pending.options.placeholder}
              onChange={(e) => setValue(e.target.value)}
              // Enter submits, same as the native prompt. Without it the
              // fastest path through this dialog is worse than the box
              // it replaced.
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  settle(true);
                }
              }}
            />
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {options?.cancelLabel ?? t('cancel')}
            </Button>
            <Button
              autoFocus={pending?.kind === 'confirm'}
              variant={options?.destructive ? 'destructive' : 'default'}
              disabled={pending?.kind === 'prompt' && !value.trim()}
              onClick={() => settle(true)}
            >
              {options?.confirmLabel ?? t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * `const { confirm } = useConfirm();`
 *
 * Throws outside the provider rather than falling back to
 * `window.confirm`. A silent fallback would put the grey box back on
 * whichever screen forgot to mount the provider, and the whole reason
 * this file exists is that nobody noticed those for months.
 */
export function useConfirm(): ConfirmApi {
  const api = useContext(ConfirmContext);
  if (!api) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>');
  }
  return api;
}
