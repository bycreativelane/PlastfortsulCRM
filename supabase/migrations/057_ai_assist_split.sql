-- ============================================================
-- 057_ai_assist_split.sql — a IA de apoio sai de dentro do agente
--
-- O pedido:
--
--   "quero separar as funções de ia do agente de ia, funções como
--    resposta sugerida, transcrição de audio, analise de imagem e
--    documento, isso fica pra uso manual, então tem q configurar
--    separado do agente de ia"
--
-- E ele aponta um defeito, não só uma preferência de organização.
--
-- ------------------------------------------------------------------
-- HOJE, DESLIGAR O AGENTE DESLIGA A TRANSCRIÇÃO
-- ------------------------------------------------------------------
--
-- `loadAiConfig` recusa a linha inteira quando `is_active` é falso, e
-- `is_active` é o interruptor do AGENTE — a coisa que responde cliente
-- sozinha. Quem passa por ali são três caminhos:
--
--   auto-reply          → é o agente. Certo que morra junto.
--   /api/ai/draft       → resposta sugerida. NÃO é o agente.
--   media-understanding → transcrição e imagem. NÃO é o agente.
--
-- O comentário da própria 049 admite: "Gated behind is_active like
-- everything else here." Resultado: quem não quer robô falando com
-- cliente — que é a maioria, e é uma decisão legítima — também fica sem
-- áudio transcrito. As duas coisas não têm relação nenhuma: uma fala com
-- o cliente, a outra ajuda o atendente a ler o que chegou.
--
-- ------------------------------------------------------------------
-- POR QUE COLUNAS E NÃO UMA TABELA NOVA
-- ------------------------------------------------------------------
--
-- Separar a CONFIGURAÇÃO não é o mesmo que separar o ARMAZENAMENTO. O
-- que precisa ser independente são os interruptores; a credencial é a
-- mesma conta no mesmo provedor, e duplicá-la seria dois lugares para
-- rotacionar a chave e dois lugares para errar.
--
-- Uma tabela separada teria que ou copiar a chave, ou apontar de volta
-- para esta linha — um join em todo caminho quente por três booleanos.
--
-- Idempotente.
-- ============================================================


-- ============================================================
-- 1. O interruptor mestre do apoio
--
-- Backfill = `is_active`, e isso é deliberado: preserva EXATAMENTE o
-- comportamento de hoje para quem já usa. Ninguém acorda com um recurso
-- ligado que não pediu, nem com um desligado que estava usando. A partir
-- daqui os dois se movem sozinhos.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS assist_is_active BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE ai_configs SET assist_is_active = is_active
 WHERE assist_is_active IS DISTINCT FROM is_active
   AND assist_is_active = FALSE;

COMMENT ON COLUMN ai_configs.assist_is_active IS
  'Interruptor mestre das ferramentas MANUAIS de IA — resposta '
  'sugerida, transcrição, leitura de imagem e documento. Independente '
  'de is_active de propósito: aquilo liga o robô que fala com o '
  'cliente, isto liga o que ajuda o atendente a ler o que chegou.';


-- ============================================================
-- 2. Modelo próprio, opcional
--
-- NULL = usa o mesmo do agente, que é o que quase todo mundo quer.
--
-- Existe porque as duas cargas são opostas: o agente responde todo mundo
-- o dia inteiro e quer modelo barato; o apoio roda quando um atendente
-- pede, algumas vezes por hora, e vale um modelo melhor. Sem esta coluna
-- a escolha teria que ser feita uma vez para os dois usos.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS assist_model TEXT;

COMMENT ON COLUMN ai_configs.assist_model IS
  'Modelo das ferramentas manuais. NULL = o mesmo do agente.';


-- ============================================================
-- 3. Um interruptor por função, não um por "mídia"
--
-- `media_understanding_enabled` (049) cobria áudio E imagem num
-- booleano só. O pedido as lista separadas — "transcrição de audio,
-- analise de imagem e documento" — e é assim que elas se comportam:
-- transcrever um minuto de áudio custa uma fração do que custa ler uma
-- foto, e um PDF de vinte páginas custa mais que as duas. Um interruptor
-- por função é o que deixa alguém ligar a barata e deixar a cara
-- desligada.
--
-- Os três primeiros herdam o valor antigo; o de documento nasce FALSE
-- porque é capacidade nova e ninguém a pediu ainda para esta conta.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS transcribe_audio_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS describe_image_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS read_document_enabled    BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE ai_configs
   SET transcribe_audio_enabled = media_understanding_enabled,
       describe_image_enabled   = media_understanding_enabled
 WHERE media_understanding_enabled IS NOT NULL;

COMMENT ON COLUMN ai_configs.transcribe_audio_enabled IS
  'Transcreve áudio que chega. Manual no sentido de que serve ao '
  'atendente — roda sozinho porque o áudio não espera ninguém pedir.';

COMMENT ON COLUMN ai_configs.describe_image_enabled IS
  'Descreve imagem que chega, para que a busca e os gatilhos por '
  'palavra vejam alguma coisa onde hoje veem vazio.';

COMMENT ON COLUMN ai_configs.read_document_enabled IS
  'Lê PDF que chega. Nasce desligado: é o mais caro dos três e o único '
  'que pode receber um arquivo de vinte páginas sem aviso.';

COMMENT ON COLUMN ai_configs.media_understanding_enabled IS
  'OBSOLETA a partir da 057 — substituída por transcribe_audio_enabled '
  'e describe_image_enabled, que separam duas coisas de custo muito '
  'diferente. Mantida para que uma versão anterior do app continue '
  'lendo algo coerente; o app atual não a lê mais.';


-- ============================================================
-- 4. Quem escreve
--
-- Nada muda: `ai_configs` já é admin para escrita e a política existente
-- cobre as colunas novas — RLS restringe LINHAS, e aqui a linha inteira
-- é a mesma decisão administrativa. É o caso oposto ao de `products` na
-- 055, onde uma coluna precisava de regra própria.
--
-- Registrado porque "por que esta não tem gatilho e aquela tem" é a
-- pergunta que a 055 deixou no ar.
-- ============================================================
