import { describe, expect, it } from 'vitest';

import { PLASTFORTSUL_TEMPLATES } from '@/lib/whatsapp/plastfortsul-templates';
import {
  isApprovedTemplate,
  isRetiredTemplate,
} from '@/lib/whatsapp/approved-templates';
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
  it('are the eleven automations of the official flow', () => {
    // Onze desde 2026-09-07: a porta de entrada (`funnel_new_lead`)
    // faltava. As outras dez reagem a uma oportunidade que já existe, e
    // nenhuma criava a primeira — o funil começava numa coluna que só
    // enchia à mão.
    expect(funnel).toHaveLength(11);
  });

  it('has exactly one automation that opens the funnel', () => {
    const entradas = funnel.filter((slug) =>
      AUTOMATION_TEMPLATES[slug].steps.some(
        (s) => s.step_type === 'create_deal'
      )
    );
    expect(entradas).toEqual(['funnel_new_lead']);
  });

  it('the funnel entry is idempotent per conversation', () => {
    // Sem isto o gatilho abriria uma oportunidade por mensagem, que o
    // item 35 do pacote lista sob "não fazer".
    const step = AUTOMATION_TEMPLATES.funnel_new_lead.steps.find(
      (s) => s.step_type === 'create_deal'
    );
    expect(
      (step?.step_config as { once_per_conversation?: boolean })
        .once_per_conversation
    ).toBe(true);
  });

  it('only send templates approved on the account', () => {
    // A referência mudou em 2026-09-07: era o catálogo do protótipo
    // (`PLASTFORTSUL_TEMPLATES`), que descreve templates PROPOSTOS. Os que
    // existem na conta têm outros nomes, e as automações apontavam para os
    // propostos — o envio falhava em produção.
    for (const slug of funnel) {
      for (const step of AUTOMATION_TEMPLATES[slug].steps) {
        if (step.step_type !== 'send_template') continue;
        const name = (step.step_config as { template_name: string })
          .template_name;
        expect(isApprovedTemplate(name), `${slug} sends ${name}`).toBe(true);
      }
    }
  });

  it('never send a retired template', () => {
    // O item 35 do pacote lista os aposentados sob "não fazer". Estar fora
    // da lista de aprovados já bastaria para reprovar; esta asserção existe
    // para que a MENSAGEM do erro diga "aposentado" e não "desconhecido".
    for (const slug of funnel) {
      for (const step of AUTOMATION_TEMPLATES[slug].steps) {
        if (step.step_type !== 'send_template') continue;
        const name = (step.step_config as { template_name: string })
          .template_name;
        expect(isRetiredTemplate(name), `${slug} sends retired ${name}`).toBe(
          false
        );
      }
    }
  });

  it('fill every template variable the prototype catalogue declares', () => {
    // SÓ OS QUE O CATÁLOGO AINDA DESCREVE.
    //
    // Este teste comparava a configuração da automação com o corpo do
    // template no catálogo do protótipo. Depois de 2026-09-07 o catálogo
    // deixou de descrever os templates em uso — eles foram recriados na
    // Meta com outros nomes e, pelo menos alguns, sem a variável de nome, e
    // o pacote de correções lista os nomes sem transcrever os textos.
    //
    // Inventar um corpo aqui para manter a asserção seria trocar uma
    // referência velha por uma imaginada, que é pior porque parece verdade.
    // A verificação real dessas variáveis está em `buildBodyComponent`, que
    // conta o corpo VERDADEIRO vindo de `message_templates` e descarta
    // valor sobrando — foi essa a correção do erro #132000.
    //
    // Quando a sincronização com a Meta preencher `message_templates`, o
    // lugar certo desta asserção é contra aquela tabela, não contra um
    // arquivo do repositório.
    for (const slug of funnel) {
      for (const step of AUTOMATION_TEMPLATES[slug].steps) {
        if (step.step_type !== 'send_template') continue;
        const cfg = step.step_config as {
          template_name: string;
          variables?: Record<string, string>;
        };
        const meta = PLASTFORTSUL_TEMPLATES.find(
          (x) => x.name === cfg.template_name
        );
        if (!meta) continue;
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
    // Faltava aqui também, e é parte de por que a omissão passou: um
    // quadro de teste sem `Ligação` não tinha como acusar uma lista de
    // cancelamento sem `Ligação`.
    { id: 's-call', name: 'Ligação', pipeline_id: 'p-sales' },
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
        's-call',
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
    // Só `Cliente`: o passo que tirava a etiqueta `Lead` saiu na auditoria
    // de 8 de setembro. Itens 23 e 35 do pacote.
    expect(r.steps[1].step_config).toEqual({ tag_id: 't-cli' });
  });

  it('fills a stage list for the deal_in_stage condition', () => {
    const r = resolveTemplateReferences(
      localizeTemplate(AUTOMATION_TEMPLATES.funnel_customer_replied, t),
      LOOKUP
    );
    expect(r.steps[0].step_config).toEqual({
      subject: 'deal_in_stage',
      // `s-open` primeiro: item 21, e era a etapa que faltava.
      stage_ids: ['s-open', 's-followup', 's-f30', 's-f60', 's-future'],
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
    // Sem hífen desde a auditoria de 8 de setembro: o quadro real escreve
    // `Pós-venda` e este arquivo declara `Pós-venda`, mas o pacote também
    // escreve `Compra-futura` para uma etapa declarada `Compra Futura`.
    // Ver a suíte da auditoria abaixo.
    expect(normalizeName('PÓS-VENDA')).toBe('pos venda');
  });

  it('treats every dash as a space, on both sides', () => {
    expect(normalizeName('Compra-futura')).toBe(normalizeName('Compra Futura'));
    expect(normalizeName('Geladeira-30D')).toBe(normalizeName('Geladeira 30D'));
    // Travessão colado de uma planilha.
    expect(normalizeName('Follow—up')).toBe('follow up');
  });
});

/**
 * A AUDITORIA DO ITEM 6 DO P0, virada em guarda.
 *
 * `docs/spec-correcoes-2026-09.md` pedia "comparar as onze automações
 * instaladas contra as especificações item a item". Uma comparação feita a
 * olho vale uma tarde; estas asserções valem para sempre, e cada uma cita o
 * item do pacote (`docs/pacote-correcoes-v2.md`) que a exige.
 */
describe('a auditoria do pacote — itens 16 a 31', () => {
  /**
   * A lista que os itens 19, 20 e 22 repetem palavra por palavra. `Ligação`
   * era a que faltava, e `FUNNEL.call` não era referenciado em lugar nenhum
   * do arquivo — declarado e órfão.
   */
  const SEIS = [
    FUNNEL.negotiating,
    FUNNEL.call,
    FUNNEL.inProgress,
    FUNNEL.served,
    FUNNEL.futurePurchase,
    FUNNEL.lost,
  ];

  /** As que esperam dias e por isso podem ser canceladas no meio. */
  const LONGAS = [
    'funnel_open_24h',
    'funnel_followup',
    'funnel_fridge_30d',
    'funnel_future_purchase',
  ] as const;

  it.each(LONGAS)(
    '%s cancela nas seis etapas dos itens 19, 20, 22 e 24',
    (slug) => {
      const def = AUTOMATION_TEMPLATES[slug];
      const gatilho = def.triggerRefs?.stage;
      // Uma automação não pode se cancelar ao entrar na etapa que a
      // dispara: a Compra Futura carrega cinco das seis, sem a própria.
      const esperado = SEIS.filter((s) => s !== gatilho);
      expect(new Set(def.rules?.cancel_when_stage_in ?? [])).toEqual(
        new Set(esperado)
      );
    }
  );

  it.each(LONGAS)('%s também para quando o cliente responde', (slug) => {
    expect(AUTOMATION_TEMPLATES[slug].rules?.cancel_on_reply).toBe(true);
  });

  /**
   * Item 21. Cinco etapas em que a resposta move para Em Negociação, e sete
   * em que ela não pode mover. `Em aberto` é a primeira da lista e era a que
   * faltava — o vendedor manda o orçamento com `/aberto`, o cliente
   * responde, e nada acontecia.
   */
  it('cliente respondeu: as cinco etapas do item 21, e só elas', () => {
    const condicao = AUTOMATION_TEMPLATES.funnel_customer_replied.steps[0];
    expect(new Set(condicao.refs?.stages ?? [])).toEqual(
      new Set([
        FUNNEL.open,
        FUNNEL.followUp,
        FUNNEL.futurePurchase,
        FUNNEL.fridge30,
        FUNNEL.fridge60,
      ])
    );
  });

  it('cliente respondeu: nunca nas sete que o item 21 recusa', () => {
    const proibidas = [
      FUNNEL.newLead,
      FUNNEL.negotiating,
      FUNNEL.call,
      FUNNEL.inProgress,
      FUNNEL.served,
      FUNNEL.afterSale,
      FUNNEL.lost,
    ];
    const lista =
      AUTOMATION_TEMPLATES.funnel_customer_replied.steps[0].refs?.stages;
    for (const etapa of proibidas) expect(lista).not.toContain(etapa);
  });

  /**
   * Itens 23 e 35: a etiqueta `Lead` não entra nem sai por automação. A
   * etapa `Novo Lead` já representa o estado.
   *
   * Não é só doutrina. Nada neste produto CRIA uma etiqueta `Lead`, então
   * `findTag` devolvia `null`, o passo instalava com `tag_id: ''` e
   * `validate.ts` recusava a ativação — a automação da venda não subia numa
   * conta limpa.
   */
  it('nenhuma automação do funil toca na etiqueta Lead', () => {
    for (const slug of funnel) {
      for (const step of AUTOMATION_TEMPLATES[slug].steps) {
        expect(
          normalizeName(step.refs?.tag ?? ''),
          `${slug} mexe na etiqueta Lead`
        ).not.toBe('lead');
      }
    }
  });

  /** Um nome de etapa fora de `FUNNEL` é um erro de digitação que só
   *  aparece na instalação, como uma referência que não resolve. */
  it('toda etapa citada por um modelo do funil existe em FUNNEL', () => {
    const conhecidas = new Set<string>(Object.values(FUNNEL));
    for (const slug of funnel) {
      const def = AUTOMATION_TEMPLATES[slug];
      const citadas = [
        def.triggerRefs?.stage,
        ...(def.rules?.cancel_when_stage_in ?? []),
        ...def.steps.flatMap((s) => [s.refs?.stage, ...(s.refs?.stages ?? [])]),
      ].filter((s): s is string => Boolean(s));
      for (const etapa of citadas) {
        expect(conhecidas, `${slug} cita "${etapa}"`).toContain(etapa);
      }
    }
  });

  /**
   * O quadro real escreve os nomes com hífen — é assim que eles aparecem em
   * todas as 2138 linhas do pacote. Um nome que não resolve instala a
   * automação com `stage_id: ''`, e é o mesmo erro do item 3.
   */
  it('resolve o quadro escrito como o pacote escreve', () => {
    const lookup: TemplateLookup = {
      pipelines: [{ id: 'p1', name: 'VENDAS' }],
      stages: [
        { id: 's-cf', pipeline_id: 'p1', name: 'Compra-futura' },
        { id: 's-g30', pipeline_id: 'p1', name: 'Geladeira-30D' },
        { id: 's-g60', pipeline_id: 'p1', name: 'Geladeira-60D' },
        { id: 's-neg', pipeline_id: 'p1', name: 'Em negociação' },
        { id: 's-lig', pipeline_id: 'p1', name: 'Ligação' },
        { id: 's-and', pipeline_id: 'p1', name: 'Em andamento' },
        { id: 's-at', pipeline_id: 'p1', name: 'Atendido' },
        { id: 's-vp', pipeline_id: 'p1', name: 'Venda perdida' },
      ],
      tags: [],
      quickReplies: [],
    };
    const resolvido = resolveTemplateReferences(
      localizeTemplate(AUTOMATION_TEMPLATES.funnel_future_purchase, t),
      lookup
    );
    expect(resolvido.unresolved).toEqual([]);
    expect(resolvido.trigger_config.stage_id).toBe('s-cf');
    expect(new Set(resolvido.rules.cancel_when_stage_in)).toEqual(
      new Set(['s-neg', 's-lig', 's-and', 's-at', 's-vp'])
    );
  });
});
