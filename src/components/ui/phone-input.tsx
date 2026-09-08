'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  caretAfterDigits,
  deleteAcrossSeparator,
} from '@/components/ui/masked-caret';
import {
  MAX_PHONE_DIGITS,
  applyDefaultCountry,
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
  onKeyDown: onKeyDownProp,
  ...rest
}: PhoneInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const caretDigitsRef = React.useRef<number | null>(null);

  /**
   * A pessoa começou o número com `+`.
   *
   * A saída do padrão brasileiro, e a terceira regra do item 10: "se já foi
   * informado um número internacional explícito começando com `+`, preservar
   * o código informado". Sem ela o padrão vira uma armadilha sem porta —
   * um fixo norueguês tem dez dígitos e cai na assinatura de um fixo
   * daqui, e a pessoa veria `+55 (47) …` na tela sem nenhum jeito de dizer
   * que não era isso.
   *
   * Estado e não `ref` porque ele PINTA: com o campo vazio e a marca
   * ligada, o campo mostra o `+` sozinho. Um modo invisível seria pior do
   * que o problema — este aparece na tela no instante em que é ligado.
   */
  const [explicito, setExplicito] = React.useState(false);

  const digitosAtuais = normalizePhone(value);
  // Um `+` solitário só se sustenta enquanto não há dígito nenhum; a partir
  // do primeiro, quem desenha o país é o formatador.
  const display = digitosAtuais ? formatPhone(value) : explicito ? '+' : '';

  React.useLayoutEffect(() => {
    const target = caretDigitsRef.current;
    const el = inputRef.current;
    caretDigitsRef.current = null;
    if (target === null || !el) return;

    // Digits back to characters — o laço que fazia isto à mão aqui era o
    // mesmo que o `currency-input` tinha, palavra por palavra.
    const index = caretAfterDigits(display, target);
    el.setSelectionRange(index, index);
  }, [display]);

  /*
   * BACKSPACE EM CIMA DE UM SEPARADOR APAGA UM DÍGITO.
   *
   * Sem isto ele não apagava nada — e ainda levava o cursor para o fim do
   * campo. Medido em `+55 (51) 99000-0001` com o caret logo depois do `)`:
   * o campo continuava igual e o caret ia de 8 para 19. O próximo Backspace
   * apagava o último dígito do número, que não é onde a pessoa estava.
   *
   * O mecanismo: apagar um separador não muda os DÍGITOS, então `value` não
   * muda, `display` não muda, e o `useLayoutEffect` acima — que depende de
   * `[display]` — não roda. O caret nunca é recolocado. Enquanto isso o React
   * reescreve o valor no `<input>` para ressincronizar o campo controlado, e
   * atribuir `.value` num input estaciona o caret no fim.
   *
   * A regra aqui é a que todo campo mascarado bom segue: os separadores não
   * são conteúdo, são desenho. Backspace apaga o DÍGITO à esquerda; Delete
   * apaga o dígito à direita. Segurar Backspace some com o número um dígito
   * por vez, com as parênteses e o traço desaparecendo sozinhos no caminho.
   *
   * Uma SELEÇÃO não passa por aqui: quem marcou um pedaço à mão quer apagar
   * exatamente aquilo, e o caminho normal já faz isso certo.
   */
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
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
      if (start === null || start !== el.selectionEnd) return;

      const plan = deleteAcrossSeparator(el.value, start, direction);
      if (!plan) return;

      event.preventDefault();
      // O caret vai para onde o dígito apagado estava, contado em DÍGITOS —
      // a única medida que sobrevive à reformatação.
      caretDigitsRef.current = plan.caretDigits;
      onValueChange(plan.digits ? toE164(plan.digits) : '');
    },
    [onKeyDownProp, onValueChange]
  );

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const el = event.currentTarget;
      const raw = el.value;

      const digits = normalizePhone(raw).slice(0, MAX_PHONE_DIGITS);
      const marcado = raw.trimStart().startsWith('+');

      /*
       * A marca de "internacional" só é lida no COMEÇO de um número.
       *
       * Depois do primeiro dígito o `+` da tela é desenho do formatador, e
       * não uma coisa que alguém digitou — perguntar por ele aí responderia
       * "sim" sempre. Então ela é decidida enquanto não há dígito nenhum:
       * de um lado do campo vazio para o primeiro caractere, do outro
       * quando alguém apaga tudo e recomeça.
       */
      if (!digitosAtuais || !digits) setExplicito(marcado);
      const internacional = digitosAtuais && digits ? explicito : marcado;

      // Count the digits before the caret in what the user just typed, so
      // the caret can be put back in the same logical place afterwards.
      const before = raw.slice(0, el.selectionStart ?? raw.length);
      const antesDoCaret = normalizePhone(before).length;

      /*
       * O `+55` do item 10, e SÓ QUANDO O NÚMERO ESTÁ CRESCENDO.
       *
       * Apagar não pode acrescentar. Sem essa guarda, quem apaga um número
       * completo dígito a dígito passa por dez dígitos no caminho, a
       * assinatura de fixo casa, e o campo devolve dois dígitos que a
       * pessoa acabou de tirar — um Backspace que aumenta o número.
       *
       * O `handleKeyDown` acima não passa por aqui, e é outro caminho de
       * apagar: ele também não deve aplicar o padrão, e não aplica.
       */
      const crescendo = digits.length > digitosAtuais.length;
      const final =
        internacional || !crescendo ? digits : applyDefaultCountry(digits);

      // Dois dígitos entraram na frente do número: o caret, que é contado em
      // dígitos, anda com eles.
      caretDigitsRef.current = antesDoCaret + (final.length - digits.length);

      // An empty field is empty, not `+`. Otherwise clearing the box would
      // leave a lone plus sign behind that nothing can delete.
      onValueChange(final ? toE164(final) : '');
    },
    [onValueChange, digitosAtuais, explicito]
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
      onKeyDown={handleKeyDown}
      disabled={disabled}
      className={className}
    />
  );
}
