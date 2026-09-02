import { describe, expect, it } from 'vitest';
import {
  PLASTFORTSUL_TEMPLATES,
  REJECTED_REATIVACAO_BODY,
} from './plastfortsul-templates';
import {
  TEMPLATE_LIMITS,
  extractVariableIndices,
  validateTemplatePayload,
} from './template-validators';

/** Name → variable count, exactly as the prototype declares it. */
const DECLARED: Record<string, number> = {
  followup_d1: 2,
  followup_d3: 2,
  // `followup_d15` and `posvenda_d10` until the official flow (D1, D3, D10,
  // D30; pós-venda on day 20) renamed them — see the template file.
  followup_d10: 1,
  followup_d30: 1,
  orcamento_enviado: 2,
  pedido_confirmado: 2,
  compra_futura: 1,
  recompra_60d: 2,
  posvenda_d20: 1,
  posvenda_avaliacao: 1,
  aniversario_cliente: 1,
  reativacao_60d: 1,
};

const byName = (n: string) => {
  const t = PLASTFORTSUL_TEMPLATES.find((x) => x.name === n);
  if (!t) throw new Error(`missing template ${n}`);
  return t;
};

describe('the twelve PlastfortSul templates', () => {
  it("is exactly the prototype's set — no additions, no omissions", () => {
    expect(PLASTFORTSUL_TEMPLATES.map((t) => t.name).sort()).toEqual(
      Object.keys(DECLARED).sort()
    );
  });

  it.each(PLASTFORTSUL_TEMPLATES.map((t) => [t.name, t] as const))(
    '%s passes the real validator',
    (_name, template) => {
      // The same function the submit route runs before touching Meta. If a
      // template would 400 at save time, it fails here instead.
      expect(() => validateTemplatePayload(template)).not.toThrow();
    }
  );

  it.each(Object.entries(DECLARED))(
    '%s carries the %i variable(s) the prototype declares',
    (name, count) => {
      // The prototype's metadata and its own bodies disagree for followup_d1
      // and orcamento_enviado — it says vars:2 while the body uses only
      // {{1}}. We resolved toward the declared count, so this asserts the
      // resolution held rather than silently drifting back.
      expect(extractVariableIndices(byName(name).body_text)).toHaveLength(
        count
      );
    }
  );

  it('keeps every category as the prototype assigns it', () => {
    const utility = ['orcamento_enviado', 'pedido_confirmado', 'posvenda_d20'];
    for (const t of PLASTFORTSUL_TEMPLATES) {
      expect(t.category, t.name).toBe(
        utility.includes(t.name) ? 'Utility' : 'Marketing'
      );
      expect(t.language, t.name).toBe('pt_BR');
    }
  });
});

describe('reativacao_60d, which Meta already rejected once', () => {
  const t = byName('reativacao_60d');

  it('does not ship the copy that was refused', () => {
    expect(t.body_text).not.toBe(REJECTED_REATIVACAO_BODY);
  });

  it('offers no discount', () => {
    // The rejection was "conteúdo promocional sem opt-in claro". A percentage
    // is the fastest way back into that bucket.
    expect(t.body_text).not.toMatch(/\d+\s*%|desconto|promo|oferta/i);
  });

  it('names the sender and cites the prior purchase as the opt-in basis', () => {
    expect(t.body_text).toMatch(/PlastfortSul/);
    expect(t.body_text).toMatch(/já comprou/i);
  });

  it('gives an explicit way out', () => {
    expect(t.buttons?.some((b) => /não quero receber/i.test(b.text))).toBe(
      true
    );
  });
});

describe('opt-out affordances', () => {
  // Marketing sends go to people who did not ask for this particular message.
  // Every one of them must offer a way to stop.
  const marketing = PLASTFORTSUL_TEMPLATES.filter(
    (t) => t.category === 'Marketing'
  );

  it.each(marketing.map((t) => [t.name, t] as const))(
    '%s tells the customer how to stop',
    (_name, t) => {
      const inFooter = /SAIR/.test(t.footer_text ?? '');
      const inButton = !!t.buttons?.some((b) =>
        /não quero receber/i.test(b.text)
      );
      expect(inFooter || inButton).toBe(true);
    }
  );

  it('does not offer to stop transactional messages', () => {
    // Opting out of updates about your own order is not opt-out, it is a
    // broken order. UTILITY templates must not carry the footer.
    for (const t of PLASTFORTSUL_TEMPLATES.filter(
      (x) => x.category === 'Utility'
    )) {
      expect(t.footer_text, t.name).toBeUndefined();
    }
  });

  it("keeps the footer inside Meta's cap", () => {
    for (const t of PLASTFORTSUL_TEMPLATES) {
      if (t.footer_text) {
        expect(t.footer_text.length, t.name).toBeLessThanOrEqual(
          TEMPLATE_LIMITS.footerMaxLength
        );
      }
    }
  });
});
