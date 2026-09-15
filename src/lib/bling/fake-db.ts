import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * SÓ PARA TESTES. Um PostgREST de mentira, em memória, com as cadeias que o
 * código do Bling usa: `select/insert/upsert/update/delete`, `eq`, `lt`, `or`
 * (só `col.is.null` e `col.lt.valor`), `maybeSingle`, `single`, `rpc`.
 *
 * Existe porque o que importa testar aqui é ORDEM e CONCORRÊNCIA — quem
 * grava antes de quem, e o que acontece quando dois chamam juntos —, e isso
 * um mock por chamada não mostra. Toda operação passa por um `await`, então
 * duas chamadas simultâneas se intercalam como no banco de verdade.
 */

type Linha = Record<string, unknown>;
type Filtro = (linha: Linha) => boolean;
type ErroPg = { code: string; message: string };

export interface FakeDbOptions {
  tables?: Record<string, Linha[]>;
  /** Colunas únicas por tabela (a chave de conflito do insert/upsert). */
  unique?: Record<string, string[]>;
  rpcs?: Record<
    string,
    (args: Record<string, unknown>, tables: Record<string, Linha[]>) => unknown
  >;
  /** Força erro numa operação: `"insert bling_oauth_codes"`, `"rpc bling_take_request"`. */
  errors?: Record<string, ErroPg>;
}

export interface FakeDb {
  client: SupabaseClient;
  tables: Record<string, Linha[]>;
  /** Cada operação, na ordem: `"update bling_connections"`, `"rpc bling_claim_refresh"`. */
  log: string[];
}

let sequencia = 0;

function avaliarOr(linha: Linha, parte: string): boolean {
  const [coluna, operador, ...resto] = parte.split('.');
  const valor = resto.join('.');
  if (operador === 'is' && valor === 'null') return linha[coluna] === null || linha[coluna] === undefined;
  if (operador === 'lt') return linha[coluna] != null && String(linha[coluna]) < valor;
  throw new Error(`fake-db: filtro or não suportado: ${parte}`);
}

export function fakeDb(options: FakeDbOptions = {}): FakeDb {
  const tables: Record<string, Linha[]> = {};
  for (const [nome, linhas] of Object.entries(options.tables ?? {})) {
    tables[nome] = linhas.map((l) => ({ ...l }));
  }
  const log: string[] = [];

  const tabela = (nome: string) => (tables[nome] ??= []);

  function from(nome: string) {
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let payload: Linha | Linha[] | null = null;
    let conflito: string | undefined;
    let devolverLinhas = false;
    let intervalo: [number, number] | null = null;
    const filtros: Filtro[] = [];

    async function executar(): Promise<{ data: unknown; error: ErroPg | null }> {
      await Promise.resolve();
      log.push(`${op} ${nome}`);
      const forcado = options.errors?.[`${op} ${nome}`];
      if (forcado) return { data: null, error: forcado };

      const linhas = tabela(nome);
      const casam = () => linhas.filter((l) => filtros.every((f) => f(l)));

      if (op === 'select') {
        const todas = casam().map((l) => ({ ...l }));
        return { data: intervalo ? todas.slice(intervalo[0], intervalo[1] + 1) : todas, error: null };
      }
      if (op === 'insert' || op === 'upsert') {
        const novas = (Array.isArray(payload) ? payload : [payload]) as Linha[];
        const chaves = options.unique?.[nome] ?? [];
        const gravadas: Linha[] = [];
        for (const nova of novas) {
          // Cada chave pode ser composta: "connection_id,kind,bling_id".
          const chave = op === 'upsert' && conflito ? [conflito] : chaves;
          const existente = linhas.find((l) =>
            chave.some((composta) => composta.split(',').every((c) => l[c.trim()] === nova[c.trim()]))
          );
          if (existente && op === 'insert') {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
          if (existente) {
            Object.assign(existente, nova);
            gravadas.push(existente);
          } else {
            const linha = { id: `id-${++sequencia}`, ...nova };
            linhas.push(linha);
            gravadas.push(linha);
          }
        }
        return { data: devolverLinhas ? gravadas.map((l) => ({ ...l })) : null, error: null };
      }
      if (op === 'update') {
        const alvo = casam();
        for (const l of alvo) Object.assign(l, payload);
        return { data: devolverLinhas ? alvo.map((l) => ({ id: l.id })) : null, error: null };
      }
      // delete
      const alvo = new Set(casam());
      tables[nome] = linhas.filter((l) => !alvo.has(l));
      return { data: null, error: null };
    }

    const b = {
      select() {
        if (op !== 'select') devolverLinhas = true;
        return b;
      },
      insert(p: Linha | Linha[]) {
        op = 'insert';
        payload = p;
        return b;
      },
      upsert(p: Linha | Linha[], opts?: { onConflict?: string }) {
        op = 'upsert';
        payload = p;
        conflito = opts?.onConflict;
        return b;
      },
      update(p: Linha) {
        op = 'update';
        payload = p;
        return b;
      },
      delete() {
        op = 'delete';
        return b;
      },
      eq(coluna: string, valor: unknown) {
        filtros.push((l) => l[coluna] === valor);
        return b;
      },
      lt(coluna: string, valor: string) {
        filtros.push((l) => l[coluna] != null && String(l[coluna]) < valor);
        return b;
      },
      is(coluna: string, valor: null) {
        filtros.push((l) => (valor === null ? l[coluna] === null || l[coluna] === undefined : l[coluna] === valor));
        return b;
      },
      in(coluna: string, valores: unknown[]) {
        filtros.push((l) => valores.includes(l[coluna]));
        return b;
      },
      neq(coluna: string, valor: unknown) {
        filtros.push((l) => l[coluna] !== valor);
        return b;
      },
      ilike(coluna: string, padrao: string) {
        // Só o suficiente: sem curinga (com escape) é igualdade sem caixa.
        const literal = padrao.replace(/\\([\\%_])/g, '$1');
        filtros.push((l) => typeof l[coluna] === 'string' && (l[coluna] as string).toLowerCase() === literal.toLowerCase());
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      range(de: number, ate: number) {
        intervalo = [de, ate];
        return b;
      },
      or(expressao: string) {
        const partes = expressao.split(',');
        filtros.push((l) => partes.some((p) => avaliarOr(l, p)));
        return b;
      },
      async maybeSingle() {
        const { data, error } = await executar();
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      async single() {
        const { data, error } = await executar();
        const linha = Array.isArray(data) ? data[0] : data;
        return linha
          ? { data: linha, error }
          : { data: null, error: error ?? { code: 'PGRST116', message: 'no rows' } };
      },
      then<T>(resolve: (v: { data: unknown; error: ErroPg | null }) => T, reject?: (e: unknown) => T) {
        return executar().then(resolve, reject);
      },
    };
    return b;
  }

  async function rpc(nome: string, args: Record<string, unknown>) {
    await Promise.resolve();
    log.push(`rpc ${nome}`);
    const forcado = options.errors?.[`rpc ${nome}`];
    if (forcado) return { data: null, error: forcado };
    const fn = options.rpcs?.[nome];
    if (!fn) return { data: null, error: { code: 'PGRST202', message: `função ${nome} ausente` } };
    return { data: fn(args, tables), error: null };
  }

  return { client: { from, rpc } as unknown as SupabaseClient, tables, log };
}
