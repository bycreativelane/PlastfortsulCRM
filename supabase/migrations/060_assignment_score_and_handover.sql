-- ============================================================
-- 060_assignment_score_and_handover.sql — quem atende melhor, e o que
-- fazer quando quem recebeu sumiu
--
-- Dois pedidos que são o mesmo assunto:
--
--   "um sistema de score dos atendentes baseado em melhores resultados
--    para direcionamento"
--   "identificar um usuário que esteja ausente por 30 minutos e acabou
--    deixando alguém sem resposta para enviar para o proximo"
--
-- O primeiro decide para quem vai; o segundo, o que fazer quando aquela
-- escolha não deu certo. Nenhum dos dois presta sem o outro: distribuir
-- pelo melhor atendente não ajuda se ele saiu para almoçar, e repassar
-- sem critério só move a fila de lugar.
--
-- ------------------------------------------------------------------
-- O QUE ESTE ARQUIVO NÃO FAZ: GUARDAR O SCORE
-- ------------------------------------------------------------------
--
-- Não há coluna `score`. Ele é CALCULADO na hora, a partir de mensagens
-- e conversas que já existem — tempo até a primeira resposta e quantas
-- conversas a pessoa encerrou.
--
-- Guardar seria mais rápido e estaria errado dentro de uma hora: um
-- número gravado envelhece em silêncio, e a primeira vez que a
-- distribuição mandar tudo para quem foi bom semana passada, ninguém
-- vai saber que a coluna parou de ser atualizada. Calcular é caro uma
-- vez por atribuição e sempre verdadeiro.
--
-- Idempotente.
-- ============================================================


-- ============================================================
-- 1. O modo novo de distribuição
-- ============================================================
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_auto_assign_mode_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_auto_assign_mode_check
  CHECK (auto_assign_mode IN ('off', 'round_robin', 'least_busy', 'best_score'));

COMMENT ON COLUMN accounts.auto_assign_mode IS
  'off | round_robin | least_busy | best_score. O último manda para '
  'quem responde mais rápido e resolve mais, calculado na hora a partir '
  'das mensagens — nunca de uma coluna guardada, que envelheceria em '
  'silêncio.';


-- ============================================================
-- 2. Quanto tempo esperar antes de repassar
--
-- ZERO É DESLIGADO, E É O PADRÃO.
--
-- Repassar tira uma conversa de uma pessoa e dá para outra, sem ninguém
-- pedir. Numa equipe pequena onde todo mundo sabe quem está onde, isso
-- é atrapalhar; numa grande, é o que impede um cliente de esperar a
-- tarde inteira porque quem pegou saiu. Qual das duas é a sua não é
-- coisa que uma migração deva adivinhar — então ela não adivinha, e
-- quem liga escolhe o número.
--
-- 30 é o que o pedido citou e é o que a tela sugere; a coluna aceita
-- qualquer coisa de 5 minutos para cima. Abaixo disso não é ausência, é
-- alguém no banheiro.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auto_reassign_after_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (auto_reassign_after_minutes = 0
           OR auto_reassign_after_minutes BETWEEN 5 AND 1440);

COMMENT ON COLUMN accounts.auto_reassign_after_minutes IS
  'Minutos que um cliente pode ficar esperando com o responsável '
  'ausente antes da conversa ser repassada. 0 = nunca repassa, que é o '
  'padrão: mover trabalho entre pessoas sem ninguém pedir é uma '
  'decisão da equipe, não um comportamento a herdar.';


-- ============================================================
-- 3. O registro do repasse
--
-- Sem isto o atendente descobre que perdeu uma conversa quando ela some
-- da lista dele, e o próximo descobre que ganhou quando ela aparece na
-- dele. Os dois merecem saber por quê — e um repasse automático que não
-- se explica é a coisa mais fácil de culpar quando algo dá errado.
--
-- Uma tabela e não uma coluna em `conversations`: uma conversa pode ser
-- repassada mais de uma vez num dia ruim, e a segunda não pode apagar a
-- primeira.
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_handovers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Por que saiu da mão de quem estava. Vocabulário fechado: um motivo
  -- em texto livre vira seis grafias da mesma coisa e nenhum relatório.
  reason TEXT NOT NULL
    CHECK (reason IN ('away', 'manual', 'no_response')),

  -- Quanto tempo o CLIENTE esperou até o repasse acontecer. Guardado no
  -- momento, e não recalculado depois, porque `waiting_since` é zerado
  -- assim que alguém responde — e aí a informação sumiria.
  waited_minutes INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handovers_conversation
  ON conversation_handovers(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_handovers_account
  ON conversation_handovers(account_id, created_at DESC);

ALTER TABLE conversation_handovers ENABLE ROW LEVEL SECURITY;

-- Todo membro LÊ. Saber que uma conversa foi repassada, e por quê, é
-- informação da equipe — esconder produz exatamente a desconfiança que
-- o registro existe para evitar.
DROP POLICY IF EXISTS handovers_select ON conversation_handovers;
CREATE POLICY handovers_select ON conversation_handovers FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

-- Ninguém escreve pela API. Os repasses são gravados pela varredura,
-- com service role. Uma política de INSERT aqui deixaria alguém forjar
-- um repasse que nunca aconteceu, e o registro perderia o sentido.


-- ============================================================
-- 4. Índice para a varredura
--
-- A varredura pergunta, a cada rodada: quais conversas estão esperando
-- há mais de N minutos e têm responsável? Sem índice isso é um scan da
-- tabela inteira num job que roda de minuto em minuto.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_conversations_waiting_assigned
  ON conversations(account_id, waiting_since)
  WHERE waiting_since IS NOT NULL AND assigned_agent_id IS NOT NULL;
