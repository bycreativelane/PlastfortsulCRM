# O que foi publicado no GitHub (cópia local)

O repositório remoto **foi apagado**. Tudo abaixo ainda existe **neste disco**: branch `main`, tag `v0.8.1` e os dois commits. Nada de `.env.local` foi enviado.

Data do último estado no GitHub: **24 de agosto de 2026** (horário de Brasília). Conta: `gabrielspencerf`.

---

## Endereço e metadados da página

| Campo | Valor que estava no GitHub |
| --- | --- |
| Nome | `Plastfortsul-CRM` |
| URL | `https://github.com/gabrielspencerf/Plastfortsul-CRM` |
| Visibilidade | **Public** |
| About (descrição) | `Sistema de Gestão Comercial desenvolvido para Plastfortsul.` |
| Website (About) | vazio (não havia URL de produção) |
| Packages | vazio — **não preencher**; não é pacote npm |
| Releases | **1** — `PlastfortSul CRM v0.8.1 (Latest)` |
| Topics sugeridos (podem não ter sido gravados na UI) | `crm`, `whatsapp`, `nextjs`, `supabase` |
| `package.json` `homepage` / `repository` / `bugs` | apontam para o URL acima |

O Git local ainda tem `origin` nesse URL. Depois de apagar o repo, `git push` falha até criar de novo e apontar o remote.

O Git local **não** deve ter remote para `wacrm` / `ArnasDon`. Esse remote (`fork-antigo`) foi removido de propósito: ele puxava os ~702 commits e, se alguém fizesse `git push --all`, o gráfico de contribuidores voltava.

---

## História Git que estava em `main`

História **órfã de 2 commits** (sem os ~702 commits do wacrm). Autor dos dois: `gabrielspencerf <gabriel@creativelane.io>`. Sem `Co-authored-by`.

| SHA | Mensagem | Notas |
| --- | --- | --- |
| `838bfd14f73515570f000084bca8ee09f5002d7f` | `Initial public release of PlastfortSul CRM.` | Snapshot do produto. Corpo: derivado do wacrm MIT; copyright original no LICENSE; histórico upstream **não** importado. |
| `f60a082e9871221ef36a0489d07690ee82d9a50d` | `Add first GitHub Release workflow and deploy guide.` | HEAD atual. Workflow de Release, `.nvmrc`, `docs/deploy.md`, notas `v0.8.1`. |

Tag anotada:

```
v0.8.1    PlastfortSul CRM v0.8.1
```

Aponta para `f60a082`. Versão em `package.json`: **0.8.1**.

Commits **anteriores** (squash / force-push) **não** fazem parte deste estado: o GitHub só via esses dois + a tag.

---

## Release `v0.8.1`

Criado pelo Actions (workflow `Release` #1, ~11 s, sucesso) ao receber o push da tag.

- Título: `PlastfortSul CRM v0.8.1`
- Corpo: o arquivo local `docs/releases/v0.8.1.md` (não havia `.exe` nem pacote npm; só Source code zip/tar gerados pelo GitHub)
- Latest: sim

---

## Actions que rodaram nesse repo

Workflows versionados (continuam no disco):

| Arquivo | Função |
| --- | --- |
| `.github/workflows/ci.yml` | lint, typecheck, test, build em PR e push em `main` |
| `.github/workflows/migrations.yml` | Postgres limpo + todas as migrações em PR |
| `.github/workflows/release.yml` | tag `v*` → `gh release create` |

Na UI, no último estado: Release #1 verde na tag; CI #12 em `main` (`f60a082`) em andamento ou a concluir; CI #11 verde em `838bfd1`; alguns CI antigos cancelados/falhos de force-push; PRs do Dependabot (`sonner`, `next-intl`) tinham disparado CI.

Outros arquivos `.github`: `CODEOWNERS` (`* @gabrielspencerf`), `SECURITY.md`, `dependabot.yml` (npm + github-actions, semanal).

---

## O que o zip / clone continha (árvore)

Pastas na raiz do commit publicado:

`.github` `docs` `mcp-server` `messages` `public` `src` `supabase`

Mais, entre outros: `Dockerfile`, `docker-compose.yml`, `.env.local.example`, `LICENSE` (MIT, copyright wacrm + Creative Lane), `README.md`, `AGENTS.md`, `next.config.ts`, `package.json` / lock, testes, `supabase/migrations/` até **044**.

**Não enviado (gitignore):** `.env.local`, `node_modules`, `.next`, chaves. O Supabase **remoto** (`nedrywfoivjpdddkqtcs`) nunca foi o GitHub — só o SQL das migrações.

---

## Configuração da UI que **não** está no Git

Isto morreu com o repo apagado e precisa ser recolocado à mão:

- About / descrição / topics
- Actions habilitado (primeiro uso)
- Dependabot (o YAML volta no push; PRs velhos **não** voltam, o que é bom para a lista de contribuidores)
- Qualquer secret de Actions (não havia secret de produção no GitHub)
- Environments, Pages (Pages **não** era para usar)
- Issues / Discussions se estavam ligados
- Os 6 PRs Dependabot com histórico antigo — **não recriar**

A lista de ~15 contribuidores vinha sobretudo de `refs/pull/*` do Dependabot com o histórico wacrm, não dos 2 commits de `main`. Repo novo + só estes dois commits = gráfico só com `gabrielspencerf`.

---

## Como republicar o mesmo conteúdo

1. GitHub → New repository → nome `Plastfortsul-CRM` (ou outro) → **vazio** (sem README, sem LICENSE).
2. Público ou privado, como quiser.
3. About: a descrição da tabela acima.
4. Neste PC:

```bash
cd d:\wacrm\wacrm
git remote set-url origin https://github.com/gabrielspencerf/NOME.git
git push -u origin main
git push origin v0.8.1
```

O push da tag recria o Release se o Actions estiver ligado e o workflow existir (já está em `main`). Conferir a página Releases.

5. **Não** ligar Dependabot no GitHub (o YAML foi removido do repo). **Nunca** `git remote add` o wacrm antigo. **Nunca** `git push --all` / `--mirror` se ainda houver objetos velhos no disco. Criar o repositório pelo botão **New**, não pelo **Fork**.

Clone depois disso:

```bash
git clone https://github.com/gabrielspencerf/NOME.git
```

---

## Documentos que já iam no repo (não duplicar aqui)

| Arquivo | Papel |
| --- | --- |
| `docs/deploy.md` | Vercel / VPS / zip; Packages vs Releases |
| `docs/releases/v0.8.1.md` | texto do GitHub Release |
| `docs/configuracao-env.md` | variáveis |
| `docs/docker.md` | Compose |
| `README.md` | visão do produto + badges CI/Release |

Este arquivo (`docs/github-publicacao.md`) é o inventário do que o GitHub **tinha**, para não depender da UI apagada.
