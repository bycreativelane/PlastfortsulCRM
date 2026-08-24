/**
 * The twelve PlastfortSul message templates, ready to submit.
 *
 * The set and the slugs come from the prototype
 * (`plastfortsul-crm/prototipo/assets/js/data.js`), not from `escopo.md`,
 * which estimates a different mix. Bodies are the prototype's, adapted only
 * where the prototype was internally inconsistent or where Meta had already
 * refused the copy — both noted per template below.
 *
 * Everything here is typed as `TemplatePayload` and exercised by
 * `plastfortsul-templates.test.ts`, which runs the real
 * `validateTemplatePayload` over all twelve. A template that would be
 * rejected at save time fails the suite instead.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Opt-out: marketing templates carry a "Não quero receber" quick reply
 * and/or a footer ("responda SAIR"). The inbound webhook honours both via
 * `isOptOutIntent` and writes `contacts.opted_out`. Broadcasts already
 * filter on that column. Submit for approval is safe; send is safe only
 * with that handler in place (which it now is).
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { TemplatePayload } from './template-validators';

/** Footer used on the marketing sends. 50 chars — the cap is 60. */
const OPT_OUT_FOOTER = 'PlastfortSul · responda SAIR para parar de receber';

export const PLASTFORTSUL_TEMPLATES: TemplatePayload[] = [
  // ── Follow-up de orçamento ──────────────────────────────────────────
  {
    // The prototype declares vars:2 but its body only uses {{1}}. Resolved
    // toward the declared count by naming the quote, which also matches
    // followup_d3 — the two run as a pair and reading them back to back
    // with different shapes is how an operator picks the wrong one.
    name: 'followup_d1',
    category: 'Marketing',
    language: 'pt_BR',
    body_text:
      'Olá {{1}}! Passando para saber se conseguiu dar uma olhada no orçamento de {{2}} que enviamos. Fico à disposição para ajustar quantidade ou prazo.',
    footer_text: OPT_OUT_FOOTER,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Tenho interesse' },
      { type: 'QUICK_REPLY', text: 'Falar com vendedor' },
    ],
    sample_values: { body: ['Marcos', 'sacos de lixo 100L'] },
  },
  {
    name: 'followup_d3',
    category: 'Marketing',
    language: 'pt_BR',
    body_text:
      '{{1}}, tudo bem? Sobre o orçamento de {{2}} — consigo revisar condição de pagamento ou prazo de entrega se ajudar na decisão.',
    footer_text: OPT_OUT_FOOTER,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Quero revisar valores' },
      { type: 'QUICK_REPLY', text: 'Falar com vendedor' },
    ],
    sample_values: { body: ['Marcos', 'sacos de lixo 100L'] },
  },
  {
    name: 'followup_d15',
    category: 'Marketing',
    language: 'pt_BR',
    body_text:
      '{{1}}, faz um tempo que enviamos seu orçamento. A proposta ainda está válida — quer que eu atualize os valores?',
    footer_text: OPT_OUT_FOOTER,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Sim, atualizar' },
      { type: 'QUICK_REPLY', text: 'Não quero receber' },
    ],
    sample_values: { body: ['Marcos'] },
  },
  {
    name: 'followup_d30',
    category: 'Marketing',
    language: 'pt_BR',
    // "condições novas" reads as an offer, so the opening states the reason
    // for contact — an orçamento the customer themselves asked for. That
    // prior request is the opt-in basis, and saying so is what keeps this
    // out of the same bucket as reativacao_60d.
    body_text:
      '{{1}}, sobre o orçamento que você pediu à PlastfortSul: as condições deste mês mudaram. Posso te enviar uma proposta atualizada?',
    footer_text: OPT_OUT_FOOTER,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Pode enviar' },
      { type: 'QUICK_REPLY', text: 'Não quero receber' },
    ],
    sample_values: { body: ['Marcos'] },
  },

  // ── Transacionais ───────────────────────────────────────────────────
  {
    // Same vars:2-vs-one-{{1}} mismatch as followup_d1. Naming the quote
    // matters more here: this is UTILITY, and Meta reads a transactional
    // template against the transaction it claims to be about.
    name: 'orcamento_enviado',
    category: 'Utility',
    language: 'pt_BR',
    body_text:
      '{{1}}, segue o orçamento {{2}} conforme solicitado. Qualquer dúvida, estou à disposição por aqui.',
    // No opt-out footer: UTILITY is a reply to something the customer did,
    // and offering to stop transactional messages about their own order is
    // both confusing and not what opt-out means.
    buttons: [{ type: 'QUICK_REPLY', text: 'Tenho uma dúvida' }],
    sample_values: { body: ['Marcos', 'nº 4172'] },
  },
  {
    name: 'pedido_confirmado',
    category: 'Utility',
    language: 'pt_BR',
    body_text:
      '{{1}}, pedido confirmado! Previsão de entrega: {{2}}. Obrigado pela confiança na PlastfortSul.',
    sample_values: { body: ['Marcos', '28/08'] },
  },
  {
    name: 'posvenda_d10',
    category: 'Utility',
    language: 'pt_BR',
    body_text:
      '{{1}}, o material chegou certinho? Qualquer coisa é só me chamar por aqui.',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Chegou tudo certo' },
      { type: 'QUICK_REPLY', text: 'Tive um problema' },
    ],
    sample_values: { body: ['Marcos'] },
  },

  // ── Recompra e relacionamento ───────────────────────────────────────
  {
    name: 'compra_futura',
    category: 'Marketing',
    language: 'pt_BR',
    // "Conforme combinamos" is doing real work for approval: it states the
    // customer agreed to this contact. Keep it in any rewrite.
    body_text:
      'Olá {{1}}! Conforme combinamos, estou retomando o contato. Quer que eu prepare o pedido nas mesmas condições?',
    footer_text: OPT_OUT_FOOTER,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Sim, pode preparar' },
      { type: 'QUICK_REPLY', text: 'Ainda não' },
    ],
    sample_values: { body: ['Marcos'] },
  },
  {
    name: 'recompra_60d',
    category: 'Marketing',
    language: 'pt_BR',
    body_text:
      '{{1}}, tudo bem? Já faz cerca de {{2}} dias desde sua última compra na PlastfortSul. Quer que eu separe a reposição?',
    footer_text: OPT_OUT_FOOTER,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Quero repor' },
      { type: 'QUICK_REPLY', text: 'Não quero receber' },
    ],
    sample_values: { body: ['Marcos', '60'] },
  },
  {
    name: 'posvenda_avaliacao',
    category: 'Marketing',
    language: 'pt_BR',
    body_text:
      '{{1}}, se puder avaliar seu atendimento com a PlastfortSul em 1 minuto, ajuda muito!',
    footer_text: OPT_OUT_FOOTER,
    // A URL button pointing at the review form is the better shape here and
    // should replace this one — it needs a real link, which we don't have.
    buttons: [
      { type: 'QUICK_REPLY', text: 'Avaliar agora' },
      { type: 'QUICK_REPLY', text: 'Agora não' },
    ],
    sample_values: { body: ['Marcos'] },
  },
  {
    name: 'aniversario_cliente',
    category: 'Marketing',
    language: 'pt_BR',
    body_text:
      'Feliz aniversário, {{1}}! 🎉 A PlastfortSul deseja um ótimo dia. Conte com a gente!',
    footer_text: OPT_OUT_FOOTER,
    sample_values: { body: ['Marcos'] },
  },
  {
    // REWRITTEN. Meta refused the prototype's copy — "Conteúdo promocional
    // sem opt-in claro" — for:
    //   "{{1}}, sentimos sua falta! Volte a comprar com desconto exclusivo de 15%."
    //
    // Three things were wrong and all three are fixed here:
    //   1. It led with an unsolicited discount, which is the definition of
    //      promotional content. The offer is gone; nothing is discounted.
    //   2. It never said who was writing or why they were allowed to. Now it
    //      names PlastfortSul and cites the prior purchase — that purchase is
    //      the opt-in basis, and stating it is what Meta looks for.
    //   3. It gave no way out. Now there is a button and a footer.
    //
    // Do not reintroduce a percentage here. If a discount is ever needed it
    // belongs in the reply, inside the 24-hour window the customer opened.
    name: 'reativacao_60d',
    category: 'Marketing',
    language: 'pt_BR',
    body_text:
      '{{1}}, aqui é a PlastfortSul. Você já comprou com a gente e faz um tempo que não conversamos. Se precisar repor algum item, posso passar as condições atuais.',
    footer_text: OPT_OUT_FOOTER,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Quero ver condições' },
      { type: 'QUICK_REPLY', text: 'Não quero receber' },
    ],
    sample_values: { body: ['Marcos'] },
  },
];

/** The rejected copy, kept so the test can assert we never ship it again. */
export const REJECTED_REATIVACAO_BODY =
  '{{1}}, sentimos sua falta! Volte a comprar com desconto exclusivo de 15%.';
