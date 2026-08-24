import { describe, expect, it } from 'vitest';
import type { Conversation, Tag } from '@/types';
import {
  OCCURRENCE_TAG_NAME,
  SCOPES,
  buildFilterOptions,
  isVisible,
  groupOptions,
  hasOccurrence,
  matchesSearch,
  typeTagOf,
  withCounts,
} from './conversation-filters';

const LABELS = {
  groupOwner: 'Responsável',
  groupState: 'Situação',
  groupType: 'Tipo de contato',
  groupPipeline: 'Funil',
  groupStage: 'Etapa',
  mine: 'Meus atendimentos',
  unassigned: 'Sem responsável',
  unread: 'Não lidas',
  withAutomation: 'Com automação',
  withOccurrence: 'Com ocorrência',
  closed: 'Encerradas',
  hidden: 'Ocultas',
  typeLead: 'Lead',
  typeCustomer: 'Cliente',
  typeInternal: 'Funcionário e parceiros',
  typeNone: 'Sem classificação',
};

const PIPELINES = [
  { id: 'p1', name: 'Vendas' },
  { id: 'p2', name: 'Operacional' },
];

const tag = (id: string, name: string): Tag =>
  ({ id, name, color: '#3a6dd0' }) as unknown as Tag;

const TAG_CLIENTE = tag('t1', 'Cliente');
const TAG_LEAD = tag('t2', 'Lead');
const TAG_FORNECEDOR = tag('t3', 'Fornecedor');
const TAG_PRODUTO = tag('t4', 'Saco de lixo');
const TAG_OCORRENCIA = tag('t5', OCCURRENCE_TAG_NAME);

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    user_id: 'u1',
    contact_id: 'ct1',
    status: 'open',
    unread_count: 0,
    created_at: '',
    updated_at: '',
    ...over,
  } as Conversation;
}

describe('SCOPES', () => {
  // These used to split on `assigned_agent_id`, so the tab called Esperando
  // meant "nobody claimed this" while the thread header's Esperando wrote
  // `status: 'pending'`. One word, two meanings, no connection between them
  // — and three of the August bug reports were that gap. The scope is the
  // conversation's STATE now; ownership is a filter.
  it('splits on the state of the conversation, not on who owns it', () => {
    const live = conv({ status: 'open', assigned_agent_id: undefined });
    const parked = conv({ status: 'pending', assigned_agent_id: 'u1' });

    expect(SCOPES.entrada(live)).toBe(true);
    expect(SCOPES.esperando(parked)).toBe(true);

    // An owned thread is still Entrada, and an unowned one is not Esperando.
    expect(SCOPES.esperando(live)).toBe(false);
    expect(SCOPES.entrada(parked)).toBe(false);
  });

  it('never shows one conversation in both tabs', () => {
    for (const c of [
      conv({ status: 'open' }),
      conv({ status: 'pending' }),
      conv({ status: 'open', assigned_agent_id: 'u1' }),
    ]) {
      const scopes = [SCOPES.entrada(c), SCOPES.esperando(c)].filter(Boolean);
      expect(scopes).toHaveLength(1);
    }
  });

  it('leaves a finished conversation out of both tabs', () => {
    // TWO TABS, not three. A finished conversation is by definition not
    // "what needs me now", so it is reachable through the Encerradas filter
    // instead of owning a third of the bar forever.
    const done = conv({ status: 'closed' });
    expect(SCOPES.entrada(done)).toBe(false);
    expect(SCOPES.esperando(done)).toBe(false);
  });
});

describe('isVisible', () => {
  it('keeps a hidden conversation out of every tab', () => {
    expect(isVisible(conv())).toBe(true);
    expect(isVisible(conv({ hidden_at: '2026-08-24T10:00:00Z' }))).toBe(false);
  });
});

describe('hasOccurrence', () => {
  it('reads the trigger-maintained counter', () => {
    // The tag it used to read was never written by anything — registering an
    // occurrence produced no triangle at all. `occurrence_count` comes from
    // migration 042's trigger, so it cannot drift.
    expect(
      hasOccurrence(conv({ contact: { occurrence_count: 2 } as never }))
    ).toBe(true);
    expect(
      hasOccurrence(conv({ contact: { occurrence_count: 0 } as never }))
    ).toBe(false);
  });

  it('still honours the legacy tag for accounts that applied it by hand', () => {
    expect(
      hasOccurrence(conv({ contact: { tags: [TAG_OCORRENCIA] } as never }))
    ).toBe(true);
  });
});

describe('typeTagOf', () => {
  it('picks the contact TYPE and ignores product and automatic tags', () => {
    const c = conv({
      contact: { tags: [TAG_PRODUTO, TAG_OCORRENCIA, TAG_CLIENTE] } as never,
    });
    expect(typeTagOf(c)?.name).toBe('Cliente');
  });

  it('is null when the contact carries no type tag', () => {
    expect(
      typeTagOf(conv({ contact: { tags: [TAG_PRODUTO] } as never }))
    ).toBeNull();
    expect(typeTagOf(conv({ contact: undefined }))).toBeNull();
  });

  it('matches the name however it was cased or padded', () => {
    // Tag names are typed by an operator in Settings, and the vocabulary is
    // matched by name because ids are per account.
    const c = conv({ contact: { tags: [tag('x', '  cliente ')] } as never });
    expect(typeTagOf(c)?.name).toBe('  cliente ');
  });
});

describe('hasOccurrence', () => {
  it('reads the one automatic tag section 16 allows', () => {
    expect(
      hasOccurrence(conv({ contact: { tags: [TAG_OCORRENCIA] } as never }))
    ).toBe(true);
    expect(
      hasOccurrence(conv({ contact: { tags: [TAG_CLIENTE] } as never }))
    ).toBe(false);
  });
});

describe('buildFilterOptions', () => {
  it('offers four fixed contact-type buckets, whatever the tag table holds', () => {
    // The point of the change: this used to emit one row per tag, so the
    // menu grew every time somebody added one in Settings.
    const options = buildFilterOptions(
      [
        conv({ contact: { tags: [TAG_CLIENTE, TAG_PRODUTO] } as never }),
        conv({ contact: { tags: [TAG_LEAD] } as never }),
      ],
      PIPELINES,
      null,
      LABELS
    );
    expect(
      options.filter((o) => o.id.startsWith('type:')).map((o) => o.id)
    ).toEqual(['type:lead', 'type:customer', 'type:internal', 'type:none']);
  });

  it('folds every minor type into one bucket and flags the unclassified', () => {
    const options = buildFilterOptions([], PIPELINES, null, LABELS);
    const internal = options.find((o) => o.id === 'type:internal')!;
    const none = options.find((o) => o.id === 'type:none')!;
    const customer = options.find((o) => o.id === 'type:customer')!;

    const supplier = conv({ contact: { tags: [TAG_FORNECEDOR] } as never });
    const customerConv = conv({ contact: { tags: [TAG_CLIENTE] } as never });
    const unclassified = conv({ contact: { tags: [TAG_PRODUTO] } as never });

    expect(internal.match(supplier)).toBe(true);
    expect(internal.match(customerConv)).toBe(false);
    expect(customer.match(customerConv)).toBe(true);
    expect(none.match(unclassified)).toBe(true);
    expect(none.match(customerConv)).toBe(false);
  });

  it('never offers a company', () => {
    // A company is a search term, not an axis: `matchesSearch` covers it,
    // and as a filter group it was one row per conversation in the list.
    const options = buildFilterOptions(
      [conv({ contact: { company: 'Acme' } as never })],
      PIPELINES,
      null,
      LABELS
    );
    expect(options.some((o) => o.id.startsWith('company:'))).toBe(false);
    expect(options.some((o) => o.label === 'Acme')).toBe(false);
  });

  it('offers one row per funnel, not per contact', () => {
    const options = buildFilterOptions([], PIPELINES, null, LABELS);
    const pipelines = options.filter((o) => o.id.startsWith('pipeline:'));
    expect(pipelines.map((o) => o.label)).toEqual(['Vendas', 'Operacional']);
    expect(
      pipelines[0].match(conv({ deal: { pipeline_id: 'p1' } as never }))
    ).toBe(true);
    expect(
      pipelines[0].match(conv({ deal: { pipeline_id: 'p2' } as never }))
    ).toBe(false);
  });

  it('offers each stage once, however many conversations sit in it', () => {
    const stage = { id: 's1', name: 'Em Negociação', color: '#0d9dbb' };
    const options = buildFilterOptions(
      [
        conv({ id: 'a', deal: { stage } as never }),
        conv({ id: 'b', deal: { stage } as never }),
        conv({ id: 'c', deal: undefined }),
      ],
      PIPELINES,
      null,
      LABELS
    );
    const stages = options.filter((o) => o.id.startsWith('stage:'));
    expect(stages).toHaveLength(1);
    expect(stages[0].label).toBe('Em Negociação');
  });

  it('offers the occurrence flag under SITUAÇÃO, not under the type group', () => {
    const options = buildFilterOptions([], PIPELINES, null, LABELS);
    const occurrence = options.find((o) => o.id === 'occurrence')!;
    expect(occurrence.group).toBe(LABELS.groupState);
    expect(
      occurrence.match(conv({ contact: { tags: [TAG_OCORRENCIA] } as never }))
    ).toBe(true);
  });

  it('omits the owner filter when nobody is signed in', () => {
    const options = buildFilterOptions([], PIPELINES, null, LABELS);
    expect(options.some((o) => o.id === 'mine')).toBe(false);
  });

  it("matches 'mine' against the signed-in user", () => {
    const options = buildFilterOptions([], PIPELINES, 'u9', LABELS);
    const mine = options.find((o) => o.id === 'mine')!;
    expect(mine.match(conv({ assigned_agent_id: 'u9' }))).toBe(true);
    expect(mine.match(conv({ assigned_agent_id: 'u1' }))).toBe(false);
  });

  it('treats a paused bot as not automated', () => {
    const options = buildFilterOptions([], PIPELINES, null, LABELS);
    const ai = options.find((o) => o.id === 'ai')!;
    expect(ai.match(conv({ ai_reply_count: 3 }))).toBe(true);
    // A human took over — the thread is no longer the machine's.
    expect(
      ai.match(conv({ ai_reply_count: 3, ai_autoreply_disabled: true }))
    ).toBe(false);
    expect(ai.match(conv({ ai_reply_count: 0 }))).toBe(false);
  });

  it('stays bounded as the contact base grows', () => {
    // The regression this whole change exists to prevent. Twenty
    // conversations, twenty companies, twenty tags: the menu must not grow
    // with them.
    const many = Array.from({ length: 20 }, (_, i) =>
      conv({
        id: `c${i}`,
        contact: {
          company: `Empresa ${i}`,
          tags: [tag(`tag${i}`, `Etiqueta ${i}`)],
        } as never,
      })
    );
    const few = buildFilterOptions([], PIPELINES, 'u9', LABELS);
    const lots = buildFilterOptions(many, PIPELINES, 'u9', LABELS);
    expect(lots).toHaveLength(few.length);
  });
});

describe('withCounts', () => {
  it('counts inside the given scope, not across the inbox', () => {
    // This is the whole contract: the number beside an option must equal the
    // number of rows the click produces.
    const inScope = [
      conv({ id: 'a', unread_count: 2, assigned_agent_id: 'u1' }),
      conv({ id: 'b', unread_count: 0, assigned_agent_id: 'u1' }),
    ];
    const outOfScope = [conv({ id: 'c', unread_count: 9 })];

    const options = buildFilterOptions(
      [...inScope, ...outOfScope],
      PIPELINES,
      null,
      LABELS
    );
    const unread = withCounts(options, inScope).find((o) => o.id === 'unread')!;

    expect(unread.count).toBe(1);
  });

  it('reports zero rather than dropping the option', () => {
    const options = buildFilterOptions([], PIPELINES, null, LABELS);
    const counted = withCounts(options, []);
    expect(counted.every((o) => o.count === 0)).toBe(true);
    // Still present — the UI disables these, it does not hide them.
    expect(counted.length).toBeGreaterThan(0);
  });
});

describe('groupOptions', () => {
  it('keeps groups in the order they were built', () => {
    const stage = { id: 's1', name: 'Em Negociação', color: '#0d9dbb' };
    const options = buildFilterOptions(
      [
        conv({
          contact: { company: 'Acme', tags: [TAG_CLIENTE] } as never,
          deal: { pipeline_id: 'p1', stage } as never,
        }),
      ],
      PIPELINES,
      'u9',
      LABELS
    );
    expect(groupOptions(options).map(([g]) => g)).toEqual([
      'Responsável',
      'Situação',
      'Tipo de contato',
      'Funil',
      'Etapa',
    ]);
  });
});

describe('matchesSearch', () => {
  const c = conv({
    contact: {
      name: 'Ricardo Menezes',
      phone: '+5551998124471',
      company: 'Solar',
    } as never,
    last_message_text: 'Consegue melhorar o preço?',
  });

  it('matches name, phone, company and last message', () => {
    for (const q of ['ricardo', '99812', 'solar', 'preço']) {
      expect(matchesSearch(c, q), q).toBe(true);
    }
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(matchesSearch(c, '  RICARDO ')).toBe(true);
  });

  it('matches everything when the query is empty', () => {
    expect(matchesSearch(conv(), '   ')).toBe(true);
  });

  it('does not match an unrelated query', () => {
    expect(matchesSearch(c, 'juliana')).toBe(false);
  });
});
