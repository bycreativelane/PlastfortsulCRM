import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dealItemRows } from '@/lib/products/catalog';

import { installmentRows } from './installments';
import { dealRow } from './row';
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
  // A migração MAIS NOVA que (re)define a função — a 078 criou, a 085
  // acrescentou os campos do pedido. Ler sempre a 078 deixaria passar uma
  // coluna nova que a função vigente não grava.
  const pasta = join(process.cwd(), 'supabase', 'migrations');
  const sql = readdirSync(pasta)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((f) => readFileSync(join(pasta, f), 'utf8'))
    .filter((texto) => /FUNCTION\s+public\.save_deal_order\s*\(/.test(texto))
    .pop() ?? '';

  it('a oportunidade: toda coluna que a gaveta monta a função grava', () => {
    const { base, orderShape, orderTotals, orderFields } = dealRow({
      title: 't',
      salesOrder: '',
      value: 0,
      shipping: null,
      carrier: '',
      currency: 'BRL',
      contactId: 'c',
      pipelineId: 'p',
      stageId: 's',
      assignedTo: '',
      notes: '',
      expectedCloseDate: '',
      freightMode: '',
      freightVolumes: null,
      grossWeight: null,
      paymentTerms: '',
      otherExpenses: null,
      generalDiscount: null,
      generalDiscountUnit: 'REAL',
    });
    const colunas = Object.keys({ ...base, ...orderShape, ...orderTotals, ...orderFields });
    for (const coluna of colunas) {
      // No UPDATE a função só mexe no que veio: `p_deal ? 'coluna'`.
      expect(sql.includes(`p_deal ? '${coluna}'`), `deals.${coluna}`).toBe(true);
    }
  });

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
