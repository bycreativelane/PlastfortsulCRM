'use client';

import * as React from 'react';
import { useLocale } from 'next-intl';

import { cn } from '@/lib/utils';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currency';
import {
  caretAfterDigits,
  deleteAcrossSeparator,
} from '@/components/ui/masked-caret';

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
  // Desestruturado e composto, e não deixado no `...rest`: o spread vem
  // DEPOIS do `onKeyDown` no elemento, então um call site que passasse o seu
  // derrubaria o do componente em silêncio — junto com o Backspace.
  onKeyDown: onKeyDownProp,
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

  /*
   * BACKSPACE EM CIMA DO PONTO DE MILHAR APAGA UM DÍGITO.
   *
   * Sem isto ele não apagava nada e ainda levava o cursor para o fim. Medido
   * em `18.400` com o cursor logo depois do ponto: o campo continuava igual e
   * o cursor ia de 3 para 6. O próximo Backspace apagava o último dígito do
   * valor — que num campo de dinheiro é a diferença entre 18.400 e 1.840.
   *
   * O mesmo defeito que o telefone tinha, pela mesma razão, e a nota inteira
   * está em `masked-caret.ts`. Aqui ele é ainda mais fácil de encontrar: o
   * separador de milhar cai bem no meio de um valor de quatro dígitos.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    onKeyDownProp?.(event);
    if (event.defaultPrevented) return;

    const direction =
      event.key === 'Backspace'
        ? 'back'
        : event.key === 'Delete'
          ? 'forward'
          : null;
    if (!direction) return;

    const el = event.currentTarget;
    const start = el.selectionStart;
    // Uma seleção é um pedaço escolhido à mão: apagar exatamente aquilo é o
    // certo, e o caminho normal já faz isso.
    if (start === null || start !== el.selectionEnd) return;

    const plan = deleteAcrossSeparator(el.value, start, direction);
    if (!plan) return;

    event.preventDefault();
    const next = plan.digits === '' ? null : Number(plan.digits);
    caretRef.current = caretAfterDigits(
      next === null ? '' : format(next),
      plan.caretDigits
    );
    onValueChange(next);
  }

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

    caretRef.current = caretAfterDigits(formatted, digitsBeforeCaret);
    onValueChange(next);
  }

  return (
    /*
     * `h-fit` E NÃO SÓ `relative`.
     *
     * O símbolo é posicionado no MEIO deste invólucro. Enquanto ele tem a
     * altura do campo, "meio do invólucro" e "meio do campo" são a mesma
     * linha — e é por isso que o defeito não aparece na maioria das telas.
     *
     * Ele apareceria se este `div` fosse item de um grid cuja outra coluna
     * é mais alta: o padrão do grid é esticar, o invólucro cresceria, o
     * `input` ficaria com seus 32px no topo e o `R$` desceria para o meio
     * do espaço vazio — abaixo do número.
     *
     * HONESTIDADE SOBRE O QUE ISTO CONSERTA. O Gabriel reportou o `R$` do
     * campo de Frete desalinhado, e esta foi a hipótese: ele fica ao lado
     * de um Valor que carrega um parágrafo de ajuda embaixo. Montei o caso
     * no `/chart-lab` e ele NÃO reproduziu — com ou sem `h-fit`, os dois
     * invólucros medem 32px e o símbolo fica centrado.
     *
     * Então `h-fit` fica porque fecha uma classe real de defeito e não
     * custa nada, e não porque esteja provado que era ele. A causa do que
     * ele viu continua em aberto.
     */
    <div className="relative h-fit">
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
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-field/30 h-8 w-full min-w-0 rounded-lg border bg-transparent py-1 pr-2.5 text-base tabular-nums transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
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
