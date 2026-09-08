import { describe, expect, it } from 'vitest';

import { isLostStage, isWonStage } from './outcome';

/**
 * PARA ONDE UM DESFECHO MANDA A OPORTUNIDADE.
 *
 * A regra vive em `deal-form.tsx` (`outcomeStage`), presa ao estado do
 * formulário. Isto aqui é a mesma decisão, isolada, porque ela responde
 * duas perguntas caras e nenhuma delas é sobre React:
 *
 *   · o quadro mostra o negócio ganho na coluna certa?
 *   · a perda cancela o follow-up?
 *
 * A segunda é a que dói. As automações do funil cancelam por
 * `cancel_when_stage_in` — ao ENTRAR em Venda Perdida — e não pelo
 * `status`. Marcar perdido sem mover a etapa deixava D1, D2, D3 e D30
 * saindo para um cliente já dado como perdido.
 */
function outcomeStage(
  status: 'won' | 'lost' | 'open',
  atual: { id: string; name: string } | null,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  if (status === 'won') {
    if (atual && isWonStage(atual.name)) return null;
    return stages.find((st) => isWonStage(st.name)) ?? null;
  }
  if (status === 'lost') {
    if (atual && isLostStage(atual.name)) return null;
    return stages.find((st) => isLostStage(st.name)) ?? null;
  }
  return null;
}

/** O funil oficial, na ordem em que o quadro o desenha. */
const VENDAS = [
  { id: 's1', name: 'Novo Lead' },
  { id: 's2', name: 'Em Aberto' },
  { id: 's3', name: 'Follow-up' },
  { id: 's4', name: 'Em Negociação' },
  { id: 's5', name: 'Ligação' },
  { id: 's6', name: 'Em Andamento' },
  { id: 's7', name: 'Atendido' },
  { id: 's8', name: 'Pós-venda' },
  { id: 's9', name: 'Compra Futura' },
  { id: 's10', name: 'Venda Perdida' },
];

const emNegociacao = VENDAS[3];

describe('outcomeStage', () => {
  it('ganho tira o negócio da coluna de negociação', () => {
    // O defeito relatado: marcar Ganho gravava o status e o cartão ficava
    // em Em Negociação, com um selo "Ganho" numa coluna de negociação.
    expect(outcomeStage('won', emNegociacao, VENDAS)?.name).toBe(
      'Em Andamento'
    );
  });

  it('perdido manda para Venda Perdida, que é o que cancela as automações', () => {
    expect(outcomeStage('lost', emNegociacao, VENDAS)?.name).toBe(
      'Venda Perdida'
    );
  });

  it('não puxa de volta quem já passou do ponto', () => {
    // Atendido é uma etapa de ganho. Marcar Ganho ali não pode devolver a
    // oportunidade para Em Andamento, que é uma etapa ANTES.
    expect(outcomeStage('won', VENDAS[6], VENDAS)).toBeNull();
    expect(outcomeStage('lost', VENDAS[9], VENDAS)).toBeNull();
  });

  it('reabrir não move — para onde seria?', () => {
    expect(outcomeStage('open', VENDAS[9], VENDAS)).toBeNull();
  });

  it('um funil sem a etapa não ganha uma inventada', () => {
    // Quem monta o quadro à mão escolhe os nomes. Sem destino, o status é
    // gravado e a etapa fica onde está — melhor do que adivinhar coluna.
    const magro = [
      { id: 'a', name: 'Entrou' },
      { id: 'b', name: 'Conversando' },
    ];
    expect(outcomeStage('won', magro[1], magro)).toBeNull();
    expect(outcomeStage('lost', magro[1], magro)).toBeNull();
  });

  it('sem etapa atual conhecida, ainda encaminha', () => {
    expect(outcomeStage('lost', null, VENDAS)?.id).toBe('s10');
  });
});
