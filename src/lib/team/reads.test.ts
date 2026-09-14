import { describe, expect, it } from 'vitest';

import { isMissingFunction } from './reads';

/**
 * O recuo para o marcador do navegador depende de reconhecer "a função da
 * 077 não existe". Medido contra o banco de teste em 14 de setembro de
 * 2026, com a 077 por aplicar: as duas chamadas voltaram 404 `PGRST202`.
 */
describe('isMissingFunction', () => {
  it('reconhece a resposta do PostgREST para função ausente', () => {
    expect(
      isMissingFunction({
        code: 'PGRST202',
        message:
          'Could not find the function public.team_unread_counts without parameters in the schema cache',
      })
    ).toBe(true);
  });

  it('reconhece a resposta do Postgres direto', () => {
    expect(
      isMissingFunction({
        code: '42883',
        message: 'function x() does not exist',
      })
    ).toBe(true);
  });

  it('não confunde erro de permissão com migração faltando', () => {
    // Um 42501 é a RLS dizendo não — cair para o marcador local nesse caso
    // esconderia um defeito real atrás de um número plausível.
    expect(
      isMissingFunction({ code: '42501', message: 'permission denied' })
    ).toBe(false);
  });
});
