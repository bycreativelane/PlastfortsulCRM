/**
 * O cursor de um campo mascarado, e o Backspace que não apagava nada.
 *
 * ------------------------------------------------------------------
 * O DEFEITO, QUE ERA O MESMO NOS DOIS CAMPOS
 * ------------------------------------------------------------------
 *
 * Medido no navegador, nos dois:
 *
 *   telefone   `+55 (51) 99000-0001`, cursor depois do `)` — Backspace deixava
 *              o campo IGUAL e mandava o cursor de 8 para 19.
 *   dinheiro   `18.400`, cursor depois do `.` — Backspace deixava o campo
 *              IGUAL e mandava o cursor de 3 para 6.
 *
 * Nos dois casos o próximo Backspace apagava o último dígito, que não é onde
 * a pessoa estava. É o app brigando com quem digita.
 *
 * O mecanismo é o mesmo: apagar um separador não muda os DÍGITOS, então o
 * valor não muda; sem valor novo não há render novo, e o efeito que recoloca o
 * cursor não roda. Enquanto isso o React reescreve o valor no `<input>` para
 * ressincronizar o campo controlado — e atribuir `.value` num input estaciona
 * o cursor no fim.
 *
 * ------------------------------------------------------------------
 * A REGRA
 * ------------------------------------------------------------------
 *
 * Separador não é conteúdo, é desenho. Backspace apaga o DÍGITO à esquerda,
 * Delete apaga o dígito à direita. É o que faz segurar Backspace sumir com o
 * número um dígito por vez, com os pontos, as parênteses e o traço caindo
 * sozinhos no caminho.
 *
 * ------------------------------------------------------------------
 * POR QUE ISTO É UM MÓDULO E NÃO ESTÁ DENTRO DE UM DOS DOIS
 * ------------------------------------------------------------------
 *
 * Porque são dois — `phone-input` e `currency-input` — e um terceiro campo
 * mascarado é questão de tempo. Estava dentro do telefone quando era um só;
 * fazer o dinheiro importar do telefone seria pior do que qualquer duplicação.
 *
 * O ambiente de teste é `node`, sem DOM. Estas funções são puras exatamente
 * por isso: é assim que esta casa testa campo mascarado desde o
 * `parseTimeInput` do `time-field`.
 */

/** Só os dígitos, que é a única parte que a pessoa realmente digitou. */
function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * O que apagar quando o cursor está encostado num SEPARADOR.
 *
 * `null` quer dizer "não é comigo" — o cursor está num dígito, o caminho
 * normal do navegador já apaga a coisa certa, e é o caso da maioria
 * esmagadora das teclas.
 *
 * A posição de volta sai em DÍGITOS e não em caracteres porque é a única
 * medida que sobrevive à reformatação: tirar um dígito no meio reescreve o
 * resto da string, e um índice de caractere aponta para outro lugar depois
 * disso.
 */
export function deleteAcrossSeparator(
  text: string,
  caret: number,
  direction: 'back' | 'forward'
): { digits: string; caretDigits: number } | null {
  const back = direction === 'back';
  const at = back ? caret - 1 : caret;

  // Encostado num dígito é o caso comum, e aí o navegador acerta sozinho.
  if (at < 0 || at >= text.length || /\d/.test(text[at])) return null;

  const digits = digitsOf(text);
  const antesDoCaret = digitsOf(text.slice(0, caret)).length;
  const target = back ? antesDoCaret - 1 : antesDoCaret;

  // Só separador daquele lado — o `+` na frente de tudo, por exemplo. Não há
  // dígito para apagar, e o certo é não apagar nada em vez de comer o
  // primeiro dígito só porque o separador estava no caminho.
  if (target < 0 || target >= digits.length) {
    return { digits, caretDigits: antesDoCaret };
  }

  return {
    digits: digits.slice(0, target) + digits.slice(target + 1),
    caretDigits: target,
  };
}

/**
 * Onde o cursor cai, em CARACTERES, para ficar depois de `count` dígitos.
 *
 * A tradução de volta: o componente conta em dígitos porque é o que sobrevive
 * à reformatação, e o `setSelectionRange` cobra um índice de caractere. Os
 * dois campos tinham este laço escrito à mão, igual.
 */
export function caretAfterDigits(formatted: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      seen += 1;
      if (seen === count) return i + 1;
    }
  }
  return formatted.length;
}
