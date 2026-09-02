import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A base de consulta comercial — scripts, objeções e regras.
 *
 * Uma tabela com `type` e não três, e o argumento inteiro está no topo
 * da migração 064. Em uma linha: quem decide é a BUSCA. Procurar
 * "frete" tem que varrer os três, e com três tabelas isso é um UNION
 * que o quarto tipo vai ser esquecido dentro de — num lugar que não dá
 * erro, só devolve menos resultado.
 *
 * Produtos NÃO estão aqui. A quarta seção da tela lê `products`
 * (migração 054); duplicar catálogo em texto livre seria uma segunda
 * verdade sobre preço e medida, e a errada é sempre a que alguém
 * consulta.
 */

export type PlaybookType = 'sales_script' | 'objection' | 'operation_rule';

export interface PlaybookEntry {
  id: string;
  account_id: string;
  type: PlaybookType;
  title: string;
  category: string | null;
  content: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Colunas, uma vez, porque três chamadas leem a mesma linha. */
const SELECT = '*';

/**
 * Tudo da conta, de uma vez.
 *
 * Sem paginação e sem filtro por tipo na consulta, de propósito. Isto é
 * o combinado escrito de uma empresa: são dezenas de linhas, não
 * milhares, e trazer o conjunto inteiro é o que deixa a busca do §A6
 * acontecer no cliente — instantânea, sem round trip a cada tecla, e
 * atravessando os três tipos sem que ela precise saber que tipos
 * existem.
 *
 * Se um dia uma conta chegar a milhares de linhas, o sintoma vai ser o
 * primeiro carregamento e a correção é paginar por tipo. Não é hoje, e
 * paginar antes custaria a busca instantânea.
 */
export async function loadPlaybook(
  db: SupabaseClient,
  accountId: string
): Promise<PlaybookEntry[] | 'missing-table'> {
  const { data, error } = await db
    .from('playbook_entries')
    .select(SELECT)
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false });

  if (error) {
    // 42P01 — a 064 não foi aplicada. A tela mostra o estado "recurso
    // desligado" em vez de um erro, que é a regra da casa: uma coluna ou
    // tabela ausente degrada para "isto ainda não está ligado", nunca
    // para "alguma coisa quebrou".
    if (error.code === '42P01') return 'missing-table';
    console.error('loadPlaybook failed', error);
    return [];
  }
  return (data ?? []) as PlaybookEntry[];
}

export async function savePlaybookEntry(
  db: SupabaseClient,
  args: {
    id?: string;
    accountId: string;
    authorId: string;
    type: PlaybookType;
    title: string;
    category: string | null;
    content: string;
  }
): Promise<{ error: string | null }> {
  const title = args.title.trim();
  const content = args.content.trim();
  // Os mesmos dois CHECKs que a 064 tem. Conferidos aqui para o usuário
  // receber "faltou o título" em vez de uma violação de constraint.
  if (!title || !content) return { error: 'EMPTY' };

  const row = {
    type: args.type,
    title,
    category: args.category?.trim() || null,
    content,
  };

  const { error } = args.id
    ? await db.from('playbook_entries').update(row).eq('id', args.id)
    : await db.from('playbook_entries').insert({
        ...row,
        account_id: args.accountId,
        created_by: args.authorId,
      });

  return { error: error?.message ?? null };
}

export async function deletePlaybookEntry(
  db: SupabaseClient,
  id: string
): Promise<{ error: string | null }> {
  const { error } = await db.from('playbook_entries').delete().eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * A busca: título, categoria e conteúdo, sem acento e sem caixa.
 *
 * `normalize('NFD')` mais a faixa de diacríticos é o que faz "objecao"
 * achar "objeção" — e num produto em português isso não é refinamento,
 * é a diferença entre a busca servir e não servir. Ninguém digita
 * cedilha com o cliente esperando.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function matchesQuery(entry: PlaybookEntry, query: string): boolean {
  const q = normalizeForSearch(query.trim());
  if (!q) return true;
  const haystack = normalizeForSearch(
    `${entry.title} ${entry.category ?? ''} ${entry.content}`
  );
  // Cada palavra tem que aparecer, em qualquer ordem: "frete caro" acha
  // "o frete ficou muito caro", que uma busca por substring não acharia.
  return q.split(/\s+/).every((word) => haystack.includes(word));
}
