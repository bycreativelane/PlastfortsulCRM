import { describe, expect, it } from 'vitest';

import { addBusinessDays, DEFAULT_BUSINESS_HOURS } from '@/lib/hours';

/**
 * O prazo relativo da ação `create_task`.
 *
 * O passo em si vive dentro do `switch` do motor, que precisa de banco para
 * rodar. O que dá para errar SEM banco — e o que erra em silêncio — é a
 * conta do prazo: uma automação que dispara numa sexta e marca "+2 dias"
 * em dias corridos põe a ligação no domingo, e o sintoma é uma tarefa que
 * nasce vencida na segunda sem que ninguém entenda por quê.
 *
 * `DEFAULT_BUSINESS_HOURS` é seg–sex; é a mesma semente que a 066 cria.
 */

const hours = DEFAULT_BUSINESS_HOURS;

describe('prazo em dias úteis', () => {
  // 2026-09-04 é uma sexta-feira.
  const sexta = '2026-09-04';

  it('+1 dia útil na sexta cai na segunda, não no sábado', () => {
    expect(addBusinessDays(hours, sexta, 1)).toBe('2026-09-07');
  });

  it('+2 dias úteis na sexta cai na terça', () => {
    // Em dias corridos isto seria domingo, dia 6.
    expect(addBusinessDays(hours, sexta, 2)).toBe('2026-09-08');
  });

  it('+3 dias úteis — o "D+3" do fluxo comercial', () => {
    expect(addBusinessDays(hours, sexta, 3)).toBe('2026-09-09');
  });

  it('zero é hoje, e não o próximo dia útil', () => {
    // Importa: "marcar para hoje" numa segunda não pode empurrar para
    // terça, e num domingo não pode virar segunda sozinho — quem escolheu
    // zero escolheu hoje.
    expect(addBusinessDays(hours, sexta, 0)).toBe(sexta);
    expect(addBusinessDays(hours, '2026-09-06', 0)).toBe('2026-09-06');
  });

  it('a partir de um domingo, +1 cai na segunda', () => {
    expect(addBusinessDays(hours, '2026-09-06', 1)).toBe('2026-09-07');
  });

  it('atravessa o fim de semana mais de uma vez', () => {
    // Segunda + 10 úteis = duas semanas cheias.
    expect(addBusinessDays(hours, '2026-09-07', 10)).toBe('2026-09-21');
  });
});

describe('dias corridos, quando a automação pede', () => {
  it('cai no fim de semana sem reclamar — é o que foi pedido', () => {
    // O passo usa `addDays` quando `due_in_business_days === false`.
    // Aqui o contraste é o ponto: 2026-09-04 + 2 corridos é domingo.
    const corridos = new Date(2026, 8, 4);
    corridos.setDate(corridos.getDate() + 2);
    expect(corridos.getDay()).toBe(0);
    expect(addBusinessDays(hours, '2026-09-04', 2)).toBe('2026-09-08');
  });
});

describe('uma semana inteira fechada', () => {
  it('não entra em laço — devolve dias corridos, impreciso e visível', () => {
    const fechada = { ...hours, weekly: [] };
    // A alternativa seria devolver a própria data, o que faria a função
    // fingir que não foi chamada.
    expect(addBusinessDays(fechada, '2026-09-04', 3)).toBe('2026-09-07');
  });
});
