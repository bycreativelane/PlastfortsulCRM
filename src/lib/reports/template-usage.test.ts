import { describe, it, expect } from 'vitest';

import {
  aggregateTemplateUsage,
  billingState,
  effectiveCategory,
} from './template-usage';
import type { Period } from '@/lib/dashboard/period';

/** Uma janela de dois dias locais, fixa, para as contagens serem estáveis. */
function twoDayPeriod(): Period {
  const from = new Date(2026, 7, 20); // 20/08/2026, 00:00 local
  const to = new Date(2026, 7, 22); // exclusivo
  return { from, to, preset: null, days: 2, key: 'test' };
}

/** Uma linha do log com defaults de "acabou de sair, sem resposta ainda". */
function row(
  patch: Partial<Parameters<typeof aggregateTemplateUsage>[0][0]> = {}
) {
  return {
    sent_at: new Date(2026, 7, 20, 10, 0).toISOString(),
    template_name: 'promo',
    declared_category: 'marketing',
    billable_category: null,
    billable: null,
    priced_at: null,
    last_status: 'sent',
    origin: 'broadcast',
    ...patch,
  };
}

describe('billingState', () => {
  it('separates "not charged" from "did not go out"', () => {
    // A distinção que a tela não pode perder: as duas somam zero na
    // fatura e significam coisas opostas na operação.
    expect(billingState({ billable: null, last_status: 'sent' })).toBe(
      'pending'
    );
    expect(billingState({ billable: null, last_status: 'failed' })).toBe(
      'failed'
    );
    expect(billingState({ billable: false, last_status: 'delivered' })).toBe(
      'free'
    );
    expect(billingState({ billable: true, last_status: 'sent' })).toBe(
      'billable'
    );
  });

  it("trusts Meta's word over the delivery status", () => {
    // Marcada como faturável no `sent` e nunca entregue: continua cobrada.
    expect(billingState({ billable: true, last_status: 'failed' })).toBe(
      'billable'
    );
  });
});

describe('effectiveCategory', () => {
  it('lets the billed category win over the one we filed', () => {
    expect(
      effectiveCategory({
        billable_category: 'utility',
        declared_category: 'marketing',
      })
    ).toBe('utility');
  });

  it('falls back to ours while Meta has not answered', () => {
    expect(
      effectiveCategory({
        billable_category: null,
        declared_category: 'marketing',
      })
    ).toBe('marketing');
  });

  it('says unknown rather than guessing', () => {
    expect(
      effectiveCategory({ billable_category: null, declared_category: null })
    ).toBe('unknown');
  });
});

describe('aggregateTemplateUsage', () => {
  it('counts each send once across every breakdown', () => {
    const summary = aggregateTemplateUsage(
      [
        row({ billable: true, billable_category: 'marketing' }),
        row({ billable: true, billable_category: 'marketing' }),
        row({ billable: false, billable_category: 'service', origin: 'inbox' }),
        row({ last_status: 'failed' }),
        row(),
      ],
      twoDayPeriod()
    );

    expect(summary.total).toBe(5);
    expect(summary.billable).toBe(2);
    expect(summary.free).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(1);
    // Os quatro estados particionam o total — nenhuma linha some nem
    // conta duas vezes.
    expect(
      summary.billable + summary.free + summary.failed + summary.pending
    ).toBe(summary.total);

    const byCategory = Object.fromEntries(
      summary.byCategory.map((c) => [c.category, c.total])
    );
    // marketing = 4: as duas cobradas, MAIS a que falhou e a que ainda
    // não teve resposta — as duas caem na categoria declarada, que é o
    // palpite certo enquanto a Meta não responde.
    expect(byCategory).toEqual({ marketing: 4, service: 1 });
    // E o balde de categoria carrega os estados, não só o total: é o
    // que permite dizer "utility: 400, sendo 380 cobradas".
    const marketing = summary.byCategory.find(
      (c) => c.category === 'marketing'
    )!;
    expect(marketing).toMatchObject({
      total: 4,
      billable: 2,
      pending: 1,
      failed: 1,
      free: 0,
    });
  });

  it('counts a send Meta recategorized', () => {
    // Arquivamos Marketing, a Meta cobrou Utility. É a única evidência
    // de recategorização que passa pelo produto.
    const summary = aggregateTemplateUsage(
      [
        row({
          declared_category: 'marketing',
          billable_category: 'utility',
          billable: true,
        }),
        row({
          declared_category: 'marketing',
          billable_category: 'marketing',
          billable: true,
        }),
      ],
      twoDayPeriod()
    );
    expect(summary.recategorized).toBe(1);
  });

  it('does not call a pending send a recategorization', () => {
    // Sem resposta da Meta não há divergência — há espera.
    const summary = aggregateTemplateUsage(
      [row({ declared_category: 'marketing', billable_category: null })],
      twoDayPeriod()
    );
    expect(summary.recategorized).toBe(0);
    expect(summary.pending).toBe(1);
  });

  it('keeps a category the product has never seen', () => {
    // Sem CHECK na coluna: um balde novo aparece com o nome que a Meta
    // deu, em vez de sumir do relatório.
    const summary = aggregateTemplateUsage(
      [row({ billable: true, billable_category: 'some_future_bucket' })],
      twoDayPeriod()
    );
    expect(summary.byCategory[0]).toMatchObject({
      category: 'some_future_bucket',
      total: 1,
      billable: 1,
    });
  });

  it('zero-fills the days in the window', () => {
    const summary = aggregateTemplateUsage(
      [
        row({
          billable: true,
          sent_at: new Date(2026, 7, 21, 9).toISOString(),
        }),
      ],
      twoDayPeriod()
    );
    expect(summary.daily.map((d) => d.day)).toEqual([
      '2026-08-20',
      '2026-08-21',
    ]);
    // Um dia sem disparo é informação; pular a data mentiria sobre o ritmo.
    expect(summary.daily[0]).toEqual({
      day: '2026-08-20',
      billable: 0,
      free: 0,
      pending: 0,
    });
    expect(summary.daily[1].billable).toBe(1);
  });

  it('leaves what never went out off the daily series', () => {
    // A série responde "quanto saiu por dia". O total de falhas continua
    // no cabeçalho.
    const summary = aggregateTemplateUsage(
      [row({ last_status: 'failed' })],
      twoDayPeriod()
    );
    expect(summary.failed).toBe(1);
    expect(
      summary.daily.every((d) => d.billable + d.free + d.pending === 0)
    ).toBe(true);
  });

  it('ranks templates by volume and labels each with its dominant category', () => {
    const summary = aggregateTemplateUsage(
      [
        row({
          template_name: 'promo',
          billable: true,
          billable_category: 'marketing',
        }),
        row({
          template_name: 'promo',
          billable: true,
          billable_category: 'marketing',
        }),
        row({
          template_name: 'promo',
          billable: true,
          billable_category: 'utility',
        }),
        row({
          template_name: 'aviso',
          billable: true,
          billable_category: 'utility',
        }),
      ],
      twoDayPeriod()
    );
    expect(summary.topTemplates.map((t) => t.name)).toEqual(['promo', 'aviso']);
    expect(summary.topTemplates[0]).toMatchObject({
      total: 3,
      billable: 3,
      category: 'marketing',
    });
  });

  it('breaks the total down by where the send came from', () => {
    const summary = aggregateTemplateUsage(
      [
        row({ origin: 'broadcast', billable: true }),
        row({ origin: 'broadcast', billable: true }),
        row({ origin: 'automation', billable: true }),
        row({ origin: 'inbox' }),
      ],
      twoDayPeriod()
    );
    expect(summary.byOrigin).toEqual([
      { origin: 'broadcast', total: 2, billable: 2 },
      { origin: 'automation', total: 1, billable: 1 },
      // Pendente conta no total da origem e não na coluna de faturável.
      { origin: 'inbox', total: 1, billable: 0 },
    ]);
  });

  it('returns an empty, zero-filled summary for a window with no sends', () => {
    const summary = aggregateTemplateUsage([], twoDayPeriod());
    expect(summary.total).toBe(0);
    expect(summary.byCategory).toEqual([]);
    expect(summary.topTemplates).toEqual([]);
    expect(summary.daily).toHaveLength(2);
  });
});
