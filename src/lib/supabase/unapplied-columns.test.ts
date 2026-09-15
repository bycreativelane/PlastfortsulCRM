import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { archiveLayers } from '@/lib/quotes/archive';
import { buildQuote } from '@/lib/quotes/quote';
import {
  dealRow,
  EMPTY_ORDER_FIELDS,
  ORDER_FIELDS_MIGRATION,
  ORDER_SHAPE_MIGRATION,
  ORDER_TOTALS_MIGRATION,
} from '@/lib/deals/row';
import { dealItemRows, ITEM_SNAPSHOT_COLUMNS } from '@/lib/products/catalog';
import {
  INSTALLMENT_METHOD_COLUMN,
  installmentRows,
} from '@/lib/deals/installments';
import {
  CONTACT_FISCAL_MIGRATION,
  EMPTY_FISCAL,
  fiscalRow,
} from '@/lib/contacts/fiscal';

/**
 * UMA COLUNA DE MIGRAÇÃO NÃO APLICADA NÃO PODE DERRUBAR A GRAVAÇÃO INTEIRA.
 *
 * ------------------------------------------------------------------
 * O DEFEITO, MEDIDO
 * ------------------------------------------------------------------
 *
 * Em 14 de setembro de 2026 o banco de teste estava com a 074, a 075 e a
 * 076 por aplicar, e duas coisas centrais estavam quebradas sem nenhum
 * teste acusar:
 *
 *   - SALVAR QUALQUER OPORTUNIDADE. A gaveta mandava as quatro colunas da
 *     075 em todo `update`, e o PostgREST recusa o corpo inteiro quando
 *     UMA coluna não existe (`PGRST204`). Payload com elas: 400. Sem
 *     elas: 204.
 *
 *   - GERAR QUALQUER ORÇAMENTO. O recuo da rota caía da camada da 076 para
 *     uma camada que ainda citava `fingerprint`, da 074 — e morria igual.
 *
 * As migrações deste projeto são aplicadas à mão, de propósito, e isso
 * abre uma janela real entre o código conhecer uma coluna e o banco tê-la.
 * `pg-errors.ts` já dizia o que fazer nessa janela: cair para o que se
 * fazia antes, não falhar. O que faltava era algo que PERCEBESSE quando a
 * regra foi quebrada — TypeScript não sabe o que está no banco, e o teste
 * passa em qualquer máquina.
 *
 * ------------------------------------------------------------------
 * COMO ELE MEDE
 * ------------------------------------------------------------------
 *
 * Lendo `supabase/migrations/`. Para cada coluna que o código grava, acha
 * a primeira migração que a cria — num `CREATE TABLE` ou num
 * `ADD COLUMN` — e confere que ela pertence à camada certa.
 *
 * Uma coluna que não aparece em migração NENHUMA também acusa: é um nome
 * digitado errado, e o PostgREST o recusaria do mesmo jeito.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** Tira comentários e literais, que citam colunas sem criá-las. */
function limpar(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** O corpo entre parênteses que começa em `inicio`, respeitando aninhamento. */
function corpoBalanceado(sql: string, inicio: number): string {
  let profundidade = 0;
  for (let i = inicio; i < sql.length; i++) {
    if (sql[i] === '(') profundidade++;
    else if (sql[i] === ')') {
      profundidade--;
      if (profundidade === 0) return sql.slice(inicio + 1, i);
    }
  }
  return '';
}

/** Divide por vírgula só no nível de cima — `NUMERIC(14,2)` não é duas colunas. */
function itensDeCima(corpo: string): string[] {
  const itens: string[] = [];
  let profundidade = 0;
  let atual = '';
  for (const c of corpo) {
    if (c === '(') profundidade++;
    if (c === ')') profundidade--;
    if (c === ',' && profundidade === 0) {
      itens.push(atual);
      atual = '';
    } else atual += c;
  }
  itens.push(atual);
  return itens;
}

const NAO_COLUNA = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|LIKE)$/i;

/** tabela → coluna → número da primeira migração que a cria. */
function mapaDeColunas(): Map<string, Map<string, number>> {
  const mapa = new Map<string, Map<string, number>>();
  const registrar = (tabela: string, coluna: string, n: number) => {
    const t = tabela.toLowerCase();
    const c = coluna.toLowerCase();
    if (!mapa.has(t)) mapa.set(t, new Map());
    const colunas = mapa.get(t)!;
    if (!colunas.has(c)) colunas.set(c, n);
  };

  const arquivos = readdirSync(MIGRATIONS)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  for (const arquivo of arquivos) {
    const n = Number(arquivo.slice(0, arquivo.indexOf('_')));
    const sql = limpar(readFileSync(join(MIGRATIONS, arquivo), 'utf8'));

    const criacao =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/gi;
    for (const m of sql.matchAll(criacao)) {
      const abre = (m.index ?? 0) + m[0].length - 1;
      for (const item of itensDeCima(corpoBalanceado(sql, abre))) {
        const nome = item.trim().split(/\s+/)[0];
        if (nome && /^\w+$/.test(nome) && !NAO_COLUNA.test(nome)) {
          registrar(m[1], nome, n);
        }
      }
    }

    const alteracao =
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)([^;]*);/gi;
    for (const m of sql.matchAll(alteracao)) {
      for (const add of m[2].matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi
      )) {
        registrar(m[1], add[1], n);
      }
    }
  }
  return mapa;
}

const COLUNAS = mapaDeColunas();

function criadaEm(tabela: string, coluna: string): number | null {
  return COLUNAS.get(tabela)?.get(coluna) ?? null;
}

describe('o leitor de migrações', () => {
  it('conhece o que se sabe de cor — sem isto o resto passa no vazio', () => {
    expect(criadaEm('deals', 'title')).toBe(1);
    expect(criadaEm('deals', 'account_id')).toBe(17);
    expect(criadaEm('deals', 'sales_order_number')).toBe(70);
    expect(criadaEm('deals', 'payment_terms')).toBe(75);
    expect(criadaEm('deal_items', 'sku')).toBe(75);
    expect(criadaEm('deal_quotes', 'issued_on')).toBe(71);
    expect(criadaEm('deal_quotes', 'pdf_url')).toBe(72);
    expect(criadaEm('deal_quotes', 'fingerprint')).toBe(74);
    expect(criadaEm('deal_quotes', 'installments')).toBe(76);
  });

  it('não confunde tipo com coluna', () => {
    // `NUMERIC(14,2)` tem uma vírgula dentro; `CHECK (...)` não é coluna.
    expect(criadaEm('deal_quotes', '2)')).toBeNull();
    expect(criadaEm('deal_quotes', 'check')).toBeNull();
  });
});

const CAMPOS = {
  title: 'Euclides',
  salesOrder: '14350',
  value: 725,
  shipping: 120,
  carrier: 'Rodoexpress',
  currency: 'BRL',
  contactId: 'c1',
  pipelineId: 'p1',
  stageId: 's1',
  assignedTo: 'u1',
  notes: 'x',
  expectedCloseDate: '',
  freightMode: 'freightCif',
  freightVolumes: 4,
  grossWeight: 128.5,
  paymentTerms: '30/60/90',
  otherExpenses: 25,
  generalDiscount: 3,
  generalDiscountUnit: 'REAL' as const,
  order: { ...EMPTY_ORDER_FIELDS, internalNotes: 'margem', carrierId: 'c1' },
};

describe('a linha de `deals` que a gaveta grava', () => {
  const { base, orderShape, orderTotals, orderFields } = dealRow(CAMPOS);

  it('a metade que vai SEMPRE só cita colunas anteriores à 075', () => {
    const problemas = Object.keys(base)
      .map((c) => [c, criadaEm('deals', c)] as const)
      .filter(([, n]) => n === null || n >= ORDER_SHAPE_MIGRATION)
      .map(([c, n]) => (n === null ? `${c}: não existe` : `${c}: da ${n}`));

    expect(
      problemas,
      'Uma coluna de migração ainda não aplicada no corpo de todo `update` ' +
        'faz o PostgREST recusar a gravação INTEIRA — nenhuma oportunidade ' +
        'salva. Ela vai em `orderShape`, que só entra quando existe.'
    ).toEqual([]);
  });

  it('a metade condicional é exatamente a 075', () => {
    for (const c of Object.keys(orderShape)) {
      expect(criadaEm('deals', c), c).toBe(ORDER_SHAPE_MIGRATION);
    }
  });

  it('o terceiro grupo é exatamente a 078', () => {
    // Outras despesas e desconto geral. Uma coluna da 078 que escorregue
    // para `orderShape` derrubaria toda gravação num banco com a 075 e sem
    // a 078 — o mesmo defeito, uma migração depois.
    expect(Object.keys(orderTotals).length).toBeGreaterThan(0);
    for (const c of Object.keys(orderTotals)) {
      expect(criadaEm('deals', c), c).toBe(ORDER_TOTALS_MIGRATION);
    }
  });

  it('o quarto grupo é exatamente a 085', () => {
    // O pedido completo. Uma coluna dele em `orderTotals` derrubaria toda
    // gravação num banco com a 078 e sem a 085.
    expect(Object.keys(orderFields).length).toBeGreaterThan(0);
    for (const c of Object.keys(orderFields)) {
      expect(criadaEm('deals', c), c).toBe(ORDER_FIELDS_MIGRATION);
    }
  });
});

describe('as linhas, as parcelas e o contato — o que o caminho direto grava', () => {
  it('itens: os snapshots são a 085, e o resto é da 075 ou mais velho', () => {
    const [linha] = dealItemRows([
      { productId: 'p1', name: 'Lona', quantity: 1, unitPrice: 10, discountPercent: 0 },
    ]);
    const snapshots = new Set<string>(ITEM_SNAPSHOT_COLUMNS);
    for (const c of Object.keys(linha)) {
      const n = criadaEm('deal_items', c);
      if (snapshots.has(c)) expect(n, c).toBe(85);
      else expect(n !== null && n <= ORDER_SHAPE_MIGRATION, `${c}: da ${n}`).toBe(true);
    }
    // `replaceDealItems` tira exatamente estas num banco sem a 085: uma que
    // faltasse na lista seria a linha recusada inteira.
    const da085 = Object.keys(linha).filter((c) => criadaEm('deal_items', c) === 85);
    expect(da085.sort()).toEqual([...ITEM_SNAPSHOT_COLUMNS].sort());
  });

  it('parcelas: só a forma por id é da 085', () => {
    const [parcela] = installmentRows([
      { days: 30, dueOn: '2026-10-15', amount: 10, method: 'Boleto', note: null },
    ]);
    const da085 = Object.keys(parcela).filter(
      (c) => criadaEm('deal_installments', c) === 85
    );
    expect(da085).toEqual([INSTALLMENT_METHOD_COLUMN]);
    for (const c of Object.keys(parcela)) {
      expect(criadaEm('deal_installments', c), c).not.toBeNull();
    }
  });

  it('contato: a seção fiscal é inteira da 085', () => {
    for (const c of Object.keys(fiscalRow(EMPTY_FISCAL))) {
      expect(criadaEm('contacts', c), c).toBe(CONTACT_FISCAL_MIGRATION);
    }
  });
});

describe('as camadas de `deal_quotes`', () => {
  const quote = buildQuote({
    issuedOn: '2026-09-14',
    customerName: 'Euclides',
    items: [],
    value: 100,
    currency: 'BRL',
  });
  const camadas = archiveLayers({
    accountId: 'a1',
    dealId: 'd1',
    userId: 'u1',
    quote,
    fingerprint: 'f',
  });

  it('cada camada só cita colunas da migração dela ou mais velhas', () => {
    const problemas = camadas.flatMap(({ migration, row }) =>
      Object.keys(row)
        .map((c) => [c, criadaEm('deal_quotes', c)] as const)
        .filter(([, n]) => n === null || n > migration)
        .map(([c, n]) =>
          n === null
            ? `camada ${migration}: ${c} não existe`
            : `camada ${migration}: ${c} é da ${n}`
        )
    );

    expect(
      problemas,
      'O recuo desce de camada quando uma coluna não existe. Uma camada ' +
        'que cite coluna mais nova do que ela morre igual à de cima — foi ' +
        'assim que `fingerprint` (074) na camada de baixo impediu todo ' +
        'orçamento de ser gerado.'
    ).toEqual([]);
  });

  it('descem em ordem, e cada uma tira só o que a seguinte acrescentou', () => {
    for (let i = 1; i < camadas.length; i++) {
      const nova = camadas[i - 1];
      const velha = camadas[i];
      expect(velha.migration).toBeLessThan(nova.migration);

      const tiradas = Object.keys(nova.row)
        .filter((c) => !(c in velha.row))
        .sort();
      const deviamSair = Object.keys(nova.row)
        .filter((c) => (criadaEm('deal_quotes', c) ?? 0) > velha.migration)
        .sort();

      // Tirar a mais é perder em silêncio um campo que o banco guardaria.
      expect(tiradas, `da ${nova.migration} para a ${velha.migration}`).toEqual(
        deviamSair
      );
    }
  });
});
