-- ============================================================
-- 062_whatsapp_usage_log.sql — o que cada template disparado custou
--
-- ------------------------------------------------------------
-- O PROBLEMA
-- ------------------------------------------------------------
--
-- Hoje o produto sabe QUANTOS templates saíram, mas só se você souber
-- onde procurar, e nunca de um lugar só:
--
--   * campanha         → broadcast_recipients, uma linha por destinatário
--   * caixa de entrada → messages, content_type='template'
--   * automação        → messages também, sender_type='bot'
--   * API pública      → messages
--
-- Quatro tabelas, três formatos, e a maior fonte de volume — campanha —
-- é justamente a que NÃO escreve em `messages`. Somar as quatro para
-- responder "quanto disparamos em julho" é um trabalho que ninguém faz
-- duas vezes.
--
-- ------------------------------------------------------------
-- O QUE MOTIVA AGORA
-- ------------------------------------------------------------
--
-- A Meta já manda, em cada webhook de status, um objeto `pricing` que
-- diz se aquela mensagem é FATURÁVEL e sob qual CATEGORIA ela foi
-- cobrada. O handler de status descarta isso — a interface do webhook
-- em `src/app/api/whatsapp/webhook/route.ts` tipa o status como
-- `{ id, status, timestamp, recipient_id }` e o resto do payload cai no
-- chão.
--
-- Isso importa por uma razão que não é óbvia: A CATEGORIA COBRADA NÃO É
-- A CATEGORIA QUE ARQUIVAMOS. A Meta recategoriza templates por conta
-- própria — um que você registrou como Marketing pode ser cobrado como
-- Utility, e o contrário também. Um relatório de custo construído sobre
-- `message_templates.category` é um relatório sobre a nossa intenção,
-- não sobre a fatura.
--
-- E é histórico irrecuperável: cada dia sem gravar é um dia que não dá
-- para reconstruir depois, porque o webhook passa uma vez só.
--
-- ------------------------------------------------------------
-- POR QUE UMA TABELA NOVA, E NÃO COLUNAS EM `messages`
-- ------------------------------------------------------------
--
-- Porque campanha não escreve em `messages`, e é onde está o volume.
-- Colunas de preço em `messages` cobririam caixa de entrada, automação
-- e API, e deixariam de fora exatamente o caso que motivou a tabela.
--
-- Além disso `messages` é a linha do tempo de uma conversa: uma coluna
-- de faturamento ali é lida em toda renderização do inbox e escrita por
-- um webhook que não tem nada a ver com o que o cliente vê.
--
-- É o mesmo desenho de `ai_usage_log` (migração 033) — um log
-- append-only por evento, escopo de conta, escrito pelo service role,
-- agregado em janela limitada. O problema é o mesmo com outra unidade
-- de medida.
--
-- ------------------------------------------------------------
-- DUAS ESCRITAS, DUAS FONTES
-- ------------------------------------------------------------
--
--   1. NO DISPARO  — o produto grava o que sabe: qual template, para
--                    quem, vindo de onde. Garante que todo disparo
--                    tenha linha mesmo que webhook nenhum chegue.
--
--   2. NO WEBHOOK  — a Meta preenche as colunas de faturamento pelo
--                    `wamid`. UPDATE, nunca INSERT: uma linha sem par
--                    no disparo é uma mensagem que este produto não
--                    mandou, e inventá-la produziria um total que não
--                    bate com nada.
--
-- Uma linha com `priced_at IS NULL` é "ainda não sabemos", e a interface
-- diz isso com essas palavras. Não é zero. As duas coisas se parecem num
-- gráfico e são opostas numa fatura.
--
-- ------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO NÃO FAZ
-- ------------------------------------------------------------
--
-- NÃO CONVERTE EM DINHEIRO. Não existe tabela de tarifas aqui, de
-- propósito: o modelo de cobrança da Meta está em movimento e um preço
-- fixado agora ficaria errado em silêncio. O que fica pronto é a base —
-- volume e faturabilidade, por categoria cobrada, por origem.
--
-- Quando as tarifas entrarem, elas entram como tabela própria com
-- vigência (`effective_from`), e o join é por (categoria cobrada, data
-- do disparo) — ambas já gravadas aqui. Relatório antigo continua
-- calculado na tarifa da época, que é a única forma de um histórico de
-- custo não mudar sozinho.
--
-- O país do destinatário, que a tarifa também precisa, deriva de
-- `contact_id` → `contacts.phone`. Não está desnormalizado aqui porque
-- não há tabela de prefixo→país no produto ainda, e inventar uma para
-- um relatório que hoje não mostra dinheiro seria escopo emprestado do
-- futuro.
--
-- Idempotente.
-- ============================================================


-- ============================================================
-- 1. O log
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_usage_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  /**
   * O id da mensagem na Meta. A CHAVE DE TUDO: é por ele que o webhook
   * de status encontra esta linha para preencher o faturamento.
   *
   * NÃO É ÚNICO, e isso é herdado da realidade, não uma folga: a
   * migração 009 já registra que ids da Meta se repetem entre números
   * diferentes. O enriquecimento do webhook resolve pegando a linha
   * mais recente com este wamid, da mesma forma que o espelhamento em
   * `messages` já convive com a duplicidade hoje.
   */
  wamid TEXT NOT NULL,

  /**
   * Para onde foi. Todos ON DELETE SET NULL: o registro de uso é
   * contábil e vive mais do que a conversa, o contato ou a campanha
   * que o originou. Apagar um contato não pode reescrever o passado de
   * quanto foi disparado em março.
   */
  conversation_id UUID REFERENCES conversations(id)       ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id)            ON DELETE SET NULL,
  broadcast_id    UUID REFERENCES broadcasts(id)          ON DELETE SET NULL,
  template_id     UUID REFERENCES message_templates(id)   ON DELETE SET NULL,

  /**
   * O nome do template, DESNORMALIZADO de propósito.
   *
   * `template_id` some quando alguém apaga o template — e apagar
   * template é rotina, é o que a Meta obriga a fazer para recriar um
   * reprovado. Sem o nome gravado aqui, o relatório do mês passado
   * perderia a linha mais interessante que tem: qual template.
   */
  template_name     TEXT NOT NULL,
  template_language TEXT,

  /**
   * A categoria QUE NÓS ARQUIVAMOS, minúscula (a coluna equivalente em
   * `message_templates` é TitleCase por herança da 001; aqui segue o
   * vocabulário da Meta, que é o que o webhook devolve, para que as
   * duas colunas de categoria sejam comparáveis sem tradução).
   *
   * Guardada JUNTO com a cobrada, e não em vez dela, porque a diferença
   * entre as duas é informação: é a Meta recategorizando, e é a única
   * forma de alguém perceber que isso aconteceu.
   */
  declared_category TEXT
    CHECK (declared_category IS NULL OR declared_category IN (
      'marketing', 'utility', 'authentication', 'service'
    )),

  /**
   * De onde partiu o disparo. É o que transforma um total em algo
   * acionável — "gastamos muito" não é resposta, "a campanha X foi
   * metade do mês" é.
   */
  origin TEXT NOT NULL
    CHECK (origin IN ('inbox', 'broadcast', 'automation', 'flow', 'api')),

  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ---------------------------------------------------------
  -- O que a Meta respondeu. Tudo NULL até o webhook chegar.
  -- ---------------------------------------------------------

  /** `pricing.billable`. NULL = ainda não sabemos. Não é `false`. */
  billable BOOLEAN,

  /**
   * `pricing.category` — a categoria SOB A QUAL FOI COBRADO.
   *
   * Sem CHECK, de propósito, e essa é a decisão mais importante do
   * arquivo. O vocabulário de cobrança da Meta mudou mais de uma vez e
   * vai mudar de novo. Um CHECK aqui transforma cada categoria nova num
   * UPDATE que falha dentro de um webhook — ou seja, em dado perdido
   * para sempre, que é o oposto do que esta tabela existe para fazer.
   * Um valor desconhecido aparece no relatório com o nome que a Meta
   * deu; um valor rejeitado não aparece em lugar nenhum.
   */
  billable_category TEXT,

  /** `pricing.pricing_model` — CBP (por conversa) | PMP (por mensagem). */
  pricing_model TEXT,

  /**
   * `pricing.type` — regular | free_customer_service | free_entry_point.
   * É o campo que separa "não foi cobrado porque é de graça" de "não foi
   * cobrado porque não saiu".
   */
  pricing_type TEXT,

  /** `conversation.origin.type` e `conversation.id`, quando vierem. */
  conversation_origin  TEXT,
  meta_conversation_id TEXT,

  /**
   * Quando o faturamento foi preenchido. É o marcador de "esta linha
   * está resolvida" — a interface conta as não resolvidas em separado
   * em vez de somá-las como zero.
   */
  priced_at TIMESTAMPTZ,

  /**
   * Último status entregue pela Meta para este wamid. Não substitui
   * `messages.status` — existe porque campanha não tem linha em
   * `messages`, e porque uma mensagem `failed` nunca recebe `pricing`:
   * sem esta coluna, um disparo que falhou e um que ainda não teve
   * resposta ficam indistinguíveis, os dois com `priced_at` nulo.
   */
  last_status TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE whatsapp_usage_log IS
  'Um registro por template disparado. Escrito no envio pelo produto e '
  'completado pelo webhook de status com o objeto `pricing` da Meta. '
  'Append-only; o UPDATE do webhook só preenche colunas de faturamento.';


-- ============================================================
-- 2. Índices — cada um responde a uma pergunta que o produto faz
-- ============================================================

-- O relatório: uma conta, uma janela, do mais novo para o mais velho.
CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_account_sent
  ON whatsapp_usage_log(account_id, sent_at DESC);

-- O webhook: achar a linha pelo id da Meta. Sem isto, cada status
-- recebido vira um seq scan numa tabela que só cresce.
CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_wamid
  ON whatsapp_usage_log(wamid);

-- "Quanto custou aquela campanha" — a pergunta que a tela de campanha
-- vai fazer. Parcial porque a maioria das linhas não vem de campanha.
CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_broadcast
  ON whatsapp_usage_log(broadcast_id)
  WHERE broadcast_id IS NOT NULL;


-- ============================================================
-- 3. RLS
--
-- SELECT para qualquer membro da conta, e NÃO só para admin.
--
-- É o oposto do que `ai_usage_log` faz, e a diferença é o lugar onde o
-- dado aparece. Aquele é um painel de Configurações, classe billing.
-- Este alimenta /relatórios, cuja porta é a capacidade `reports.view` —
-- declarada `rlsBacked: false` em `src/lib/auth/capabilities.ts`, ou
-- seja: o banco entrega para qualquer membro e QUEM DECIDE É A
-- APLICAÇÃO, exatamente como já acontece com o resto da página.
--
-- Fechar aqui em `admin` quebraria o caso que a 050 existe para
-- permitir: dar `reports.view` a um agente. Ele veria a página inteira
-- e um painel vazio, sem erro e sem explicação — que é pior do que não
-- ter o painel.
--
-- Escrita: nenhuma política para `authenticated`. Só service role
-- (envio e webhook), como no `ai_usage_log`.
-- ============================================================
ALTER TABLE whatsapp_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_usage_log_select ON whatsapp_usage_log;
CREATE POLICY whatsapp_usage_log_select ON whatsapp_usage_log FOR SELECT
  USING (is_account_member(account_id));
