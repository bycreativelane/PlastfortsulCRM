import { describe, expect, it } from 'vitest';

import { formatTime, parseTimeInput } from './time-field';

/**
 * A metade pura do `TimeField`: o que se aceita de quem digita.
 *
 * O campo é generoso de propósito — digitar hora é a parte chata de marcar
 * um compromisso, e cada formato recusado é alguém tendo de apagar e
 * redigitar. O que se testa aqui é justamente onde a generosidade para:
 * o que não tem leitura única é recusado, e recusar significa manter o
 * valor anterior, nunca apagá-lo.
 */
describe('parseTimeInput', () => {
  it('lê a hora cheia de um ou dois dígitos', () => {
    expect(parseTimeInput('9')).toBe(9 * 60);
    expect(parseTimeInput('14')).toBe(14 * 60);
  });

  it('lê três dígitos como h:mm, não como hh:m', () => {
    expect(parseTimeInput('930')).toBe(9 * 60 + 30);
  });

  it('lê quatro dígitos', () => {
    expect(parseTimeInput('1430')).toBe(14 * 60 + 30);
  });

  it('ignora o separador, qualquer que seja', () => {
    expect(parseTimeInput('14:30')).toBe(870);
    expect(parseTimeInput('14h30')).toBe(870);
    expect(parseTimeInput('14.30')).toBe(870);
    expect(parseTimeInput(' 14 30 ')).toBe(870);
  });

  it('entende o meridiano de quem lê em inglês', () => {
    expect(parseTimeInput('2:30 PM')).toBe(870);
    expect(parseTimeInput('2:30pm')).toBe(870);
    expect(parseTimeInput('12:15 am')).toBe(15);
    expect(parseTimeInput('12:15 pm')).toBe(12 * 60 + 15);
  });

  it('recusa o que não tem leitura única', () => {
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput('   ')).toBeNull();
    expect(parseTimeInput('meio-dia')).toBeNull();
    expect(parseTimeInput('13030')).toBeNull();
  });

  it('recusa hora e minuto fora da faixa', () => {
    expect(parseTimeInput('25:00')).toBeNull();
    expect(parseTimeInput('14:75')).toBeNull();
    // 24:00 é meia-noite do dia SEGUINTE, e um campo de hora de um dia não
    // tem como dizer isso. Dobrar para 00:00 marcaria o dia errado.
    expect(parseTimeInput('24:00')).toBeNull();
  });
});

describe('formatTime', () => {
  it('mostra 24 h em pt-BR e meridiano em en', () => {
    expect(formatTime('14:30', 'pt-BR')).toBe('14:30');
    // O espaço é U+202F (narrow no-break) nos ICU atuais; normalizado para
    // que o teste não dependa da versão do runtime.
    expect(formatTime('14:30', 'en-US').replace(/\s/g, ' ')).toBe('2:30 PM');
  });

  it('devolve vazio para hora ilegível', () => {
    expect(formatTime('', 'pt-BR')).toBe('');
    expect(formatTime('nada', 'pt-BR')).toBe('');
  });
});
