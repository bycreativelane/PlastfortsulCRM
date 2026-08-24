-- ============================================================
-- 044_quick_reply_shortcut_media
--
-- Two things a quick reply needs before `/` is worth typing.
--
-- 1. A SHORTCUT. The composer's `/` panel already filters, but it filters on
--    the TITLE — `/pra` finds "Prazo de entrega" because one of its words
--    starts that way. That works and it is not the same thing: a shortcut is
--    a short name somebody decides once and then types without reading, and
--    it survives the title being reworded. The design prototype lists them
--    exactly that way — `/orcamento`, `/frete`, `/linha100` — as the primary
--    label, with the title beside it.
--
-- 2. MEDIA. A "catálogo completo" or a "linha 100L reforçada" is a PDF or a
--    photo with a sentence attached, and today a quick reply can only be
--    words. The file lives in the `chat-media` bucket the composer already
--    uploads to (migration 023), so this stores the same public URL an
--    outbound media message stores, and the send path is the one that
--    already exists.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE quick_replies
  ADD COLUMN IF NOT EXISTS shortcut TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT;

COMMENT ON COLUMN quick_replies.shortcut IS
  'What you type after the slash, without it: "orcamento", not "/orcamento". '
  'Lower-case, no spaces, unique per account. NULL means the snippet has no '
  'shortcut and is only reachable by name.';

COMMENT ON COLUMN quick_replies.media_url IS
  'Public chat-media URL (bucket from migration 023). When set, choosing the '
  'snippet stages the file with content_text as its caption.';

COMMENT ON COLUMN quick_replies.media_type IS
  'MIME type of media_url, as the browser reported it at upload. Drives which '
  'bubble the composer stages; NULL or unrecognised falls back to document, '
  'which WhatsApp will deliver whatever the file turns out to be '
  '(mediaKindFromMime in src/lib/quick-replies/media.ts).';

-- ============================================================
-- One shortcut per account.
--
-- A UNIQUE INDEX and not a constraint, because it has to be partial: most
-- snippets will never have a shortcut, and NULLs are not equal to each other
-- in Postgres anyway — but saying so explicitly is what makes the intent
-- readable, and it keeps the index off the rows that would only pad it.
--
-- Case is folded here rather than trusted to the app: `/Orcamento` and
-- `/orcamento` are the same keystrokes to the person typing them, and two
-- rows that differ only in case would make the panel show a duplicate that
-- resolves arbitrarily.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_replies_shortcut
  ON quick_replies(account_id, lower(shortcut))
  WHERE shortcut IS NOT NULL;

-- ============================================================
-- And the rest of what the comment above promises.
--
-- "Lower-case, no spaces" was a sentence in a COMMENT, which is a wish. The
-- app normalises on the way in (`normalizeShortcut`), and this is what makes
-- that true of the column rather than true of one code path: a shortcut with
-- a space in it is unreachable BY CONSTRUCTION, because the `/` panel closes
-- on the first space, and a row nobody can ever reach is worse than a
-- rejected write.
--
-- The length cap is the same 32 the field enforces. Not a real limit on
-- anything — a shortcut is a thing you type instead of reading.
-- ============================================================
ALTER TABLE quick_replies
  DROP CONSTRAINT IF EXISTS quick_replies_shortcut_format;

ALTER TABLE quick_replies
  ADD CONSTRAINT quick_replies_shortcut_format
  CHECK (
    shortcut IS NULL
    OR (
      shortcut = lower(shortcut)
      AND shortcut !~ '\s'
      AND length(shortcut) BETWEEN 1 AND 32
    )
  );

-- ============================================================
-- `kind` gains 'media'.
--
-- The column already separates 'text' from 'interactive' so the send path
-- knows which payload to read. A snippet carrying a file is a third answer
-- to that question, not a text snippet with an extra field: choosing it
-- stages an attachment with a caption, which is a different send call.
--
-- The CHECK is dropped and re-added because Postgres has no ALTER for the
-- expression. Named as migration 035 left it — the default name for an
-- inline CHECK on a column.
-- ============================================================
ALTER TABLE quick_replies
  DROP CONSTRAINT IF EXISTS quick_replies_kind_check;

ALTER TABLE quick_replies
  ADD CONSTRAINT quick_replies_kind_check
  CHECK (kind IN ('text', 'interactive', 'media'));

-- A media snippet without a file is a broken row the interface cannot send,
-- and it is cheaper to refuse it here than to discover it at Meta.
ALTER TABLE quick_replies
  DROP CONSTRAINT IF EXISTS quick_replies_media_requires_url;

ALTER TABLE quick_replies
  ADD CONSTRAINT quick_replies_media_requires_url
  CHECK (kind <> 'media' OR media_url IS NOT NULL);
