import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nenhuma coluna DATE passa por `new Date()`.
 *
 * ------------------------------------------------------------------
 * O DEFEITO, MEDIDO
 * ------------------------------------------------------------------
 *
 * `new Date('2026-09-08')` é parseado como **meia-noite UTC**. A oeste de
 * Greenwich isso é o dia anterior:
 *
 *     TZ=America/Sao_Paulo
 *     new Date('2026-09-08')  →  "7 de set."
 *     fromISO('2026-09-08')   →  "8 de set."
 *
 * Sete telas imprimiam a data errada por causa disso — o cartão do funil, a
 * ficha do contato (previsão de fechamento, última compra, próxima compra,
 * aniversário) e o histórico de ocorrências. Um negócio marcado para o dia 8
 * aparecia fechando no dia 7.
 *
 * ------------------------------------------------------------------
 * POR QUE ISSO PRECISA DE UM GUARDA, E NÃO DE ATENÇÃO
 * ------------------------------------------------------------------
 *
 * O `lib/calendar.ts` já documenta este defeito no cabeçalho, com estas
 * palavras: *"`new Date('2026-06-23')` is parsed as UTC midnight, which is
 * the previous day everywhere west of Greenwich — the off-by-one that shows
 * a deal closing on the 22nd."* E o `lib/dashboard/agenda.ts:728` tem uma
 * guarda em código com o mesmo comentário.
 *
 * A regra estava escrita em dois lugares e violada em sete. O que falha aqui
 * não é conhecimento — é que `new Date(x)` é a coisa óbvia de escrever, o
 * TypeScript aceita, o teste passa na máquina de quem está em UTC, e o erro
 * some para quem revisa em Londres. Só um guarda pega isso.
 *
 * ------------------------------------------------------------------
 * COMO A LISTA É MANTIDA
 * ------------------------------------------------------------------
 *
 * `DATE_COLUMNS` são as colunas declaradas `DATE` nas migrações. Quando uma
 * nova entrar, some aqui — o segundo teste deste arquivo confere que toda
 * coluna da lista ainda existe em alguma migração, para a lista não virar
 * ficção depois de um `ALTER TABLE ... DROP COLUMN`.
 */

const SRC = join(process.cwd(), 'src');
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** Colunas `DATE` (dia sem hora) que alguma tela renderiza. */
const DATE_COLUMNS = [
  'expected_close_date',
  'last_purchase_at',
  'next_purchase_expected_at',
  'occurred_on',
  'due_on',
  'birthday',
] as const;

/** `new Date(qualquer.coisa.com_essa_coluna)`, em qualquer escrita. */
const OFFENDER = new RegExp(
  `new Date\\(\\s*[A-Za-z_$][\\w$.?!\\[\\]'"]*\\b(?:${DATE_COLUMNS.join('|')})\\b`
);

/**
 * Quem PODE citar as colunas ao lado de `new Date`.
 *
 * `calendar.ts` e `agenda.ts` são onde a regra mora — o primeiro define o
 * `fromISO` e o segundo tem a guarda de string. Explicar a regra não é
 * infringi-la.
 */
const ALLOWED = new Set(['calendar.ts', 'agenda.ts', 'date-only.test.ts']);

/** Comentários explicam a regra; explicar não é infringir. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) =>
      '\n'.repeat((block.match(/\n/g) ?? []).length)
    )
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (ALLOWED.has(entry)) return [];
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('date-only columns', () => {
  it('never go through `new Date()`', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      source.split('\n').forEach((line, i) => {
        if (OFFENDER.test(line)) {
          offenders.push(`${file.replace(SRC, 'src')}:${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      'Use `fromISO` de @/lib/calendar. `new Date("2026-09-08")` é meia-noite ' +
        'UTC, que no Brasil é o dia 7 — a tela mostra a data errada por um ' +
        'dia. Ver a nota no topo de lib/calendar.ts.'
    ).toEqual([]);
  });

  it('are all still declared DATE in a migration', () => {
    // Sem isto a lista acima envelhece em silêncio: uma coluna renomeada
    // deixa de ser vigiada e o guarda continua verde.
    const sql = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
      .join('\n');

    for (const column of DATE_COLUMNS) {
      expect(
        new RegExp(`\\b${column}\\s+DATE\\b`, 'i').test(sql),
        `\`${column}\` não é declarada DATE em nenhuma migração — a lista do ` +
          `guarda está desatualizada.`
      ).toBe(true);
    }
  });

  it('finds files at all — guards against a silent empty pass', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(200);
  });
});
