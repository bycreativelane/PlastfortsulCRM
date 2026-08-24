# PlastfortSul CRM

> O CRM comercial da PlastfortSul, operado inteiramente sobre o
> WhatsApp Business: atendimento compartilhado, cadastro de clientes,
> funis de venda, campanhas e automações.

[![CI](https://github.com/bycreativelane/PlastfortsulCRM/actions/workflows/ci.yml/badge.svg)](https://github.com/bycreativelane/PlastfortsulCRM/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/bycreativelane/PlastfortsulCRM)](https://github.com/bycreativelane/PlastfortsulCRM/releases)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

Desenvolvido e mantido pela **Creative Lane**.

---

## O que o sistema faz

- **Atendimento compartilhado** na API oficial do WhatsApp Business —
  vários atendentes num número só, com atribuição, status e notas por
  conversa.
- **Clientes** com etiquetas, campos personalizados, ocorrências,
  registro de ligações, importação por CSV e deduplicação.
- **Funis de venda** em quadro Kanban, com oportunidades ligadas à
  conversa que as originou, motivo de perda e playbook comercial.
- **Campanhas** com modelos aprovados pela Meta, acompanhamento de
  entrega e leitura, e substituição de variáveis por destinatário.
- **Automações sem código** — gatilhos por mensagem recebida, contato
  novo, palavra-chave ou agendamento; ramificações condicionais,
  esperas, etiquetas e webhooks, num construtor visual.
- **Fluxos** (beta) — o mesmo motor, num canvas de nós.
- **Assistente de IA** com a sua própria chave da OpenAI ou da
  Anthropic, guardada criptografada. Rascunho de resposta na caixa de
  entrada, resposta automática opcional com limite por conversa e
  repasse limpo para o humano, e base de conhecimento própria com
  busca híbrida (full-text do Postgres, ou semântica via pgvector
  quando há chave de embeddings).
- **Visão geral e relatórios** — a fila do dia, o que a automação fez
  sozinha, agenda do que está por vir, tempo de resposta, volume
  diário e valor em funil.
- **Contas de equipe** — convite por link e papéis (dono, admin,
  atendente, leitor), com todo dado isolado por conta.
- **API REST** (`/api/v1`) com chaves revogáveis e escopo — ver
  [docs/public-api.md](./docs/public-api.md).
- **Servidor MCP** para operar o CRM a partir de assistentes de IA —
  ver [docs/mcp.md](./docs/mcp.md).

## Como rodar

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Preencha o `.env.local` antes do primeiro `npm run dev` — o
[guia de configuração](./docs/configuracao-env.md) lista cada variável,
onde encontrar o valor e o que deixa de funcionar sem ela.

A aplicação sobe em <http://localhost:3000> e redireciona para
`/login`.

### Comandos

| Comando             | O que faz                   |
| ------------------- | --------------------------- |
| `npm run dev`       | Servidor de desenvolvimento |
| `npm run build`     | Build de produção           |
| `npm run typecheck` | `tsc --noEmit`              |
| `npm run lint`      | ESLint                      |
| `npm test`          | Suíte de testes (Vitest)    |
| `npm run format`    | Prettier                    |

## Docker

A imagem é multi-estágio e sai com a saída `standalone` do Next: só o
servidor e o que ele realmente carrega, rodando como usuário sem
privilégio, com healthcheck.

```bash
docker compose up --build
```

O `.env.local` alimenta os dois lados, e a diferença entre eles é a
coisa mais importante deste arquivo:

- As `NEXT_PUBLIC_*` são **embutidas no bundle do cliente em tempo de
  build**, então viajam como build args. Mudar qualquer uma exige
  reconstruir a imagem.
- Todo o resto — chave service-role, `ENCRYPTION_KEY`, `META_APP_SECRET`
  — é lido **em tempo de execução**, via `env_file`, e **nunca é
  gravado na imagem**. O `.dockerignore` barra `.env*` justamente para
  que um `.env.local` esquecido não entre por acidente.

Para publicar em outra porta do host:

```bash
HOST_PORT=8080 docker compose up --build
```

Detalhes e resolução de problemas em [docs/docker.md](./docs/docker.md).

## Produção (outro servidor, a partir deste GitHub)

Passo a passo: [docs/deploy.md](./docs/deploy.md). Resumo:

- **Releases** — zip da versão (hoje `v0.8.3`). É isto que se baixa para subir em outro lugar.
- **Packages** — deixe vazio. Não é um pacote npm; não precisa preencher nada.
- Caminho mais curto: importe o repositório na **Vercel** e cole as variáveis do [guia de env](./docs/configuracao-env.md). Alternativa: `git clone` + Docker no VPS.

## Migrações

Os arquivos ficam em `supabase/migrations/`, numerados e aplicados em
ordem. **Uma migração já aplicada nunca é editada** — a correção é
sempre o próximo arquivo numerado. O workflow `.github/workflows/migrations.yml`
sobe um Postgres limpo em cada PR e reaplica todas do zero, sem precisar
de segredo nenhum.

## Documentação

| Onde                                                       | O quê                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [docs/ux-overhaul/](./docs/ux-overhaul/)                   | A reforma de UX/UI: worklog, decisões, defeitos, verificação                     |
| [docs/playbook-comercial.md](./docs/playbook-comercial.md) | O playbook de vendas, em português, para a equipe                                |
| [docs/configuracao-env.md](./docs/configuracao-env.md)     | Cada variável de ambiente: o que faz, onde achar o valor, o que quebra se faltar |
| [docs/public-api.md](./docs/public-api.md)                 | A API REST pública                                                               |
| [docs/mcp.md](./docs/mcp.md)                               | O servidor MCP                                                                   |
| [docs/docker.md](./docs/docker.md)                         | Docker e Docker Compose                                                          |
| [docs/deploy.md](./docs/deploy.md)                         | Produção: Vercel, VPS, o que é Releases vs Packages                              |
| `src/app/globals.css`                                      | O sistema de design: tokens, doutrina de cor, escala de tipo, movimento          |

O sistema de design não vive num arquivo separado — ele vive nos
comentários do `globals.css` e dos primitivos em `src/components/ui/`,
ao lado do código que ele governa. Três testes o mantêm no lugar:
`type-scale.test.ts`, `color-doctrine.test.ts` e `theme-contrast.test.ts`.

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4,
  Base UI.
- **Dados** — Supabase (Postgres, Auth, Storage, RLS).
- **WhatsApp** — Meta Cloud API (API oficial do WhatsApp Business).

## Segurança

Token do WhatsApp criptografado em repouso (AES-256-GCM), RLS em toda
tabela, webhooks verificados por HMAC, proteção contra SSRF na saída de
webhooks, CSP e limitação de taxa. Relato de vulnerabilidade em
[.github/SECURITY.md](./.github/SECURITY.md) — nunca em issue pública.

## Origem e licença

Este sistema começou a partir do projeto open-source wacrm, de Arnas
Donauskas, licenciado sob MIT, e desde então foi substancialmente
modificado e estendido pela Creative Lane como o PlastfortSul CRM.
Não é um fork no GitHub: o histórico publicado é só desta linha.

Licença [MIT](./LICENSE), com os dois avisos de copyright preservados
— o do autor original, como a licença exige, e o da Creative Lane
pelas modificações.
