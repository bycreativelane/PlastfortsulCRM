# Subir o PlastfortSul CRM em outro lugar

O GitHub guarda o **código**. A aplicação em si precisa de um host (Vercel, VPS, etc.) e de um **Supabase** — o banco não vai no GitHub.

**Packages** (aba do repositório) fica **vazio**. Não preencha. É um registry para publicar bibliotecas npm ou imagens Docker (`ghcr.io/...`). Este projeto é um **aplicativo privado da empresa**, não um pacote para `npm install`. Publicar no Packages só faria sentido se vocês passassem a empurrar uma imagem Docker daí — e mesmo assim a imagem teria de ser reconstruída **por ambiente**, porque as `NEXT_PUBLIC_*` entram no bundle no **build**.

**Releases** é o lugar certo para a “versão 1”: zip do código + notas. A tag `v0.8.1` dispara isso automaticamente.

---

## O que configurar no GitHub (uma vez)

| Onde | O quê |
| --- | --- |
| **About** (canto direito da home do repo) | Descrição curta. Website = URL de produção quando existir. Topics: `crm`, `whatsapp`, `nextjs`, `supabase`. |
| **Releases** | Não preencha à mão se a tag `v*` já subiu — o workflow cria. |
| **Packages** | Nada. |
| **Settings → Secrets and variables → Actions** | Só se no futuro um workflow de deploy for usar chaves. **Não** coloque `SUPABASE_SERVICE_ROLE_KEY` em secret de Action a menos que o job precise disso. |
| **Settings → Environments** (opcional) | `production` com URL do site, para o deploy da Vercel/host apontar para cá. |
| **Settings → Pages** | Não use para este app (é Next.js com servidor, não site estático). |
| **Settings → Webhooks** | Só se um host externo precisar de push. A Vercel não precisa: ela liga pelo próprio GitHub App. |
| **Actions** | Precisa estar habilitado para o CI e para criar o Release na tag. |

Nunca commite `.env.local`. No host de produção as variáveis vão no **painel da hospedagem**.

---

## Caminho A — Vercel (o mais simples a partir do GitHub)

1. [vercel.com](https://vercel.com) → Add New → Project → importe `bycreativelane/PlastfortsulCRM`.
2. Framework: Next.js (detecta sozinho). Root: `.`
3. Environment Variables — cole o bloco de [configuracao-env.md](./configuracao-env.md) com valores **de produção**:
   - `NEXT_PUBLIC_SITE_URL` = `https://seu-dominio` (sem barra no final)
   - `NEXT_PUBLIC_APP_LOCALE` = `pt-BR`
   - as demais obrigatórias preenchidas
4. Deploy. Cada push em `main` gera um deploy novo.
5. No **Supabase** → Authentication → URL Configuration:
   - Site URL = o mesmo `NEXT_PUBLIC_SITE_URL`
   - Redirect URLs = `https://seu-dominio/**`
6. Aplique as migrações no projeto Supabase (CLI `supabase db push` logada, ou o fluxo que vocês já usam no remoto).
7. Meta → webhook do WhatsApp: `https://seu-dominio/api/whatsapp/webhook`
8. Agendador (cron do host ou o [cron da Vercel](https://vercel.com/docs/cron-jobs)) chamando, com o header `x-cron-secret`:
   - `GET https://seu-dominio/api/automations/cron`
   - `GET https://seu-dominio/api/flows/cron`

Rebuild se mudar qualquer `NEXT_PUBLIC_*` (a Vercel faz isso no próximo deploy depois de alterar a env e clicar Redeploy).

---

## Caminho B — VPS / outro servidor (Docker)

No servidor:

```bash
git clone https://github.com/bycreativelane/PlastfortsulCRM.git
cd PlastfortsulCRM
git checkout v0.8.1   # ou main
cp .env.local.example .env.local
# edite .env.local — SITE_URL com o domínio público (https)
docker compose --env-file .env.local up --build -d
```

Na frente, um reverse proxy (Caddy/Nginx) com TLS apontando para a porta publicada (`HOST_PORT`, padrão 3000).

Mesmos passos 5–8 do caminho A (Auth URLs, migrações, webhook Meta, cron).

Detalhes: [docker.md](./docker.md).

---

## Caminho C — só o zip do Release (sem git no servidor)

1. GitHub → Releases → `v0.8.1` → Source code (zip)
2. Extraia, copie `.env.local.example` → `.env.local`, preencha
3. `npm ci && npm run build && npm start`  
   ou o Compose como no caminho B

---

## Checklist antes de apontar o WhatsApp para produção

- [ ] Migrações 001–044 aplicadas no Supabase de produção
- [ ] `ENCRYPTION_KEY` gerada e **guardada** (trocar depois apaga tokens já gravados)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` só no servidor, nunca `NEXT_PUBLIC_*`
- [ ] `WHATSAPP_TEMPLATES_DRY_RUN` **não** definido (ou `false`)
- [ ] Configurações → WhatsApp no app: número que a Meta aceita (verify antes do save)
- [ ] Webhook GET da Meta casa com `verify_token` gravado
- [ ] Cron com `AUTOMATION_CRON_SECRET` (senão as rotas respondem 503)
