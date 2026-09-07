// ============================================================
// A referência, rota a rota.
//
// Uma entrada por método e caminho de `/api/v1`. É esta lista que
// desenha a barra lateral, o cabeçalho com o método, as tabelas de
// parâmetros, as abas de resposta, os exemplos em cURL/JavaScript/
// Python (gerados — ver `samples.ts`) e o playground.
//
// REGRA DE OURO: o que está aqui é o que a rota FAZ, conferido contra
// `src/app/api/v1/**/route.ts`, e não o que seria bonito ela fazer. As
// esquisitices ficam escritas: `POST /contacts` devolve 200 quando o
// telefone já existia, `POST /deals` embrulha a resposta em `deal`,
// `GET /custom-fields` não usa o envelope de lista. Documentar o mundo
// como ele é custa três frases; deixar o integrador descobrir sozinho
// custa uma tarde dele.
//
// `scope` é `ApiScope`, o mesmo union que `requireApiKey` exige — um
// escopo removido do produto quebra a compilação desta página em vez
// de virar uma linha mentirosa.
// ============================================================

import type { Endpoint, ResponseExample } from './types';

// ------------------------------------------------------------------
// Respostas de erro, montadas em vez de copiadas.
//
// Cada endpoint mostra as suas — o mesmo `401` repetido vinte e duas
// vezes à mão é vinte e duas chances de uma delas envelhecer sozinha.
// ------------------------------------------------------------------

function err(status: number, code: string, message: string): ResponseExample {
  return {
    status,
    json: `{
  "error": {
    "code": "${code}",
    "message": "${message}"
  }
}`,
  };
}

const UNAUTHORIZED = err(401, 'unauthorized', 'Missing or invalid API key');

const forbidden = (scope: string) =>
  err(403, 'forbidden', `This API key is missing the '${scope}' scope`);

const notFound = (what: string) => err(404, 'not_found', `${what} not found`);

const RATE_LIMITED = err(
  429,
  'rate_limited',
  'Rate limit exceeded for this API key'
);

// ------------------------------------------------------------------
// Fragmentos de resposta reutilizados, para que o mesmo recurso tenha
// a mesma cara em toda página que o mostra.
// ------------------------------------------------------------------

const CONTACT_JSON = `{
  "id": "3f1a9c22-5f0a-4f2e-9a1e-6b2d4c8e0f31",
  "phone": "+5551999990000",
  "name": "Joana Prado",
  "email": "joana@acme.com.br",
  "company": "Acme Embalagens",
  "avatar_url": null,
  "tags": [
    { "id": "b7e1…", "name": "revenda", "color": "#3b82f6" }
  ],
  "created_at": "2026-09-01T12:04:11.220Z",
  "updated_at": "2026-09-02T09:31:00.004Z"
}`;

const CONVERSATION_JSON = `{
  "id": "9c4b1f8e-2d33-4a71-b0c5-77e2a1d9e410",
  "contact_id": "3f1a9c22-5f0a-4f2e-9a1e-6b2d4c8e0f31",
  "status": "open",
  "assigned_agent_id": null,
  "last_message_text": "Consegue me mandar o orçamento?",
  "last_message_at": "2026-09-02T09:30:58.900Z",
  "unread_count": 2,
  "created_at": "2026-09-01T12:04:12.010Z",
  "updated_at": "2026-09-02T09:30:58.900Z",
  "contact": {
    "id": "3f1a9c22-5f0a-4f2e-9a1e-6b2d4c8e0f31",
    "phone": "+5551999990000",
    "name": "Joana Prado",
    "email": "joana@acme.com.br",
    "company": "Acme Embalagens",
    "tags": [{ "id": "b7e1…", "name": "revenda", "color": "#3b82f6" }]
  }
}`;

const WEBHOOK_JSON = `{
  "id": "c0ffee00-1111-2222-3333-444455556666",
  "url": "https://seu-sistema.com/hooks/crm",
  "events": ["message.received", "conversation.created"],
  "is_active": true,
  "last_delivery_at": "2026-09-02T09:31:04.117Z",
  "failure_count": 0,
  "created_at": "2026-08-28T18:02:41.003Z"
}`;

/** Os dois parâmetros que toda rota de lista aceita, do mesmo jeito. */
const LIST_QUERY = [
  {
    name: 'limit',
    type: 'integer',
    description: 'Tamanho da página. Acima do máximo, é reduzido a 100.',
    defaultValue: '50',
    example: '100',
  },
  {
    name: 'cursor',
    type: 'string',
    description:
      'O `meta.next_cursor` da resposta anterior, devolvido sem alteração. Ausente = primeira página. Um cursor ilegível recomeça do topo em vez de dar erro.',
  },
];

// ------------------------------------------------------------------
// Conta
// ------------------------------------------------------------------

const ME: Endpoint = {
  slug: 'identidade',
  title: 'Verificar a chave',
  summary: 'A conta a que a chave pertence e os escopos que ela carrega.',
  method: 'GET',
  path: '/api/v1/me',
  scope: null,
  intro: [
    {
      kind: 'p',
      text: 'A rota de referência da API: exige **apenas uma chave válida**, sem escopo nenhum. Use para confirmar que uma credencial chegou inteira à produção e para descobrir o que ela pode fazer antes de ligar qualquer chamada de verdade.',
    },
    {
      kind: 'p',
      text: 'Ela também exercita a pilha inteira — leitura do header, hash, checagem de validade, limite de uso, envelope. Um `200` aqui significa que o encanamento de que todas as outras rotas dependem está de pé.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": {
    "account": { "id": "a1b2…", "name": "PlastfortSul" },
    "key": {
      "id": "k1e5…",
      "scopes": ["messages:send", "contacts:read"]
    }
  }
}`,
    },
    UNAUTHORIZED,
    RATE_LIMITED,
  ],
};

// ------------------------------------------------------------------
// Mensagens
// ------------------------------------------------------------------

const SEND_MESSAGE: Endpoint = {
  slug: 'enviar-mensagem',
  title: 'Enviar mensagem',
  summary:
    'Manda texto, mídia, template ou botões para um número — criando contato e conversa se preciso.',
  method: 'POST',
  path: '/api/v1/messages',
  scope: 'messages:send',
  intro: [
    {
      kind: 'p',
      text: 'Você passa um **número em E.164**, não um id interno — é o que uma automação externa tem na mão. A rota encontra ou cria o contato e a conversa e então envia pelo mesmo caminho que a caixa de entrada usa.',
    },
    {
      kind: 'callout',
      tone: 'warn',
      title: 'A janela de 24 horas',
      text: 'Texto livre só sai para quem falou com você nas últimas 24 horas. Fora dela, use `type: "template"` com um template aprovado — a recusa vem da Meta como `meta_error` (502).',
    },
  ],
  body: [
    {
      name: 'to',
      type: 'string',
      required: true,
      description: 'Telefone do destinatário em E.164, com o `+` e o país.',
      example: '+5551999990000',
    },
    {
      name: 'type',
      type: 'string',
      description: 'O tipo da mensagem.',
      defaultValue: 'text',
      values: [
        'text',
        'template',
        'image',
        'video',
        'document',
        'audio',
        'interactive',
      ],
    },
    {
      name: 'text',
      type: 'string',
      description:
        'O corpo, quando `type` é `text` — e a legenda, quando é mídia. Obrigatório para `text`.',
      example: 'Oi 👋 Seu orçamento saiu.',
    },
    {
      name: 'media_url',
      type: 'string',
      description:
        'URL pública do arquivo. Obrigatório para `image`, `video`, `document` e `audio`.',
    },
    {
      name: 'filename',
      type: 'string',
      description:
        'Nome que o destinatário vê no anexo. Só faz sentido em `document`.',
      example: 'orcamento-4820.pdf',
    },
    {
      name: 'template',
      type: 'object',
      description:
        'Obrigatório quando `type` é `template`. Precisa apontar para um template **aprovado** na conta.',
      children: [
        {
          name: 'name',
          type: 'string',
          required: true,
          description: 'O nome do template como aprovado na Meta.',
          example: 'orcamento_pronto',
        },
        {
          name: 'language',
          type: 'string',
          description: 'Código do idioma do template.',
          defaultValue: 'en_US',
          example: 'pt_BR',
        },
        {
          name: 'params',
          type: 'string[] | object',
          description:
            'Array = variáveis posicionais do corpo (`{{1}}`, `{{2}}`…). Objeto = parâmetros estruturados, quando o template tem cabeçalho ou botões.',
          example: '["Joana", "4820,00"]',
        },
      ],
    },
    {
      name: 'reply_to_message_id',
      type: 'string',
      description:
        'Id interno da mensagem que está sendo respondida. Precisa ser da **mesma conversa**.',
    },
    {
      name: 'name',
      type: 'string',
      description:
        'Nome a dar ao contato **caso ele seja criado agora**. Ignorado se o telefone já existir — a API não renomeia contato por baixo de quem o cadastrou.',
    },
  ],
  requestExample: `{
  "to": "+5551999990000",
  "type": "text",
  "text": "Oi 👋 Seu orçamento saiu."
}`,
  responses: [
    {
      status: 201,
      json: `{
  "data": {
    "message_id": "77c1a0d4-9a4b-4a5f-8a11-0c2f1e77b901",
    "whatsapp_message_id": "wamid.HBgMNTUxMTk5…",
    "conversation_id": "9c4b1f8e-2d33-4a71-b0c5-77e2a1d9e410",
    "contact_id": "3f1a9c22-5f0a-4f2e-9a1e-6b2d4c8e0f31",
    "contact_created": true
  }
}`,
    },
    err(400, 'bad_request', "'to' is required"),
    forbidden('messages:send'),
    err(
      502,
      'meta_error',
      'Meta API error: (#131047) Message failed to send because more than 24 hours have passed'
    ),
  ],
  notes: [
    { kind: 'h2', id: 'validacao', text: 'A ordem importa' },
    {
      kind: 'p',
      text: 'O corpo é validado **antes** de o contato ser procurado ou criado. Um payload errado devolve `400` sem deixar contato e conversa órfãos para trás — o que também significa que dá para testar o formato com um número real sem sujar a base.',
    },
    { kind: 'h2', id: 'template', text: 'Enviando um template' },
    {
      kind: 'code',
      language: 'json',
      code: `{
  "to": "+5551999990000",
  "type": "template",
  "template": {
    "name": "orcamento_pronto",
    "language": "pt_BR",
    "params": ["Joana", "4820,00"]
  }
}`,
    },
    {
      kind: 'p',
      text: 'Parâmetros que não batem com o que o template declara devolvem `template_malformed` (500). O número de variáveis é conferido contra o template aprovado, não contra o que você espera dele.',
    },
    { kind: 'h2', id: 'origem', text: 'De onde a mensagem veio' },
    {
      kind: 'p',
      text: 'Mensagens enviadas por aqui ficam gravadas com `origin: "api"`, o que as separa do que um atendente digitou na caixa de entrada — nos relatórios e na medição de volume por template.',
    },
  ],
};

const LIST_MESSAGES: Endpoint = {
  slug: 'listar-mensagens',
  title: 'Listar mensagens',
  summary: 'O histórico de uma conversa, da mais recente para a mais antiga.',
  method: 'GET',
  path: '/api/v1/conversations/{id}/messages',
  scope: 'messages:read',
  intro: [
    {
      kind: 'p',
      text: 'A conversa é conferida contra a conta da chave **antes** de qualquer mensagem sair — um id de outra conta é `404`, e nenhuma linha vaza no caminho.',
    },
  ],
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id da conversa.',
    },
  ],
  query: LIST_QUERY,
  responses: [
    {
      status: 200,
      json: `{
  "data": [
    {
      "id": "77c1a0d4-9a4b-4a5f-8a11-0c2f1e77b901",
      "conversation_id": "9c4b1f8e-2d33-4a71-b0c5-77e2a1d9e410",
      "direction": "outbound",
      "sender_type": "agent",
      "content_type": "text",
      "content_text": "Oi 👋 Seu orçamento saiu.",
      "media_url": null,
      "template_name": null,
      "whatsapp_message_id": "wamid.HBgMNTUxMTk5…",
      "status": "delivered",
      "reply_to_message_id": null,
      "interactive_reply_id": null,
      "created_at": "2026-09-02T09:31:00.004Z"
    }
  ],
  "meta": { "next_cursor": "MjAyNi0wOS0wMlQwOTozMTowMC4wMDRafDc3YzFhMGQ0" }
}`,
    },
    forbidden('messages:read'),
    notFound('Conversation'),
  ],
  notes: [
    { kind: 'h2', id: 'campos', text: 'Os campos que importam' },
    {
      kind: 'table',
      head: ['Campo', 'O que traz'],
      rows: [
        [
          '`direction`',
          '`inbound` (veio do contato) ou `outbound` (saiu daqui).',
        ],
        [
          '`sender_type`',
          'Quem escreveu: `customer`, `agent`, `bot` ou `system`.',
        ],
        [
          '`status`',
          'Estado de entrega — `sent`, `delivered`, `read`, `failed`.',
        ],
        [
          '`whatsapp_message_id`',
          'O `wamid` da Meta. É a chave para casar com o evento `message.status_updated`.',
        ],
        [
          '`interactive_reply_id`',
          'Quando o contato tocou num botão, o id do botão que ele tocou.',
        ],
      ],
    },
  ],
};

// ------------------------------------------------------------------
// Contatos
// ------------------------------------------------------------------

const LIST_CONTACTS: Endpoint = {
  slug: 'listar-contatos',
  title: 'Listar contatos',
  summary: 'Todos os contatos da conta, do mais novo para o mais antigo.',
  method: 'GET',
  path: '/api/v1/contacts',
  scope: 'contacts:read',
  query: [
    ...LIST_QUERY,
    {
      name: 'search',
      type: 'string',
      description:
        'Busca por nome **ou** telefone, sem diferenciar maiúsculas. Casa com pedaço no meio da string.',
      example: 'joana',
    },
    {
      name: 'tag',
      type: 'string',
      description:
        'Id de uma etiqueta. Só volta quem a carrega — mas cada contato ainda traz o conjunto **completo** das suas etiquetas.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": [${CONTACT_JSON.split('\n').join('\n    ')}],
  "meta": { "next_cursor": "MjAyNi0wOS0wMVQxMjowNDoxMS4yMjBafDNmMWE5YzIy" }
}`,
    },
    forbidden('contacts:read'),
    UNAUTHORIZED,
  ],
};

const CREATE_CONTACT: Endpoint = {
  slug: 'criar-contato',
  title: 'Criar contato',
  summary: 'Cria — ou encontra, pelo telefone — e devolve o contato inteiro.',
  method: 'POST',
  path: '/api/v1/contacts',
  scope: 'contacts:write',
  intro: [
    {
      kind: 'callout',
      tone: 'note',
      title: 'Find-or-create, e o status diz qual foi',
      text: '`201` quando o contato foi criado agora; **`200` quando o telefone já existia** e o que voltou é a linha que já estava lá. Chamar duas vezes com o mesmo número não duplica nada — o que torna esta rota segura para repetir depois de um timeout.',
    },
  ],
  body: [
    {
      name: 'phone',
      type: 'string',
      required: true,
      description: 'Telefone em E.164. É a chave da busca.',
      example: '+5551999990000',
    },
    { name: 'name', type: 'string', description: 'Nome do contato.' },
    { name: 'email', type: 'string', description: 'E-mail.' },
    { name: 'company', type: 'string', description: 'Empresa.' },
    {
      name: 'tags',
      type: 'string[]',
      description:
        'Etiquetas por **nome**, não por id — as que ainda não existirem na conta são criadas.',
      example: '["revenda", "veio-do-site"]',
    },
  ],
  requestExample: `{
  "phone": "+5551999990000",
  "name": "Joana Prado",
  "company": "Acme Embalagens",
  "tags": ["revenda"]
}`,
  responses: [
    { status: 201, label: 'Criado', json: `{ "data": ${CONTACT_JSON} }` },
    { status: 200, label: 'Já existia', json: `{ "data": ${CONTACT_JSON} }` },
    err(400, 'bad_request', "'phone' is required"),
    forbidden('contacts:write'),
  ],
};

const GET_CONTACT: Endpoint = {
  slug: 'ler-contato',
  title: 'Ler contato',
  summary: 'Um contato pelo id, com as etiquetas embutidas.',
  method: 'GET',
  path: '/api/v1/contacts/{id}',
  scope: 'contacts:read',
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id do contato.',
    },
  ],
  responses: [
    { status: 200, json: `{ "data": ${CONTACT_JSON} }` },
    forbidden('contacts:read'),
    notFound('Contact'),
  ],
};

const UPDATE_CONTACT: Endpoint = {
  slug: 'atualizar-contato',
  title: 'Atualizar contato',
  summary: 'Altera só os campos que você mandar. O resto fica como estava.',
  method: 'PATCH',
  path: '/api/v1/contacts/{id}',
  scope: 'contacts:write',
  intro: [
    {
      kind: 'p',
      text: 'Um campo só é tocado quando a **chave está presente** no corpo. `null` limpa, uma string grava, e qualquer outro tipo é `400` — nunca um no-op silencioso, que é a falha em que se perde uma tarde.',
    },
  ],
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id do contato.',
    },
  ],
  body: [
    {
      name: 'name',
      type: 'string | null',
      description: 'Nome. `null` limpa.',
    },
    {
      name: 'email',
      type: 'string | null',
      description: 'E-mail. `null` limpa.',
    },
    {
      name: 'company',
      type: 'string | null',
      description: 'Empresa. `null` limpa.',
    },
    {
      name: 'tags',
      type: 'string[]',
      description:
        '**Substitui** o conjunto de etiquetas pelo que vier aqui — não acrescenta. Mande a lista completa; `[]` remove todas.',
    },
  ],
  requestExample: `{
  "company": "Acme Embalagens Ltda",
  "tags": ["revenda", "ativo"]
}`,
  responses: [
    { status: 200, json: `{ "data": ${CONTACT_JSON} }` },
    err(400, 'bad_request', "'name' must be a string or null"),
    notFound('Contact'),
  ],
};

const GET_CONTACT_VALUES: Endpoint = {
  slug: 'ler-valores-personalizados',
  title: 'Ler valores personalizados',
  summary: 'Os valores dos campos personalizados de um contato.',
  method: 'GET',
  path: '/api/v1/contacts/{id}/custom-fields',
  scope: 'contacts:read',
  intro: [
    {
      kind: 'p',
      text: 'Só voltam campos **desta conta** e que têm valor gravado. Um campo definido mas nunca preenchido simplesmente não aparece na lista.',
    },
  ],
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id do contato.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": {
    "custom_fields": [
      { "id": "8c1f…", "name": "gclid", "value": "Cj0KCQjw…" },
      { "id": "2d90…", "name": "origem", "value": "Meta Ads" }
    ]
  }
}`,
    },
    notFound('contact'),
  ],
};

const PUT_CONTACT_VALUES: Endpoint = {
  slug: 'gravar-valores-personalizados',
  title: 'Gravar valores personalizados',
  summary:
    'Escreve valores por id de campo. O que você não citar fica intacto.',
  method: 'PUT',
  path: '/api/v1/contacts/{id}/custom-fields',
  scope: 'contacts:write',
  intro: [
    {
      kind: 'p',
      text: 'O corpo é um objeto `{ "<id_do_campo>": valor }`. Os ids saem de [`GET /api/v1/custom-fields`](/developers/endpoints/listar-campos-personalizados).',
    },
    {
      kind: 'callout',
      tone: 'note',
      title: 'PUT, mas não substitui tudo',
      text: '**Campos que o corpo não nomeia são deixados em paz.** Uma chamada que grava `gclid` não pode apagar `utm_campaign` por omissão — que é justamente o erro que um PUT literal convidaria a cometer.',
    },
  ],
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id do contato.',
    },
  ],
  body: [
    {
      name: '<id do campo>',
      type: 'string | null',
      description:
        'O valor a gravar, convertido para texto (máx. 5.000 caracteres). `null` limpa o campo. Até 50 campos por requisição.',
    },
  ],
  requestExample: `{
  "8c1f0f1e-9a11-4b2c-8d33-77aa11bb22cc": "Cj0KCQjw…",
  "2d90a4c7-5511-4f22-9b18-3a5e77c90011": "Meta Ads"
}`,
  responses: [
    { status: 200, json: `{ "data": { "written": 2 } }` },
    err(
      400,
      'invalid_request',
      'unknown custom field ids: 0000-0000-0000-0000'
    ),
    notFound('contact'),
  ],
  notes: [
    {
      kind: 'p',
      text: 'Um id desconhecido é `400` **nomeando o id**, e não um pulo em silêncio: quem manda um valor que nunca aparece não tem como distinguir "id errado" de "gravou mas a tela não mostra", e vai procurar no lugar errado por uma hora.',
    },
  ],
};

const LIST_CUSTOM_FIELDS: Endpoint = {
  slug: 'listar-campos-personalizados',
  title: 'Listar campos personalizados',
  summary: 'As definições da conta — de onde saem os ids para gravar valores.',
  method: 'GET',
  path: '/api/v1/custom-fields',
  scope: 'fields:read',
  intro: [
    {
      kind: 'p',
      text: 'Gravar um valor exige o UUID do campo, e antes desta rota não havia como descobri-lo sem copiar da URL do navegador — o tipo de passo que torna uma integração impossível de documentar.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": {
    "custom_fields": [
      {
        "id": "8c1f0f1e-9a11-4b2c-8d33-77aa11bb22cc",
        "name": "gclid",
        "type": "text",
        "options": null,
        "created_at": "2026-07-14T11:02:00.000Z",
        "automation_field_key": "custom:8c1f0f1e-9a11-4b2c-8d33-77aa11bb22cc"
      }
    ]
  }
}`,
    },
    forbidden('fields:read'),
  ],
  notes: [
    {
      kind: 'p',
      text: '`automation_field_key` é a string exata que o passo _atualizar campo do contato_ de uma automação espera. Ela é publicada para que ninguém precise conhecer a codificação — e para que mudá-la um dia seja uma mudança aqui, e não no fluxo n8n de todo mundo.',
    },
    {
      kind: 'callout',
      tone: 'note',
      title: 'Somente leitura, de propósito',
      text: 'Definir um campo é uma decisão de conta, tomada uma vez, numa tela onde dá para ver o que já existe — não algo que uma integração deva fazer na hora, e muito menos duas vezes sob duas grafias.',
    },
  ],
};

// ------------------------------------------------------------------
// Conversas
// ------------------------------------------------------------------

const LIST_CONVERSATIONS: Endpoint = {
  slug: 'listar-conversas',
  title: 'Listar conversas',
  summary: 'As conversas da conta, com contato e etiquetas já embutidos.',
  method: 'GET',
  path: '/api/v1/conversations',
  scope: 'conversations:read',
  query: [
    ...LIST_QUERY,
    {
      name: 'status',
      type: 'string',
      description: 'Filtra pelo estado da conversa.',
      values: ['open', 'pending', 'closed'],
    },
    {
      name: 'contact_id',
      type: 'string',
      description: 'Só as conversas deste contato.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": [${CONVERSATION_JSON.split('\n').join('\n    ')}],
  "meta": { "next_cursor": null }
}`,
    },
    forbidden('conversations:read'),
  ],
};

const GET_CONVERSATION: Endpoint = {
  slug: 'ler-conversa',
  title: 'Ler conversa',
  summary: 'Uma conversa pelo id.',
  method: 'GET',
  path: '/api/v1/conversations/{id}',
  scope: 'conversations:read',
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id da conversa.',
    },
  ],
  responses: [
    { status: 200, json: `{ "data": ${CONVERSATION_JSON} }` },
    notFound('Conversation'),
  ],
};

// ------------------------------------------------------------------
// Disparos
// ------------------------------------------------------------------

const CREATE_BROADCAST: Endpoint = {
  slug: 'criar-disparo',
  title: 'Criar disparo',
  summary:
    'Uma campanha de template para até 1.000 números, em uma requisição.',
  method: 'POST',
  path: '/api/v1/broadcasts',
  scope: 'broadcasts:send',
  intro: [
    {
      kind: 'p',
      text: 'O disparo e as linhas de destinatário são gravados na hora; os envios saem em **segundo plano**. A chamada devolve `202` rápido e você acompanha o progresso em [`GET /api/v1/broadcasts/{id}`](/developers/endpoints/ler-disparo).',
    },
    {
      kind: 'callout',
      tone: 'warn',
      title: 'É esta rota, e não um laço em /messages',
      text: '500 contatos por `POST /messages` são 500 requisições e mais de quatro minutos só de limite de uso. Aqui é uma requisição.',
    },
  ],
  body: [
    {
      name: 'template_name',
      type: 'string',
      required: true,
      description: 'Nome de um template **aprovado** na conta.',
      example: 'promocao_setembro',
    },
    {
      name: 'template_language',
      type: 'string',
      description: 'Idioma do template.',
      defaultValue: 'en_US',
      example: 'pt_BR',
    },
    {
      name: 'name',
      type: 'string',
      description:
        'Rótulo da campanha, para quem for olhar a lista de disparos depois.',
      example: 'Promo setembro — revendas',
    },
    {
      name: 'recipients',
      type: 'object[]',
      required: true,
      description: 'De 1 a 1.000 destinatários. Acima disso é `400`.',
      children: [
        {
          name: 'to',
          type: 'string',
          required: true,
          description:
            'Telefone em E.164. Números inválidos são descartados e contados em `rejected` — o disparo não falha por causa deles.',
        },
        {
          name: 'params',
          type: 'string[]',
          description:
            'Variáveis posicionais do corpo do template, para este destinatário.',
        },
      ],
    },
  ],
  requestExample: `{
  "name": "Promo setembro — revendas",
  "template_name": "promocao_setembro",
  "template_language": "pt_BR",
  "recipients": [
    { "to": "+5551999990000", "params": ["Joana"] },
    { "to": "+5551988880000", "params": ["Marcos"] }
  ]
}`,
  responses: [
    {
      status: 202,
      json: `{
  "data": {
    "broadcast_id": "5a7d2c10-8f31-4b90-9f22-1122aabbccdd",
    "status": "sending",
    "total_recipients": 2,
    "accepted": 2,
    "rejected": 0
  }
}`,
    },
    err(
      400,
      'bad_request',
      'A broadcast is capped at 1000 recipients per request; split larger sends'
    ),
    err(
      400,
      'whatsapp_not_configured',
      'WhatsApp is not configured for this account'
    ),
    forbidden('broadcasts:send'),
  ],
  notes: [
    { kind: 'h2', id: 'tamanho', text: 'Quanto cabe de verdade' },
    {
      kind: 'p',
      text: 'O teto de 1.000 é do formato da requisição; o teto **prático** é o tempo. O leque de envios roda dentro da duração máxima da rota (60 s), sequencialmente, e uma audiência perto do limite pode estourar isso — deixando linhas em `pending` e o disparo parado em `sending`. Para audiências grandes, divida em requisições de algumas centenas.',
    },
  ],
};

const GET_BROADCAST: Endpoint = {
  slug: 'ler-disparo',
  title: 'Ler disparo',
  summary:
    'Status e contadores de uma campanha — a rota que você fica pollando.',
  method: 'GET',
  path: '/api/v1/broadcasts/{id}',
  scope: 'broadcasts:send',
  intro: [
    {
      kind: 'p',
      text: '`status` caminha de `sending` para `sent`. Os contadores de entrega e leitura continuam subindo **depois** disso, conforme os callbacks da Meta chegam — "enviado" não é "lido".',
    },
  ],
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id devolvido pela criação.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": {
    "id": "5a7d2c10-8f31-4b90-9f22-1122aabbccdd",
    "name": "Promo setembro — revendas",
    "template_name": "promocao_setembro",
    "template_language": "pt_BR",
    "status": "sent",
    "total_recipients": 2,
    "sent_count": 2,
    "delivered_count": 2,
    "read_count": 1,
    "replied_count": 0,
    "failed_count": 0,
    "created_at": "2026-09-02T09:40:00.000Z",
    "updated_at": "2026-09-02T09:41:12.500Z"
  }
}`,
    },
    notFound('Broadcast'),
  ],
};

// ------------------------------------------------------------------
// Funil e negócios
// ------------------------------------------------------------------

const LIST_PIPELINES: Endpoint = {
  slug: 'listar-funis',
  title: 'Listar funis',
  summary: 'Funis e etapas em ordem — de onde sai um `stage_id`.',
  method: 'GET',
  path: '/api/v1/pipelines',
  scope: 'deals:read',
  responses: [
    {
      status: 200,
      json: `{
  "data": {
    "pipelines": [
      {
        "id": "11aa…",
        "name": "Comercial",
        "created_at": "2026-05-02T10:00:00.000Z",
        "stages": [
          { "id": "22bb…", "name": "Novo lead", "position": 0, "color": "#64748b", "kind_hint": "open" },
          { "id": "33cc…", "name": "Orçamento enviado", "position": 1, "color": "#3b82f6", "kind_hint": "open" },
          { "id": "44dd…", "name": "Ganho", "position": 2, "color": "#22c55e", "kind_hint": "won" }
        ]
      }
    ]
  }
}`,
    },
    forbidden('deals:read'),
  ],
  notes: [
    { kind: 'h2', id: 'kind-hint', text: '`kind_hint` é palpite, e diz isso' },
    {
      kind: 'p',
      text: 'O campo vale `won`, `lost` ou `open` e é **inferido do nome da etapa** — que é como o produto inteiro decide hoje. Ele se chama `kind_hint`, e não `kind`, exatamente por isso: uma etapa chamada _Faturado_ não está na lista de nomes e vai reportar `open`.',
    },
    {
      kind: 'p',
      text: 'Trate como pista e confirme uma vez contra o seu funil. Quando as etapas ganharem uma coluna de verdade, este campo passa a falar a verdade e nenhum integrador muda uma linha.',
    },
  ],
};

const LIST_DEALS: Endpoint = {
  slug: 'listar-negocios',
  title: 'Listar negócios',
  summary: 'As oportunidades da conta, com a etapa em que cada uma está.',
  method: 'GET',
  path: '/api/v1/deals',
  scope: 'deals:read',
  query: [
    ...LIST_QUERY,
    {
      name: 'contact_id',
      type: 'string',
      description: 'Só os negócios deste contato.',
    },
    {
      name: 'status',
      type: 'string',
      description: 'Estado do negócio.',
      values: ['active', 'won', 'lost'],
    },
    {
      name: 'pipeline_id',
      type: 'string',
      description: 'Só os negócios deste funil.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": [
    {
      "id": "88ee…",
      "title": "Orçamento saco 40x60",
      "value": 4820.0,
      "currency": "BRL",
      "status": "active",
      "expected_close_date": "2026-09-20",
      "notes": null,
      "contact_id": "3f1a9c22-5f0a-4f2e-9a1e-6b2d4c8e0f31",
      "pipeline_id": "11aa…",
      "stage": { "id": "33cc…", "name": "Orçamento enviado", "position": 1 },
      "created_at": "2026-09-01T14:00:00.000Z",
      "updated_at": "2026-09-02T08:12:00.000Z"
    }
  ],
  "meta": { "next_cursor": null }
}`,
    },
    forbidden('deals:read'),
  ],
};

const CREATE_DEAL: Endpoint = {
  slug: 'criar-negocio',
  title: 'Criar negócio',
  summary: 'Abre uma oportunidade para um contato, numa etapa do funil.',
  method: 'POST',
  path: '/api/v1/deals',
  scope: 'deals:write',
  intro: [
    {
      kind: 'p',
      text: 'A rota que faltava para "chegou um lead do anúncio, abre uma oportunidade". O `stage_id` vem de [`GET /api/v1/pipelines`](/developers/endpoints/listar-funis); o `pipeline_id` é deduzido da etapa e não se passa.',
    },
  ],
  body: [
    {
      name: 'contact_id',
      type: 'string',
      required: true,
      description: 'O contato dono da oportunidade. Conferido contra a conta.',
    },
    {
      name: 'stage_id',
      type: 'string',
      required: true,
      description: 'A etapa em que o negócio nasce. Conferida contra a conta.',
    },
    {
      name: 'title',
      type: 'string',
      required: true,
      description: 'O nome do negócio, como aparece no quadro.',
      example: 'Orçamento saco 40x60',
    },
    {
      name: 'value',
      type: 'number',
      description:
        'Valor de partida, não negativo. Ver a nota abaixo — ele é provisório por natureza.',
      example: '4820.00',
    },
    {
      name: 'currency',
      type: 'string',
      description: 'Código de 3 letras. É normalizado para maiúsculas.',
      defaultValue: 'a moeda da conta',
      example: 'BRL',
    },
    {
      name: 'expected_close_date',
      type: 'string',
      description: 'Data prevista de fechamento (`YYYY-MM-DD`).',
    },
    {
      name: 'notes',
      type: 'string',
      description: 'Observação livre, cortada em 5.000 caracteres.',
    },
  ],
  requestExample: `{
  "contact_id": "3f1a9c22-5f0a-4f2e-9a1e-6b2d4c8e0f31",
  "stage_id": "33cc0000-1111-2222-3333-444455556666",
  "title": "Orçamento saco 40x60",
  "value": 4820.0,
  "currency": "BRL"
}`,
  responses: [
    {
      status: 201,
      json: `{
  "data": {
    "deal": {
      "id": "88ee…",
      "title": "Orçamento saco 40x60",
      "value": 4820.0,
      "currency": "BRL",
      "status": "active",
      "expected_close_date": null,
      "notes": null,
      "contact_id": "3f1a9c22-5f0a-4f2e-9a1e-6b2d4c8e0f31",
      "pipeline_id": "11aa…",
      "stage": { "id": "33cc…", "name": "Orçamento enviado", "position": 1 },
      "created_at": "2026-09-02T09:45:00.000Z",
      "updated_at": "2026-09-02T09:45:00.000Z"
    }
  }
}`,
    },
    err(400, 'invalid_request', 'stage_id is required'),
    err(404, 'not_found', 'contact not found'),
    forbidden('deals:write'),
  ],
  notes: [
    {
      kind: 'callout',
      tone: 'note',
      title: 'A resposta vem dentro de `deal`',
      text: 'Diferente das outras rotas, o payload de sucesso é `{ "data": { "deal": { … } } }`. É a forma que está no fio; ler `data.deal` é o certo aqui.',
    },
    {
      kind: 'h2',
      id: 'valor',
      text: 'O `value` é provisório, e isso é o ponto',
    },
    {
      kind: 'p',
      text: '`deals.value` é mantido por um gatilho a partir dos **itens** do negócio: o total de cada linha é coluna gerada e a soma cai no negócio. Um valor postado aqui vale até alguém adicionar uma linha — dali em diante quem manda é a aritmética, que é o que torna o relatório de receita rastreável até um produto em vez de até quem digitou um número por último.',
    },
    { kind: 'h2', id: 'tenancy', text: 'As duas referências são conferidas' },
    {
      kind: 'p',
      text: '`contact_id` e `stage_id` chegam de fora, então os dois são verificados contra a conta da chave antes da inserção. Um UUID de outra conta é `404` — e não uma linha arquivada onde não devia.',
    },
  ],
};

// ------------------------------------------------------------------
// Webhooks
// ------------------------------------------------------------------

const LIST_WEBHOOKS: Endpoint = {
  slug: 'listar-webhooks',
  title: 'Listar webhooks',
  summary: 'Os endpoints registrados na conta. Nunca devolve o segredo.',
  method: 'GET',
  path: '/api/v1/webhooks',
  scope: 'webhooks:manage',
  intro: [
    {
      kind: 'p',
      text: 'A lista é pequena e de classe "configuração", então volta inteira — o `meta.next_cursor` desta rota é sempre `null`.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": [${WEBHOOK_JSON.split('\n').join('\n    ')}],
  "meta": { "next_cursor": null }
}`,
    },
    forbidden('webhooks:manage'),
  ],
};

const CREATE_WEBHOOK: Endpoint = {
  slug: 'criar-webhook',
  title: 'Registrar webhook',
  summary: 'Assina eventos numa URL sua — e devolve o segredo, uma vez só.',
  method: 'POST',
  path: '/api/v1/webhooks',
  scope: 'webhooks:manage',
  intro: [
    {
      kind: 'callout',
      tone: 'warn',
      title: 'O `secret` só existe nesta resposta',
      text: 'Guarde-o na hora: é com ele que você confere a assinatura das entregas. O CRM mantém apenas uma cópia cifrada e nunca mais exibe o valor. Ver [Webhooks de saída](/developers/webhooks).',
    },
  ],
  body: [
    {
      name: 'url',
      type: 'string',
      required: true,
      description:
        'Destino das entregas. Precisa ser `https://` e resolver para um endereço público.',
      example: 'https://seu-sistema.com/hooks/crm',
    },
    {
      name: 'events',
      type: 'string[]',
      required: true,
      description:
        'Ao menos um evento conhecido. Uma lista vazia ou um nome desconhecido é `400`.',
      values: [
        'message.received',
        'message.status_updated',
        'conversation.created',
      ],
    },
  ],
  requestExample: `{
  "url": "https://seu-sistema.com/hooks/crm",
  "events": ["message.received", "conversation.created"]
}`,
  responses: [
    {
      status: 201,
      json: `{
  "data": {
    "id": "c0ffee00-1111-2222-3333-444455556666",
    "url": "https://seu-sistema.com/hooks/crm",
    "events": ["message.received", "conversation.created"],
    "is_active": true,
    "last_delivery_at": null,
    "failure_count": 0,
    "created_at": "2026-09-02T09:50:00.000Z",
    "secret": "whsec_9f2a…"
  }
}`,
    },
    err(400, 'bad_request', "'url' must be a valid https:// URL"),
    forbidden('webhooks:manage'),
  ],
};

const GET_WEBHOOK: Endpoint = {
  slug: 'ler-webhook',
  title: 'Ler webhook',
  summary: 'Um endpoint pelo id, com o contador de falhas.',
  method: 'GET',
  path: '/api/v1/webhooks/{id}',
  scope: 'webhooks:manage',
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id do endpoint.',
    },
  ],
  responses: [
    { status: 200, json: `{ "data": ${WEBHOOK_JSON} }` },
    notFound('Webhook'),
  ],
};

const UPDATE_WEBHOOK: Endpoint = {
  slug: 'atualizar-webhook',
  title: 'Atualizar webhook',
  summary: 'Muda a URL, os eventos ou reativa um endpoint desligado.',
  method: 'PATCH',
  path: '/api/v1/webhooks/{id}',
  scope: 'webhooks:manage',
  intro: [
    {
      kind: 'p',
      text: 'Um corpo sem nenhum campo atualizável é `400` — não um `200` que não fez nada.',
    },
  ],
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id do endpoint.',
    },
  ],
  body: [
    {
      name: 'url',
      type: 'string',
      description: 'Novo destino. As mesmas regras da criação.',
    },
    {
      name: 'events',
      type: 'string[]',
      description: 'Substitui a assinatura inteira.',
    },
    {
      name: 'is_active',
      type: 'boolean',
      description:
        'Liga ou desliga. **Ligar zera o `failure_count`**, para que uma falha velha não desative o endpoint de novo na hora.',
    },
  ],
  requestExample: `{ "is_active": true }`,
  responses: [
    { status: 200, json: `{ "data": ${WEBHOOK_JSON} }` },
    err(400, 'bad_request', 'No updatable fields provided'),
    notFound('Webhook'),
  ],
};

const DELETE_WEBHOOK: Endpoint = {
  slug: 'remover-webhook',
  title: 'Remover webhook',
  summary: 'Apaga o endpoint. As entregas param na hora.',
  method: 'DELETE',
  path: '/api/v1/webhooks/{id}',
  scope: 'webhooks:manage',
  pathParams: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'O id do endpoint.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{ "data": { "id": "c0ffee00-1111-2222-3333-444455556666", "deleted": true } }`,
    },
    notFound('Webhook'),
  ],
};

// ------------------------------------------------------------------
// A lista, na ordem em que a barra lateral a mostra.
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Tarefas
// ------------------------------------------------------------------

const LIST_TASKS: Endpoint = {
  slug: 'listar-tarefas',
  title: 'Listar tarefas',
  summary: 'O que está marcado, com dono e prazo.',
  method: 'GET',
  path: '/api/v1/tasks',
  scope: 'tasks:read',
  query: [
    ...LIST_QUERY,
    { name: 'contact_id', type: 'string', description: 'Só as deste contato.' },
    { name: 'deal_id', type: 'string', description: 'Só as desta oportunidade.' },
    {
      name: 'status',
      type: 'string',
      description: 'Estado da tarefa.',
      values: ['open', 'done', 'cancelled'],
    },
    {
      name: 'assigned_to',
      type: 'string',
      description: 'Id de usuário do responsável.',
    },
    { name: 'kind', type: 'string', description: 'Tipo da tarefa.' },
    {
      name: 'due_from',
      type: 'string',
      description: 'Prazo a partir desta data, `YYYY-MM-DD`.',
    },
    {
      name: 'due_to',
      type: 'string',
      description: 'Prazo até esta data, `YYYY-MM-DD`.',
    },
  ],
  responses: [
    {
      status: 200,
      json: `{
  "data": [
    {
      "id": "aa11…",
      "title": "Ligar para confirmar o pedido",
      "kind": "call",
      "status": "open",
      "due_on": "2026-09-10",
      "due_time": "14:30",
      "assigned_to": "77ff…",
      "contact_id": "55ee…",
      "deal_id": null,
      "completed_at": null,
      "created_at": "2026-09-07T12:00:00.000Z"
    }
  ],
  "next_cursor": null
}`,
    },
    forbidden('tasks:read'),
  ],
  notes: [
    {
      kind: 'h2',
      id: 'dia-e-hora',
      text: 'O dia e a hora são campos separados',
    },
    {
      kind: 'p',
      text: '`due_on` é uma data (`YYYY-MM-DD`) e `due_time` é uma hora de parede (`HH:MM`) no fuso da conta. Eles **não** são um timestamp partido ao meio: uma tarefa com `due_time: null` é do DIA, e isso é informação — "ligar hoje" não é "ligar às 00:00".',
    },
    {
      kind: 'p',
      text: 'Se você precisa de um instante, componha os dois com o fuso da conta, que sai em `GET /api/v1/me`. Assumir UTC devolve o dia anterior para quem está a oeste de Greenwich.',
    },
  ],
};

const CREATE_TASK: Endpoint = {
  slug: 'criar-tarefa',
  title: 'Criar tarefa',
  summary: 'Marcar algo para alguém fazer, com prazo.',
  method: 'POST',
  path: '/api/v1/tasks',
  scope: 'tasks:write',
  body: [
    { name: 'title', type: 'string', required: true, description: 'O que precisa ser feito.' },
    { name: 'description', type: 'string', description: 'Detalhes.' },
    { name: 'kind', type: 'string', description: 'Tipo da tarefa. Padrão `todo`.' },
    { name: 'due_on', type: 'string', description: 'Prazo, `YYYY-MM-DD`.' },
    { name: 'due_time', type: 'string', description: 'Hora, `HH:MM`. Exige `due_on`.' },
    { name: 'assigned_to', type: 'string', description: 'Id de usuário do responsável.' },
    { name: 'contact_id', type: 'string', description: 'A quem a tarefa se refere.' },
    { name: 'deal_id', type: 'string', description: 'A oportunidade relacionada.' },
    {
      name: 'remind_minutes_before',
      type: 'number',
      description: 'Minutos antes do prazo para o lembrete.',
    },
  ],
  requestExample: `{
  "title": "Ligar para confirmar o pedido",
  "kind": "call",
  "due_on": "2026-09-10",
  "due_time": "14:30",
  "contact_id": "55ee…",
  "remind_minutes_before": 30
}`,
  responses: [
    {
      status: 201,
      json: `{
  "data": {
    "id": "aa11…",
    "title": "Ligar para confirmar o pedido",
    "status": "open",
    "due_on": "2026-09-10",
    "due_time": "14:30"
  }
}`,
    },
    {
      status: 400,
      json: `{ "error": { "code": "due_time_without_due_on", "message": "due_time requires due_on" } }`,
    },
    forbidden('tasks:write'),
  ],
};

const UPDATE_TASK: Endpoint = {
  slug: 'atualizar-tarefa',
  title: 'Atualizar tarefa',
  summary: 'Mudar prazo, responsável — ou concluir.',
  method: 'PATCH',
  path: '/api/v1/tasks/{id}',
  scope: 'tasks:write',
  body: [
    {
      name: 'status',
      type: 'string',
      description: 'Concluir é `done`. Também aceita `open` e `cancelled`.',
    },
    { name: 'title', type: 'string', description: 'Novo título.' },
    { name: 'due_on', type: 'string', description: 'Novo prazo. `null` limpa (e limpa a hora junto).' },
    { name: 'due_time', type: 'string', description: 'Nova hora.' },
    { name: 'assigned_to', type: 'string', description: 'Novo responsável. `null` desatribui.' },
  ],
  requestExample: `{
  "status": "done"
}`,
  responses: [
    {
      status: 200,
      json: `{
  "data": {
    "id": "aa11…",
    "status": "done",
    "completed_at": "2026-09-10T17:32:00.000Z"
  }
}`,
    },
    forbidden('tasks:write'),
  ],
  notes: [
    { kind: 'h2', id: 'concluir', text: 'Concluir é um `PATCH`, não um verbo próprio' },
    {
      kind: 'p',
      text: 'Não existe `POST /tasks/{id}/complete`. Um verbo separado seria uma segunda porta para a mesma transição, com uma segunda regra para manter em sincronia. `status: "done"` carimba `completed_at` do mesmo jeito que a tela carimba.',
    },
  ],
};

const DELETE_TASK: Endpoint = {
  slug: 'remover-tarefa',
  title: 'Remover tarefa',
  summary: 'Apagar de vez — para o que foi erro de escrita.',
  method: 'DELETE',
  path: '/api/v1/tasks/{id}',
  scope: 'tasks:write',
  responses: [
    { status: 200, json: `{ "data": { "id": "aa11…", "deleted": true } }` },
    forbidden('tasks:write'),
  ],
  notes: [
    {
      kind: 'p',
      text: 'Uma tarefa concluída normalmente **fica** — o CRM guarda status e motivo em vez de apagar, porque "já ligamos na semana passada" é o que se quer saber antes de ligar de novo. Este endpoint existe para o outro caso: a tarefa que uma integração criou por engano e que nunca deveria ter existido. Para o que foi decidido e não vai acontecer, use `status: "cancelled"`.',
    },
  ],
};

export const ENDPOINTS: Endpoint[] = [

  ME,
  SEND_MESSAGE,
  LIST_MESSAGES,
  LIST_CONTACTS,
  CREATE_CONTACT,
  GET_CONTACT,
  UPDATE_CONTACT,
  GET_CONTACT_VALUES,
  PUT_CONTACT_VALUES,
  LIST_CUSTOM_FIELDS,
  LIST_CONVERSATIONS,
  GET_CONVERSATION,
  CREATE_BROADCAST,
  GET_BROADCAST,
  LIST_PIPELINES,
  LIST_DEALS,
  CREATE_DEAL,
  LIST_TASKS,
  CREATE_TASK,
  UPDATE_TASK,
  DELETE_TASK,
  LIST_WEBHOOKS,
  CREATE_WEBHOOK,
  GET_WEBHOOK,
  UPDATE_WEBHOOK,
  DELETE_WEBHOOK,
];

/** Os grupos da barra lateral — rótulo e os slugs que vão dentro. */
export const ENDPOINT_GROUPS: { label: string; slugs: string[] }[] = [
  { label: 'Conta', slugs: ['identidade'] },
  { label: 'Mensagens', slugs: ['enviar-mensagem', 'listar-mensagens'] },
  {
    label: 'Contatos',
    slugs: [
      'listar-contatos',
      'criar-contato',
      'ler-contato',
      'atualizar-contato',
      'ler-valores-personalizados',
      'gravar-valores-personalizados',
      'listar-campos-personalizados',
    ],
  },
  { label: 'Conversas', slugs: ['listar-conversas', 'ler-conversa'] },
  { label: 'Disparos', slugs: ['criar-disparo', 'ler-disparo'] },
  {
    label: 'Funil',
    slugs: ['listar-funis', 'listar-negocios', 'criar-negocio'],
  },
  {
    label: 'Tarefas',
    slugs: [
      'listar-tarefas',
      'criar-tarefa',
      'atualizar-tarefa',
      'remover-tarefa',
    ],
  },
  {
    label: 'Webhooks',
    slugs: [
      'listar-webhooks',
      'criar-webhook',
      'ler-webhook',
      'atualizar-webhook',
      'remover-webhook',
    ],
  },
];
