import { describe, expect, it } from 'vitest';
import {
  applyDefaultCountry,
  formatPhone,
  toE164,
  isCompletePhone,
} from './phone-format';
import { normalizePhone } from './phone-utils';

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

describe('isCompletePhone', () => {
  it('aceita os dois comprimentos que o Brasil tem', () => {
    expect(isCompletePhone('+5551990000001')).toBe(true); // celular, 13
    expect(isCompletePhone('+555199000001')).toBe(true); // fixo, 12
  });

  it('recusa o número brasileiro pela metade', () => {
    // O que passava antes: o campo só era testado por "vazio".
    expect(isCompletePhone('+55')).toBe(false);
    expect(isCompletePhone('+5551')).toBe(false);
    expect(isCompletePhone('+55519900')).toBe(false);
    expect(isCompletePhone('+55519900000')).toBe(false); // 11, falta um
  });

  it('recusa o brasileiro comprido demais', () => {
    // O dígito a mais que o formatador escondia até hoje de manhã.
    expect(isCompletePhone('+55519900000012')).toBe(false);
  });

  it('não inventa regra para número estrangeiro', () => {
    // Fora do Brasil vale a régua larga do E.164 e nada além: não há como
    // saber daqui o comprimento certo de um número paraguaio.
    expect(isCompletePhone('+595991234567')).toBe(true);
    expect(isCompletePhone('+15551234567')).toBe(true);
    expect(isCompletePhone('+351912345678')).toBe(true);
  });

  it('recusa o vazio e o curto demais para qualquer país', () => {
    expect(isCompletePhone('')).toBe(false);
    expect(isCompletePhone(null)).toBe(false);
    expect(isCompletePhone('+123')).toBe(false);
  });
});

describe('applyDefaultCountry — o item 10 do pacote', () => {
  it('põe o 55 no celular escrito como todo mundo escreve', () => {
    // Os dois exemplos do pacote, palavra por palavra.
    expect(applyDefaultCountry('47999549247')).toBe('5547999549247');
    expect(applyDefaultCountry(normalizePhone('(47) 99954-9247'))).toBe(
      '5547999549247'
    );
  });

  it('põe o 55 no fixo', () => {
    expect(applyDefaultCountry('4733334444')).toBe('554733334444');
  });

  it('não duplica quando o 55 já está lá', () => {
    expect(applyDefaultCountry('5547999549247')).toBe('5547999549247');
    expect(applyDefaultCountry('554733334444')).toBe('554733334444');
  });

  it('DDD 55 sem código do país ainda é um número daqui', () => {
    // Santa Maria. A leitura ingênua — "começa com 55, já tem país" —
    // deixaria onze dígitos passarem e o formatador desenharia
    // `+55 (98) 7654-321`, que não é número nenhum.
    expect(applyDefaultCountry('55987654321')).toBe('5555987654321');
  });

  it('não inventa DDD que não existe', () => {
    // 20, 23, 26, 52 e 80 nunca foram atribuídos.
    for (const ddd of ['20', '23', '26', '52', '80']) {
      expect(applyDefaultCountry(`${ddd}999999999`)).toBe(`${ddd}999999999`);
    }
  });

  it('celular precisa do 9, fixo precisa de 2 a 5', () => {
    // Um alemão (+49 15…) tem 49 como DDD válido e falha no dígito seguinte.
    expect(applyDefaultCountry('49151234567')).toBe('49151234567');
    // 11 dígitos com 8 no lugar do 9 não é celular nenhum.
    expect(applyDefaultCountry('47899954924')).toBe('47899954924');
    // 10 dígitos começando em 9 seria um celular sem um dígito.
    expect(applyDefaultCountry('4799954924')).toBe('4799954924');
    // 10 dígitos começando em 1 não é fixo brasileiro.
    expect(applyDefaultCountry('4713334444')).toBe('4713334444');
  });

  it('não encosta em quem já veio com código do país', () => {
    expect(applyDefaultCountry('595991234567')).toBe('595991234567');
    expect(applyDefaultCountry('12125551234')).toBe('12125551234');
    expect(applyDefaultCountry('')).toBe('');
    expect(applyDefaultCountry('4799')).toBe('4799');
  });

  it('o que sai é o que o formatador desenha certo', () => {
    expect(formatPhone(toE164(applyDefaultCountry('47999549247')))).toBe(
      '+55 (47) 99954-9247'
    );
    expect(formatPhone(toE164(applyDefaultCountry('4733334444')))).toBe(
      '+55 (47) 3333-4444'
    );
  });

  it('e passa a valer como número completo', () => {
    expect(isCompletePhone(toE164('47999549247'))).toBe(true);
    expect(isCompletePhone(toE164(applyDefaultCountry('47999549247')))).toBe(
      true
    );
  });
});
