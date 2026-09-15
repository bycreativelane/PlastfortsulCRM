import { describe, expect, it } from 'vitest';

import {
  caretAfterSignificant,
  decimalSeparatorFor,
  formatMoneyCents,
  parseMoneyText,
  significantBefore,
} from './money-text';

const PT = 'pt-BR';

describe('parseMoneyText — o que se digita num campo de dinheiro com centavos', () => {
  it('"80" é R$ 80,00 — nunca R$ 0,80', () => {
    // O campo de frete aceitava reais inteiros até hoje. O modo "caixa
    // registradora" transformaria o hábito de digitar 80 num frete de 80
    // centavos.
    expect(parseMoneyText('80', PT)).toEqual({ text: '80', cents: 8000 });
  });

  it('os centavos entram depois da vírgula', () => {
    expect(parseMoneyText('80,5', PT)).toEqual({ text: '80,5', cents: 8050 });
    expect(parseMoneyText('33,33', PT)).toEqual({ text: '33,33', cents: 3333 });
  });

  it('a vírgula digitada fica na tela enquanto os centavos não vêm', () => {
    expect(parseMoneyText('80,', PT)).toEqual({ text: '80,', cents: 8000 });
    expect(parseMoneyText(',', PT)).toEqual({ text: '0,', cents: null });
  });

  it('mais de duas casas são cortadas, não arredondadas', () => {
    // Arredondar enquanto a pessoa digita mudaria o número debaixo do dedo.
    expect(parseMoneyText('10,999', PT).cents).toBe(1099);
  });

  it('agrupa milhares enquanto digita', () => {
    expect(parseMoneyText('1117', PT).text).toBe('1.117');
    expect(parseMoneyText('1234567,8', PT)).toEqual({
      text: '1.234.567,8',
      cents: 123456780,
    });
  });

  it('colar do Bling ("1.117,00") dá o valor certo', () => {
    expect(parseMoneyText('1.117,00', PT).cents).toBe(111700);
  });

  it('colar de planilha em inglês ("1117.00") não multiplica por cem', () => {
    expect(parseMoneyText('1117.00', PT).cents).toBe(111700);
    expect(parseMoneyText('80.5', PT).cents).toBe(8050);
  });

  it('ponto com três dígitos depois continua agrupando milhares', () => {
    expect(parseMoneyText('1.117', PT).cents).toBe(111700);
  });

  it('vazio é vazio, e lixo não vira número', () => {
    expect(parseMoneyText('', PT)).toEqual({ text: '', cents: null });
    expect(parseMoneyText('R$ ', PT)).toEqual({ text: '', cents: null });
  });

  it('zeros à esquerda somem', () => {
    expect(parseMoneyText('007,50', PT)).toEqual({ text: '7,50', cents: 750 });
  });

  it('não passa de dez dígitos inteiros — o NUMERIC(12,2) do banco', () => {
    expect(parseMoneyText('123456789012345', PT).cents).toBe(123456789000);
  });

  it('em inglês o separador decimal é o ponto', () => {
    expect(decimalSeparatorFor('en')).toBe('.');
    expect(parseMoneyText('1,117.50', 'en')).toEqual({
      text: '1,117.50',
      cents: 111750,
    });
  });
});

describe('formatMoneyCents — o campo em repouso', () => {
  it('sempre duas casas', () => {
    expect(formatMoneyCents(8000, PT)).toBe('80,00');
    expect(formatMoneyCents(3333, PT)).toBe('33,33');
    expect(formatMoneyCents(111700, PT)).toBe('1.117,00');
    expect(formatMoneyCents(null, PT)).toBe('');
  });
});

describe('o cursor depois de reformatar', () => {
  it('fica depois do mesmo dígito, com os pontos mudando de lugar', () => {
    // "1117|" vira "1.117|": quatro significativos antes → fim.
    expect(caretAfterSignificant('1.117', 4, ',')).toBe(5);
    // "12|34" vira "1.2|34": dois significativos antes.
    expect(caretAfterSignificant('1.234', 2, ',')).toBe(3);
  });

  it('a vírgula conta, então o cursor não pula para antes dela', () => {
    // "80,|" → três significativos (8, 0 e a vírgula) → depois da vírgula.
    expect(caretAfterSignificant('80,', 3, ',')).toBe(3);
  });

  it('conta os significativos de um texto qualquer', () => {
    expect(significantBefore('1.234,5', 7, ',')).toBe(6);
    expect(significantBefore('1.234,5', 2, ',')).toBe(1);
  });
});
