# Estado do projeto — 7 de setembro de 2026

> Escrito no fim da sessão que entregou a 0.10.0, para que o contexto não
> dependa da memória de uma conversa. Se você está começando agora, leia
> este arquivo antes de qualquer outro.
>
> **Atualize-o quando o estado mudar.** Um documento de estado que envelhece
> é pior que nenhum: ele é acreditado.

---

## Onde o código está

**A `main` está na v0.10.0**, cortada em 7 de setembro de 2026. O
[PR #1](https://github.com/bycreativelane/PlastfortsulCRM/pull/1) foi
mesclado por rebase — os 15 commits foram preservados, e a `main` continua
linear, com 25 no total.

A tag `v0.10.0` está publicada e a
[release](https://github.com/bycreativelane/PlastfortsulCRM/releases/tag/v0.10.0)
saiu pelo workflow, com as notas de `docs/releases/v0.10.0.md`. A branch
`release/0.10.0` aponta para o mesmo commit, como as anteriores.

| Verificação | Estado |
| --- | --- |
| `npm test` | 1781 testes, 146 arquivos |
| `npm run typecheck` | limpo |
| `npm run lint` | 0 erros, 42 avisos preexistentes |
| `npm run build` | compila, saída de produção ~81 MB |
| CI · Lint, typecheck, test, build | passa |
| CI · Apply to a clean database | passa |

`npm run format:check` **falha com ~433 arquivos e isso é falso positivo** —
`core.autocrlf=true` entrega CRLF ao prettier, que exige LF. Os blobs
commitados estão todos em LF. A CI não roda esse comando. Não "conserte".

---

## As três pendências, e as três são de credencial

Nenhuma bloqueia o merge. Nenhuma pode ser resolvida por um agente.

### 1. A migração `069` não foi aplicada

`supabase/migrations/069_google_calendar.sql` está escrita e a CI a valida
aplicando as 69 do zero num banco limpo. Mas o **banco de desenvolvimento
não tem as tabelas** — `calendar_connections`, `calendar_sources`,
`calendar_events`, `task_calendar_links`.

Aplicadas e conferidas: `066`, `067`, `068`.

O caminho é o MCP do Supabase (ver abaixo), ou o SQL editor do painel.

### 2. O OAuth da Google nunca falou com a Google

Falta um app no Google Cloud Console: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` e `GOOGLE_OAUTH_REDIRECT_URI`. O passo a passo, com
a armadilha do `redirect_uri_mismatch`, está em `docs/configuracao-env.md`.

Sem as três, a tela Configurações › Agendas diz que a integração não está
configurada e **o resto do CRM funciona igual**.

Todo o código da fase 4 e 5 está escrito e testado contra dublês. O que
nunca aconteceu foi uma chamada real.

### 3. A `/agenda` nunca foi vista desenhada

A rota exige sessão autenticada — redireciona para `/login`, o que
confirma que a proteção funciona e impede a verificação visual. O build
prerenderiza a rota e os testes cobrem as contas puras, mas ninguém olhou
a grade.

---

## O MCP do Supabase, e a pegadinha da raiz

**A raiz do projeto é `D:\wacrm\wacrm`, não `D:\wacrm`.**

O `.mcp.json` que declara o servidor do Supabase mora na raiz, e os
servidores MCP são lidos **na abertura da sessão**. Abrir um nível acima
carrega o repositório mas não o MCP, em silêncio — e sem MCP não há como
aplicar migração nenhuma.

O token OAuth do Supabase **já está guardado** em
`~/.claude/.credentials.json` sob `mcpOAuth`, com refresh token. Não é
preciso autenticar de novo; é preciso abrir na pasta certa e aprovar o
servidor do `.mcp.json` na primeira vez.

O `~/.claude/projects/` também trata as duas pastas como **projetos
diferentes**, com memórias separadas. Elas foram sincronizadas à mão em
2026-09-07.

O `.mcp.json` **não está versionado** — é decisão em aberto se deveria
estar, já que aponta o `project_ref` do banco de teste.

---

## O que a 0.10.0 entregou

O plano é `docs/spec-tarefas-e-agendas.md`, e as sete fases estão marcadas
como entregues lá. Em uma frase: **o CRM tinha um calendário e não tinha
nem relógio nem compromisso.**

| | |
| --- | --- |
| `066` | Fuso da conta, expediente semanal, exceções |
| `067` | `contacts`, `contact_tags`, `deals` no realtime |
| `068` | A entidade Tarefa e o lembrete como notificação |
| `069` | Conexão Google, agendas seguidas, espelho, vínculo |

Mais: a página `/agenda` (mês, semana, dia), a integração com a Google nos
dois sentidos, a ação `create_task` e o gatilho `task_completed` no motor
de automações, `/api/v1/tasks` na API pública e a página `/developers`.

As notas estão em `docs/releases/v0.10.0.md`.

---

## Três armadilhas que custaram tempo, para não custarem de novo

**O prefixo do id de evento da Google.** O plano sugeria `wacrm`, e `w` não
existe em base32hex — o alfabeto para em `v`. A Google recusaria todo id, no
envio e não na compilação. O teste em `map.test.ts` fixa o alfabeto.

**Dois espaços de identificador para "responsável".**
`deals.assigned_to` referencia `profiles.id`; `tasks.assigned_to` referencia
`auth.users`. Copiar um para o outro grava um responsável que não existe, e
a tarefa aparece sem dono **sem que nada falhe**. Onde os dois se encontram,
há um join — no filtro "Minhas" da agenda e no `deal_owner` das automações.

**O fim exclusivo do dia inteiro.** Um evento que dura só o dia 7 chega da
Google com `end.date = 2026-09-08`. Guardado como vem, todo evento de um dia
parece de dois, e o sintoma aparece longe da causa.

---

## Ferramentas que não se comportam como o esperado nesta máquina

- **`jq` não existe.** Use o `--jq` embutido do `gh`. Um pipe para `jq`
  falha em silêncio — dois monitores de CI ficaram 15 minutos mudos por isso.
- **`du -sh` não termina** na pasta do projeto. Use PowerShell com
  `Get-ChildItem -Recurse -File -Force | Measure-Object Length -Sum`.
- **O cache do Turbopack cresce ~20 GB em duas semanas** em `.next/dev`. É
  descartável: `.next` está no `.gitignore` e se regenera. Foi apagado em
  2026-09-06.

---

## O que está parado, por decisão

Três documentos de planejamento escritos em 2026-09-04, **nenhum
implementado e nenhum com "ok" de execução**:

- `docs/spec-acoes-de-agente.md` — dar ações de escrita à IA interna.
- `docs/pesquisa-plataformas-de-agente.md` — a pesquisa que o acompanha.
- `docs/spec-transporte-secundario.md` — Baileys ao lado da Cloud API.

Os dois specs **reivindicam a mesma numeração de migração** (070 em diante)
e precisam ser renumerados na hora de escrever, conforme a ordem real de
entrega. Com a `069` ocupada, a próxima livre é a **070**.

Ver também `docs/spec-automacoes-fluxo.md`, cuja decisão 2 ("ligação é uma
etapa, sem entidade tarefa") foi revogada por este trabalho.
