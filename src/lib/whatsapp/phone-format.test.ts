import { describe, expect, it } from 'vitest';
import { formatPhone, toE164 } from './phone-format';

describe('formatPhone', () => {
  it('groups a Brazilian mobile the way people write it', () => {
    // The reported case: the field printed `+555199000001` back at you.
    expect(formatPhone('+5551990000001')).toBe('+55 (51) 99000-0001');
  });

  it('groups a Brazilian landline on eight digits', () => {
    expect(formatPhone('+555199000001')).toBe('+55 (51) 9900-0001');
  });

  it('does not care how the input was punctuated', () => {
    // Pasted from a spreadsheet, typed with spaces, imported from a CSV.
    for (const input of [
      '5551990000001',
      '+55 51 99000-0001',
      '55 (51) 99000.0001',
    ]) {
      expect(formatPhone(input)).toBe('+55 (51) 99000-0001');
    }
  });

  it('formats progressively so the field does not jump while typing', () => {
    expect(formatPhone('55')).toBe('+55');
    expect(formatPhone('5551')).toBe('+55 (51');
    expect(formatPhone('555199')).toBe('+55 (51) 99');
    // No dangling hyphen: the separator appears when there is something
    // on the other side of it, not before.
    expect(formatPhone('5551990')).toBe('+55 (51) 990');
    expect(formatPhone('55519900000')).toBe('+55 (51) 9900-000');
  });

  it('leaves a foreign number ungrouped past the country code', () => {
    // There is no correct universal grouping, and imposing the Brazilian
    // one produces something that looks authoritative and is wrong.
    //
    // THIS TEST USED TO ASSERT `+59 5991234567`, which is the bug: a fixed
    // two-digit slice invents the country code +59 and steals a digit from
    // the number. It is rewritten rather than deleted because a test that
    // pins the wrong answer is worse than no test — it is why the defect
    // survived a green suite.
    expect(formatPhone('+595991234567')).toBe('+595 991234567');
  });

  it('measures the country code instead of assuming two digits', () => {
    // One digit (zone 1 and zone 7), two, and three.
    expect(formatPhone('+15551234567')).toBe('+1 5551234567');
    expect(formatPhone('+79161234567')).toBe('+7 9161234567');
    expect(formatPhone('+351912345678')).toBe('+351 912345678');
    expect(formatPhone('+4915112345678')).toBe('+49 15112345678');
  });

  it('is empty for an empty number', () => {
    expect(formatPhone('')).toBe('');
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
  });
});

describe('toE164', () => {
  it('strips the mask back to what the database stores', () => {
    expect(toE164('+55 (51) 99000-0001')).toBe('+5551990000001');
  });

  it('round-trips with formatPhone', () => {
    // The property that keeps the mask safe: what is stored never changes
    // shape, however the field chose to draw it.
    const stored = '+5551990000001';
    expect(toE164(formatPhone(stored))).toBe(stored);
  });

  it('is empty rather than a bare plus', () => {
    expect(toE164('')).toBe('');
    expect(toE164('+')).toBe('');
  });
});

/**
 * O round-trip acima é a propriedade que mantém a máscara segura, e ele só
 * era testado com treze dígitos — que é exatamente onde o formatador parava
 * de ser fiel.
 *
 * `formatPhone` cortava em nove dígitos locais enquanto o `PhoneInput` aceita
 * quinze no total (`MAX_PHONE_DIGITS`). Como o campo é CONTROLADO pelo que
 * esta função devolve, os dígitos a mais existiam no estado e não na tela: o
 * contato ia para o banco com um número que ninguém viu, e `isValidE164` — 7
 * a 15 dígitos — deixava passar.
 */
describe('formatPhone não perde dígito', () => {
  it('devolve todos os dígitos que recebeu, em qualquer comprimento', () => {
    // A propriedade, e não um caso: para todo número, os dígitos do que sai
    // são os dígitos do que entrou. É isso que faz o campo controlado poder
    // realimentar a própria saída sem apagar o que a pessoa digitou.
    const bases = [
      '5551990000001234',
      '5511987654321098',
      '5521330012345678',
      '595991234567890',
      '15551234567890',
    ];

    for (const base of bases) {
      for (let n = 2; n <= base.length; n++) {
        const entrada = base.slice(0, n);
        expect(
          formatPhone(entrada).replace(/\D/g, ''),
          `formatPhone perdeu dígito em ${entrada}`
        ).toBe(entrada);
      }
    }
  });

  it('mostra o excedente em vez de escondê-lo', () => {
    // Nenhum número brasileiro tem catorze dígitos. A saída é feia de
    // propósito: a feiura é o aviso de que sobrou um, e é o que faltava
    // quando a tela simplesmente parava de mudar.
    expect(formatPhone('+55519900000012')).toBe('+55 (51) 99000-00012');
    expect(formatPhone('+555199000000123')).toBe('+55 (51) 99000-000123');
  });

  it('não mexeu em nenhum número válido', () => {
    // As duas formas que o Brasil tem, intactas.
    expect(formatPhone('+5551990000001')).toBe('+55 (51) 99000-0001');
    expect(formatPhone('+555199000001')).toBe('+55 (51) 9900-0001');
  });

  it('faz round-trip com toE164 acima de treze dígitos', () => {
    const stored = '+55519900000012';
    expect(toE164(formatPhone(stored))).toBe(stored);
  });
});
