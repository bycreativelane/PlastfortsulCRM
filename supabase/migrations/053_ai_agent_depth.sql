-- ============================================================
-- 053_ai_agent_depth.sql — the assistant stops being one text box
--
-- 029 gave the agent everything it needed to exist: a provider, a key, a
-- model, and `system_prompt` — one free-text field where the whole
-- personality, the whole business context and every rule had to be typed
-- as prose. 030 gave it a knowledge base. Between them that is a working
-- assistant, and it is also the entire configuration surface.
--
-- What that costs shows up the moment somebody tries to make it good:
--
--   · The prompt is one blob. "Fale sempre em português", "nunca prometa
--     prazo de entrega" and "somos uma distribuidora de embalagens" are
--     three completely different kinds of statement — an instruction, a
--     prohibition, and a fact — and they have to be written into one
--     paragraph and then re-read every time one of them changes.
--   · There is no way to say what it may DO. It can only talk, so a
--     customer asking "qual o preço do saco de 100 litros" gets whatever
--     the knowledge base happens to say, or an apology.
--   · Retrieval has no dial. Four chunks, always, whatever the question.
--   · And there is no path through it. The screen shows every field at
--     once to somebody who has never configured an LLM.
--
-- Every column here is nullable or defaulted to what the code does
-- today, so an account that never opens the new wizard behaves exactly
-- as it does now.
--
-- Idempotent. Depends on 029 (`ai_configs`) and 030 (`ai_knowledge_*`).
-- ============================================================


-- ============================================================
-- 1. The prompt, taken apart.
--
-- `system_prompt` STAYS, and keeps being appended verbatim — an account
-- that spent an afternoon tuning a paragraph must not lose it. What the
-- fields below add is structure for the things people write into that
-- paragraph over and over, in an order the model reads reliably:
--
--     who it is  →  what the business is  →  how it speaks
--       →  what it must never do  →  when to hand over
--
-- `buildSystemPrompt` composes them. Anything left NULL contributes no
-- line at all, so a half-filled form produces a shorter prompt rather
-- than a prompt with holes in it.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS persona_name TEXT,
  ADD COLUMN IF NOT EXISTS business_description TEXT,
  ADD COLUMN IF NOT EXISTS tone TEXT,
  ADD COLUMN IF NOT EXISTS guardrails TEXT,
  ADD COLUMN IF NOT EXISTS escalation_rules TEXT;

COMMENT ON COLUMN ai_configs.persona_name IS
  'What the assistant calls itself to a customer. NULL = it does not '
  'introduce itself, which is the pre-053 behaviour.';

COMMENT ON COLUMN ai_configs.business_description IS
  'What this company sells and to whom, in the operator''s own words. '
  'The single highest-value line in the prompt — most wrong answers are '
  'a model that does not know what business it is in.';

COMMENT ON COLUMN ai_configs.tone IS
  'formal | neutral | casual. NULL keeps the model''s own register.';

COMMENT ON COLUMN ai_configs.guardrails IS
  'What it must NEVER do — prices it may not quote, promises it may not '
  'make, subjects it must refuse. Kept apart from system_prompt because '
  'a prohibition buried in a paragraph of description is a prohibition '
  'the model averages away.';

COMMENT ON COLUMN ai_configs.escalation_rules IS
  'When to stop and hand the thread to a person, in words. Composed into '
  'the auto-reply prompt next to the handoff protocol.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_configs_tone_check'
  ) THEN
    ALTER TABLE ai_configs
      ADD CONSTRAINT ai_configs_tone_check
      CHECK (tone IS NULL OR tone IN ('formal', 'neutral', 'casual'));
  END IF;
END $$;


-- ============================================================
-- 2. What it may DO.
--
-- An array of tool names, closed in the application
-- (`@/lib/ai/tools`) rather than in a CHECK — same argument the audit
-- log's `action` makes: an enum would turn every new tool into a
-- migration, and that friction ends with tools not being added.
--
-- DEFAULT IS EMPTY, and that is the conservative direction on purpose.
-- A tool is the assistant reaching into the account's data mid-sentence;
-- turning them on is a decision, and one nobody should discover was
-- made for them. The wizard asks.
--
-- Unknown names are dropped on read, so removing a tool from the code
-- does not need a data migration.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS enabled_tools TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN ai_configs.enabled_tools IS
  'Tool names the assistant may call. Vocabulary lives in '
  '@/lib/ai/tools; unknown entries are ignored on read. Empty (the '
  'default) is the pre-053 behaviour: it can only talk.';


-- ============================================================
-- 3. Retrieval, with a dial.
--
-- Four chunks was a constant in the code. It is a good default and a bad
-- law: a knowledge base of three short documents wants everything, and
-- one of two hundred pages wants a tighter cut than four generous
-- chunks of prose.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS retrieval_top_k INTEGER NOT NULL DEFAULT 4;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_configs_retrieval_top_k_check'
  ) THEN
    ALTER TABLE ai_configs
      ADD CONSTRAINT ai_configs_retrieval_top_k_check
      CHECK (retrieval_top_k BETWEEN 0 AND 20);
  END IF;
END $$;

COMMENT ON COLUMN ai_configs.retrieval_top_k IS
  'How many knowledge chunks to put in front of the model. 0 turns '
  'retrieval off entirely, which is a real thing to want while '
  'debugging a prompt.';


-- ============================================================
-- 4. The assistant that helps the HUMAN.
--
-- Separate from `auto_reply_enabled`, and the separation is the point.
-- Auto-reply is the machine talking to a customer with nobody watching;
-- assist is an agent asking for a suggestion, reading it, and deciding.
-- They are different amounts of trust and most accounts want the second
-- long before the first — so gating assist behind the auto-reply switch
-- would have meant "let it answer customers by itself" as the price of
-- "help me write this".
--
-- DEFAULT TRUE: it costs nothing until somebody presses the button, and
-- the button is inside a menu on a message.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS assist_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN ai_configs.assist_enabled IS
  'Agents may ask for a suggested reply on a customer message. Nothing '
  'is sent — the text lands in the composer for a person to edit. '
  'Independent of auto_reply_enabled on purpose: they are different '
  'amounts of trust.';


-- ============================================================
-- 5. Has anybody actually finished setting this up?
--
-- The wizard needs to know whether to open on step one or to stay out of
-- the way, and `is_active` cannot answer that — an account can have a
-- key and a live agent and still have never written a line of business
-- description.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN ai_configs.setup_completed_at IS
  'When somebody walked the setup wizard to the end. NULL means the '
  'assistant may work but was never deliberately configured.';


-- ============================================================
-- 6. Knowledge documents that are always in front of the model.
--
-- Retrieval finds what is RELEVANT to the question, which is the right
-- default and the wrong answer for the two or three documents that are
-- relevant to every question — the price list, the delivery rules, the
-- one-paragraph description of what the company does. Those lose to a
-- semantically closer chunk about something else, at exactly the moment
-- they were needed.
--
-- Pinned documents are prepended before retrieval runs and do not
-- consume the top-k budget. There is a cap in the code, because
-- "everything is pinned" is a context window, not a knowledge base.
-- ============================================================
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ai_knowledge_documents.pinned IS
  'Always put this document in front of the model, before retrieval. '
  'For the two or three documents that are relevant to every question.';

CREATE INDEX IF NOT EXISTS ai_knowledge_documents_pinned_idx
  ON ai_knowledge_documents(account_id)
  WHERE pinned;
