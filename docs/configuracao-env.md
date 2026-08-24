# Configuração do ambiente

Tudo que o PlastfortSul CRM lê de variável de ambiente, o que cada uma
faz, e o que acontece se faltar.

O arquivo fica em `.env.local` na raiz do projeto. Ele **nunca** é
versionado — o `.gitignore` cobre `.env*`, com exceção dos exemplos.
Em produção, as variáveis vão no painel da hospedagem, não num arquivo
no servidor.

> **O token do WhatsApp não está aqui.** Ele é gravado criptografado no
> banco, pela tela **Configurações → WhatsApp**, e não por variável de
> ambiente. O mesmo vale para o token de verificação do webhook, o PIN
> de duas etapas e as chaves de IA (OpenAI/Anthropic). O que está
> abaixo é só o que a aplicação precisa para subir.

---

## Bloco pronto para copiar

```bash
# ---------- Supabase ----------
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ---------- Criptografia ----------
ENCRYPTION_KEY=

# ---------- Endereço da aplicação ----------
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_LOCALE=pt-BR

# ---------- Meta / WhatsApp ----------
META_APP_SECRET=
META_APP_ID=

# ---------- Automações ----------
AUTOMATION_CRON_SECRET=

# ---------- Endurecimento (opcional, recomendado em produção) ----------
# ALLOWED_INVITE_HOSTS=crm.plastfortsul.com.br

# ---------- Só em desenvolvimento ----------
# ALLOWED_DEV_ORIGINS=192.168.1.50:3000
# WHATSAPP_TEMPLATES_DRY_RUN=true

# ---------- Ajuste fino da IA (opcional) ----------
# AI_REQUEST_TIMEOUT_MS=30000
# AI_CONTEXT_MESSAGE_LIMIT=20
```

---

## Obrigatórias

### `NEXT_PUBLIC_SUPABASE_URL`

O endereço do projeto, no formato `https://<ref>.supabase.co`.

**Onde achar:** painel do Supabase → **Project Settings → API → Project
URL**.

Vai para o navegador (prefixo `NEXT_PUBLIC_`), então não é segredo — é
o endereço que toda requisição do cliente já carrega.

### `NEXT_PUBLIC_SUPABASE_ANON_KEY`

A chave pública do cliente. Também vai para o navegador, e também não é
segredo: ela sozinha não dá acesso a nada, porque todo acesso passa por
RLS (row-level security) e pela sessão do usuário.

**Onde achar:** mesma tela, campo **anon / public**.

### `SUPABASE_SERVICE_ROLE_KEY`

**Esta é segredo, e é o segredo mais sensível do sistema.** Ela ignora
RLS por completo — quem a tem lê e escreve qualquer linha de qualquer
conta.

**Onde achar:** mesma tela, campo **service_role**. Nunca a coloque numa
variável `NEXT_PUBLIC_*`, nunca a mande para o navegador, nunca a
registre em log.

**Sem ela:** o webhook do WhatsApp não grava mensagens recebidas, as
automações e os fluxos não rodam, a IA não responde e a faixa de agenda
da visão geral volta vazia. A aplicação sobe, mas metade dela é
decorativa.

### `ENCRYPTION_KEY`

Chave AES-256-GCM que protege o token do WhatsApp e as chaves de IA
guardadas no banco. **32 bytes em hexadecimal — exatamente 64
caracteres.**

Gere com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Se você trocar esta chave**, tudo que já foi criptografado com a
anterior fica ilegível: o token do WhatsApp precisa ser colado de novo
em Configurações, e a chave de IA também. O sistema avisa no log em vez
de falhar em silêncio, mas o trabalho é manual. Guarde-a onde guarda
senha, não no repositório.

### `NEXT_PUBLIC_SITE_URL`

O endereço público da aplicação, sem barra no final. É o que monta o
link do convite de equipe (`/join/<token>`) enviado por e-mail.

Em desenvolvimento: `http://localhost:3000`.
Em produção: o domínio real, com `https://`.

**Sem ela** a aplicação tenta deduzir o endereço do cabeçalho `Host` da
requisição e, se não conseguir, cai em `http://localhost:3000` — um
link que não funciona para quem recebeu. O log diz exatamente isso
quando acontece.

---

## Necessárias para o WhatsApp funcionar

### `META_APP_SECRET`

Usado para verificar a assinatura `X-Hub-Signature-256` de cada webhook
que a Meta envia. É o que separa um evento legítimo de alguém enviando
mensagens falsas para o seu endpoint.

**Onde achar:** [developers.facebook.com](https://developers.facebook.com)
→ seu app → **Configurações → Básico → Chave Secreta do Aplicativo**.

### `META_APP_ID`

O id do mesmo app. O upload retomável de mídia para modelos de mensagem
é escopado por aplicativo, então sem ele o envio de um modelo com
cabeçalho de imagem ou documento falha.

**Onde achar:** mesma tela, campo **ID do Aplicativo**.

---

## Necessária para as automações rodarem

### `AUTOMATION_CRON_SECRET`

Protege `/api/automations/cron` e `/api/flows/cron`, que são as rotas
que o agendador chama para processar follow-ups vencidos.

Gere com:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

O agendador precisa enviá-la no cabeçalho `x-cron-secret`. A comparação
é feita em tempo constante.

**Sem ela a rota responde 503** — fechada por padrão, nunca aberta. Isso
é seguro, e também significa que **nenhuma automação agendada dispara**
até que ela exista.

---

## Endurecimento — opcional, recomendado em produção

### `ALLOWED_INVITE_HOSTS`

Lista de hostnames separados por vírgula. Quando definida, o endereço
do link de convite só é aceito se vier de um host da lista; qualquer
outro cai no padrão, com aviso no log.

Serve contra um `Host` forjado: sem a lista, alguém que conseguisse
disparar o endpoint com um cabeçalho próprio faria o convite apontar
para o site dele. Com `NEXT_PUBLIC_SITE_URL` definida a questão é
quase teórica — ela é lida primeiro —, mas defesa em profundidade
custa uma linha.

Exemplo: `ALLOWED_INVITE_HOSTS=crm.plastfortsul.com.br`

---

## Só em desenvolvimento

### `ALLOWED_DEV_ORIGINS`

Origens extras aceitas pelo servidor de desenvolvimento do Next, para
abrir o app de outro aparelho na mesma rede (testar no celular, por
exemplo). Separadas por vírgula, no formato `ip:porta`.

Não tem efeito em produção.

### `WHATSAPP_TEMPLATES_DRY_RUN`

Com `true`, o envio de modelo para aprovação da Meta pula a chamada de
rede e finge sucesso. Serve para exercitar o fluxo sem sujar a fila de
revisão da Meta com modelos de teste.

**Nunca em produção.**

---

## Ajuste fino da IA — opcional

| Variável                   | Padrão  | O que faz                                    |
| -------------------------- | ------- | -------------------------------------------- |
| `AI_REQUEST_TIMEOUT_MS`    | `30000` | Tempo limite por chamada ao provedor         |
| `AI_CONTEXT_MESSAGE_LIMIT` | `20`    | Quantas mensagens recentes vão como contexto |

Ambas aceitam só números positivos; qualquer outra coisa cai no padrão
em silêncio.

---

## Conferindo

Depois de preencher:

```bash
npm run dev
```

Se subir e a tela de login aparecer em <http://localhost:3000>, as três
do Supabase estão certas. O resto só se manifesta quando você usa a
funcionalidade correspondente — e cada uma dessas falhas escreve no log
o nome da variável que está faltando, de propósito.

## Idioma

`NEXT_PUBLIC_APP_LOCALE` aceita `pt-BR`, `en` ou `ko`, e o padrão é
`en`. Para este produto é sempre `pt-BR`. A troca exige reiniciar o
servidor: o catálogo é carregado uma vez, no boot.
