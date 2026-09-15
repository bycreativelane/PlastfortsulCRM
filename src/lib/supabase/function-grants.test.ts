import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `REVOKE ... FROM PUBLIC` NÃO TIRA A FUNÇÃO DE QUEM NÃO ESTÁ LOGADO.
 *
 * ------------------------------------------------------------------
 * O DEFEITO, MEDIDO
 * ------------------------------------------------------------------
 *
 * A 078 fechou `save_deal_order` com `REVOKE ALL ... FROM PUBLIC` e
 * `GRANT EXECUTE ... TO authenticated`, pensando em "só logados". No
 * Supabase os privilégios padrão do esquema public dão EXECUTE DIRETO a
 * `anon`, `authenticated` e `service_role` em toda função criada — não por
 * PUBLIC —, então tirar de PUBLIC não tira de ninguém que chama pela API.
 *
 * Medido em 14 de setembro de 2026, só com a anon key: `save_deal_order`
 * EXECUTOU (respondeu o 22023 da própria função); a
 * `increment_automation_execution_count`, que a 007 revoga de `anon` por
 * nome, respondeu 42501. A 079 corrigiu a da 078.
 *
 * Nenhum teste de unidade vê isso: é privilégio de banco, e o SQL "parece"
 * certo. O que dá para ler é a combinação nas migrações.
 *
 * ------------------------------------------------------------------
 * A REGRA
 * ------------------------------------------------------------------
 *
 * Uma função que recebe `REVOKE ... FROM PUBLIC` foi fechada de propósito.
 * Para `anon` e para `authenticated`, alguma migração tem de dizer o que
 * vale POR NOME — um GRANT (é para chamar) ou um REVOKE (não é). Silêncio
 * sobre o papel é o padrão do Supabase, e o padrão é poder executar.
 *
 * `DROP FUNCTION` leva o ACL junto: a contagem daquela assinatura recomeça.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

const PAPEIS_DA_API = ['anon', 'authenticated'] as const;
type Papel = (typeof PAPEIS_DA_API)[number];

/**
 * Fechadas com FROM PUBLIC antes desta regra existir e que não dizem nada
 * sobre o papel. Nenhuma faz estrago pelo papel que sobrou, conferido na
 * leitura de 14/09/2026:
 *
 *   - as SECURITY DEFINER (018, 019, 050, 051) param em
 *     `auth.uid() IS NULL` antes de tocar em qualquer linha;
 *   - as SECURITY INVOKER (025, 032) rodam sob a RLS de quem chama, e
 *     `anon` não passa em nenhuma;
 *   - as duas de mesclagem (022, 036) não acham o que mesclar: os índices
 *     únicos criados logo depois delas impedem o duplicado que procuram.
 *
 * Revogar é endurecimento, não conserto — e a lista só pode encolher: o
 * último teste deste arquivo acusa a entrada que deixou de ser verdade.
 */
const LEGADO = new Set<string>([
  'filter_contacts_by_tags(uuid[],text,int,int) → anon',
  'match_ai_knowledge_fts(uuid,text,integer) → anon',
  'match_ai_knowledge_semantic(uuid,text,integer) → anon',
  'merge_duplicate_contacts() → anon',
  'merge_duplicate_contacts() → authenticated',
  'merge_duplicate_conversations() → anon',
  'merge_duplicate_conversations() → authenticated',
  'record_sign_in() → anon',
  'redeem_invitation(text) → anon',
  'remove_account_member(uuid) → anon',
  'set_member_auto_assign(uuid,boolean) → anon',
  'set_member_permissions(uuid,jsonb) → anon',
  'set_member_role(uuid,account_role_enum) → anon',
  'transfer_account_ownership(uuid) → anon',
]);

/** Comentários, corpos entre `$$` e literais citam GRANT sem executá-lo. */
function limpar(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
}

function assinatura(nome: string, argumentos: string): string {
  const semEsquema = nome.toLowerCase().replace(/^public\./, '');
  return `${semEsquema}(${argumentos.toLowerCase().replace(/\s+/g, '')})`;
}

interface Estado {
  fechadaEm: number | null;
  papeis: Map<Papel, 'GRANT' | 'REVOKE'>;
}

/** assinatura → o que as migrações, em ordem, disseram sobre ela. */
function lerPrivilegios(): {
  estados: Map<string, Estado>;
  arquivos: string[];
  sql: string[];
} {
  const estados = new Map<string, Estado>();
  const arquivos = readdirSync(MIGRATIONS)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const todos: string[] = [];

  const comando =
    /\b(?:(GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+([\w.]+)\s*\(([^)]*)\)\s+(?:TO|FROM)\s+([^;]+)|DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s*\(([^)]*)\))\s*;/gi;

  for (const arquivo of arquivos) {
    const n = Number(arquivo.slice(0, arquivo.indexOf('_')));
    const sql = limpar(readFileSync(join(MIGRATIONS, arquivo), 'utf8'));
    todos.push(sql);

    for (const m of sql.matchAll(comando)) {
      if (m[5] !== undefined) {
        estados.delete(assinatura(m[5], m[6]));
        continue;
      }
      const verbo = m[1].toUpperCase() as 'GRANT' | 'REVOKE';
      const chave = assinatura(m[2], m[3]);
      const papeis = m[4].split(',').map((p) => p.trim().toLowerCase());

      const estado = estados.get(chave) ?? { fechadaEm: null, papeis: new Map() };
      if (verbo === 'REVOKE' && papeis.includes('public')) estado.fechadaEm ??= n;
      for (const papel of PAPEIS_DA_API) {
        if (papeis.includes(papel)) estado.papeis.set(papel, verbo);
      }
      estados.set(chave, estado);
    }
  }
  return { estados, arquivos, sql: todos };
}

/** `assinatura → papel` para cada papel da API que ficou no padrão. */
function esquecidas(estados: Map<string, Estado>): string[] {
  const saida: string[] = [];
  for (const [chave, estado] of estados) {
    if (estado.fechadaEm === null) continue;
    for (const papel of PAPEIS_DA_API) {
      if (!estado.papeis.has(papel)) saida.push(`${chave} → ${papel}`);
    }
  }
  return saida.sort();
}

describe('privilégio de EXECUTE nas funções das migrações', () => {
  it('a premissa continua de pé: nenhuma migração muda o padrão do esquema', () => {
    // Se um dia alguém tirar o EXECUTE padrão de anon com ALTER DEFAULT
    // PRIVILEGES, a regra do topo deixa de ser verdade e este teste tem de
    // ser reescrito — de propósito, não por acidente.
    const { sql } = lerPrivilegios();
    expect(
      sql.some((s) => /ALTER\s+DEFAULT\s+PRIVILEGES[\s\S]*?ON\s+FUNCTIONS/i.test(s))
    ).toBe(false);
  });

  it('o leitor enxerga os três jeitos certos de fechar', () => {
    const { estados } = lerPrivilegios();
    const papeis = (chave: string) =>
      Object.fromEntries(estados.get(chave)?.papeis ?? new Map());

    // 007: revoga de todos por nome, só o serviço chama.
    expect(papeis('increment_automation_execution_count(uuid)')).toEqual({
      anon: 'REVOKE',
      authenticated: 'REVOKE',
    });
    // 019: fechada de PUBLIC e aberta de volta para anon de propósito.
    expect(papeis('peek_invitation(text)')).toEqual({
      anon: 'GRANT',
      authenticated: 'GRANT',
    });
    // 078 + 079: logados chamam, anon não.
    expect(papeis('save_deal_order(uuid,jsonb,jsonb,jsonb)')).toEqual({
      anon: 'REVOKE',
      authenticated: 'GRANT',
    });
    // 047: o DROP da assinatura antiga não apaga a nova.
    expect(
      estados.get('bump_conversation_on_inbound(uuid,text,text,text)')?.fechadaEm
    ).toBe(47);
    expect(estados.has('bump_conversation_on_inbound(uuid,text)')).toBe(false);
  });

  it('função fechada com FROM PUBLIC diz por nome o que anon e authenticated podem', () => {
    const { estados } = lerPrivilegios();
    const novas = esquecidas(estados).filter((e) => !LEGADO.has(e));
    expect(novas).toEqual([]);
  });

  it('a lista de legado só encolhe: cada entrada ainda é verdade', () => {
    const { estados } = lerPrivilegios();
    const agora = new Set(esquecidas(estados));
    const resolvidas = [...LEGADO].filter((e) => !agora.has(e));
    expect(resolvidas).toEqual([]);
  });
});
