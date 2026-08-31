-- ============================================================
-- 049_media_understanding.sql — words for the messages that have none
--
-- A WhatsApp CRM receives a large share of its inbound traffic as voice
-- notes and photographs, and until now the system could store them and
-- nothing else. Everything the product does with a message reads
-- `content_text`:
--
--   · the conversation list's preview line
--   · the global search
--   · every automation trigger that matches on words
--   · the flow runner
--   · the AI auto-reply, which is gated on `inboundText.trim()`
--
-- For an audio message all five see an empty string. So a customer who
-- says "preciso de 200 unidades até sexta" out loud gets a row in the
-- inbox reading `[audio]`, no keyword match, no automation, no reply —
-- and an agent finds out what they wanted by putting headphones on. The
-- content was never missing. It was in a format nothing downstream can
-- read.
--
-- This migration adds the place to put the words. The writing is done by
-- `@/lib/ai/media-understanding`, from the webhook's `after()` block, on
-- the account's own AI key.
--
-- Idempotent — safe to re-run. Depends on 039 (`messages.media_type`,
-- which is how the reader knows whether it is holding audio or a photo).
-- ============================================================


-- ============================================================
-- 1. Where the words go.
--
-- ONE COLUMN FOR BOTH KINDS, and that is a decision rather than a
-- shortcut. A transcript of a voice note and a description of a
-- photograph are different things to produce and the same thing to
-- consume: a paragraph of Portuguese saying what arrived. Every reader
-- downstream — search, the preview line, an agent scanning the thread —
-- wants that paragraph and does not care which of the two it is, and
-- `content_type` already says which, on the same row.
--
-- Two columns would mean every one of those readers writing
-- `COALESCE(transcript, description)` forever, and one of them
-- eventually forgetting.
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_transcript TEXT;

COMMENT ON COLUMN messages.media_transcript IS
  'What the attachment says, in words: the spoken text of an audio '
  'message, or a description of an image. Written by the inbound webhook '
  'when the account has AI configured and media understanding on. NULL '
  'when the feature is off, the message carries no media, or the attempt '
  'failed — read media_transcript_status to tell those apart.';

-- The status, so "we never tried" and "we tried and it did not work" are
-- distinguishable. Without this the interface has one value — NULL — for
-- three different situations, and the only honest thing it could render
-- for all three is nothing.
--
--   none         no attempt: not media, or the feature is off
--   done         media_transcript holds the result
--   failed       the provider refused, timed out, or returned nothing
--   unsupported  the format is one no configured provider reads
--
-- `failed` is the one worth having: it is what lets a retry exist later
-- without re-processing every audio ever received.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_transcript_status TEXT NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'messages_media_transcript_status_check'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_media_transcript_status_check
      CHECK (media_transcript_status IN ('none', 'done', 'failed', 'unsupported'));
  END IF;
END $$;

COMMENT ON COLUMN messages.media_transcript_status IS
  'none | done | failed | unsupported. Distinguishes "never attempted" '
  'from "attempted and empty", which a NULL transcript alone cannot.';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_transcript_at TIMESTAMPTZ;

COMMENT ON COLUMN messages.media_transcript_at IS
  'When the attempt finished, successful or not. Present so a future '
  'retry sweep can find rows that failed before a key was fixed.';

-- Finding the failures.
--
-- A partial index, because the rows worth looking for are a rounding
-- error against the table: every text message and every successful
-- transcript is excluded from it. This is the index a "retry what broke
-- while the key was wrong" job reads, and it costs almost nothing to
-- carry until that job exists.
CREATE INDEX IF NOT EXISTS idx_messages_transcript_failed
  ON messages(conversation_id, created_at DESC)
  WHERE media_transcript_status = 'failed';


-- ============================================================
-- 2. The switch.
--
-- DEFAULT TRUE, and it is worth being explicit about why a column that
-- spends the account's money defaults to on.
--
-- `ai_configs` is not a row every account has. It exists only where
-- somebody went to Configurações › IA, pasted their own provider key,
-- and turned the assistant on — and every path in this feature is gated
-- behind that same `is_active` master switch. So the population this
-- default reaches is exactly "accounts that have already decided to
-- spend money on AI for their messages", and for them the surprising
-- behaviour is the one where voice notes stay silent.
--
-- The switch is what makes that reversible in one click, which is the
-- reason it exists rather than the feature being unconditional.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS media_understanding_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN ai_configs.media_understanding_enabled IS
  'Transcribe inbound audio and describe inbound images automatically, '
  'on this account key. Gated behind is_active like everything else here.';


-- ============================================================
-- 3. Two more things the usage log is allowed to say.
--
-- `ai_usage_log.mode` was CHECK-constrained to ('auto_reply', 'draft')
-- — the only two surfaces that existed when 033 wrote it. Transcription
-- and vision are the third and fourth, they bill against the same key,
-- and the whole point of that table is that Configurações › IA can show
-- what the key is being spent on.
--
-- Leaving them out would not have been "no data". It would have been an
-- INSERT that fails the constraint on every voice note, inside a
-- best-effort logger that swallows its own errors — so the panel would
-- have quietly under-reported the spend of the one feature on this page
-- that runs without anybody pressing anything.
-- ============================================================
ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'transcription', 'vision'));

COMMENT ON COLUMN ai_usage_log.mode IS
  'auto_reply | draft | transcription | vision — which surface spent the '
  'tokens. The last two arrive with 049 and are written by the inbound '
  'webhook rather than by somebody pressing a button.';
