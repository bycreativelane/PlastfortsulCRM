import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CRM_COLUMNS,
  freeColumns,
  isOrderLockedError,
  orderLock,
  pickFreeColumns,
  PRODUCTION_COLUMNS,
  SERVER_COLUMNS,
} from './order-lock';

/**
 * As listas da gaveta são as do gatilho.
 *
 * Lê a migração MAIS NOVA que (re)define `guard_deal_order_columns` — uma
 * migração futura que libere uma coluna tem de ser acompanhada aqui, e o
 * teste acusa se não for.
 */
function arraysDoGatilho(): Record<string, string[]> {
  const pasta = join(process.cwd(), 'supabase', 'migrations');
  const arquivos = readdirSync(pasta)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  let sql = '';
  for (const arquivo of arquivos) {
    const texto = readFileSync(join(pasta, arquivo), 'utf8');
    if (/FUNCTION\s+public\.guard_deal_order_columns\s*\(/.test(texto)) {
      sql = texto;
    }
  }
  const corpo = sql.slice(sql.search(/FUNCTION\s+public\.guard_deal_order_columns/));
  const saida: Record<string, string[]> = {};
  for (const m of corpo.matchAll(
    /(c_servidor|c_do_crm|c_da_producao)\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/g
  )) {
    saida[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  return saida;
}

describe('as travas da gaveta espelham o gatilho da 085', () => {
  const sql = arraysDoGatilho();

  it('o leitor achou as três listas — sem isto o resto passa no vazio', () => {
    expect(sql.c_servidor?.length).toBeGreaterThan(5);
    expect(sql.c_do_crm?.length).toBeGreaterThan(5);
    expect(sql.c_da_producao?.length).toBeGreaterThan(2);
  });

  it('colunas de servidor', () => {
    expect([...SERVER_COLUMNS].sort()).toEqual([...sql.c_servidor].sort());
  });

  it('colunas do CRM', () => {
    expect([...CRM_COLUMNS].sort()).toEqual([...sql.c_do_crm].sort());
  });

  it('colunas da produção', () => {
    expect([...PRODUCTION_COLUMNS].sort()).toEqual([...sql.c_da_producao].sort());
  });
});

describe('orderLock', () => {
  it('sem pedido e Em aberto editam tudo', () => {
    expect(orderLock(null, null)).toBe('open');
    expect(orderLock('em_aberto', null)).toBe('open');
    expect(orderLock('compra_futura', null)).toBe('open');
  });

  it('Em andamento congela; contas lançadas congelam mesmo fora dele', () => {
    expect(orderLock('em_andamento', null)).toBe('in_progress');
    expect(orderLock('em_aberto', '2026-09-15T10:00:00Z')).toBe('in_progress');
  });

  it('Atendido e Cancelado só deixam o CRM', () => {
    expect(orderLock('atendido', null)).toBe('closed');
    expect(orderLock('cancelado', '2026-09-15T10:00:00Z')).toBe('closed');
  });
});

describe('pickFreeColumns', () => {
  const corpo = {
    title: 'Euclides',
    notes: 'ligar sexta',
    internal_notes: 'margem baixa',
    shipping_cost: 120,
    contact_id: 'c1',
    freight_volumes: 4,
    gross_weight: 128.5,
    departure_date: '2026-09-20',
    order_status: 'em_aberto',
    stage_id: 's1',
  };

  it('aberto passa tudo, menos o que é do servidor', () => {
    const livre = pickFreeColumns(corpo, 'open');
    expect(livre).not.toHaveProperty('order_status');
    expect(livre).toHaveProperty('shipping_cost', 120);
    expect(livre).toHaveProperty('contact_id', 'c1');
  });

  it('Em andamento deixa o CRM e a produção, e segura frete e cliente', () => {
    const livre = pickFreeColumns(corpo, 'in_progress');
    expect(Object.keys(livre).sort()).toEqual(
      [
        'departure_date',
        'freight_volumes',
        'gross_weight',
        'internal_notes',
        'notes',
        'stage_id',
        'title',
      ].sort()
    );
  });

  it('fechado deixa só o CRM', () => {
    const livre = pickFreeColumns(corpo, 'closed');
    expect(Object.keys(livre).sort()).toEqual(
      ['internal_notes', 'notes', 'stage_id', 'title'].sort()
    );
  });

  it('freeColumns: aberto é "todas"', () => {
    expect(freeColumns('open')).toBeNull();
    expect(freeColumns('closed')?.has('freight_volumes')).toBe(false);
    expect(freeColumns('in_progress')?.has('freight_volumes')).toBe(true);
  });
});

describe('isOrderLockedError', () => {
  it('reconhece a dica do gatilho e a mensagem', () => {
    expect(isOrderLockedError({ code: '42501', hint: 'order_locked' })).toBe(true);
    expect(
      isOrderLockedError({
        code: '42501',
        message: 'guard_deal_children_locked: pedido em_andamento: itens e parcelas travados',
      })
    ).toBe(true);
  });

  it('RLS pura não é trava', () => {
    expect(
      isOrderLockedError({ code: '42501', message: 'new row violates row-level security policy' })
    ).toBe(false);
    expect(isOrderLockedError(null)).toBe(false);
  });
});
