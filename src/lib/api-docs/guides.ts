// ============================================================
// As páginas de conceito — o que alguém precisa ler UMA vez antes de
// abrir a referência endpoint a endpoint.
//
// A divisão com `endpoints.ts` é a mesma que a documentação do Chatwoot
// faz, e pela mesma razão: autenticação, escopos, envelope, limites e
// paginação valem para as dezesseis rotas, e repeti-los em cada uma
// produz dezesseis cópias que divergem na primeira correção.
//
// `__BASE_URL__` em qualquer texto ou bloco de código é trocado, na
// renderização, pela origem real desta instância (ver `base-url.ts`).
// Uma documentação que já mostra o endereço do CRM de quem está lendo
// poupa a pergunta "qual é a minha URL?", que é sempre a primeira.
// ============================================================

import type { GuidePage } from './types';

export const INTRO: GuidePage = {
  slug: 'introducao',
  title: 'Introdução',
  summary:
    'A API pública do CRM: o que dá para automatizar de fora, com que credencial e por qual porta.',
  blocks: [
    {
      kind: 'p',
      text: 'Tudo que a equipe faz na tela — enviar uma mensagem no WhatsApp, criar um contato, abrir uma oportunidade no funil, disparar uma campanha — também pode ser feito de fora: por um script seu, por um fluxo no n8n, pelo sistema que já roda no seu negócio. Esta é a documentação dessas portas.',
    },
    {
      kind: 'cards',
      items: [
        {
          icon: 'key',
          title: 'Autenticação',
          text: 'Uma chave por integração, presa a uma conta, com escopos que limitam o alcance.',
          href: '/developers/autenticacao',
        },
        {
          icon: 'send',
          title: 'Referência da API',
          text: 'As rotas de `/api/v1`, com parâmetros, exemplos gerados e respostas reais.',
          href: '/developers/endpoints/enviar-mensagem',
        },
        {
          icon: 'webhook',
          title: 'Webhooks de saída',
          text: 'O CRM avisa o seu sistema quando algo acontece, em vez de você ficar perguntando.',
          href: '/developers/webhooks',
        },
        {
          icon: 'releases',
          title: 'Releases',
          text: 'O que mudou em cada versão do produto, da mais recente para a mais antiga.',
          href: '/developers/releases',
        },
      ],
    },

    { kind: 'h2', id: 'as-duas-portas', text: 'As duas portas' },
    {
      kind: 'p',
      text: 'Há dois jeitos de falar com o CRM de fora, e escolher o certo economiza semanas.',
    },
    {
      kind: 'table',
      head: ['', 'API pública (`/api/v1`)', 'Hook de entrada (`/api/hooks/…`)'],
      rows: [
        [
          'O que é',
          'CRUD com contrato explícito',
          'Uma porta que aceita qualquer JSON',
        ],
        [
          'Quem decide o que acontece',
          'Você, chamando a rota certa',
          'As automações da conta',
        ],
        ['Credencial', 'Chave de API com escopos', 'Um token na própria URL'],
        [
          'Use quando',
          'Precisa ler ou escrever algo específico',
          'Quer que o payload dispare regras já configuradas',
        ],
      ],
    },
    {
      kind: 'p',
      text: 'Os dois ao mesmo tempo é um arranjo normal: o n8n como cérebro, o hook como porta. Ver [Hooks de entrada](/developers/hooks-de-entrada).',
    },

    { kind: 'h2', id: 'o-basico', text: 'O básico, em três linhas' },
    {
      kind: 'list',
      items: [
        'A base é `__BASE_URL__/api/v1` — a mesma origem desta página.',
        'Toda requisição leva `Authorization: Bearer wacrm_live_…`.',
        'Toda resposta vem embrulhada: `{ "data": … }` no sucesso, `{ "error": { "code", "message" } }` na falha.',
      ],
    },
    {
      kind: 'code',
      language: 'bash',
      title: 'Verificar uma chave',
      code: `curl __BASE_URL__/api/v1/me \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
    },
    {
      kind: 'callout',
      tone: 'note',
      title: 'Comece por aqui',
      text: '`GET /api/v1/me` não exige escopo nenhum — só uma chave viva. Se ele responde `200`, o caminho inteiro está de pé: leitura do header, hash da chave, checagem de validade, limite de uso e envelope.',
    },

    { kind: 'h2', id: 'o-que-da-para-fazer', text: 'O que dá para fazer' },
    {
      kind: 'table',
      head: ['Recurso', 'O que a API permite'],
      rows: [
        [
          'Mensagens',
          'Enviar texto, mídia, template ou botão para um número; ler o histórico de uma conversa',
        ],
        [
          'Contatos',
          'Listar, buscar, criar (find-or-create por telefone), atualizar, etiquetar',
        ],
        [
          'Campos personalizados',
          'Descobrir as definições da conta e gravar valores em um contato',
        ],
        ['Conversas', 'Listar e ler, com o contato e as etiquetas embutidos'],
        ['Funil', 'Ler funis e etapas, listar negócios, abrir um negócio'],
        [
          'Disparos',
          'Lançar uma campanha de template para até 1.000 números e acompanhar o progresso',
        ],
        [
          'Webhooks',
          'Registrar endpoints que recebem eventos assim que eles acontecem',
        ],
      ],
    },
    {
      kind: 'p',
      text: 'O que a API **não** faz, de propósito: criar campos personalizados, desenhar funis, mexer em permissões ou aprovar templates. São decisões de conta, tomadas uma vez, numa tela onde dá para ver o que já existe.',
    },
  ],
};

export const QUICKSTART: GuidePage = {
  slug: 'inicio-rapido',
  title: 'Início rápido',
  summary: 'Da chave em branco à primeira mensagem entregue, em quatro passos.',
  blocks: [
    { kind: 'h2', id: 'passo-1', text: '1. Crie uma chave' },
    {
      kind: 'p',
      text: 'No CRM: **Configurações › Chaves de API › Nova chave**. Só administradores e o dono da conta criam chaves. Marque apenas os escopos que a integração vai usar — para este roteiro, `messages:send`.',
    },
    {
      kind: 'callout',
      tone: 'warn',
      title: 'A chave aparece uma vez só',
      text: 'O CRM guarda apenas um hash SHA-256. Copie no momento da criação e guarde onde a integração vai lê-la. Perdeu, revogue e crie outra — não existe "mostrar de novo".',
    },

    { kind: 'h2', id: 'passo-2', text: '2. Confirme que ela está viva' },
    {
      kind: 'code',
      language: 'bash',
      code: `curl __BASE_URL__/api/v1/me \\
  -H "Authorization: Bearer $WACRM_KEY"`,
    },
    {
      kind: 'p',
      text: 'A resposta traz a conta a que a chave pertence e os escopos que ela carrega. Um `401` aqui é chave errada, revogada ou expirada; qualquer outra coisa é problema de rede ou de URL.',
    },

    { kind: 'h2', id: 'passo-3', text: '3. Envie uma mensagem' },
    {
      kind: 'p',
      text: 'Você passa um número em **E.164** — não um id interno. A rota encontra ou cria o contato e a conversa, e então envia.',
    },
    {
      kind: 'code',
      language: 'bash',
      code: `curl -X POST __BASE_URL__/api/v1/messages \\
  -H "Authorization: Bearer $WACRM_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "to": "+5551999990000", "type": "text", "text": "Oi 👋" }'`,
    },
    {
      kind: 'callout',
      tone: 'warn',
      title: 'A janela de 24 horas é da Meta, não do CRM',
      text: 'Texto livre só sai para quem falou com você nas últimas 24 horas. Fora dessa janela o envio precisa ser `type: "template"`, com um template aprovado. A recusa volta como `meta_error` (502) — ver [Erros](/developers/erros).',
    },

    {
      kind: 'h2',
      id: 'passo-4',
      text: '4. Pare de perguntar, passe a ser avisado',
    },
    {
      kind: 'p',
      text: 'Registre um webhook e o CRM chama o seu endpoint quando uma mensagem chega, quando o status de um envio muda e quando uma conversa é aberta — em vez de você varrer as listas de minuto em minuto.',
    },
    {
      kind: 'code',
      language: 'bash',
      code: `curl -X POST __BASE_URL__/api/v1/webhooks \\
  -H "Authorization: Bearer $WACRM_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
        "url": "https://seu-sistema.com/hooks/crm",
        "events": ["message.received"]
      }'`,
    },
    {
      kind: 'p',
      text: 'A resposta traz o `secret` **uma vez** — é com ele que você confere a assinatura de cada entrega. Ver [Webhooks de saída](/developers/webhooks).',
    },
  ],
};

export const AUTH: GuidePage = {
  slug: 'autenticacao',
  title: 'Autenticação',
  summary:
    'Uma chave por integração, presa a uma conta, com escopos que limitam o alcance.',
  blocks: [
    {
      kind: 'p',
      text: 'Toda requisição se identifica com uma **chave de API**, enviada como bearer token:',
    },
    {
      kind: 'code',
      language: 'http',
      code: `Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
    },
    {
      kind: 'p',
      text: 'As chaves são **presas a uma conta**: uma chave age sobre exatamente a conta em que foi criada. Não existe acesso entre contas, e o `account_id` nunca é parâmetro — ele sai da própria chave.',
    },
    {
      kind: 'p',
      text: 'O prefixo `wacrm_live_` faz parte do texto claro e não é segredo. Ele existe para que um scanner de segredos (GitGuardian e afins) reconheça uma chave vazada num commit, e para deixar espaço a um `wacrm_test_` no futuro.',
    },

    { kind: 'h2', id: 'criar', text: 'Criar uma chave' },
    {
      kind: 'p',
      text: 'No CRM: **Configurações › Chaves de API › Nova chave**. Só **administradores e o dono** podem criar.',
    },
    {
      kind: 'list',
      ordered: true,
      items: [
        'Dê um nome à chave — o da integração que vai usá-la, para que revogar depois seja uma decisão óbvia.',
        'Conceda os **escopos** de que ela precisa, e nada além. Ver [Escopos](/developers/escopos).',
        'Copie a chave. **Ela é exibida exatamente uma vez.**',
      ],
    },
    {
      kind: 'callout',
      tone: 'danger',
      title: 'Uma chave é credencial de servidor',
      text: 'Ela ignora as permissões de quem a criou e responde só aos próprios escopos. Nunca coloque uma chave em código de front-end, em app móvel ou em qualquer lugar que o navegador de um cliente possa ler.',
    },

    { kind: 'h2', id: 'revogar', text: 'Revogar' },
    {
      kind: 'p',
      text: '**Configurações › Chaves de API › Revogar.** A revogação vale a partir da próxima requisição daquela chave. Chaves revogadas continuam na lista como rastro de auditoria e passam a responder `401 unauthorized` — o mesmo código de uma chave que nunca existiu, de propósito: quem está tentando adivinhar não aprende nada com a diferença.',
    },

    { kind: 'h2', id: 'quem-assina', text: 'De quem é a escrita' },
    {
      kind: 'p',
      text: 'Uma chave não é uma pessoa, e o banco exige um autor em cada linha. Toda escrita feita pela API é atribuída ao **dono da configuração do WhatsApp** da conta, caindo no dono da conta quando ainda não há configuração. Na auditoria, portanto, uma linha criada por integração aponta para alguém real — e a mensagem enviada carrega `origin: "api"`, o que separa o que veio de fora do que alguém digitou na caixa de entrada.',
    },
  ],
};

export const SCOPES_PAGE: GuidePage = {
  slug: 'escopos',
  title: 'Escopos',
  summary: 'O que cada chave pode fazer — independentemente de quem a criou.',
  blocks: [
    {
      kind: 'p',
      text: 'Uma chave faz apenas o que os escopos dela permitem. O papel de quem a criou não entra na conta: um administrador pode emitir uma chave que só lê contatos, e ela só lê contatos, para sempre. Conceda o mínimo.',
    },
    {
      kind: 'table',
      head: ['Escopo', 'Permite', 'Rotas'],
      rows: [
        ['`messages:send`', 'Enviar mensagens no WhatsApp', '`POST /messages`'],
        [
          '`messages:read`',
          'Ler mensagens e status de entrega',
          '`GET /conversations/{id}/messages`',
        ],
        [
          '`contacts:read`',
          'Listar e ler contatos e seus valores personalizados',
          '`GET /contacts`, `GET /contacts/{id}`, `GET /contacts/{id}/custom-fields`',
        ],
        [
          '`contacts:write`',
          'Criar e atualizar contatos, etiquetas e valores',
          '`POST /contacts`, `PATCH /contacts/{id}`, `PUT /contacts/{id}/custom-fields`',
        ],
        [
          '`conversations:read`',
          'Listar e ler conversas',
          '`GET /conversations`, `GET /conversations/{id}`',
        ],
        [
          '`broadcasts:send`',
          'Lançar campanhas e acompanhar o progresso',
          '`POST /broadcasts`, `GET /broadcasts/{id}`',
        ],
        [
          '`webhooks:manage`',
          'Registrar e administrar webhooks de saída',
          'todas as `/webhooks`',
        ],
        [
          '`fields:read`',
          'Ler as definições de campos personalizados',
          '`GET /custom-fields`',
        ],
        [
          '`deals:read`',
          'Ler funis, etapas e negócios',
          '`GET /pipelines`, `GET /deals`',
        ],
        ['`deals:write`', 'Abrir um negócio', '`POST /deals`'],
      ],
    },
    {
      kind: 'callout',
      tone: 'note',
      text: 'Uma chave **sem escopo nenhum** ainda autentica e consegue chamar `GET /api/v1/me`. É o jeito mais barato de conferir que uma credencial chegou inteira à produção antes de conceder qualquer poder a ela.',
    },
    {
      kind: 'p',
      text: 'Faltando o escopo, a resposta é `403 forbidden`, com a mensagem dizendo qual escopo faltou — e não `404`. A distinção importa: `403` quer dizer "a rota existe, a sua chave é que não alcança"; `404` quer dizer "esse id não é desta conta".',
    },

    {
      kind: 'h2',
      id: 'somente-leitura',
      text: 'O que é somente leitura, e por quê',
    },
    {
      kind: 'p',
      text: '`fields:read` não tem par de escrita, e `deals:write` só cria — não move de etapa nem apaga. Definir um campo ou desenhar um funil é decisão de conta, tomada uma vez, numa tela onde dá para ver o que já existe. Uma integração que cria campos na hora termina com dois campos parecidos escritos de dois jeitos, e ninguém descobre até o relatório sair errado.',
    },
  ],
};

export const ERRORS: GuidePage = {
  slug: 'erros',
  title: 'Envelope e erros',
  summary:
    'Duas formas de resposta, um punhado de códigos estáveis, e o que fazer com cada um.',
  blocks: [
    {
      kind: 'p',
      text: 'Toda resposta usa uma de duas formas. Escreva **um** parser e ele serve para a API inteira.',
    },
    {
      kind: 'code',
      language: 'json',
      title: 'Sucesso',
      code: `{ "data": { "id": "…" } }`,
    },
    {
      kind: 'code',
      language: 'json',
      title: 'Falha',
      code: `{
  "error": {
    "code": "forbidden",
    "message": "This API key is missing the 'messages:send' scope"
  }
}`,
    },
    {
      kind: 'p',
      text: 'Ramifique pelo `error.code` — ele é estável e feito para máquina. O `error.message` é para gente e pode ser reescrito a qualquer momento; nunca compare texto.',
    },
    {
      kind: 'p',
      text: 'Listas trazem um terceiro campo, `meta.next_cursor` — ver [Paginação](/developers/paginacao).',
    },

    { kind: 'h2', id: 'codigos', text: 'Códigos comuns' },
    {
      kind: 'table',
      head: ['Status', '`code`', 'Significa', 'O que fazer'],
      rows: [
        [
          '401',
          '`unauthorized`',
          'Chave ausente, malformada, desconhecida, revogada ou expirada',
          'Confira a chave. Repetir com a mesma dá o mesmo erro.',
        ],
        [
          '403',
          '`forbidden`',
          'Chave válida, sem o escopo exigido',
          'Crie uma chave com o escopo — escopos não mudam depois da criação.',
        ],
        [
          '429',
          '`rate_limited`',
          'Estourou o limite por chave',
          'Espere o `Retry-After` e repita. Ver [Limites](/developers/limites).',
        ],
        [
          '400',
          '`bad_request`',
          'Entrada malformada',
          'Corrija o corpo. Repetir igual dá o mesmo erro.',
        ],
        [
          '404',
          '`not_found`',
          'Não existe — ou não é desta conta',
          'Confira o id. Um id de outra conta é `404`, nunca `403`.',
        ],
        [
          '500',
          '`internal`',
          'Erro do servidor',
          'Repita com recuo exponencial.',
        ],
      ],
    },

    { kind: 'h2', id: 'codigos-de-dominio', text: 'Códigos de domínio' },
    {
      kind: 'p',
      text: 'Algumas rotas devolvem códigos próprios, mais específicos que os seis acima. Eles obedecem ao mesmo envelope.',
    },
    {
      kind: 'table',
      head: ['`code`', 'Status', 'Onde aparece'],
      rows: [
        [
          '`whatsapp_not_configured`',
          '400',
          'Envio e disparo, quando a conta ainda não conectou o WhatsApp',
        ],
        [
          '`meta_error`',
          '502',
          'A requisição chegou à Meta e ela recusou — janela de 24h, número inválido, template reprovado',
        ],
        [
          '`template_malformed`',
          '500',
          'O template existe, mas os parâmetros não batem com o que ele declara',
        ],
        [
          '`invalid_request`',
          '400',
          'Criação de negócio e escrita de valores personalizados',
        ],
        ['`db_error`', '500', 'Falha ao gravar; nada foi persistido'],
      ],
    },
    {
      kind: 'callout',
      tone: 'note',
      title: 'Um 404 não conta segredo',
      text: 'Todo id — contato, conversa, disparo, negócio, webhook — é conferido contra a conta da chave antes de qualquer coisa. Um id que existe em outra conta responde `404`, e não `403`, para não revelar que ele existe em algum lugar.',
    },
  ],
};

export const RATE_LIMITS_PAGE: GuidePage = {
  slug: 'limites',
  title: 'Limites de uso',
  summary:
    '120 requisições por minuto, por chave, com os cabeçalhos que dizem quando voltar.',
  blocks: [
    {
      kind: 'p',
      text: 'O limite é **por chave**: **120 requisições por minuto**, cerca de duas por segundo. Chaves diferentes têm baldes diferentes — mais um motivo para dar uma chave a cada integração em vez de compartilhar uma.',
    },
    {
      kind: 'p',
      text: 'Ao estourar, a resposta é `429` com `code: "rate_limited"` e estes cabeçalhos:',
    },
    {
      kind: 'table',
      head: ['Cabeçalho', 'O que traz'],
      rows: [
        [
          '`Retry-After`',
          'Segundos até a janela reabrir. Espere exatamente isso.',
        ],
        ['`X-RateLimit-Limit`', 'O teto da janela (120).'],
        ['`X-RateLimit-Remaining`', 'Quanto sobra na janela atual.'],
        [
          '`X-RateLimit-Reset`',
          'Quando a janela reabre, em segundos desde a época Unix.',
        ],
      ],
    },
    {
      kind: 'callout',
      tone: 'warn',
      title: 'O contador é por processo',
      text: 'O limitador vive na memória da instância. Um deploy de instância única — o caso comum — funciona como descrito. Escalando para várias instâncias, cada uma conta o próprio balde e o teto efetivo multiplica; a troca por um armazenamento compartilhado (Redis/Upstash) está anotada no topo de `src/lib/rate-limit.ts`.',
    },

    { kind: 'h2', id: 'em-lote', text: 'Trabalhos em lote' },
    {
      kind: 'p',
      text: 'Para mandar a mesma mensagem a muita gente, **não** faça um laço em `POST /messages`: 500 contatos são 500 requisições e mais de quatro minutos só de espera. Use [`POST /broadcasts`](/developers/endpoints/criar-disparo), que aceita até 1.000 destinatários em **uma** requisição e dispara em segundo plano.',
    },
  ],
};

export const PAGINATION_PAGE: GuidePage = {
  slug: 'paginacao',
  title: 'Paginação',
  summary:
    'Um cursor opaco, o mesmo em toda lista, estável sob escrita concorrente.',
  blocks: [
    {
      kind: 'p',
      text: 'Toda rota de lista pagina do mesmo jeito, para que você escreva **um** laço e ele sirva para contatos, conversas, mensagens e negócios.',
    },
    {
      kind: 'code',
      language: 'http',
      code: `GET /api/v1/contacts?limit=50
→ { "data": [ … ], "meta": { "next_cursor": "eyJ…" } }

GET /api/v1/contacts?limit=50&cursor=eyJ…
→ { "data": [ … ], "meta": { "next_cursor": null } }   // última página`,
    },
    {
      kind: 'table',
      head: ['Parâmetro', 'Tipo', 'O que faz'],
      rows: [
        [
          '`limit`',
          'integer',
          'Tamanho da página. Padrão 50, máximo 100 — um valor maior é reduzido a 100 em silêncio.',
        ],
        [
          '`cursor`',
          'string',
          'O `meta.next_cursor` da resposta anterior. Ausente = primeira página.',
        ],
      ],
    },
    {
      kind: 'p',
      text: 'Os cursores são de **keyset**, não de deslocamento: as linhas são ordenadas por `(created_at, id)` decrescente e o cursor guarda esse par da última linha. Isso é estável sob inserções concorrentes — um `offset` pula ou repete linhas quando algo novo entra no meio da varredura — e continua rápido em qualquer profundidade.',
    },
    {
      kind: 'callout',
      tone: 'note',
      title: 'Devolva o cursor sem tocar',
      text: 'É uma string opaca (base64url). Não a interprete, não a monte à mão, não a guarde entre execuções esperando que continue válida. `next_cursor: null` é o fim — a única condição de parada do laço.',
    },
    {
      kind: 'p',
      text: 'Um cursor ilegível é tratado como **ausente**, e não como erro: a lista recomeça do topo. É a falha mais barata das duas — repetir uma página custa uma requisição, enquanto um `400` no meio de uma varredura de madrugada custa a varredura inteira.',
    },
    {
      kind: 'code',
      language: 'js',
      title: 'Varrer todos os contatos',
      code: `let cursor = null;
const todos = [];

do {
  const url = new URL('__BASE_URL__/api/v1/contacts');
  url.searchParams.set('limit', '100');
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, {
    headers: { Authorization: \`Bearer \${process.env.WACRM_KEY}\` },
  });
  const page = await res.json();

  todos.push(...page.data);
  cursor = page.meta.next_cursor;
} while (cursor);`,
    },
  ],
};

export const WEBHOOKS_PAGE: GuidePage = {
  slug: 'webhooks',
  title: 'Webhooks de saída',
  summary:
    'O CRM chama o seu endpoint quando algo acontece — assinado, e com as ressalvas ditas em voz alta.',
  blocks: [
    {
      kind: 'p',
      text: 'Em vez de perguntar de minuto em minuto se chegou mensagem, registre um endpoint e o CRM faz um `POST` nele quando algo acontece na sua conta. O cadastro é por [`POST /api/v1/webhooks`](/developers/endpoints/criar-webhook), com o escopo `webhooks:manage`.',
    },

    { kind: 'h2', id: 'eventos', text: 'Eventos' },
    {
      kind: 'table',
      head: ['Evento', 'Dispara quando'],
      rows: [
        ['`message.received`', 'Uma mensagem de um contato chega'],
        [
          '`message.status_updated`',
          'Uma mensagem que você enviou muda de status de entrega',
        ],
        [
          '`conversation.created`',
          'Uma conversa nova é aberta para um contato',
        ],
      ],
    },

    { kind: 'h2', id: 'entrega', text: 'A entrega' },
    {
      kind: 'p',
      text: 'Toda entrega é um `POST` com este envelope. O `id` é único por entrega — é nele que você deduplica.',
    },
    {
      kind: 'code',
      language: 'json',
      code: `{
  "id": "8f3c…",
  "event": "message.received",
  "occurred_at": "2026-09-02T12:00:00.000Z",
  "account_id": "…",
  "data": {}
}`,
    },
    { kind: 'p', text: 'O `data` muda conforme o evento:' },
    {
      kind: 'code',
      language: 'json',
      title: 'data, por evento',
      code: `// message.received
{
  "conversation_id": "…",
  "contact_id": "…",
  "whatsapp_message_id": "wamid.…",
  "content_type": "text",
  "text": "Oi 👋"
}

// conversation.created
{ "conversation_id": "…", "contact_id": "…" }

// message.status_updated
{ "whatsapp_message_id": "wamid.…", "conversation_id": "…", "status": "delivered" }`,
    },
    {
      kind: 'p',
      text: 'Cabeçalhos de toda entrega: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id` e `X-Wacrm-Signature`.',
    },

    { kind: 'h2', id: 'assinatura', text: 'Conferir a assinatura' },
    {
      kind: 'p',
      text: 'O cabeçalho é `X-Wacrm-Signature: t=<segundos_unix>,v1=<hex>`, e `v1` é o HMAC-SHA256 do segredo sobre a string `<t>.<corpo_bruto>`. Recalcule sobre o **corpo bruto** — não sobre o JSON reserializado, que reordena chaves e quebra a conta — e compare em tempo constante.',
    },
    {
      kind: 'code',
      language: 'js',
      code: `import crypto from 'node:crypto';

function verificar(header, corpoBruto, secret) {
  const m = /t=(\\d+),v1=([0-9a-f]+)/.exec(header ?? '');
  if (!m) return false;
  const [, t, v1] = m;

  // Anti-replay: recuse o que é velho demais para ser legítimo.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const esperado = crypto
    .createHmac('sha256', secret)
    .update(\`\${t}.\${corpoBruto}\`)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
}`,
    },
    {
      kind: 'callout',
      tone: 'warn',
      title: 'O segredo aparece uma vez',
      text: '`POST /api/v1/webhooks` devolve `secret` em texto claro na resposta da criação, e só ali. O CRM guarda uma cópia cifrada e não consegue exibi-la de novo. Perdeu, apague o endpoint e crie outro.',
    },

    {
      kind: 'h2',
      id: 'semantica',
      text: 'O que a entrega garante — e o que não',
    },
    {
      kind: 'p',
      text: 'Diga-se com todas as letras, porque quem assume o contrário escreve um sistema que perde dado em silêncio:',
    },
    {
      kind: 'list',
      items: [
        '**Uma tentativa por evento**, com timeout curto. Não há fila durável nem repetição com recuo — ainda.',
        '**Redirecionamentos não são seguidos.** Aponte para a URL final.',
        '**Pode chegar repetido e fora de ordem.** Provedores reenviam e reordenam callbacks de status; deduplique pelo `id` e não presuma ordem.',
        '`message.status_updated` cobre as mensagens que o CRM guarda (caixa de entrada e envios de API), **não** os envios que existem apenas dentro de um disparo.',
        'Cada falha consecutiva incrementa `failure_count`; passado o limite, o endpoint é **desativado sozinho** (`is_active: false`). Reative com `PATCH`, que zera o contador.',
      ],
    },
    {
      kind: 'p',
      text: 'Na prática: trate entregas perdidas como possíveis e reconcilie com as rotas de leitura quando o dado importar de verdade.',
    },

    { kind: 'h2', id: 'ssrf', text: 'Restrições de destino' },
    {
      kind: 'p',
      text: 'A `url` precisa ser `https://` e precisa resolver para um endereço público. Chamadas para `localhost`, para as faixas privadas (RFC1918), para link-local — incluindo o metadata das nuvens, `169.254.169.254` — e para alvos internos semelhantes são recusadas na hora da entrega. Um webhook não é um caminho para dentro da rede de quem hospeda o CRM.',
    },
  ],
};

export const INBOUND_HOOKS: GuidePage = {
  slug: 'hooks-de-entrada',
  title: 'Hooks de entrada',
  summary:
    'A outra porta: qualquer JSON entra e vira variável para as automações da conta.',
  blocks: [
    {
      kind: 'p',
      text: 'Existe uma segunda porta, e ela **não** faz parte da API `/api/v1`.',
    },
    {
      kind: 'code',
      language: 'http',
      code: `POST __BASE_URL__/api/hooks/<token>`,
    },
    {
      kind: 'p',
      text: 'Ela aceita JSON arbitrário — do Typebot, do n8n, de uma landing page — e entrega o payload ao **motor de automações**, onde cada campo vira `{{vars.campo}}`. Dali ele alcança qualquer ação: gravar um campo personalizado, etiquetar, abrir um negócio, responder no WhatsApp. Sem uma rota por recurso.',
    },
    {
      kind: 'table',
      head: ['', 'API pública', 'Hook de entrada'],
      rows: [
        ['Credencial', 'Chave com escopos, no header', 'Token na própria URL'],
        [
          'Contrato',
          'Explícito, por rota',
          'Nenhum — o payload é o que você mandar',
        ],
        ['Quem decide', 'Quem chama', 'As automações da conta'],
        [
          'Rastro',
          'Auditoria da conta',
          'Cada entrega é registrada com as automações que disparou',
        ],
      ],
    },
    {
      kind: 'p',
      text: 'Hooks são criados em **Configurações › Webhooks**, carregam escopos próprios (`messages` vem desligado) e registram toda entrega junto das execuções que causaram.',
    },
    {
      kind: 'callout',
      tone: 'note',
      title: 'Qual usar',
      text: 'Use a **API** quando quiser CRUD com contrato explícito — ler um contato, criar um negócio, disparar uma campanha. Use um **hook** quando quiser que as regras já configuradas na conta decidam o que acontece. Os dois ao mesmo tempo é normal: o n8n como cérebro, o hook como porta.',
    },
  ],
};

export const GUIDES: GuidePage[] = [
  INTRO,
  QUICKSTART,
  AUTH,
  SCOPES_PAGE,
  ERRORS,
  RATE_LIMITS_PAGE,
  PAGINATION_PAGE,
  WEBHOOKS_PAGE,
  INBOUND_HOOKS,
];
