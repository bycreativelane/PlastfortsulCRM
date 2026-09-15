import type { SupabaseClient } from '@supabase/supabase-js';

import type { BlingSettingsRow, Reference, RefPick } from './health';
import { foldName } from './health';

/**
 * Os papéis que um admin confirma em Configurações › Bling (`bling_settings`).
 *
 * A validação é o que impede o pior modo de falha do mapeamento: um id que
 * não existe (ou é de outro tipo) salvo como "Em andamento". O PATCH só aceita
 * id que está no cache, vivo, do tipo certo — nada de texto livre.
 */

export const ROLE_FIELDS = {
  order_module_id: 'order_module',
  status_open_id: 'order_status',
  status_in_progress_id: 'order_status',
  status_fulfilled_id: 'order_status',
  status_canceled_id: 'order_status',
  status_future_purchase_id: 'order_status',
  revenue_root_category_id: 'revenue_category',
} as const;

export type RoleField = keyof typeof ROLE_FIELDS;

export type SettingsPatch = Partial<Record<RoleField, string | null>> & {
  payment_method_ids?: string[];
};

const MAXIMO_DE_FORMAS = 20;

export const EMPTY_SETTINGS: Omit<BlingSettingsRow, 'company_id'> = {
  order_module_id: null,
  status_open_id: null,
  status_in_progress_id: null,
  status_fulfilled_id: null,
  status_canceled_id: null,
  status_future_purchase_id: null,
  revenue_root_category_id: null,
  payment_method_ids: [],
};

export function validateSettingsPatch(
  body: unknown,
  referencias: Reference[]
): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'corpo inválido' };
  }
  const entrada = body as Record<string, unknown>;
  const chaves = Object.keys(entrada);
  if (chaves.length === 0) return { ok: false, error: 'nada para salvar' };

  const vivas = (kind: string) =>
    new Set(referencias.filter((r) => r.kind === kind && r.removed_at === null).map((r) => r.bling_id));

  const patch: SettingsPatch = {};
  for (const chave of chaves) {
    const valor = entrada[chave];

    if (chave === 'payment_method_ids') {
      if (!Array.isArray(valor) || !valor.every((v) => typeof v === 'string')) {
        return { ok: false, error: 'payment_method_ids precisa ser uma lista de ids' };
      }
      const ids = [...new Set(valor as string[])];
      if (ids.length > MAXIMO_DE_FORMAS) return { ok: false, error: 'formas de pagamento demais' };
      const existentes = vivas('payment_method');
      const invalido = ids.find((id) => !existentes.has(id));
      if (invalido) return { ok: false, error: `forma de pagamento ${invalido} não está no Bling` };
      patch.payment_method_ids = ids;
      continue;
    }

    if (!(chave in ROLE_FIELDS)) return { ok: false, error: `campo desconhecido: ${chave}` };
    const campo = chave as RoleField;
    if (valor === null) {
      patch[campo] = null;
      continue;
    }
    if (typeof valor !== 'string' || !valor.trim()) {
      return { ok: false, error: `${campo} precisa ser um id ou null` };
    }
    if (!vivas(ROLE_FIELDS[campo]).has(valor)) {
      return { ok: false, error: `${campo}: ${valor} não está no Bling` };
    }
    patch[campo] = valor;
  }
  return { ok: true, patch };
}

/**
 * Para a auditoria: o que mudou, com os rótulos (um id sozinho não diz nada a
 * quem lê o log daqui a um ano).
 */
export function describeSettingsChanges(
  antes: Partial<BlingSettingsRow> | null,
  patch: SettingsPatch,
  referencias: Reference[]
): Record<string, { from: string | null; to: string | null }> {
  const rotulo = (id: string | null | undefined) =>
    id ? (referencias.find((r) => r.bling_id === id)?.label ?? id) : null;
  const mudancas: Record<string, { from: string | null; to: string | null }> = {};
  for (const [campo, valor] of Object.entries(patch)) {
    const anterior = antes?.[campo as keyof BlingSettingsRow];
    if (campo === 'payment_method_ids') {
      const de = ((anterior as string[] | null) ?? []).map((id) => rotulo(id)).join(', ') || null;
      const para = ((valor as string[]) ?? []).map((id) => rotulo(id)).join(', ') || null;
      if (de !== para) mudancas[campo] = { from: de, to: para };
      continue;
    }
    if ((anterior ?? null) !== (valor ?? null)) {
      mudancas[campo] = { from: rotulo(anterior as string | null), to: rotulo(valor as string | null) };
    }
  }
  return mudancas;
}

/** O cache inteiro de uma conexão, em páginas (o PostgREST corta em 1.000). */
export async function loadReferences(db: SupabaseClient, connectionId: string): Promise<Reference[]> {
  const pagina = 1000;
  const todas: Reference[] = [];
  for (let inicio = 0; inicio < 50_000; inicio += pagina) {
    const { data, error } = await db
      .from('bling_references')
      .select('kind, bling_id, parent_bling_id, label, active, removed_at, payload')
      .eq('connection_id', connectionId)
      .order('kind')
      .order('bling_id')
      .range(inicio, inicio + pagina - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const linhas = (data ?? []) as Reference[];
    todas.push(...linhas);
    if (linhas.length < pagina) break;
  }
  return todas;
}

export interface ReferenceOptions {
  orderModules: RefPick[];
  statuses: RefPick[];
  revenueRoots: RefPick[];
  paymentMethods: Array<RefPick & { active: boolean; destination: number | null; purpose: number | null }>;
}

/** As listas dos seletores da tela: só o que está vivo. */
export function buildReferenceOptions(referencias: Reference[], moduloId: string | null): ReferenceOptions {
  const vivas = (kind: string) =>
    referencias
      .filter((r) => r.kind === kind && r.removed_at === null)
      .sort((a, b) => foldName(a.label).localeCompare(foldName(b.label)));
  const escolha = (r: Reference): RefPick => ({ id: r.bling_id, label: r.label });

  return {
    orderModules: vivas('order_module').map(escolha),
    statuses: vivas('order_status')
      .filter((s) => !moduloId || s.parent_bling_id === moduloId)
      .map(escolha),
    revenueRoots: vivas('revenue_category')
      .filter((c) => c.parent_bling_id === null && c.payload.tipo !== 1)
      .map(escolha),
    paymentMethods: vivas('payment_method').map((f) => ({
      ...escolha(f),
      active: f.active,
      destination: typeof f.payload.destino === 'number' ? f.payload.destino : null,
      purpose: typeof f.payload.finalidade === 'number' ? f.payload.finalidade : null,
    })),
  };
}
