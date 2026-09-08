import type { Deal, Tag } from '@/types';

/**
 * Achata `contact_tags(tags(*))` em `contact.tags`, para o quadro do funil.
 *
 * ------------------------------------------------------------------
 * POR QUE A FUNÇÃO EXISTE, E POR QUE AQUI
 * ------------------------------------------------------------------
 *
 * O PostgREST devolve uma tabela de junção como uma lista de linhas de
 * junção — `[{ tags: {...} }]` — e não como a lista de etiquetas. O tipo
 * `Contact` declara `tags?: Tag[]` e o comentário dele diz, textualmente,
 * que o campo é "hidratado por consultas que embutem `contact_tags(tags(*))`".
 * Alguém tem de fazer a hidratação, e havia dois lugares fazendo:
 * `normalizeConversation` para a caixa de entrada e `serializeContact` para
 * a API pública.
 *
 * Este é o terceiro consumidor, e ele não podia usar nenhum dos dois: o
 * primeiro devolve uma `Conversation` e o segundo devolve a forma pública da
 * API, com `avatar_url` e `updated_at` obrigatórios. O que se repete entre
 * os três é só a extração da junção, e é o que mora aqui.
 *
 * ------------------------------------------------------------------
 * O `null` NO MEIO DA LISTA
 * ------------------------------------------------------------------
 *
 * `tags` pode vir `null` numa linha de junção que aponta para uma etiqueta
 * apagada — a linha de junção sobrevive à etiqueta por um instante, e num
 * banco sem `ON DELETE CASCADE` sobrevive para sempre. Filtrar é o que
 * impede o cartão de tentar ler `.name` de `null` e derrubar o quadro
 * inteiro por causa de uma etiqueta que alguém removeu.
 */
type TagJoin = { tags: Tag | null };

type RawDeal = Deal & {
  contact?: (Deal['contact'] & { contact_tags?: TagJoin[] | null }) | null;
};

export function flattenDealTags(raw: RawDeal): Deal {
  const contact = raw.contact;
  if (!contact) return raw as Deal;

  const { contact_tags: joins, ...rest } = contact;
  return {
    ...raw,
    contact: {
      ...rest,
      tags: (joins ?? [])
        .map((join) => join.tags)
        .filter((tag): tag is Tag => tag != null),
    },
  } as Deal;
}
