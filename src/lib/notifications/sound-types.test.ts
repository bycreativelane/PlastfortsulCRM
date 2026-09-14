import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOUND_TYPES } from './sound';

/**
 * TODO TIPO QUE O SINO ESCREVE PRECISA DE UM INTERRUPTOR.
 *
 * ------------------------------------------------------------------
 * O QUE ESTE TESTE PROTEGE
 * ------------------------------------------------------------------
 *
 * O painel do perfil ("Notificações") desenha uma linha por tipo, lendo
 * `SOUND_TYPES`. Um quinto tipo de notificação chega ao produto por DOIS
 * arquivos — uma migração que amplia o CHECK de `notifications.type` e a
 * união `NotificationType` — e nenhum dos dois passa perto daqui.
 *
 * O resultado silencioso seria o pior tipo de defeito de configuração: o
 * aviso novo toca, a pessoa procura onde desligar, e não existe onde. Ela
 * desliga o som INTEIRO — e perde os quatro que queria ouvir.
 *
 * TypeScript não pega isso: `SOUND_TYPES: SoundType[]` aceita uma lista
 * incompleta com alegria. O que prova a cobertura é comparar com o banco.
 *
 * ------------------------------------------------------------------
 * COMO ELE MEDE
 * ------------------------------------------------------------------
 *
 * Lendo `supabase/migrations/` e achando o ÚLTIMO
 * `notifications_type_check` — o CHECK vale pelo que foi escrito por
 * último, e a 077 derruba o da 068 justamente para ampliá-lo. A lista de
 * dentro dele é a verdade sobre o que pode existir na tabela.
 *
 * E confere que cada tipo tem nome e explicação nos três idiomas: uma
 * chave faltando no `next-intl` vira a própria chave na tela
 * ("types.task_due"), que é uma linha de configuração ilegível.
 */

const RAIZ = process.cwd();
const IDIOMAS = ['pt-BR', 'en', 'ko'] as const;

/** Tira comentários; os literais FICAM — a lista mora dentro deles. */
function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** A lista de tipos do último `notifications_type_check` das migrações. */
function tiposDoBanco(): string[] {
  const dir = join(RAIZ, 'supabase', 'migrations');
  const arquivos = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let encontrado: string[] | null = null;
  for (const arquivo of arquivos) {
    const sql = semComentarios(readFileSync(join(dir, arquivo), 'utf8'));
    // `ADD CONSTRAINT notifications_type_check CHECK (type IN (...))`
    const re =
      /ADD\s+CONSTRAINT\s+notifications_type_check\s+CHECK\s*\(\s*type\s+IN\s*\(([^)]*)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      encontrado = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
  }
  return encontrado ?? [];
}

function mensagens(idioma: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(RAIZ, 'messages', `${idioma}.json`), 'utf8')
  ) as Record<string, unknown>;
}

describe('os tipos de som cobrem o sino', () => {
  it('a lista do painel é exatamente a do CHECK do banco', () => {
    const banco = tiposDoBanco();

    // Se o parse não achou nada, o teste não está medindo coisa alguma —
    // acusar isso vale mais do que passar por engano.
    expect(banco.length).toBeGreaterThan(0);

    expect([...SOUND_TYPES].sort()).toEqual([...banco].sort());
  });

  it.each(IDIOMAS)('cada tipo tem nome e explicação em %s', (idioma) => {
    const bloco = (
      (mensagens(idioma).Settings as Record<string, unknown> | undefined)
        ?.notifications as
        | {
            types?: Record<string, string>;
            hints?: Record<string, string>;
          }
        | undefined
    );

    expect(bloco, `Settings.notifications não existe em ${idioma}`).toBeTruthy();

    for (const tipo of SOUND_TYPES) {
      expect(bloco?.types?.[tipo], `types.${tipo} em ${idioma}`).toBeTruthy();
      expect(bloco?.hints?.[tipo], `hints.${tipo} em ${idioma}`).toBeTruthy();
    }
  });
});
