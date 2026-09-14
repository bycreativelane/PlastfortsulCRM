/**
 * `@fulano` NA SALA DA EQUIPE.
 *
 * ------------------------------------------------------------------
 * O MESMO `@` DA CAIXA DE ENTRADA, NUM CAMPO DIFERENTE
 * ------------------------------------------------------------------
 *
 * No compositor do ATENDIMENTO, `@` atribui a conversa — e o comentário de
 * `inbox/assign-mention.ts` defende que ele nunca vire menção naquele
 * campo: duas funções para uma tecla num campo que fala com o cliente é
 * como alguém um dia manda "@ana" para um cliente.
 *
 * Aqui é outro campo, e nada escrito nele chega a cliente nenhum. Então o
 * `@` pode ser o que ele é em todo aplicativo de conversa: chamar alguém.
 *
 * ------------------------------------------------------------------
 * EM QUALQUER LUGAR DA FRASE — mas só depois de espaço
 * ------------------------------------------------------------------
 *
 * O `@` de atribuir só abre no começo do campo, porque no meio de uma
 * mensagem ao cliente ele é um e-mail. Numa conversa entre colegas a
 * menção vem no meio — "valeu @Juliana, vou ver" —, então abre em qualquer
 * posição, desde que o `@` esteja no começo de uma PALAVRA. `joao@empresa`
 * continua sendo um e-mail.
 *
 * ------------------------------------------------------------------
 * O TEXTO É TEXTO; QUEM É FICA NUM ARRAY
 * ------------------------------------------------------------------
 *
 * Escolher alguém insere "@Juliana Prestes " no campo, como palavra comum,
 * e guarda o id à parte. Na hora de enviar, `resolveMentions` confere quais
 * nomes AINDA estão no texto: apagar a menção antes de mandar desfaz o
 * aviso, sem ninguém precisar clicar num "x". O porquê de não codificar a
 * menção dentro do corpo está no topo da migração 077.
 */

export interface MentionMember {
  user_id: string;
  full_name: string;
}

/**
 * O `@` que está sendo digitado, se houver um, na posição do cursor.
 *
 * Devolve onde ele começa e o que veio depois. Nulo fecha o painel.
 *
 * Um espaço encerra a busca: "@ana " é alguém que já escreveu a palavra e
 * seguiu adiante, não alguém ainda escolhendo — a mesma regra de
 * `assignQuery` e de `slashQuery`.
 */
export function mentionQueryAt(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const antes = text.slice(0, caret);
  const arroba = antes.lastIndexOf('@');
  if (arroba < 0) return null;

  // O `@` precisa abrir uma palavra. Colado em letra, é e-mail ou handle.
  const anterior = arroba === 0 ? '' : antes[arroba - 1];
  if (anterior && !/\s/.test(anterior)) return null;

  const query = antes.slice(arroba + 1);
  if (/\s/.test(query)) return null;

  return { start: arroba, query };
}

/**
 * Quem combina com o que foi digitado.
 *
 * PREFIXO DE PALAVRA, nunca substring solta — o argumento está em
 * `filterAssignCandidates`: `an` trazendo "Joana" é o tipo de resultado que
 * faz alguém parar de confiar na lista.
 *
 * Sem acento na comparação: "@joao" tem de achar "João", porque é assim
 * que se digita rápido num teclado de computador.
 *
 * Quem digita não aparece. Chamar a si mesmo não é notícia — e o gatilho
 * da 077 descartaria o aviso de qualquer forma.
 */
export function filterMentionCandidates<T extends MentionMember>(
  // Genérica para devolver o que recebeu: o painel precisa da foto que o
  // diretório traz, e uma lista de `MentionMember` a jogaria fora.
  members: T[],
  query: string,
  selfId: string | null
): T[] {
  const q = semAcento(query.trim());
  return members
    .filter((m) => m.user_id !== selfId && m.full_name.trim())
    .filter(
      (m) =>
        !q ||
        semAcento(m.full_name)
          .split(/\s+/)
          .some((palavra) => palavra.startsWith(q))
    )
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * Troca o `@consulta` pelo nome escolhido, e diz onde o cursor fica.
 *
 * Com um espaço depois do nome: quem escolheu alguém vai continuar a frase,
 * e começar a próxima palavra colada no nome é o erro que todo mundo comete
 * uma vez e depois passa a apertar espaço duas vezes para evitar.
 */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string
): { text: string; caret: number } {
  const inserido = `@${name} `;
  // O que já estava depois do cursor fica — inclusive um espaço que já
  // existia, que não pode virar dois.
  const depois = text.slice(caret).replace(/^ /, '');
  return {
    text: text.slice(0, start) + inserido + depois,
    caret: start + inserido.length,
  };
}

/**
 * Quem a mensagem chama DE FATO, na hora de enviar.
 *
 * Os ids escolhidos no painel cujo "@Nome" ainda está no texto. Apagar a
 * menção desfaz o aviso; digitar "@Juliana Prestes" à mão, sem o painel,
 * NÃO avisa ninguém — o painel é o que diz de QUAL Juliana se trata.
 */
export function resolveMentions(
  text: string,
  picked: Iterable<string>,
  members: Map<string, MentionMember>
): string[] {
  const vistos = new Set<string>();
  for (const id of picked) {
    const nome = members.get(id)?.full_name.trim();
    if (!nome || vistos.has(id)) continue;
    if (text.includes(`@${nome}`)) vistos.add(id);
  }
  return [...vistos];
}

export interface MentionSegment {
  text: string;
  /** Presente quando o trecho é uma menção. */
  mention?: { userId: string; self: boolean };
}

/**
 * O corpo em pedaços, para desenhar as menções de outra cor.
 *
 * Só colore os nomes de quem está em `mentions` — um "@Fulano" digitado à
 * mão, que não avisou ninguém, fica como texto comum. Colorir o que não
 * chamou ninguém seria prometer um aviso que não saiu.
 *
 * O nome MAIS LONGO ganha quando dois começam igual ("@Ana" e "@Ana
 * Paula"): senão "@Ana Paula" sairia com só "@Ana" colorido e " Paula"
 * solto do lado.
 */
export function mentionSegments(
  body: string,
  mentionIds: string[] | null | undefined,
  members: Map<string, MentionMember>,
  selfId: string | null
): MentionSegment[] {
  const alvos = (mentionIds ?? [])
    .map((id) => ({ id, nome: members.get(id)?.full_name.trim() ?? '' }))
    .filter((a) => a.nome)
    .sort((a, b) => b.nome.length - a.nome.length);

  if (!body || alvos.length === 0) return body ? [{ text: body }] : [];

  const pedacos: MentionSegment[] = [];
  let resto = body;
  let texto = '';

  while (resto.length > 0) {
    const achado =
      resto[0] === '@'
        ? alvos.find((a) => resto.startsWith(`@${a.nome}`))
        : null;
    if (achado) {
      if (texto) pedacos.push({ text: texto });
      texto = '';
      const trecho = `@${achado.nome}`;
      pedacos.push({
        text: trecho,
        mention: { userId: achado.id, self: achado.id === selfId },
      });
      resto = resto.slice(trecho.length);
    } else {
      texto += resto[0];
      resto = resto.slice(1);
    }
  }
  if (texto) pedacos.push({ text: texto });
  return pedacos;
}

function semAcento(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
