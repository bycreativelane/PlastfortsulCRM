-- ============================================================
-- 077_team_mentions_and_reads
--
-- Duas coisas pedidas juntas pelo Gabriel em 8 de setembro de 2026, com um
-- print do card "Minha equipe":
--
--   "uma cor diferente com uma configuração nova para poder dar um @fulano
--    e mencionar ela no chat interno, além do número de notificação contar
--    real"
--
-- As duas são a mesma pergunta vista de lados opostos — O QUE É NOVO PARA
-- ESTA PESSOA —, e por isso moram no mesmo arquivo:
--
--   1. `@fulano`: uma mensagem que chama alguém pelo nome precisa CHEGAR a
--      esse alguém, e não só ficar colorida na sala.
--   2. O número real: quantas mensagens ESTA PESSOA ainda não leu — em
--      qualquer aparelho, sem contar as que ela mesma escreveu.
--
-- Idempotente — pode rodar de novo. Depende da 052 (`team_rooms`) e da 068
-- (o CHECK de `notifications.type` que esta amplia).
-- ============================================================


-- ============================================================
-- 1. `team_messages.mentions` — quem a mensagem chama.
--
-- UM ARRAY DE IDS, e o texto continua sendo texto. O corpo guarda
-- "@Juliana Prestes" como qualquer outra palavra; o array diz QUEM ela é.
-- A alternativa era codificar a menção no corpo (`@[Juliana](uuid)`), e ela
-- espalharia marcação crua por todo lugar que lê `body` sem saber dela — a
-- prévia do card, o trecho da notificação, a busca, e qualquer cliente
-- anterior a esta migração.
--
-- O array não é validado por CHECK contra os membros da conta, porque um
-- CHECK não consulta outra tabela. Não precisa: o gatilho abaixo só avisa
-- quem é membro, e um id que não é de ninguém não faz nada além de não
-- colorir palavra nenhuma.
-- ============================================================
ALTER TABLE team_messages
  ADD COLUMN IF NOT EXISTS mentions UUID[] NOT NULL DEFAULT '{}';

-- Um teto, para uma mensagem não virar uma notificação para a empresa
-- inteira por engano. Vinte é mais do que qualquer equipe que este CRM
-- atende chama numa frase.
ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_mentions_cap;
ALTER TABLE team_messages
  ADD CONSTRAINT team_messages_mentions_cap CHECK (cardinality(mentions) <= 20);

COMMENT ON COLUMN team_messages.mentions IS
  'Quem a mensagem chama com @ (auth.users.id). O corpo guarda o nome como '
  'texto; este array diz quem e. O gatilho on_team_message_mentions avisa '
  'cada um no sino (077).';


-- ============================================================
-- 2. A menção vira notificação — no sino, que já existe.
--
-- `notifications` (027) já é entregue ao vivo e já é contada pelo sino, e
-- a 068 fez o mesmo raciocínio para o lembrete de tarefa: um segundo canal
-- para o mesmo tipo de interrupção seria um segundo sino. Só o CHECK cresce,
-- e a linha ganha um ponteiro para a mensagem, para o clique abrir a sala
-- NA mensagem.
--
-- ON DELETE CASCADE: apagar a mensagem apaga o aviso. Uma notificação que
-- aponta para uma mensagem que não existe mais é um clique que não leva a
-- lugar nenhum — e a sala já apaga de verdade, sem lápide (ver 046).
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'new_message', 'task_due', 'team_mention'));

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS team_message_id UUID
    REFERENCES team_messages(id) ON DELETE CASCADE;

COMMENT ON COLUMN notifications.team_message_id IS
  'A mensagem da sala da equipe que mencionou o destinatario, para '
  'type = team_mention (077).';

-- NUM GATILHO, e não na rota, pelo mesmo motivo da 027: `notifications` não
-- tem política de INSERT para o navegador, de propósito. Quem escreve é
-- SECURITY DEFINER ou o service role. E, ao contrário de `messages` (ver o
-- argumento da 046 contra gatilho lá), `team_messages` não tem caminho em
-- massa: é gente digitando.
CREATE OR REPLACE FUNCTION notify_team_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_novos UUID[];
  v_autor TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_novos := NEW.mentions;
  ELSE
    -- NUMA EDIÇÃO, só quem ENTROU. Corrigir um erro de digitação numa
    -- mensagem que já chamava a Juliana não pode chamá-la de novo.
    SELECT COALESCE(array_agg(u), '{}') INTO v_novos
      FROM unnest(NEW.mentions) AS u
     WHERE NOT (u = ANY (COALESCE(OLD.mentions, '{}')));
  END IF;

  IF v_novos IS NULL OR cardinality(v_novos) = 0 THEN
    RETURN NEW;
  END IF;

  -- O nome de quem chamou, como fallback do título. A interface compõe o
  -- texto pelo `type` (ver `lib/notifications/text.ts`) — o que fica
  -- gravado é um FATO, não uma frase num idioma.
  SELECT full_name INTO v_autor FROM profiles WHERE user_id = NEW.author_id;

  INSERT INTO notifications (
    account_id, user_id, type, actor_user_id, title, body, team_message_id
  )
  SELECT
    NEW.account_id,
    p.user_id,
    'team_mention',
    NEW.author_id,
    COALESCE(NULLIF(trim(v_autor), ''), 'team_mention'),
    -- O trecho, numa linha só: a notificação é uma linha de lista.
    left(regexp_replace(COALESCE(NEW.body, ''), '\s+', ' ', 'g'), 200),
    NEW.id
  FROM profiles p
  -- Só membros DESTA conta, e nunca quem escreveu: chamar a si mesmo não é
  -- notícia, e um id de fora não pode virar um aviso em outra empresa.
  WHERE p.account_id = NEW.account_id
    AND p.user_id = ANY (v_novos)
    AND p.user_id <> NEW.author_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- O aviso nunca derruba a mensagem. Mesma regra da 027.
  RAISE WARNING 'notify_team_mentions falhou para a mensagem %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_team_mentions() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_team_message_mentions ON team_messages;
CREATE TRIGGER on_team_message_mentions
  AFTER INSERT OR UPDATE OF mentions ON team_messages
  FOR EACH ROW EXECUTE FUNCTION notify_team_mentions();


-- ============================================================
-- 3. `team_room_reads` — até onde CADA PESSOA leu CADA SALA.
--
-- O QUE ESTAVA ERRADO NO NÚMERO, medido no código em 14 de setembro:
--
--   - Ele morava no `localStorage`. Ler a sala no celular não apagava o
--     número do computador — a mesma pessoa, dois números.
--   - Um navegador que nunca tinha aberto a sala mostrava ZERO, com
--     quantas mensagens houvesse.
--   - As mensagens da própria pessoa contavam como não lidas quando
--     chegavam por outro aparelho.
--   - O marcador era UM para todas as salas: ler "Comercial" às 10h05
--     marcava como lida uma mensagem de "Operação" das 10h03.
--
-- Uma linha por pessoa por sala resolve as quatro. É o que "contar real"
-- quer dizer em qualquer aplicativo de conversa.
-- ============================================================
CREATE TABLE IF NOT EXISTS team_room_reads (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES team_rooms(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, room_id)
);

COMMENT ON TABLE team_room_reads IS
  'Ate onde cada pessoa leu cada sala da equipe. Substitui o marcador do '
  'localStorage, que era por aparelho e um so para todas as salas (077).';

ALTER TABLE team_room_reads ENABLE ROW LEVEL SECURITY;

-- Cada um lê e escreve SÓ as próprias linhas. Até onde um colega leu não é
-- da conta de ninguém — e um "visto por" é outra funcionalidade, que
-- ninguém pediu.
DROP POLICY IF EXISTS team_room_reads_select ON team_room_reads;
CREATE POLICY team_room_reads_select ON team_room_reads FOR SELECT
  USING (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS team_room_reads_insert ON team_room_reads;
CREATE POLICY team_room_reads_insert ON team_room_reads FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND is_account_member(account_id)
    AND EXISTS (
      SELECT 1 FROM team_rooms r
       WHERE r.id = room_id AND r.account_id = team_room_reads.account_id
    )
  );

DROP POLICY IF EXISTS team_room_reads_update ON team_room_reads;
CREATE POLICY team_room_reads_update ON team_room_reads FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

-- A VIRADA: tudo o que foi escrito antes desta migração conta como lido.
--
-- O estado antigo mora nos navegadores e o banco não tem como buscá-lo.
-- Sem esta linha, no minuto em que a 077 rodasse, cada pessoa da empresa
-- veria "99+" no card — o número mais "real" possível, e o mais inútil.
INSERT INTO team_room_reads (user_id, room_id, account_id, last_read_at)
SELECT p.user_id, r.id, r.account_id, NOW()
  FROM team_rooms r
  JOIN profiles p ON p.account_id = r.account_id
 WHERE r.archived_at IS NULL
ON CONFLICT (user_id, room_id) DO NOTHING;

-- Ao vivo, para ler no celular apagar o número do computador na hora.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'team_room_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_room_reads;
  END IF;
END $$;


-- ============================================================
-- 4. Marcar como lido — sem nunca andar para trás.
--
-- Uma função e não um upsert do navegador, por causa do GREATEST: duas
-- abas abertas na mesma sala mandam marcadores fora de ordem, e um upsert
-- simples deixaria a aba atrasada DESMARCAR mensagens que a outra já leu.
--
-- `LEAST(p_read_at, NOW())`: um relógio adiantado — ou um cliente
-- malicioso — não consegue marcar o futuro como lido e silenciar as
-- próximas mensagens.
--
-- SECURITY INVOKER: a RLS acima é quem decide, e a função não sabe nada
-- que o chamador não saiba.
-- ============================================================
CREATE OR REPLACE FUNCTION mark_team_room_read(
  p_room_id UUID,
  p_read_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO team_room_reads (user_id, room_id, account_id, last_read_at)
  SELECT auth.uid(), r.id, r.account_id, LEAST(p_read_at, NOW())
    FROM team_rooms r
   WHERE r.id = p_room_id
  ON CONFLICT (user_id, room_id) DO UPDATE
    SET last_read_at = GREATEST(team_room_reads.last_read_at, EXCLUDED.last_read_at),
        updated_at = NOW();
$$;


-- ============================================================
-- 5. O número, por sala, numa consulta só.
--
-- O que conta: mensagens de OUTRAS pessoas, em salas não arquivadas,
-- depois do marcador desta pessoa naquela sala. `mentions` é o subconjunto
-- que chama esta pessoa pelo nome — o card o pinta de outra cor.
--
-- SEM MARCADOR — uma sala criada depois da 077, ou alguém que entrou na
-- empresa depois dela — o piso é a criação do perfil. Um colega novo não
-- herda como "não lido" o histórico de antes de ele existir; uma sala nova
-- conta tudo, porque tudo nela é novo.
--
-- `m.room_id IS NULL` na sala padrão: toda linha anterior à 052 mora lá,
-- e é a mesma regra de `roomFilter` em `lib/team/messages.ts`.
-- ============================================================
CREATE OR REPLACE FUNCTION team_unread_counts()
RETURNS TABLE (room_id UUID, unread BIGINT, mentions BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH eu AS (
    SELECT p.user_id, p.account_id, p.created_at
      FROM profiles p
     WHERE p.user_id = auth.uid()
  )
  SELECT
    r.id,
    COUNT(m.id),
    COUNT(m.id) FILTER (WHERE eu.user_id = ANY (m.mentions))
  FROM eu
  JOIN team_rooms r
    ON r.account_id = eu.account_id
   AND r.archived_at IS NULL
  LEFT JOIN team_room_reads tr
    ON tr.room_id = r.id
   AND tr.user_id = eu.user_id
  LEFT JOIN team_messages m
    ON m.account_id = eu.account_id
   AND (m.room_id = r.id OR (r.is_default AND m.room_id IS NULL))
   AND m.author_id <> eu.user_id
   AND m.created_at > COALESCE(tr.last_read_at, eu.created_at, '-infinity'::timestamptz)
  GROUP BY r.id;
$$;
