'use client';

import * as React from 'react';
import { useLocale } from 'next-intl';

import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currency';
import { fromCents, toCents } from '@/lib/money';
import { cn } from '@/lib/utils';

import {
  caretAfterSignificant,
  decimalSeparatorFor,
  formatMoneyCents,
  parseMoneyText,
  significantBefore,
} from './money-text';

interface MoneyInputProps extends Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type'
> {
  /** Em reais, com até duas casas. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** ISO-4217 — decide o símbolo desenhado no campo. */
  currency?: string;
}

/**
 * O CAMPO DE DINHEIRO COM CENTAVOS — para o pedido.
 *
 * ------------------------------------------------------------------
 * POR QUE UM SEGUNDO CAMPO, E NÃO UMA OPÇÃO NO PRIMEIRO
 * ------------------------------------------------------------------
 *
 * `CurrencyInput` é de reais inteiros por decisão escrita nele: "não
 * existem centavos em lugar nenhum deste produto". Para o valor de um
 * cartão no funil ou o preço de catálogo, isso continua certo.
 *
 * Para o PEDIDO, não. Medido em 14 de setembro de 2026 na gaveta da
 * oportunidade: um pedido de R$ 100,00 em três parcelas vira 33,33 +
 * 33,33 + 33,34, e o campo de parcela mostrava "33", "33", "33" — e tocar
 * em qualquer um deles gravava 33, apagando os centavos e fazendo as
 * parcelas pararem de fechar com o total, que é exatamente o que o Bling
 * recusa. O frete de R$ 80,50 simplesmente não podia ser digitado.
 *
 * Um campo separado deixa a decisão do primeiro intacta onde ela vale e
 * põe centavos só onde o pedido precisa: frete, outras despesas, desconto
 * geral e parcelas.
 *
 * ------------------------------------------------------------------
 * COMO SE DIGITA
 * ------------------------------------------------------------------
 *
 * "80" é R$ 80,00 e "80,5" é R$ 80,50 — ver `money-text.ts` para por que
 * não o modo caixa registradora. Enquanto o campo tem foco, o texto é o
 * que a pessoa escreveu (a vírgula sem centavos fica lá); ao sair, ele
 * volta ao formato de repouso, sempre com duas casas.
 *
 * O cursor é reposicionado pelos caracteres significativos — dígitos e a
 * vírgula —, pela mesma razão do `CurrencyInput`: os pontos de milhar
 * mudam de lugar a cada tecla e os dígitos não.
 */
export function MoneyInput({
  value,
  onValueChange,
  currency = DEFAULT_CURRENCY,
  className,
  disabled,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  onKeyDown: onKeyDownProp,
  ...rest
}: MoneyInputProps) {
  const locale = useLocale();
  const sep = decimalSeparatorFor(locale);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const caretRef = React.useRef<number | null>(null);

  const symbol =
    CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;

  const repouso = formatMoneyCents(
    value === null ? null : toCents(value),
    locale
  );

  // O texto em edição só existe enquanto há foco. Fora dele, o campo é
  // o valor — então uma mudança vinda de fora (gerar parcelas, recarregar a
  // oportunidade) aparece sem efeito nenhum para sincronizar.
  const [editando, setEditando] = React.useState<string | null>(null);
  const display = editando ?? repouso;

  React.useEffect(() => {
    const el = inputRef.current;
    const caret = caretRef.current;
    if (el && caret !== null && document.activeElement === el) {
      el.setSelectionRange(caret, caret);
    }
    caretRef.current = null;
  });

  function aplicar(texto: string, significativosAntes: number) {
    const lido = parseMoneyText(texto, locale);
    caretRef.current = caretAfterSignificant(
      lido.text,
      significativosAntes,
      sep
    );
    setEditando(lido.text);
    onValueChange(lido.cents === null ? null : fromCents(lido.cents));
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const posicao = event.target.selectionStart ?? raw.length;
    aplicar(raw, significantBefore(raw, posicao, sep));
  }

  /*
   * BACKSPACE EM CIMA DO PONTO DE MILHAR APAGA O DÍGITO ANTES DELE.
   *
   * O mesmo defeito que `masked-caret.ts` documenta para o telefone e para
   * o `CurrencyInput`: apagar só o ponto não muda número nenhum, a
   * reformatação o devolve, e a tecla parece não fazer nada.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    onKeyDownProp?.(event);
    if (event.defaultPrevented) return;
    const el = event.currentTarget;
    const inicio = el.selectionStart;
    if (inicio === null || inicio !== el.selectionEnd) return;
    const texto = el.value;

    const ehAgrupador = (c: string | undefined) =>
      c !== undefined && !/\d/.test(c) && c !== sep;

    if (event.key === 'Backspace' && inicio >= 2 && ehAgrupador(texto[inicio - 1])) {
      event.preventDefault();
      aplicar(
        texto.slice(0, inicio - 2) + texto.slice(inicio),
        significantBefore(texto, inicio - 2, sep)
      );
    } else if (event.key === 'Delete' && ehAgrupador(texto[inicio])) {
      event.preventDefault();
      aplicar(
        texto.slice(0, inicio) + texto.slice(inicio + 2),
        significantBefore(texto, inicio, sep)
      );
    }
  }

  return (
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
        // `decimal`, e não o `numeric` do campo de inteiros: aqui a vírgula
        // é uma tecla que o campo usa.
        inputMode="decimal"
        autoComplete="off"
        value={display}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          setEditando(repouso);
          onFocusProp?.(event);
        }}
        onBlur={(event) => {
          setEditando(null);
          onBlurProp?.(event);
        }}
        disabled={disabled}
        className={cn(
          'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-field/30 h-8 w-full min-w-0 rounded-lg border bg-transparent py-1 pr-2.5 text-base tabular-nums transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
          symbol.length > 2 ? 'pl-12' : 'pl-7',
          className
        )}
        {...rest}
      />
    </div>
  );
}
