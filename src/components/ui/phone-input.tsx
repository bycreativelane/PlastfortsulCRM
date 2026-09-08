'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  MAX_PHONE_DIGITS,
  formatPhone,
  toE164,
} from '@/lib/whatsapp/phone-format';

interface PhoneInputProps extends Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type'
> {
  /** E.164 (`+5551990000001`). This is what the database holds. */
  value: string;
  /** Called with E.164, never with the mask. */
  onValueChange: (value: string) => void;
}

/**
 * A phone field that reads like a phone number while you type it.
 *
 * The sibling of `currency-input.tsx`, for the same reason and with the same
 * caret problem: the field was printing back `+555199000001`, thirteen
 * digits in a row that somebody has to count with a finger to check against
 * a business card. Every other surface in this product will now show
 * `+55 (51) 99000-0001` through `formatPhone`; this is the one place the
 * number is entered, and it was the one place it stayed a string.
 *
 * IN, MASKED. OUT, E.164. The parent never sees the parentheses — see the
 * note in `@/lib/whatsapp/phone-format` for why what is stored stays
 * canonical, and why formatting is safe end to end (everything downstream,
 * Meta included, strips non-digits before using it).
 *
 * The caret is repositioned by hand after every keystroke, exactly as the
 * currency field does it: inserting a separator shifts every character
 * after it, so leaving the browser to restore the caret walks it backwards
 * through the number as each new group appears. The position is counted in
 * DIGITS rather than characters — how many digits are to the left of the
 * caret is the one thing that survives re-formatting.
 */
export function PhoneInput({
  value,
  onValueChange,
  className,
  disabled,
  ...rest
}: PhoneInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const caretDigitsRef = React.useRef<number | null>(null);

  const display = formatPhone(value);

  React.useLayoutEffect(() => {
    const target = caretDigitsRef.current;
    const el = inputRef.current;
    caretDigitsRef.current = null;
    if (target === null || !el) return;

    // Walk the formatted string until we have passed `target` digits; that
    // character index is where the caret belongs.
    let seen = 0;
    let index = display.length;
    for (let i = 0; i < display.length; i++) {
      if (/\d/.test(display[i])) {
        seen++;
        if (seen === target) {
          index = i + 1;
          break;
        }
      }
    }
    if (target === 0) index = 0;
    el.setSelectionRange(index, index);
  }, [display]);

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const el = event.currentTarget;
      const raw = el.value;

      // Count the digits before the caret in what the user just typed, so
      // the caret can be put back in the same logical place afterwards.
      const before = raw.slice(0, el.selectionStart ?? raw.length);
      caretDigitsRef.current = normalizePhone(before).length;

      const digits = normalizePhone(raw).slice(0, MAX_PHONE_DIGITS);

      // An empty field is empty, not `+`. Otherwise clearing the box would
      // leave a lone plus sign behind that nothing can delete.
      onValueChange(digits ? toE164(digits) : '');
    },
    [onValueChange]
  );

  return (
    /*
     * O `Input` DA CASA, e não um `<input>` nu.
     *
     * Era nu, com `className={cn(className)}` e nada mais — o que significa
     * que ele não recebia NADA da receita de campo: sem `w-full`, sem `h-8`,
     * sem `px-2.5`, sem `border`, sem `rounded-lg`, sem o anel de foco de 3px
     * e sem `data-slot="input"`. Medido na ficha do contato, ao lado dos três
     * irmãos que usam o `Input`:
     *
     *   largura   trava em ~215px (o `size` padrão do navegador) · acompanha
     *   altura    24px · 32px
     *   padding   0 · 10px
     *   borda     0 · 1px
     *   raio      0 · 8px
     *
     * As classes que os dois call sites passavam — `border-border` entre elas
     * — são COR, não largura: o preflight do Tailwind zera `border-width` em
     * tudo, então pintar a borda de uma borda que não existe não desenha
     * nada. É por isso que o campo aparecia sem contorno e com o número
     * colado na margem esquerda.
     *
     * `data-slot="input"` é o que menos se vê e mais importa: é por ele que o
     * `globals.css` dá 44px de altura no ponteiro grosso. Sem ele, o campo de
     * telefone era o alvo de 24px de um formulário — no componente cujo
     * próprio `type="tel"` existe, diz o parágrafo acima, porque é do celular
     * que a maioria dos contatos é cadastrada.
     *
     * O irmão `currency-input.tsx` também desenha um `<input>` nu, mas ele
     * PRECISA: o símbolo da moeda é um irmão absoluto dentro de um `relative`.
     * E ele copia a receita inteira à mão, `data-slot` incluído. Aqui não há
     * sobreposição nenhuma, então o certo é usar o componente e parar de ter
     * uma terceira cópia da receita.
     *
     * `{...rest}` vem PRIMEIRO de propósito: `value`, `onChange` e `type` são
     * o contrato deste componente e um call site não pode sobrescrevê-los sem
     * quebrar a máscara.
     */
    <Input
      {...rest}
      ref={inputRef}
      // `tel` and not `text`: it is what puts the numeric keypad in front of
      // somebody adding a contact from a phone, which is where most of them
      // get added.
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={display}
      onChange={handleChange}
      disabled={disabled}
      className={className}
    />
  );
}
