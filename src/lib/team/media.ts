import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Anexos da sala da equipe — o balde, o tipo e a URL.
 *
 * ------------------------------------------------------------------
 * POR QUE UM MÓDULO SÓ PARA ISSO
 * ------------------------------------------------------------------
 *
 * O anexo da sala difere do anexo do atendimento em exatamente uma
 * coisa, e ela contamina tudo: **o balde é privado**. A migração 063
 * explica o porquê — a sala existe para o que a equipe diz entre si, e
 * o `chat-media` é público por obrigação, porque a Meta busca a URL na
 * hora de enviar.
 *
 * Privado significa que não existe URL guardável. A coluna guarda o
 * CAMINHO, e a URL nasce assinada, expira, e nasce de novo. Isso muda
 * quem pode chamar o quê e quando, e é o tipo de detalhe que, espalhado
 * por um componente de 800 linhas, vira um `getPublicUrl` bem-
 * intencionado que devolve 400 em silêncio.
 */

/** O balde privado da migração 063. Nunca o `chat-media`. */
export const TEAM_MEDIA_BUCKET = 'team-media';

/**
 * Quanto vale uma URL assinada.
 *
 * Uma hora. A sala é lida em sessão — alguém abre, lê, responde e sai —
 * e uma URL que dura o dia inteiro é uma URL que vaza por copiar e colar
 * num grupo de WhatsApp e continua servindo o arquivo amanhã.
 *
 * O custo de errar para baixo é uma imagem que para de carregar numa aba
 * esquecida aberta há duas horas, e a correção é recarregar. O custo de
 * errar para cima é o balde privado ter servido de balde público por um
 * turno inteiro.
 */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type TeamMediaKind = 'image' | 'audio' | 'video' | 'document';

/**
 * O tipo, deduzido do MIME e não da extensão.
 *
 * A extensão é o que o usuário digitou; o MIME é o que o navegador leu.
 * Um `.jpg` renomeado para `.pdf` continua sendo `image/jpeg` aqui, e é
 * a imagem que tem que aparecer.
 *
 * Cai para `document` no desconhecido em vez de recusar: o balde já
 * filtra por `allowed_mime_types`, então qualquer coisa que chegou aqui
 * já passou pela lista, e um arquivo legítimo virar balão de download é
 * melhor que virar erro.
 */
export function teamMediaKind(mime: string | null | undefined): TeamMediaKind {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Caminhos em URLs assinadas, TODOS DE UMA VEZ.
 *
 * `createSignedUrls` no plural, e essa é a decisão que importa: a
 * alternativa é cada balão assinar o seu no `useEffect`, o que numa
 * página de duzentas mensagens é duzentas requisições disparadas juntas,
 * cada uma renderizando um estado de carregamento próprio. A sala
 * abriria como uma cortina de retângulos cinzas.
 *
 * Devolve um `Map` e não um array porque o chamador tem mensagens, não
 * índices — e parear array de volta com array é onde o off-by-one mora.
 *
 * Um caminho que falhar simplesmente não entra no mapa. O balão então
 * cai no estado "não foi possível carregar", que é o que ele deve dizer
 * — e não um `undefined` virando `src=""`, que o navegador resolve
 * pedindo a página atual de novo.
 */
export async function signTeamMedia(
  db: SupabaseClient,
  paths: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return out;

  const { data, error } = await db.storage
    .from(TEAM_MEDIA_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);

  // Falhar aqui não é falhar a sala. As mensagens de texto — a esmagadora
  // maioria — não dependem disto, e devolver o mapa vazio deixa cada
  // balão de mídia dizer que não carregou, em vez de derrubar a lista.
  if (error || !data) return out;

  for (const row of data) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}

/**
 * A linha que representa a mensagem onde não cabe a mensagem inteira.
 *
 * O card da sala na barra lateral mostra o `body` — e uma mensagem que é
 * só um print tem `body` nulo, então a linha aparecia **em branco**. Uma
 * mensagem invisível num card cujo trabalho é dizer que há mensagem nova
 * é pior que card nenhum: a contagem de não lidas sobe e não há nada
 * escrito para justificá-la.
 *
 * Com legenda, a legenda ganha — ela é o que a pessoa escreveu. Sem
 * legenda, o tipo do anexo em palavra ("Imagem", "Áudio"). O chamador
 * passa os rótulos porque este módulo não fala i18n, e as quatro chaves
 * já existem em `Inbox.team` para o menu do clipe.
 */
export function teamMessagePreview(
  message: {
    body?: string | null;
    media_mime?: string | null;
    media_path?: string | null;
  },
  labels: Record<TeamMediaKind, string>
): string {
  const body = message.body?.trim();
  if (body) return body;
  if (!message.media_path) return '';
  return labels[teamMediaKind(message.media_mime)];
}
