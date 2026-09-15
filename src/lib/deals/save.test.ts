import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dealItemRows } from '@/lib/products/catalog';

import { installmentRows } from './installments';
import { classifySaveError } from './save';

describe('classifySaveError — quando o caminho antigo ainda serve', () => {
  it('função ausente: grava pelo caminho antigo, sem alarde', () => {
    expect(classifySaveError({ code: 'PGRST202' })).toBe('unavailable');
    expect(classifySaveError({ code: '42883' })).toBe('unavailable');
  });

  it('permissão e dado inválido: erro na tela, porque o antigo falharia igual', () => {
    for (const code of ['42501', '23514', '23503', '23502', '23505', '22023']) {
      expect(classifySaveError({ code }), code).toBe('rejected');
    }
  });

  /*
   * O caso que protege a gravação de oportunidade inteira: a 078 aplicada
   * com a função defeituosa. Um 42703 dentro da função (coluna que ela cita
   * e não existe), um 22P02 (conversão de tipo), qualquer coisa que não
   * seja culpa do dado — o antigo ainda grava.
   */
  it('defeito na função: não pode impedir de salvar', () => {
    for (const code of ['42703', '22P02', 'XX000', 'PGRST116', '']) {
      expect(classifySaveError({ code }), code || 'sem código').toBe('broken');
    }
  });
});

describe('a função e o caminho antigo gravam as mesmas colunas', () => {
  /*
   * `dealItemRows` e `installmentRows` são o que os DOIS caminhos mandam.
   * Se a função da 078 não inserir uma coluna que eles montam, a mesma
   * oportunidade grava diferente conforme a migração — um `sku` que some
   * só depois da 078, sem erro nenhum.
   */
  const sql = readFileSync(
    join(
      process.cwd(),
      'supabase',
      'migrations',
      '078_order_totals_and_atomic_save.sql'
    ),
    'utf8'
  );

  const colunasDoInsert = (tabela: string) => {
    const m = sql.match(
      new RegExp(`INSERT INTO ${tabela} \\(([^)]*)\\)`, 'i')
    );
    return (m?.[1] ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  };

  it('itens', () => {
    const montadas = Object.keys(
      dealItemRows([
        { productId: 'p', name: 'x', quantity: 1, unitPrice: 1, discountPercent: 0 },
      ])[0]
    );
    const inseridas = colunasDoInsert('deal_items');
    expect(inseridas.length).toBeGreaterThan(0);
    for (const coluna of montadas) {
      expect(inseridas, `deal_items.${coluna}`).toContain(coluna);
    }
  });

  it('parcelas', () => {
    const montadas = Object.keys(
      installmentRows([
        { days: 0, dueOn: null, amount: 1, method: null, note: null },
      ])[0]
    );
    const inseridas = colunasDoInsert('deal_installments');
    expect(inseridas.length).toBeGreaterThan(0);
    for (const coluna of montadas) {
      expect(inseridas, `deal_installments.${coluna}`).toContain(coluna);
    }
  });
});
