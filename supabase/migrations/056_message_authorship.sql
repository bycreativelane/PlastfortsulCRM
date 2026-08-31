-- ============================================================
-- 056_message_authorship.sql — quem mandou, e se chegou
--
-- O pedido, de quem está testando com o time:
--
--   "Envios de mensagens deixar no modelo de whatsapp.
--    Quando lead responde fica sem os verificados.
--    Quando matheus responde aparece os verificados e o nome do matheus.
--    Quando thales responde aparece os verificados e o nome do thales.
--    Puxando sempre o nome do atendente que esta mandando a mensagem."
--
-- É o modelo do WhatsApp e ele é exato: na lista de conversas, o que
-- SAIU leva os tiques e o nome de quem escreveu; o que ENTROU não leva
-- nada. O WhatsApp escreve "Você:" porque o aparelho é de uma pessoa só.
-- Aqui o número é do time inteiro, então "Você:" é mentira na tela de
-- qualquer colega — o nome do atendente é a versão certa da mesma ideia.
--
-- ------------------------------------------------------------------
-- O BURACO REAL: `messages.sender_id` NUNCA FOI ESCRITO
-- ------------------------------------------------------------------
--
-- A coluna existe desde a 001. Nenhum caminho de envio a preenche —
-- `send-message.ts` grava `sender_type: 'agent'` e para por aí. O único
-- rastro de autoria no sistema é o prefixo `*Nome*` que a assinatura
-- coloca DENTRO do texto, e ele:
--
--   · é opcional e vem DESLIGADO por padrão;
--   · mora no `localStorage`, então é um apelido por máquina e não uma
--     identidade — trocar de computador apaga;
--   · é para o CLIENTE ler no celular dele, não para o time.
--
-- Ou seja: hoje o CRM não sabe quem respondeu. Não é uma tela faltando,
-- é um dado que nunca foi gravado. Esta migração e o código que a
-- acompanha passam a gravá-lo.
--
-- ------------------------------------------------------------------
-- POR QUE COLUNAS EM `conversations` E NÃO UM JOIN
-- ------------------------------------------------------------------
--
-- A lista já lê `conversations` com `select('*')` e desenha vinte linhas.
-- Buscar a última mensagem de cada uma seria um N+1 ou um lateral que o
-- PostgREST não expressa. As três colunas seguem exatamente o padrão que
-- a 047 abriu para `last_message_kind` e `last_message_media_url`.
--
-- ------------------------------------------------------------------
-- E POR QUE UM GATILHO, E NÃO SEIS CHAMADAS
-- ------------------------------------------------------------------
--
-- Quem escreve `last_message_*` hoje: a RPC do webhook (037/047), o
-- caminho de envio, o motor de fluxos, as automações, o disparo em massa
-- e a API pública. Seis lugares para manter em sincronia é seis lugares
-- para esquecer um.
--
-- O gatilho abaixo deriva tudo da própria linha de `messages`, então
-- nenhum desses caminhos precisa mudar e nenhum pode divergir. E cobre a
-- coisa que uma chamada no envio NÃO cobriria: o tique que muda depois.
-- "Entregue" e "lido" chegam por webhook de status minutos mais tarde,
-- como UPDATE em `messages.status` — sem o gatilho no UPDATE a lista
-- ficaria congelada em um tique para sempre.
--
-- Idempotente.
-- ============================================================


-- ============================================================
-- 1. As três colunas
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_sender_type TEXT
    CHECK (last_message_sender_type IS NULL
           OR last_message_sender_type IN ('customer', 'agent', 'bot')),
  ADD COLUMN IF NOT EXISTS last_message_sender_id UUID,
  ADD COLUMN IF NOT EXISTS last_message_status TEXT
    CHECK (last_message_status IS NULL
           OR last_message_status IN
              ('sending', 'sent', 'delivered', 'read', 'failed'));

COMMENT ON COLUMN conversations.last_message_sender_type IS
  'customer | agent | bot da última mensagem. Guarda a DIREÇÃO (customer '
  '= entrou) e ainda separa o colega do assistente, que é a diferença '
  'entre o nome de uma pessoa e o raio da automação na linha.';

COMMENT ON COLUMN conversations.last_message_sender_id IS
  'profiles.user_id de quem enviou, quando foi uma pessoa. NULL para '
  'mensagem do cliente, para envio do bot e para tudo que foi gravado '
  'antes desta migração.';

COMMENT ON COLUMN conversations.last_message_status IS
  'Tique da última mensagem enviada. Mantido pelo gatilho abaixo, '
  'inclusive quando o webhook de status atualiza a mensagem depois.';


-- ============================================================
-- 2. O índice que o gatilho precisa
--
-- O gatilho pergunta "esta é a mensagem mais nova desta conversa?" a
-- cada insert e a cada mudança de status. Sem um índice ordenado isso é
-- um scan das mensagens da conversa no caminho de gravação do webhook —
-- barato numa conversa de dez mensagens, não numa de dez mil.
--
-- `idx_messages_conversation` (001) é só por `conversation_id`. Este
-- responde a mesma pergunta com um lookup só, e de quebra serve o
-- carregamento da thread, que ordena exatamente assim.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages(conversation_id, created_at DESC, id DESC);


-- ============================================================
-- 3. O gatilho
--
-- A guarda `EXISTS (… mais nova …)` é o que torna isto seguro para
-- rodar em qualquer ordem: um backfill que insere mensagem antiga, uma
-- correção de status numa mensagem de ontem, ou o webhook chegando fora
-- de ordem não reescrevem a prévia com uma mensagem que não é a última.
--
-- `(created_at, id)` e não só `created_at`: duas mensagens no mesmo
-- milissegundo — uma automação disparando junto com uma resposta — não
-- podem ambas se declarar a mais nova, senão a prévia oscila.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_conversation_last_sender()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND (m.created_at, m.id) > (NEW.created_at, NEW.id)
  ) THEN
    RETURN NEW;
  END IF;

  UPDATE conversations
  SET last_message_sender_type = NEW.sender_type,
      last_message_sender_id   = NEW.sender_id,
      -- Só o que saiu tem tique. Guardar 'sent' para a mensagem do
      -- cliente faria a lista desenhar um ✓ ao lado da fala dele, que é
      -- precisamente o que o pedido diz para não acontecer.
      last_message_status      = CASE
        WHEN NEW.sender_type = 'customer' THEN NULL
        ELSE NEW.status
      END
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS messages_sync_last_sender ON messages;
CREATE TRIGGER messages_sync_last_sender
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_conversation_last_sender();

-- O segundo, e é o que mantém o tique vivo. `UPDATE OF status` para que
-- editar o texto de uma mensagem ou anexar uma transcrição (049) não
-- gaste um UPDATE em `conversations` sem motivo.
DROP TRIGGER IF EXISTS messages_sync_last_status ON messages;
CREATE TRIGGER messages_sync_last_status
  AFTER UPDATE OF status ON messages
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.sync_conversation_last_sender();


-- ============================================================
-- 4. Backfill
--
-- Sem isto a lista fica sem tique e sem nome até cada conversa receber
-- uma mensagem nova — e as conversas paradas, que são justamente as que
-- alguém precisa olhar, ficariam sem para sempre.
--
-- `DISTINCT ON` pega a última mensagem de cada conversa numa passada só.
-- O `sender_id` vem NULL para todas: ninguém nunca o gravou, e é isso
-- que a coluna deve dizer. O nome do atendente aparece a partir do
-- primeiro envio depois desta migração.
-- ============================================================
UPDATE conversations c
SET last_message_sender_type = m.sender_type,
    last_message_sender_id   = m.sender_id,
    last_message_status      = CASE
      WHEN m.sender_type = 'customer' THEN NULL
      ELSE m.status
    END
FROM (
  SELECT DISTINCT ON (conversation_id)
         conversation_id, sender_type, sender_id, status
  FROM messages
  ORDER BY conversation_id, created_at DESC, id DESC
) m
WHERE m.conversation_id = c.id
  AND c.last_message_sender_type IS DISTINCT FROM m.sender_type;
