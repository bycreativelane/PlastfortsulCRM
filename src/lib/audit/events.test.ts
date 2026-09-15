import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS, AUDIT_AREA_PREFIXES, auditArea } from './events';

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
