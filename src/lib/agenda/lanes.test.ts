import { describe, expect, it } from 'vitest';

import { laneOf } from './view';
import type { AgendaItem } from '@/lib/dashboard/agenda';

/**
 * As faixas de um dia sobrecarregado.
 *
 * O defeito que isto cobre: cada item era desenhado com a largura inteira da
 * coluna, então duas tarefas às 08:00 ficavam uma exatamente em cima da
 * outra e a de baixo sumia — nem o título, nem a existência dela. Numa
 * agenda, o conflito de horário é a informação mais cara da tela, e era a
 * única que ela não sabia mostrar.
 */
function item(id: string, time: string | null): AgendaItem {
  return {
    id,
    kind: 'task',
    day: '2026-09-08',
    time,
    title: id,
    contact: null,
    value: null,
    currency: null,
    status: null,
    href: null,
    owner: null,
  } as AgendaItem;
}

/** `durationOf` real dá 30 para tarefa; aqui é explícito para o teste ler. */
const HALF_HOUR = () => 30;

describe('laneOf', () => {
  it('gives a lone item the whole width', () => {
    const lanes = laneOf([item('a', '09:00')], HALF_HOUR);
    expect(lanes.get('a')).toEqual({ index: 0, of: 1 });
  });

  it('splits two items that start at the same minute', () => {
    const lanes = laneOf([item('a', '08:00'), item('b', '08:00')], HALF_HOUR);
    expect(lanes.get('a')).toEqual({ index: 0, of: 2 });
    expect(lanes.get('b')).toEqual({ index: 1, of: 2 });
  });

  it('reuses a lane once the previous item has ended', () => {
    // 08:00–08:30 e 08:30–09:00 não se tocam: a segunda volta para a faixa 0
    // e as duas ocupam a largura inteira, uma embaixo da outra.
    const lanes = laneOf([item('a', '08:00'), item('b', '08:30')], HALF_HOUR);
    expect(lanes.get('a')).toEqual({ index: 0, of: 1 });
    expect(lanes.get('b')).toEqual({ index: 0, of: 1 });
  });

  it('shares one width across a chain, and reuses lanes inside it', () => {
    // A(08:00–08:30) encosta em B(08:15–08:45), B encosta em C(08:40–09:10);
    // A e C não se tocam.
    //
    // Duas coisas ao mesmo tempo, e as duas importam. A e C PODEM dividir a
    // faixa 0, porque uma acabou antes de a outra começar — três colunas ali
    // seriam cartões 33% mais estreitos sem ganho nenhum. Mas os três têm de
    // sair com o MESMO `of`: se A e C calculassem `of: 1` por não se tocarem,
    // as duas ocupariam a largura inteira e B, em `of: 2`, ficaria por cima
    // delas. É para isso que a corrente é um grupo só.
    const lanes = laneOf(
      [item('a', '08:00'), item('b', '08:15'), item('c', '08:40')],
      HALF_HOUR
    );
    expect(lanes.get('a')?.of).toBe(2);
    expect(lanes.get('b')?.of).toBe(2);
    expect(lanes.get('c')?.of).toBe(2);

    expect(lanes.get('a')?.index).toBe(0);
    expect(lanes.get('b')?.index).toBe(1);
    // C volta para a faixa que A desocupou.
    expect(lanes.get('c')?.index).toBe(0);
  });

  it('does not let a quiet afternoon inherit a busy morning', () => {
    // Três às 08:00 e uma sozinha às 15:00. Contar `of` pelo dia inteiro
    // deixaria a das 15h com 33% de largura e muito branco ao lado.
    const lanes = laneOf(
      [
        item('m1', '08:00'),
        item('m2', '08:00'),
        item('m3', '08:00'),
        item('tarde', '15:00'),
      ],
      HALF_HOUR
    );
    expect(lanes.get('m1')?.of).toBe(3);
    expect(lanes.get('tarde')).toEqual({ index: 0, of: 1 });
  });

  it('ignores the all-day items — they live above the axis', () => {
    const lanes = laneOf([item('aniversário', null)], HALF_HOUR);
    expect(lanes.size).toBe(0);
  });

  it('is stable: same input, same lanes', () => {
    // A ordem de leitura da esquerda para a direita é a ordem do relógio, e
    // dois itens no mesmo minuto desempatam pelo id. Sem isso a agenda
    // reordenaria as colunas a cada render.
    const input = [item('b', '08:00'), item('a', '08:00')];
    const first = laneOf(input, HALF_HOUR);
    const second = laneOf([...input].reverse(), HALF_HOUR);
    expect(first.get('a')).toEqual(second.get('a'));
    expect(first.get('b')).toEqual(second.get('b'));
  });
});
