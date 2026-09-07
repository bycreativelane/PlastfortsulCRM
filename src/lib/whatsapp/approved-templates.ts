/**
 * Os templates aprovados na Meta que o fluxo comercial usa hoje.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTA LISTA EXISTE, TENDO `plastfortsul-templates.ts`
 * ------------------------------------------------------------------
 *
 * Aquele arquivo é um conjunto de payloads **prontos para submeter**,
 * derivados do protótipo: nome, corpo, botões, rodapé. Ele descreve
 * templates como eles foram PROPOSTOS.
 *
 * Esta lista descreve os que EXISTEM. As duas divergiram: em 7 de setembro
 * de 2026 os testes reais mostraram que os templates em uso foram recriados
 * na Meta com outros nomes (`comprafutura` e não `compra_futura`,
 * `aniversario` e não `aniversario_cliente`, `posvenda20d` e não
 * `posvenda_d20`) e, pelo menos alguns deles, **sem a variável de nome**.
 *
 * Enquanto o catálogo do protótipo era a única referência, as automações do
 * fluxo oficial apontavam para nomes que não existem na conta — e o envio
 * falhava em produção com um erro que fala de contagem de parâmetros.
 *
 * ------------------------------------------------------------------
 * SÓ OS NOMES, E ISSO É DELIBERADO
 * ------------------------------------------------------------------
 *
 * Não há corpo nem contagem de variáveis aqui porque **não sabemos**: o
 * pacote de correções lista os nomes aprovados e não transcreve os textos.
 * Inventar um corpo para poder validar contra ele seria trocar uma
 * referência desatualizada por uma inventada, que é pior — a segunda parece
 * verdade.
 *
 * A fonte da verdade sobre variáveis é a tabela `message_templates`, que a
 * sincronização com a Meta preenche. `buildBodyComponent` conta as
 * variáveis do corpo REAL e descarta valor sobrando, então uma automação
 * configurada com mais variáveis do que o template tem não quebra mais.
 */

/**
 * Os onze nomes do fluxo atual, do item 7 do pacote de 7 de setembro.
 *
 * Uma automação do grupo `funnel` só pode mandar um destes.
 */
export const APPROVED_TEMPLATE_NAMES = [
  'followup_orcamento_d1',
  'followup_orcamento_d2',
  'followup_orcamento_d3',
  'followup_orcamento_d30',
  'reativacao30dgeladeira30d',
  'posvenda20d',
  'recompra_60d',
  'recompra_120d',
  'comprafutura',
  'aniversario',
  'atendido',
] as const;

export type ApprovedTemplateName = (typeof APPROVED_TEMPLATE_NAMES)[number];

/**
 * Os que saíram do fluxo e não devem voltar.
 *
 * O item 35 do pacote os lista sob "não fazer". Estão nomeados aqui, e não
 * apenas ausentes da lista acima, porque a diferença importa: um nome que
 * some pode ter sido esquecido; um nome que está numa lista de proibidos
 * foi decidido.
 */
export const RETIRED_TEMPLATE_NAMES = [
  'followup_orcamento_d15',
  'posvenda_10d_tudo_certo',
  'reativacao_geladeira_60d',
  // Os nomes que as automações do fluxo usavam antes da correção de
  // 2026-09-07. Não existem na conta e o envio falha.
  'followup_d1',
  'followup_d3',
  'followup_d10',
  'followup_d30',
  'posvenda_d20',
  'compra_futura',
  'aniversario_cliente',
] as const;

export function isApprovedTemplate(name: string): boolean {
  return (APPROVED_TEMPLATE_NAMES as readonly string[]).includes(name);
}

export function isRetiredTemplate(name: string): boolean {
  return (RETIRED_TEMPLATE_NAMES as readonly string[]).includes(name);
}
