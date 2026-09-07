# Pendências

O que **não** foi feito, o que depende de você, e o que ficou em aberto.

---

## 1. O que só você pode fazer

As três são de credencial. Nenhuma pode ser resolvida por um agente, e
nenhuma bloqueia o resto do CRM.

### 1.1 Aplicar a migração `069`

`supabase/migrations/069_google_calendar.sql` está escrita, e a CI a valida
aplicando as 69 do zero num banco limpo. Mas o **banco de desenvolvimento
não tem as quatro tabelas**: `calendar_connections`, `calendar_sources`,
`calendar_events`, `task_calendar_links`.

As `066`, `067` e `068` estão aplicadas e conferidas.

Como aplicar: abra a sessão em **`D:\wacrm\wacrm`** (ver §3 abaixo) e o MCP
do Supabase carrega — o token já está guardado. Ou cole o arquivo no SQL
editor do painel.

Como conferir: [04-verificacao.md §2](04-verificacao.md#2-conferir-a-069).

### 1.2 Criar o app OAuth no Google Cloud Console

Faltam `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e
`GOOGLE_OAUTH_REDIRECT_URI`. O passo a passo está em
[configuracao-env.md](../configuracao-env.md), incluindo a armadilha do
`redirect_uri_mismatch` — a Google compara a URI caractere por caractere e
não diz qual dos dois lados está errado.

**Sem as três, a integração fica dormente**: a tela diz que não está
configurada e o resto do CRM funciona igual.

Depois disso é preciso também um agendador chamando
`GET /api/calendar/cron` a cada cinco minutos com o mesmo
`AUTOMATION_CRON_SECRET` das automações. Sem ele, só o botão "sincronizar
agora" traz eventos.

### 1.3 Olhar a `/agenda` desenhada

A rota exige sessão autenticada. Ninguém viu a grade com dados reais — nem a
semana, nem a faixa de dia todo, nem o eixo de horas contra um expediente de
verdade. É a verificação que falta, e ela custa dois minutos com o
`npm run dev` de pé.

---

## 2. O que ficou de fora, por decisão

- **`events.watch` (tempo real da Google).** Exige endpoint público, tabela
  de canais e renovação antes de expirar — custo operacional real para
  ganhar quatro minutos sobre o `syncToken`. Está no §D6 do plano, na
  Parte G.
- **A oportunidade no filtro por responsável.** Ver
  [02-decisoes.md §2](02-decisoes.md): os dois espaços de identificador.
- **Um seletor de "publicar em" por tarefa.** Hoje a tarefa vai para todas
  as agendas marcadas como `out`/`both`. O plano previa a escolha por
  tarefa, com padrão por usuário; ficou de fora porque a escolha por agenda
  já cobre o caso real (uma agenda comercial), e um seletor a mais no
  diálogo pesa mais do que resolve enquanto ninguém pediu.

---

## 3. A pegadinha da raiz, que já custou duas sessões

**A raiz do projeto é `D:\wacrm\wacrm`, não `D:\wacrm`.**

Os servidores MCP são lidos na **abertura** da sessão, a partir da raiz.
Abrir um nível acima carrega o repositório e não o `.mcp.json` — em
silêncio. Um `cd` depois move o shell e não recarrega nada. Foi por isso que
a `069` não pôde ser aplicada.

O token OAuth do Supabase **já está guardado** e tem refresh token: não é
preciso autenticar, só abrir na pasta certa e aprovar o servidor na primeira
vez.

O `~/.claude/projects/` também trata as duas pastas como **projetos
diferentes, com memórias separadas**. Elas foram sincronizadas à mão em
7 de setembro (15 arquivos), depois de terem divergido — o lado errado ainda
afirmava que a migração `065` não tinha sido aplicada.

---

## 4. Em aberto, sem decisão

- **Versionar o `.mcp.json`?** Ele aponta o `project_ref` do banco de teste.
  Versionar facilita a vida de quem clona; é uma escolha sua e ficou parada.
- **Os três documentos de 4 de setembro.** `spec-acoes-de-agente.md`,
  `pesquisa-plataformas-de-agente.md` e `spec-transporte-secundario.md` —
  nenhum implementado, nenhum com "ok" de execução. Os dois specs
  reivindicam a mesma numeração de migração e precisam ser renumerados na
  hora de escrever. Com a `069` ocupada, a próxima livre é a **070**.
- **Consolidar os quatro `supabaseAdmin()`.** O helper está copiado em
  `ai/`, `flows/`, `automations/` e agora `calendar-sync/`, com um
  comentário que admite a duplicação. Segui a convenção em vez de mexer em
  três módulos alheios no meio da entrega.
