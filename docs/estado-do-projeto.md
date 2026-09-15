# Estado do projeto — 15 de setembro de 2026

> Escrito no fim da sessão que publicou a 0.11.0, para que o contexto não
> dependa da memória de uma conversa. Se você está começando agora, leia
> este arquivo antes de qualquer outro.
>
> **Atualize-o quando o estado mudar.** Um documento de estado que envelhece
> é pior que nenhum: ele é acreditado.

---

## Onde o código está

**A 0.11.0 está publicada.** Tag `v0.11.0` em `cb01957`, com o
[release no GitHub](https://github.com/bycreativelane/PlastfortsulCRM/releases/tag/v0.11.0)
marcado como Latest e as notas de `docs/releases/v0.11.0.md`. A tag só foi
criada depois de o CI e a reaplicação limpa das migrações passarem nesse
commit da `main`. A versão anterior é a `v0.10.0` (7 de setembro).

Entre as duas, 125 commits: o pacote de correções de 7 de setembro, o
redesenho das telas de trabalho, a oportunidade no formato do pedido de venda,
o orçamento (documento, PDF no servidor, arquivo, envio pelo WhatsApp), a sala
da equipe com `@menção` e som, as tarefas em três visões, o endurecimento das
funções do banco (079–081), a integração com o Bling (Fases 1–7) e as
correções das três auditorias que leram a integração antes do release (090
e 091, `7d473fa`, `a439ad8` e `cb01957`).

| Verificação | Estado |
| --- | --- |
| `npm test` | 2539 testes em 214 arquivos, todos passando |
| `npm run typecheck` | limpo |
| `npm run lint` | 0 erros (52 avisos, todos anteriores) |
| `npm run build` | passa (Next 16.2.12, 127 páginas) |
| CI · Lint, typecheck, test, build | passa em `cb01957` |
| CI · Apply to a clean database | passa em `cb01957` — a primeira reaplicação do zero com 070–091 e a conferência do esquema |

### As auditorias de 15 de setembro

Três agentes independentes leram a integração com o Bling — segurança, tela
e correção do fluxo de pedidos — e acharam 36 problemas, um crítico (a fila
podia criar o mesmo pedido duas vezes com o Bling lento). Todos foram
corrigidos na própria 0.11.0, e cada correção foi desfeita de propósito para
ver o teste acusar. Uma quarta leitura, das próprias correções, achou mais
sete pontos (nenhum crítico), corrigidos na 091 e em `cb01957` — 74
mutações ao todo, 74 acusadas. O que cada um era está nas mensagens de
`7d473fa` (servidor e banco), `a439ad8` (tela) e `cb01957` (a revisão). As
regras que ficaram, para não desfazer sem querer:

- **A fila pega uma operação por vez** e renova o lease antes de cada escrita
  no Bling (`beforeWrite` → `bling_touch_operation`). O término é
  `bling_finish_operation`, numa transação, e só escreve as colunas de
  `FINISH_PATCH_COLUMNS`.
- **Em andamento exige o pedido sincronizado** (`deals.bling_source_hash`
  igual ao resumo do pedido gravado) — menos na repetição de uma mudança que
  ficou pela metade. A gaveta grava, pede, e só atualiza no Bling quando a
  rota responde `order_not_synced`.
- **A gaveta lê o pedido de `currentOrder`** (a prop com a leitura da fila por
  cima) e acompanha a operação que pediu, pelo id.
- **Toda leitura filha do pedido leva a conta**, e a 090 recusa referência de
  outra conta no banco.
- **Pedido que já existe no Bling recebe o conteúdo de agora.** A criação que
  acha o pedido pela chave (tentativa anterior) faz PUT antes de gravar o
  resumo; a chave só é gravada logo antes do POST.
- **Travas sempre na mesma ordem**: oportunidade, depois operação (091).

`npm run format:check` **falha com centenas de arquivos e isso é falso
positivo** — `core.autocrlf=true` entrega CRLF ao prettier, que exige LF. A CI
não roda esse comando. Não "conserte".

---

## O banco

**As migrações até a 091 estão aplicadas no banco de teste**, e cada uma foi
conferida depois de aplicar (as conferências estão nas mensagens dos commits).
A próxima livre é a **092**.

Desde 3 de setembro quem aplica é o Claude, pelo MCP do Supabase — ver
[O MCP do Supabase](#o-mcp-do-supabase-e-a-pegadinha-da-raiz). Quando o MCP
não carrega na sessão, dá para falar com o mesmo endpoint por HTTP com o token
guardado, **só com autorização explícita do Gabriel e só para o banco de
teste**, e o script tem de ser apagado depois.

Duas regras da casa que as últimas migrações reforçaram:

- **Nunca editar migração aplicada.** A 087 existe porque a 086 tinha um
  defeito descoberto minutos depois de aplicada; a 088 desempata a fila da 086;
  a 090 substitui funções e guardas da 085–089 depois das auditorias, e a 091
  corrige a 090.
- **Função nova revoga `anon` por nome.** `REVOKE ... FROM PUBLIC` não tira o
  que o Supabase concede por padrão. `function-grants.test.ts` lê as migrações
  e acusa.

O `supabase/ci/verify-schema.sql` confere o desenho de 082 a 091 (políticas,
privilégios, gatilhos, índices únicos), e cada asserção nova foi rodada contra
o banco — e rodada alterada, para ver que acusa.

**A guarda da exceção de peso só foi exercitada no banco no caminho de
agente** (recusa, autor preservado, limpar zera). O caminho de admin — gravar
e ter o autor forçado — não: o único admin da conta de teste é o Gabriel, e
entrar como ele não se faz.

---

## Pendências

### 1. Publicar não é implantar

O release existe no GitHub, mas nenhum deploy foi registrado para `cb01957`
(nem implantação, nem status de host no commit). Onde a 0.11.0 for posta no
ar, as migrações **070 a 091** vão antes, no Supabase daquele ambiente e em
ordem ([deploy.md](./deploy.md#checklist-antes-de-apontar-o-whatsapp-para-produção)):
a gaveta da oportunidade já lê colunas da 070 (`sales_order_number`,
`shipping_cost`), e a fila do Bling chama funções da 090.

### 2. A integração com o Bling nunca falou com o Bling

Oito fases escritas e testadas contra dublês; nenhuma chamada real. Falta o que
é do Gabriel (`docs/spec-orcamentos-bling.md` §4): cadastrar o aplicativo
(escopos antes de conectar), as três variáveis, o cron, os webhooks e a conta
ou protocolo de homologação. Sem as variáveis a integração fica dormente; com
elas, pedidos só são criados depois que um admin liga **Pedidos no Bling**.

O que ficou de fora e as escolhas feitas estão em §11 do plano; o roteiro de
operação em `docs/operacao-bling.md`.

### 3. O OAuth da Google nunca falou com a Google

Mesma situação desde a 0.10.0: falta o app no Google Cloud Console
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`).

### 4. Telas nunca vistas com sessão de admin

As verificações em tela desta sessão usaram um usuário de teste com papel de
agente. Promover o usuário a admin foi recusado pelo controle de permissões, e
não foi contornado. Configurações › Bling, Transportadoras e Vendedor no Bling
estão testadas nas funções e nas rotas, não na tela.

### 5. Sincronizar os templates da Meta

`message_templates` continua vazia no ambiente de desenvolvimento.

---

## O MCP do Supabase, e a pegadinha da raiz

**A raiz do projeto é `D:\wacrm\wacrm`, não `D:\wacrm`.**

O `.mcp.json` que declara o servidor do Supabase mora na raiz, e os
servidores MCP são lidos **na abertura da sessão**. Abrir um nível acima
carrega o repositório mas não o MCP, em silêncio.

O `.mcp.json` **não é versionado, e isso está decidido** (Gabriel,
2026-09-07): ele aponta o `project_ref` do banco e é infraestrutura de quem
desenvolve, não do produto.

---

## Armadilhas que custaram tempo, para não custarem de novo

**Dois espaços de identificador para "responsável".** `deals.assigned_to`
referencia `profiles.id`; `tasks.assigned_to` e o vínculo de vendedor do Bling
(`bling_seller_links.user_id`) referenciam `auth.users`. Onde os dois se
encontram, há um join.

**`uuid_generate_v4()` dentro de função com `search_path` travado.** No
Supabase a extensão mora em `extensions`; a função não acha a outra e morre com
42883. Use `gen_random_uuid()`. (DEFAULT de coluna não tem o problema.)

**`try/finally` em componente.** A regra de hooks do lint (análise do React
Compiler) desiste do componente inteiro; o sintoma é diretiva de desabilitar
"sem uso".

**O Browser pane com viewport emulado** escala a tela, e cliques por
coordenada caem fora do alvo. Volte ao `desktop` e clique por script.

**O fim exclusivo do dia inteiro da Google** e **o prefixo `w` que não existe
em base32hex** continuam valendo (ver `lib/calendar-sync`).

---

## Ferramentas que não se comportam como o esperado nesta máquina

- **`jq` não existe.** Use o `--jq` embutido do `gh`.
- **`du -sh` não termina** na pasta do projeto. Use PowerShell com
  `Get-ChildItem -Recurse -File -Force | Measure-Object Length -Sum`.
- **O cache do Turbopack cresce ~20 GB em duas semanas** em `.next/dev`. É
  descartável.
- **`node -e` com crases dentro de um comando do Bash** quebra: o shell
  interpreta os template literals. Use um arquivo de script.

---

## O que está parado, por decisão

Três documentos de planejamento de 2026-09-04, **nenhum implementado e nenhum
com "ok" de execução**:

- `docs/spec-acoes-de-agente.md` — dar ações de escrita à IA interna.
- `docs/pesquisa-plataformas-de-agente.md` — a pesquisa que o acompanha.
- `docs/spec-transporte-secundario.md` — Baileys ao lado da Cloud API.

Os dois specs reivindicavam a numeração 070 em diante, hoje ocupada até a 091:
a próxima livre é a **092**, e eles precisam ser renumerados na hora de
escrever.
