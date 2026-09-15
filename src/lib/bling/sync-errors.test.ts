import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { describeSyncError, PAYLOAD_PROBLEM_CODES, SYNC_ERROR_CODES } from './sync-errors';

type Mensagens = Record<string, unknown>;

const LOCALES = ['pt-BR', 'en', 'ko'] as const;
const mensagens = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(process.cwd(), 'messages', `${l}.json`), 'utf8')) as Mensagens])
);

function chave(doc: Mensagens, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((no, parte) => (no && typeof no === 'object' ? (no as Mensagens)[parte] : undefined), doc);
}

/** Um `t` de mentira que devolve a chave e os valores — o bastante para ver o caminho. */
const t = (k: string, v?: Record<string, string | number>) => (v ? `${k}|${JSON.stringify(v)}` : k);

describe('describeSyncError', () => {
  it('código conhecido vira a frase; desconhecido vira frase com o código, nunca o código cru', () => {
    expect(describeSyncError('order_not_synced', t)).toBe('errors.order_not_synced');
    expect(describeSyncError('inventado', t)).toBe('errors.unknown|{"code":"inventado"}');
    expect(describeSyncError('bling:400:Não pode', t)).toBe('errors.bling|{"status":"400","detail":"Não pode"}');
    expect(describeSyncError('payload:no_items,no_category', t)).toBe('errors.payload.no_items errors.payload.no_category');
    expect(describeSyncError('diff:total', t)).toBe('errors.diff|{"fields":"total"}');
  });

  it('todo código tem frase nas três línguas', () => {
    for (const locale of LOCALES) {
      for (const codigo of SYNC_ERROR_CODES) {
        expect(typeof chave(mensagens[locale], `Pipelines.order.errors.${codigo}`), `${locale}: ${codigo}`).toBe('string');
      }
      for (const codigo of PAYLOAD_PROBLEM_CODES) {
        expect(typeof chave(mensagens[locale], `Pipelines.order.errors.payload.${codigo}`), `${locale}: payload.${codigo}`).toBe('string');
      }
      for (const extra of ['bling', 'diff', 'unknown']) {
        expect(typeof chave(mensagens[locale], `Pipelines.order.errors.${extra}`), `${locale}: ${extra}`).toBe('string');
      }
    }
  });

  /**
   * O que o servidor escreve: `error: 'codigo'` nas bibliotecas da fila e nas
   * rotas de pedido. Cada um tem de estar na lista — ou chega à tela como o
   * "O Bling não aceitou agora (codigo)" genérico.
   */
  it('todo código que a fila e as rotas de pedido escrevem está na lista', () => {
    const arquivos = [
      ...['orders.ts', 'status-change.ts', 'operations.ts'].map((f) => join(process.cwd(), 'src', 'lib', 'bling', f)),
      ...listar(join(process.cwd(), 'src', 'app', 'api', 'bling', 'orders')),
    ];
    const escritos = new Set<string>();
    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, 'utf8');
      for (const m of fonte.matchAll(/error:\s*'([a-z_]+)'/g)) escritos.add(m[1]);
    }
    // Recusas com tratamento próprio na tela.
    const tratadosAParte = new Set(['not_ready']);
    const faltando = [...escritos].filter((c) => !SYNC_ERROR_CODES.has(c) && !tratadosAParte.has(c));
    expect(faltando).toEqual([]);
    expect(escritos.size).toBeGreaterThan(10);
  });
});

function listar(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    return statSync(caminho).isDirectory() ? listar(caminho) : caminho.endsWith('.ts') ? [caminho] : [];
  });
}
