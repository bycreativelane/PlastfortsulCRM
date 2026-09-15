import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS, AUDIT_AREA_PREFIXES, auditArea, auditValue } from './events';

describe('áreas do log de auditoria', () => {
  it('toda ação cai em no máximo uma área pelos prefixos, e auditArea concorda', () => {
    for (const action of AUDIT_ACTIONS) {
      const areas = Object.entries(AUDIT_AREA_PREFIXES)
        .filter(([, prefixes]) => prefixes.some((p) => action.startsWith(p)))
        .map(([area]) => area);
      // Duas áreas seria o filtro de uma trazendo linha da outra.
      expect(areas.length, action).toBeLessThanOrEqual(1);
      // A rota filtra por estes prefixos em SQL; uma ação que só `auditArea`
      // soubesse classificar sumiria do filtro da tela.
      expect(auditArea(action), action).toBe(areas[0] ?? 'account');
    }
  });

  it('o Bling é integração', () => {
    expect(auditArea('bling.connected')).toBe('integration');
    expect(auditArea('bling.disconnected')).toBe('integration');
  });

  it('o que ninguém conhece continua sendo conta', () => {
    expect(auditArea('algo.novo')).toBe('account');
  });
});

describe('auditValue', () => {
  const rotulos = { yes: 'sim', no: 'não' };

  it('ligar os pedidos no Bling não aparece como "— → —"', () => {
    expect(`${auditValue(false, rotulos)} → ${auditValue(true, rotulos)}`).toBe('não → sim');
  });

  it('texto, número, lista e o que não se lê', () => {
    expect(auditValue('Em andamento', rotulos)).toBe('Em andamento');
    expect(auditValue('', rotulos)).toBe('—');
    expect(auditValue(0, rotulos)).toBe('0');
    expect(auditValue(['7001', '7002'], rotulos)).toBe('7001, 7002');
    expect(auditValue([], rotulos)).toBe('—');
    expect(auditValue(null, rotulos)).toBe('—');
    expect(auditValue({ a: 1 }, rotulos)).toBe('—');
  });
});
