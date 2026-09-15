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
 * nome, respondeu 42501. A 079 corrigiu a da 078; a 080, doze funções
 * antigas (018 a 051) que tinham o mesmo engano desde que foram escritas.
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
 * Uma SECURITY DEFINER que não é gatilho passa por cima da RLS, então não
 * pode depender de ninguém lembrar: ou há GRANT para `anon` por nome (é para
 * anon chamar), ou há REVOKE de `anon` E de PUBLIC. A 081 fechou seis que
 * nunca tinham recebido REVOKE nenhum — quatro delas gravavam em qualquer
 * conta com a anon key e um id.
 *
 * E revogar um papel sem revogar PUBLIC não fecha nada: todo papel é membro
 * implícito de PUBLIC.
 *
 * `DROP FUNCTION` leva o ACL junto: a contagem daquela assinatura recomeça.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

const PAPEIS_DA_API = ['anon', 'authenticated'] as const;
type Papel = (typeof PAPEIS_DA_API)[number];

/** Comentários, corpos entre `$$` e literais citam GRANT sem executá-lo. */
function limpar(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
}

function semEsquema(nome: string): string {
  return nome.toLowerCase().replace(/^public\./, '');
}

function assinatura(nome: string, argumentos: string): string {
  return `${semEsquema(nome)}(${argumentos.toLowerCase().replace(/\s+/g, '')})`;
}

interface Estado {
  fechadaEm: number | null;
  papeis: Map<Papel, 'GRANT' | 'REVOKE'>;
}

/**
 * assinatura → o que as migrações, em ordem, disseram sobre ela; e o nome de
 * cada SECURITY DEFINER que não é gatilho, com a migração que a criou por
 * último. O `CREATE` é lido pelo NOME: a declaração traz nomes e defaults dos
 * parâmetros, que o GRANT não traz.
 */
function lerPrivilegios(): {
  estados: Map<string, Estado>;
  definers: Map<string, number>;
  arquivos: string[];
  sql: string[];
} {
  const estados = new Map<string, Estado>();
  const funcoes = new Map<string, { n: number; definer: boolean }>();
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

    // CREATE e DROP na ordem em que aparecem: o último decide.
    const eventos: { pos: number; nome: string; definer?: boolean }[] = [];
    for (const m of sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\(/gi
    )) {
      // Sem os corpos entre `$$`, a declaração acaba no primeiro `;`.
      const fim = sql.indexOf(';', m.index);
      const declaracao = sql.slice(m.index, fim < 0 ? undefined : fim);
      // Função de gatilho não se chama pela API: o EXECUTE dela não importa.
      if (/RETURNS\s+(?:event_)?trigger\b/i.test(declaracao)) continue;
      eventos.push({
        pos: m.index,
        nome: semEsquema(m[1]),
        definer: /SECURITY\s+DEFINER/i.test(declaracao),
      });
    }
    for (const m of sql.matchAll(
      /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w.]+)/gi
    )) {
      eventos.push({ pos: m.index, nome: semEsquema(m[1]) });
    }
    for (const e of eventos.sort((a, b) => a.pos - b.pos)) {
      if (e.definer === undefined) funcoes.delete(e.nome);
      else funcoes.set(e.nome, { n, definer: e.definer });
    }

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
  const definers = new Map(
    [...funcoes].filter(([, f]) => f.definer).map(([nome, f]) => [nome, f.n])
  );
  return { estados, definers, arquivos, sql: todos };
}

/**
 * `assinatura → anon` para cada SECURITY DEFINER que anon ainda executa sem
 * ninguém ter dito: nem GRANT para anon, nem REVOKE de anon com PUBLIC.
 * Sem GRANT/REVOKE nenhum para o nome, acusa o nome.
 */
function definersAbertas(
  estados: Map<string, Estado>,
  definers: Map<string, number>
): string[] {
  const saida: string[] = [];
  for (const nome of definers.keys()) {
    const assinaturas = [...estados].filter(([chave]) =>
      chave.startsWith(`${nome}(`)
    );
    if (assinaturas.length === 0) saida.push(`${nome} → anon`);
    for (const [chave, estado] of assinaturas) {
      const anon = estado.papeis.get('anon');
      const fechada = anon === 'REVOKE' && estado.fechadaEm !== null;
      if (anon !== 'GRANT' && !fechada) saida.push(`${chave} → anon`);
    }
  }
  return saida.sort();
}

/** `assinatura → papel` revogado por nome enquanto PUBLIC continua podendo. */
function revogacoesInocuas(estados: Map<string, Estado>): string[] {
  const saida: string[] = [];
  for (const [chave, estado] of estados) {
    if (estado.fechadaEm !== null) continue;
    for (const [papel, verbo] of estado.papeis) {
      if (verbo === 'REVOKE') saida.push(`${chave} → ${papel}`);
    }
  }
  return saida.sort();
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

  it('o leitor enxerga os jeitos certos de fechar', () => {
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
    // 022 + 080: dois papéis num REVOKE só, e o GRANT de uma migração
    // anterior não some quando a posterior revoga só o outro papel (025).
    expect(papeis('merge_duplicate_contacts()')).toEqual({
      anon: 'REVOKE',
      authenticated: 'REVOKE',
    });
    expect(papeis('filter_contacts_by_tags(uuid[],text,int,int)')).toEqual({
      anon: 'REVOKE',
      authenticated: 'GRANT',
    });
    // 047: o DROP da assinatura antiga não apaga a nova.
    expect(
      estados.get('bump_conversation_on_inbound(uuid,text,text,text)')?.fechadaEm
    ).toBe(47);
    expect(estados.has('bump_conversation_on_inbound(uuid,text)')).toBe(false);
  });

  it('o leitor separa SECURITY DEFINER de INVOKER e de gatilho', () => {
    const { estados, definers } = lerPrivilegios();

    // DEFINER que a API chama.
    expect(definers.has('claim_ai_reply_slot')).toBe(true);
    expect(definers.has('is_account_member')).toBe(true);
    // INVOKER (025, 078): a RLS de quem chama já vale.
    expect(definers.has('filter_contacts_by_tags')).toBe(false);
    expect(definers.has('save_deal_order')).toBe(false);
    // DEFINER, mas gatilho (065): não se chama pela API.
    expect(definers.has('deals_record_stage_event')).toBe(false);

    // 029 + 081: PUBLIC e anon juntos, num REVOKE só.
    expect(estados.get('claim_ai_reply_slot(uuid,integer)')?.fechadaEm).toBe(81);
    // 017 + 081: aberta para anon de propósito, por escrito.
    expect(
      estados.get('is_account_member(uuid,account_role_enum)')?.papeis.get('anon')
    ).toBe('GRANT');
  });

  it('função fechada com FROM PUBLIC diz por nome o que anon e authenticated podem', () => {
    const { estados } = lerPrivilegios();
    expect(esquecidas(estados)).toEqual([]);
  });

  it('SECURITY DEFINER que não é gatilho diz por nome se anon executa', () => {
    const { estados, definers } = lerPrivilegios();
    expect(definersAbertas(estados, definers)).toEqual([]);
  });

  it('revogar anon ou authenticated vem junto com revogar PUBLIC', () => {
    const { estados } = lerPrivilegios();
    expect(revogacoesInocuas(estados)).toEqual([]);
  });
});
