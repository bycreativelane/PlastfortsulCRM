import { describe, expect, it } from 'vitest';

import { PLASTFORTSUL_TEMPLATES } from '@/lib/whatsapp/plastfortsul-templates';
import {
  AUTOMATION_TEMPLATES,
  FUNNEL,
  TEMPLATE_SLUGS,
  localizeTemplate,
  normalizeName,
  resolveTemplateReferences,
  templateNeedsLookup,
  type TemplateLookup,
} from './templates';

const funnel = TEMPLATE_SLUGS.filter(
  (s) => AUTOMATION_TEMPLATES[s].group === 'funnel'
);

/** A translator that answers with the key — the words are not under test. */
const t = (key: string) => key;

describe('the funnel templates', () => {
  it('are the ten automations of the official flow', () => {
    expect(funnel).toHaveLength(10);
  });

  it('only send Meta templates that exist in the PlastfortSul set', () => {
    const known = new Set(PLASTFORTSUL_TEMPLATES.map((x) => x.name));
    for (const slug of funnel) {
      for (const step of AUTOMATION_TEMPLATES[slug].steps) {
        if (step.step_type !== 'send_template') continue;
        const name = (step.step_config as { template_name: string })
          .template_name;
        expect(known.has(name), `${slug} sends ${name}`).toBe(true);
      }
    }
  });

  it('fill every template variable the Meta template declares', () => {
    for (const slug of funnel) {
      for (const step of AUTOMATION_TEMPLATES[slug].steps) {
        if (step.step_type !== 'send_template') continue;
        const cfg = step.step_config as {
          template_name: string;
          variables?: Record<string, string>;
        };
        const meta = PLASTFORTSUL_TEMPLATES.find(
          (x) => x.name === cfg.template_name
        )!;
        const declared = new Set(
          (meta.body_text.match(/\{\{(\d+)\}\}/g) ?? []).map((m) =>
            m.replace(/[{}]/g, '')
          )
        );
        expect(
          Object.keys(cfg.variables ?? {}).sort(),
          `${slug}/${cfg.template_name}`
        ).toEqual([...declared].sort());
      }
    }
  });

  it('never send plain text a day after a wait — the 24-hour window', () => {
    for (const slug of funnel) {
      expect(
        AUTOMATION_TEMPLATES[slug].steps.some(
          (s) => s.step_type === 'send_message'
        ),
        slug
      ).toBe(false);
    }
  });

  it('all need the account to resolve something; the generic ones do not', () => {
    for (const slug of funnel) {
      if (slug === 'funnel_birthday') continue;
      expect(templateNeedsLookup(AUTOMATION_TEMPLATES[slug]), slug).toBe(true);
    }
    expect(templateNeedsLookup(AUTOMATION_TEMPLATES.welcome_message)).toBe(
      false
    );
  });
});

const LOOKUP: TemplateLookup = {
  pipelines: [
    { id: 'p-ops', name: 'Operacional' },
    { id: 'p-sales', name: 'Vendas' },
  ],
  stages: [
    // The same name in two funnels — resolution must prefer the declared one.
    { id: 's-ops-andamento', name: 'Em andamento', pipeline_id: 'p-ops' },
    { id: 's-open', name: 'Em Aberto', pipeline_id: 'p-sales' },
    { id: 's-followup', name: 'Follow-up', pipeline_id: 'p-sales' },
    { id: 's-neg', name: 'Em negociacao', pipeline_id: 'p-sales' },
    { id: 's-prog', name: 'Em Andamento', pipeline_id: 'p-sales' },
    { id: 's-served', name: 'Atendido', pipeline_id: 'p-sales' },
    { id: 's-after', name: 'Pós-venda', pipeline_id: 'p-sales' },
    { id: 's-future', name: 'Compra Futura', pipeline_id: 'p-sales' },
    // The pre-flow seed's names, to prove the aliases.
    { id: 's-f30', name: 'Geladeira 30 dias', pipeline_id: 'p-sales' },
    { id: 's-f60', name: 'Geladeira 60 dias', pipeline_id: 'p-sales' },
    { id: 's-lost', name: 'Perdido', pipeline_id: 'p-sales' },
  ],
  tags: [
    { id: 't-lead', name: 'Lead' },
    { id: 't-cli', name: 'Cliente' },
  ],
  quickReplies: [
    { id: 'q-open', shortcut: 'aberto', title: 'Orçamento enviado' },
    { id: 'q-prog', shortcut: 'andamento', title: 'Pedido em andamento' },
  ],
};

describe('resolveTemplateReferences', () => {
  it('turns names into this account ids — accents, case and aliases included', () => {
    const r = resolveTemplateReferences(
      localizeTemplate(AUTOMATION_TEMPLATES.funnel_followup, t),
      LOOKUP
    );
    expect(r.unresolved).toEqual([]);
    expect(r.trigger_config).toEqual({
      stage_id: 's-followup',
      pipeline_id: 'p-sales',
    });
    const move = r.steps.at(-1)!;
    expect(move.step_config).toEqual({ stage_id: 's-f30' });
    expect(r.rules).toEqual({
      pipeline_id: 'p-sales',
      cancel_on_reply: true,
      cancel_when_stage_in: [
        's-neg',
        's-prog',
        's-served',
        's-lost',
        's-future',
      ],
      reentry_policy: 'after_complete',
      reentry_days: null,
    });
  });

  it('prefers the declared funnel when two funnels share a stage name', () => {
    const r = resolveTemplateReferences(
      localizeTemplate(AUTOMATION_TEMPLATES.funnel_in_progress, t),
      LOOKUP
    );
    expect(r.unresolved).toEqual([]);
    expect(r.trigger_config.quick_reply_id).toBe('q-prog');
    expect(r.steps[0].step_config).toEqual({ stage_id: 's-prog' });
    expect(r.steps[1].step_config).toEqual({ tag_id: 't-lead' });
    expect(r.steps[2].step_config).toEqual({ tag_id: 't-cli' });
  });

  it('fills a stage list for the deal_in_stage condition', () => {
    const r = resolveTemplateReferences(
      localizeTemplate(AUTOMATION_TEMPLATES.funnel_customer_replied, t),
      LOOKUP
    );
    expect(r.steps[0].step_config).toEqual({
      subject: 'deal_in_stage',
      stage_ids: ['s-followup', 's-f30', 's-f60', 's-future'],
    });
  });

  it('leaves what it cannot find empty and says so, once per name', () => {
    const bare: TemplateLookup = {
      pipelines: [],
      stages: [],
      tags: [],
      quickReplies: [],
    };
    const r = resolveTemplateReferences(
      localizeTemplate(AUTOMATION_TEMPLATES.funnel_quote_sent, t),
      bare
    );
    expect(r.trigger_config.quick_reply_id).toBe('');
    expect(r.steps[0].step_config).toEqual({ stage_id: '' });
    expect(r.rules.pipeline_id).toBeNull();
    expect(r.unresolved).toEqual([FUNNEL.pipeline, '/aberto', FUNNEL.open]);
  });

  it('does not touch the shared definition', () => {
    const before = JSON.stringify(AUTOMATION_TEMPLATES.funnel_after_sale);
    resolveTemplateReferences(
      localizeTemplate(AUTOMATION_TEMPLATES.funnel_after_sale, t),
      LOOKUP
    );
    expect(JSON.stringify(AUTOMATION_TEMPLATES.funnel_after_sale)).toBe(before);
  });
});

describe('normalizeName', () => {
  it('ignores case, accents and stray spaces', () => {
    expect(normalizeName('  Em  Negociação ')).toBe('em negociacao');
    expect(normalizeName('PÓS-VENDA')).toBe('pos-venda');
  });
});
