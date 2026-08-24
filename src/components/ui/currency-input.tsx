'use client';

import * as React from 'react';
import { useLocale } from 'next-intl';

import { cn } from '@/lib/utils';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currency';

interface CurrencyInputProps extends Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type'
> {
  /** The amount, in whole units. `null` is an empty field, not zero. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** ISO-4217 code — decides the symbol shown inside the field. */
  currency?: string;
}

/**
 * A money field that reads like money while you type it.
 *
 * The board and the cards run every amount through `formatCurrency`, so a
 * deal worth 143123421 shows as R$ 143.123.421 everywhere — except in the
 * field where you actually enter it, which was a bare `type="number"` and
 * printed `143123421`. Nine digits with no grouping is not a number a person
 * can read: you count them with a finger to find out whether you typed a
 * hundred million or ten.
 *
 * Whole units only, matching `formatCurrency` and the rest of the app: there
 * are no cents anywhere in this product, and a field that accepts them would
 * be the only place they exist.
 *
 * The caret is repositioned by hand after every keystroke. Inserting a
 * thousands separator shifts every character after it, so leaving the browser
 * to restore the caret puts it one place too far left on each new group —
 * type 1234567 and the cursor walks backwards through the number.
 */
export function CurrencyInput({
  value,
  onValueChange,
  currency = DEFAULT_CURRENCY,
  className,
  disabled,
  ...rest
}: CurrencyInputProps) {
  const locale = useLocale();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const caretRef = React.useRef<number | null>(null);

  const symbol =
    CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;

  const format = React.useCallback(
    (amount: number) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
        amount
      ),
    [locale]
  );

  const display = value === null ? '' : format(value);

  // Runs after the formatted value is committed to the DOM, which is the only
  // point at which the caret can be placed against the final string.
  React.useEffect(() => {
    const el = inputRef.current;
    const caret = caretRef.current;
    if (el && caret !== null && document.activeElement === el) {
      el.setSelectionRange(caret, caret);
    }
    caretRef.current = null;
  });

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const selection = event.target.selectionStart ?? raw.length;

    // Count digits rather than characters: separators move, digits do not.
    const digitsBeforeCaret = (raw.slice(0, selection).match(/\d/g) ?? [])
      .length;
    const digits = raw.replace(/\D/g, '');

    if (digits === '') {
      caretRef.current = 0;
      onValueChange(null);
      return;
    }

    // 15 digits keeps the value inside the range integers stay exact in, so a
    // pasted or leaned-on key sequence can never round the amount silently.
    const next = Number(digits.slice(0, 15));
    const formatted = format(next);

    let seen = 0;
    let caret = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) {
        seen += 1;
        if (seen === digitsBeforeCaret) {
          caret = i + 1;
          break;
        }
      }
    }
    caretRef.current = digitsBeforeCaret === 0 ? 0 : caret;
    onValueChange(next);
  }

  return (
    <div className="relative">
      <span
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs font-medium tabular-nums"
      >
        {symbol}
      </span>
      <input
        ref={inputRef}
        data-slot="input"
        type="text"
        // `numeric` and not `decimal`: whole units, so the keypad has no
        // business offering a separator key the field would strip anyway.
        inputMode="numeric"
        autoComplete="off"
        value={display}
        onChange={handleChange}
        disabled={disabled}
        className={cn(
          'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 h-8 w-full min-w-0 rounded-lg border bg-transparent py-1 pr-2.5 text-base tabular-nums transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
          // Room for the symbol. Sized off the symbol's own length so
          // "R$" and "د.إ" both clear the text.
          symbol.length > 2 ? 'pl-12' : 'pl-7',
          className
        )}
        {...rest}
      />
    </div>
  );
}
