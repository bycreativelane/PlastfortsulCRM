import { describe, expect, it } from 'vitest';

import { isNotificationSoundOn, notesFor } from './sound';

describe('notesFor', () => {
  it('a menção sobe uma nota a mais — dá para distinguir sem olhar', () => {
    expect(notesFor('team_mention')).toHaveLength(3);
    expect(notesFor('new_message')).toHaveLength(2);
  });

  it('todo outro aviso toca igual, inclusive tipos que ainda não existem', () => {
    expect(notesFor('conversation_assigned')).toEqual(notesFor('new_message'));
    expect(notesFor('task_due')).toEqual(notesFor('new_message'));
    expect(notesFor('um_tipo_futuro')).toEqual(notesFor('new_message'));
  });

  it('as notas sobem — um "plim", não um alarme descendo', () => {
    for (const tipo of ['new_message', 'team_mention']) {
      const notas = notesFor(tipo);
      expect([...notas].sort((a, b) => a - b)).toEqual(notas);
    }
  });
});

describe('isNotificationSoundOn', () => {
  it('no servidor não há som', () => {
    // Renderização no servidor: sem `window`, sem áudio, sem preferência.
    expect(isNotificationSoundOn()).toBe(false);
  });
});
