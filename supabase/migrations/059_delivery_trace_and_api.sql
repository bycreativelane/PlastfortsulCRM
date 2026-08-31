-- ============================================================
-- 059_delivery_trace_and_api.sql — de "chegou" a "e daí o quê"
--
-- A 058 registra o que um webhook recebeu. O que ela não registra é o
-- que aconteceu DEPOIS: a automação rodou? qual? parou em que passo?
--
-- Sem essa ligação, a tela de entregas responde "aceita" e para, e quem
-- depura tem que abrir o histórico de automações, achar a execução pelo
-- horário e torcer para não haver duas no mesmo segundo. É exatamente a
-- lacuna que faria alguém voltar para o n8n só para conseguir enxergar —
-- uma escolha de ferramenta feita por falta de visibilidade, não por
-- arquitetura.
--
-- Uma coluna resolve.
--
-- Idempotente. Depende da 058.
-- ============================================================


-- ============================================================
-- 1. De qual entrega veio esta execução
--
-- A CHAVE ESTRANGEIRA APONTA DAQUI PARA LÁ, e não o contrário.
--
-- Uma entrega dispara N automações — todas as que escutam
-- `webhook_received` e passam nas condições. Guardar `automation_log_ids
-- UUID[]` na entrega seria o lado errado: exigiria que o dispatch
-- devolvesse os ids (hoje ele é `Promise<void>`, fire-and-forget dentro
-- de `after()`) e um array que cresce depois da inserção.
--
-- Do lado do log, é o padrão de sempre: muitos para um, escrito no
-- momento em que a linha nasce, sem ninguém precisar voltar para
-- atualizar nada.
--
-- ON DELETE SET NULL e não CASCADE: quando a retenção de 7 dias apagar a
-- entrega, a execução da automação — que é registro operacional e vive
-- mais — não pode ir junto.
-- ============================================================
ALTER TABLE automation_logs
  ADD COLUMN IF NOT EXISTS delivery_id UUID
    REFERENCES webhook_deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_automation_logs_delivery
  ON automation_logs(delivery_id)
  WHERE delivery_id IS NOT NULL;

COMMENT ON COLUMN automation_logs.delivery_id IS
  'A entrega de webhook que causou esta execução, quando foi uma. NULL '
  'para tudo que começou dentro do produto — mensagem de cliente, '
  'etiqueta, agendador.';


-- ============================================================
-- 2. Escopos novos para a API pública
--
-- `api_keys.scopes` é TEXT[] sem CHECK (ver a migração das chaves), então
-- os nomes novos não precisam de alteração de schema — só de código.
-- Esta seção existe para deixar registrado quais são, porque o vocabulário
-- vive em `lib/api-keys/scopes.ts` e um leitor do banco não tem como
-- adivinhá-lo:
--
--   fields:read    ler a definição dos campos personalizados
--   deals:read     ler oportunidades e funis
--   deals:write    criar e mover oportunidade
--
-- Nada a executar. O comentário É a migração.
-- ============================================================


-- ============================================================
-- 3. A limpeza da 058, agendável
--
-- `prune_webhook_deliveries()` nasceu na 058 sem ninguém a chamar. O
-- endpoint de cron do produto passa a chamá-la; esta linha só garante
-- que ela exista com a assinatura esperada mesmo se a 058 tiver sido
-- aplicada numa versão anterior do arquivo.
-- ============================================================
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'prune_webhook_deliveries'
  ) THEN
    RAISE EXCEPTION 'prune_webhook_deliveries() is missing — apply 058 first';
  END IF;
END
$chk$;
