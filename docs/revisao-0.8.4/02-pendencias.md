# O que não foi feito

---

## Banco: aplicado

**Treze** migrações novas nesta passagem, da 049 à 061.

**Da 049 à 059 estão aplicadas e sondadas.** As sondas em `.claude/tmp/`
confirmam coluna por coluna (`probe-schema.mjs`) e comportamento por
comportamento (`probe-behaviour.mjs`, `probe-057.mjs`, `probe-hooks.mjs`,
`probe-queries.mjs`) — o backfill da 052, o gatilho e a coluna GENERATED
da 054, o índice único parcial do SKU, e as travas da 058: escopo padrão
`["data"]`, escopo inválido recusado (23514), token duplicado recusado
(23505), chave de deduplicação duplicada recusada, entrega rejeitada com a
mesma chave ainda inserindo, e o `ON DELETE SET NULL` da 059.

**A 060 e a 061 entraram depois**, e foram sondadas em 31 de agosto de
2026: `accounts.auto_reassign_after_minutes` e `conversation_handovers`
existem, `account_capabilities` e `role_capabilities` existem, e o
`CHECK` ampliado aceita mesmo `best_score` — gravado e desfeito na conta
de teste. As treze estão no banco.

O que sobrou das duas não é aplicação, é código: o painel da 061, e as
asserções de CI das duas.

### 060 — `060_assignment_score_and_handover.sql`

Amplia o `CHECK` de `auto_assign_mode` para aceitar `best_score`, cria
`accounts.auto_reassign_after_minutes` e a tabela
`conversation_handovers`.

Sem ela, **a tela abre e não grava**: escolher "Melhor desempenho" em
Configurações › Atribuição bate no `CHECK` antigo, e o campo de minutos
não existe para receber valor. O repasse por ausência não roda — não tem
onde registrar quem tinha a conversa, quem recebeu e quanto o cliente
esperou.

O score em si **funciona sem a migração**: ele é calculado a partir de
`conversations` e `messages`, que já existem. O que falta é o modo de
atribuição que o consome.

### 061 — `061_custom_permissions.sql`

`account_capabilities` (as permissões que a conta inventou) e
`role_capabilities` (as exceções à matriz do código), com o gatilho que
impede o dono de ser negado.

Sem ela, `loadPermissionMatrix` devolve `EMPTY_MATRIX` — os dois
`SELECT` falham, o `catch` recolhe, e **o app se comporta exatamente como
antes da 061**, que é o teste que toda tabela de override tem que passar.
Nada quebra; nada de novo existe.

**E o painel dela não foi construído.** A migração, o resolvedor
(`lib/auth/permission-matrix.ts`) e os doze testes estão prontos. A tela
não. É o item mais concreto ainda aberto desta passagem.

E o preço de não ter a tela é maior do que parece: **`permission-matrix.ts`
é importado só pelo próprio teste.** `loadPermissionMatrix`, `roleCan` e
`personCan` não são chamados por nenhuma rota nem componente. Com a
migração aplicada, isso deixou de ser "a tela falta" e passou a ser
"existem duas tabelas vivas que nada no app lê" — os doze testes passam
contra um módulo que ninguém executa.

### O que o CI ainda não confere

`supabase/ci/verify-schema.sql` tem asserções para tudo da 040 à 059 e
**nenhuma para a 060 ou a 061**. Isso era consistente enquanto elas não
estavam aplicadas. **Não é mais.** Elas entraram, e o portão que pegou os
erros das doze anteriores é cego exatamente para as duas mais novas: são
68 asserções que param na 059.

### 049 — `049_media_understanding.sql`

Três colunas em `messages`, uma em `ai_configs`, e o `CHECK` de
`ai_usage_log.mode` ampliado.

**Sem ela, o comportamento é inerte e não quebrado**, de propósito:

- `loadAiConfig` faz o `SELECT` sem a coluna nova quando o Postgres
  responde 42703, e devolve `mediaUnderstandingEnabled: false`. Sem esse
  recuo o `SELECT` falharia inteiro — e essa função está no caminho da
  resposta automática, então o sintoma não seria "transcrição desligada",
  seria **o assistente parar de responder a tudo**.
- `false` e não `true` no recuo: a janela sem a migração é uma em que o
  recurso poderia gastar os tokens da conta e não ter onde guardar o
  resultado.
- A rota `GET /api/ai/config` tem o mesmo recuo, e o `POST` derruba o
  campo e tenta de novo se o banco não o conhecer — senão um admin
  editando o prompt do sistema receberia 500 na configuração inteira por
  causa de uma chave que ainda não existe.

### 050 — `050_account_governance.sql`

`account_audit_log`, `profiles.last_sign_in_at`,
`profiles.permission_overrides`, `record_sign_in()`,
`set_member_permissions()` e o gatilho `guard_permission_overrides`.

**Sem ela:**

- O `AuthProvider` faz o `SELECT` do perfil sem `permission_overrides` no
  42703 — mesmo motivo de vida ou morte que o de cima: essa linha é a que
  estabelece conta e cargo, e perdê-la deixa a sessão silenciosamente em
  somente-leitura.
- `record_sign_in()` responde `PGRST202`, que o chamador engole.
- O painel de auditoria desenha o estado "falta aplicar a 050" em vez de
  um erro vermelho.
- A rota de permissões responde 409 com `pending: true`.

### 051 — `051_assignment_rules.sql`

As regras do rodízio: `least_busy` no CHECK do modo, o piso de cargo, o
que fazer sem ninguém online, o teto por pessoa, o opt-out por membro, e
a RPC que escreve o opt-out de outra pessoa.

**Sem ela:** o motor lê o SELECT estreito e se comporta exatamente como
antes; a tela salva só a estratégia e mostra o aviso "falta aplicar a
051"; o interruptor por pessoa responde `PGRST202` e volta sozinho.

**Com ela há uma mudança de comportamento, a única desta passagem:** o
piso de cargo passa a ser `agent`, então um `viewer` deixa de receber
conversas. É a correção do defeito confirmado na auditoria da 0.8.2.

### 052 — `052_team_rooms.sql`

`team_rooms`, `team_messages.room_id`, o gatilho que protege a sala
padrão, as duas políticas de `team_messages` reescritas para checar que a
sala é da mesma conta, e o backfill de uma sala padrão por conta.

**Sem ela:** `loadTeamRooms` responde `'missing-table'`, o cabeçalho da
sala volta a ser um título sem seletor, a tela de Salas desenha "falta
aplicar a 052", e um envio que mencionasse `room_id` cai no recuo que
insere sem a coluna — a mensagem não se perde.

### 053 — `053_ai_agent_depth.sql`

O prompt em partes (`persona_name`, `business_description`, `tone`,
`guardrails`, `escalation_rules`), `enabled_tools`, `retrieval_top_k`,
`assist_enabled`, `setup_completed_at`, e `ai_knowledge_documents.pinned`.

**Sem ela:** `loadAiConfig` tem uma escada de **três** SELECTs — o mais
largo, depois o da 049, depois o original — e cai no que o banco tiver. O
resultado é o comportamento anterior exato: nenhuma linha de persona no
prompt, nenhuma ferramenta, quatro trechos, apoio desligado. O assistente
de configuração desenha com os padrões e salva o que a rota conseguir.

**Por que a escada e não um recuo só:** essa função está no caminho da
resposta automática **e** no do rascunho. Uma coluna que o banco não tem
tem que degradar para "esse recurso está desligado", nunca para "o
assistente sumiu".

### 054 — `054_products.sql`

`products`, `deal_items`, `contacts.product_interest`, o gatilho que soma
o valor do negócio e o índice único parcial do código.

**Sem ela:** `loadProducts` responde `'missing-table'`, a tela de Produtos
desenha "falta aplicar a 054", o editor de itens **não desenha nada** no
formulário de negócio (o valor digitado continua sendo o valor), o público
"por produto" no disparo não estima e o `product_interest` fica fora do
payload do contato. A ferramenta de catálogo do assistente responde ao
**modelo** que o catálogo não está disponível, em vez de estourar a
geração.

### Verificação no CI

`supabase/ci/verify-schema.sql` ganhou **dezoito** asserções novas ao
longo desta passagem : as colunas da 049 e o `CHECK` ampliado; a tabela do
log, a **ausência** de políticas de UPDATE/DELETE nela, a coluna de
overrides, o gatilho e as duas funções da 050; o `least_busy` no CHECK, as
duas colunas e a RPC da 051; e a tabela, a coluna, o gatilho e **o
backfill** da 052.

Duas dessas valem mais que as outras dezesseis, porque asseram coisas
invisíveis de fora:

- **A ausência** das políticas de escrita no log de auditoria.
  Append-only é uma propriedade do que **não** existe, e é o tipo de coisa
  que uma migração futura devolve por acidente.
- **O backfill** da 052 — "toda conta tem exatamente uma sala padrão". Uma
  conta sem ela é uma conta cuja sala da equipe abre vazia, e a migração
  teria aplicado limpa.

---

## Não implementado, de propósito

### Item 7 — personalização por perfil

O pedido foi **"estudar"**. O estudo está em
[04-personalizacao.md](04-personalizacao.md): sete propostas ordenadas
por custo, com o levantamento de onde cada preferência mora hoje. **Zero
linhas de código.**

O achado, se você só ler uma linha: **as nove preferências pessoais do
produto moram no `localStorage`, nenhuma no perfil.** Trocar de máquina
apaga todas.

---

## Herdado da 0.8.3, ainda aberto

Um destes foi fechado sem ser riscado da lista — ver abaixo da tabela.

### Achados de servidor da auditoria da 0.8.2

| Onde | O quê |
| ---- | ----- |
| `lib/conversations/auto-assign.ts:305` | A atribuição reporta vencedor mesmo quando perde a corrida. Falta `.select('id')`. |
| `lib/notifications/new-message.ts:99` | Trava de rajada read-then-insert sem índice único. |
| `lib/notifications/new-message.ts:165` | Releitura sem limite de `profiles` a cada mensagem. |
| `app/api/whatsapp/webhook/route.ts:842` | O fan-out de notificação é aguardado **na frente** do motor de fluxos. |
| `migrations/045:118` | `idx_conversations_visible` não pode ser escolhido pela consulta da lista. |
| `lib/team/messages.ts:103` | `conversation_id` continua peso morto. **`edited_at` saiu desta lista** — ver [§3](01-worklog.md#3-editar-e-apagar-na-sala-da-equipe). |

Sobre o `webhook:842`: esta passagem **não piorou** essa fila. A
transcrição foi colocada no fim do `processMessage`, atrás de tudo, pelo
motivo oposto — é a coisa mais lenta do handler e ninguém depende dela.

### A 041 continua dizendo duas coisas

O release lista `041_playbooks.sql` como deliberadamente não aplicada, e
a sonda mostra que **está** aplicada no projeto do `.env.local`. O app
embarca a interface de playbook sem guarda de tabela ausente. Decisão em
aberto, e é sua.

### Os `npm run seed:*` não rodam num clone

Seis atalhos no `package.json` apontando para uma pasta `scripts/` que
não está no repositório. Devolver a pasta ou tirar os atalhos — decisão
de quem publica.

### Pedidos antigos

- **Faixas de áudio ao vivo** na gravação (waveform).
- **Bandeira no seletor de moeda.**
- **Cal.com no celular** — é um projeto, não um ajuste.
- **Opções de estilo para o BETA** — foi pedido "vê opções" e só uma foi
  apresentada, na 0.8.2.
- **Clique direito no resto do sistema** — existe em conversa e card do
  Kanban; contatos, fluxos, automações, disparos e modelos não têm.

---

## O que ficou por conta do modelo de transcrição

`AI_TRANSCRIBE_MODEL` tem padrão `whisper-1`, e a escolha é conservadora
de propósito: isto roda numa chave que a conta trouxe, num tier que a
conta escolheu, e o modo de falha que vale desenhar contra é "seus áudios
pararam de funcionar porque escolhemos um modelo que a sua conta não
chama". Uma conta que queira `gpt-4o-mini-transcribe` diz isso no
ambiente.

Está documentada no `.env.local.example`, comentada, junto das outras
duas de ajuste fino da IA.


---

### As três que valem mais que as outras vinte e duas

O `verify-schema.sql` tem **25** asserções novas desta série ao todo.
Três delas cobrem coisas que aplicam limpo e mesmo assim não entregam:

| Asserção | Sintoma sem ela |
| -------- | --------------- |
| Ausência de política de UPDATE/DELETE no log de auditoria | O log vira um documento que os auditados editam |
| Toda conta tem uma sala padrão (backfill da 052) | A sala da equipe abre vazia |
| O gatilho `deal_items_sync_value` (054) | **O pior de todos:** as linhas gravam, `deals.value` não se move, e o relatório volta a mentir sem nenhum erro em lugar nenhum |

---

## Não implementado, de propósito — segunda leva

### WhatsApp em passos

A conversão da tela de WhatsApp para o `StepFlow` do Agente IA. O motivo
está em [§25](01-worklog.md#25-harmonia-nas-outras-seções): mais de mil
linhas, alertas e botões entremeados, e é a tela onde um erro não é
cosmético — é o número parar de receber. Merece uma sessão em que alguém
acompanha.

### A análise de mercado

[06-mercado-brasileiro.md](06-mercado-brasileiro.md) lista oito lacunas.
**Nenhuma foi implementada** — é análise. As três que eu escolheria:
extrair estado da conversa, histórico de etapa, e LGPD.

Uma delas (duplicidade por CNPJ) foi **parcialmente** fechada nesta
passagem — o cadastro confere e avisa; a importação em massa ainda não.

---

## Ainda aberto — terceira leva (itens 39 a 41)

### Cinco dos nove pontos de UX

O item 39 pediu nove coisas. Quatro fechadas em
[§37](01-worklog.md#37-o-botão-direito-contatos-as-rotas-que-não-iam-a-lugar-nenhum-e-o-período-livre)
— botão direito, renomear Clientes, rotas de configuração, e o seletor de
período com a barra de cima medida. Faltam:

| # | Pedido | Estado |
| - | ------ | ------ |
| 1 | Cor das etiquetas quebrada no light | **Não reproduzido** — ver abaixo |
| 2 | Cores e visualização dos gráficos | Aberto (a distribuição e a barra de cima foram feitas) |
| 3 | Visão geral: usabilidade, linhas e texto | Aberto |
| 4 | Área de CRM e o funil | Aberto |
| 5 | Calendário, no mesmo padrão | Aberto |
| 6 | Lista de contatos e tipografia padronizada | Aberto |

**Sobre as etiquetas no light.** Os tokens foram medidos no navegador,
convertidos para sRGB por canvas:

| | light | dark |
| - | ----- | ---- |
| chip (`--muted`) contra o card | 1.14:1 | 1.09:1 |
| texto sobre o chip | 7.02:1 | 9.26:1 |

O chip é fraco nos **dois** modos e o texto é legível nos dois. A
matemática do `stageChip` está correta contra as duas superfícies, e o
único lugar do produto que usa chip preenchido é a lista de conversas.
**Não há nada que quebre só no light** — falta o print para saber que
tela era.

### O painel das permissões personalizadas

Migração 061, `lib/auth/permission-matrix.ts` e doze testes prontos. A
tela não existe. Ver a seção da 061 acima.

### Uma decisão que ficou com o Gabriel

Tornar **Acesso e auditoria** concedível a uma pessoa específica, em vez
de "admin para cima".

Hoje a seção é gatilhada em `settings.manage` porque é isso que a tela
realmente exige: `AccessPanel` recusa qualquer um abaixo de admin por
conta própria, e `/api/account/audit` chama `requireRole('admin')`.
Gatilhá-la em `audit.view` — que foi a primeira tentativa — só produzia
uma linha no trilho que abria "Acesso restrito".

Fazer valer de verdade exige **separar o painel em duas metades** (a
matriz de permissões continua sendo de admin; o log de auditoria passa a
ser de quem tiver `audit.view`) e **afrouxar o `requireRole('admin')` da
API**. Isso abre os horários de login de cada membro e todas as mudanças
de configuração da conta para quem receber a permissão. Não é uma escolha
técnica, é uma escolha de governança — por isso não foi feita sozinha.

### O `MAX_PAGES` é um limite real, não um detalhe

`lib/supabase/paged.ts` lê no máximo 40 páginas de mil linhas e **lança**
ao chegar lá — o Relatórios captura e diz "período grande demais para
somar aqui, escolha uma janela menor".

É a resposta honesta e não é a resposta certa. A certa é uma RPC que
agrega em SQL em vez de trazer as linhas para o navegador contar; isso
precisa de migração. Enquanto não vier, uma conta movimentada não
consegue analisar um ano inteiro de uma vez.
