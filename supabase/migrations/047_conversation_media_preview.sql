-- ============================================================
-- 047_conversation_media_preview
--
-- What the last message WAS, not just what it said.
--
-- `conversations.last_message_text` is the only thing the inbox list has to
-- describe a conversation with, and for anything that is not text it holds a
-- debug string: the inbound webhook writes `[` || Meta's own type name || `]`
-- when there is no caption. Twenty rows of `[audio]` is a list that looks
-- broken, and it tells an operator scanning a queue nothing they could not
-- have guessed.
--
-- Rendering fixed half of that — an icon and the word in Portuguese, resolved
-- on read so every row already in the table was mended too. This migration is
-- the other half, and it is the half that needs columns: you cannot draw a
-- thumbnail of a photo from the string "[image]".
--
-- TWO COLUMNS, AND THE FIRST ONE IS THE IMPORTANT ONE.
--
-- `last_message_kind` is what the row actually is. Parsing it back out of
-- `last_message_text` works for a photo with no caption and fails for a photo
-- WITH one — a captioned image stores the caption, so the list has been
-- showing those as plain text with no sign that a picture came with them.
-- Storing the kind means the row can say both.
--
-- `last_message_media_url` is a denormalised copy of the newest message's
-- `media_url`. It duplicates data, which is the trade: the alternative is a
-- lateral join to the latest message per conversation on every render of a
-- list that already loads every conversation at once, to decorate a 28px
-- square. The copy is written by the same statements that already write
-- `last_message_text`, so it cannot drift further than that column can.
--
-- Both nullable and both ignorable: a row written before this migration has
-- neither, and the interface falls back to parsing the text exactly as it
-- does today.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_kind TEXT,
  ADD COLUMN IF NOT EXISTS last_message_media_url TEXT;

COMMENT ON COLUMN conversations.last_message_kind IS
  'content_type of the newest message — text, image, video, audio, document, '
  'location, interactive, template. Lets the inbox row show that a photo '
  'arrived even when it carried a caption, which is the case parsing '
  'last_message_text cannot see.';

COMMENT ON COLUMN conversations.last_message_media_url IS
  'media_url of the newest message, when it had one. Denormalised so the '
  'conversation list can draw a thumbnail without a join per row; written by '
  'the same statements that write last_message_text.';


-- ============================================================
-- The inbound bump learns two more fields.
--
-- DROP first, not CREATE OR REPLACE. Postgres identifies a function by its
-- argument types, so replacing a 2-argument function with a 4-argument one
-- creates an OVERLOAD — and then every existing 2-argument call is ambiguous
-- against the new defaults. The old signature has to go.
--
-- The grants go with it and are re-applied below: dropping a function drops
-- its ACL, and the whole point of the REVOKEs in 037 was that only the
-- service role (the webhook) may bump somebody's unread count.
-- ============================================================
DROP FUNCTION IF EXISTS public.bump_conversation_on_inbound(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(
  p_conversation_id UUID,
  p_last_message_text TEXT,
  -- Defaulted so a caller that has not been updated yet still compiles. The
  -- webhook passes both; nothing else calls this.
  p_last_message_kind TEXT DEFAULT NULL,
  p_last_message_media_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET unread_count           = COALESCE(unread_count, 0) + 1,
      last_message_text      = p_last_message_text,
      last_message_kind      = p_last_message_kind,
      -- Overwritten unconditionally, NOT coalesced. A text message after a
      -- photo has no media, and keeping the photo's URL would leave the row
      -- showing a thumbnail of something the customer sent an hour ago next
      -- to a sentence they sent just now.
      last_message_media_url = p_last_message_media_url,
      last_message_at        = NOW(),
      updated_at             = NOW()
  WHERE id = p_conversation_id;
$$;

-- Only the service role (webhook) calls this. Lock everyone else out so an
-- authenticated user can't bump another account's unread count.
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT, TEXT, TEXT) FROM authenticated;

-- AND HAND IT BACK TO THE WEBHOOK. This line is the whole reason the three
-- REVOKEs above are safe, and it was missing.
--
-- `DROP FUNCTION` above takes the old signature's ACL with it, so nothing
-- carries over from 037 — and `REVOKE ... FROM PUBLIC` removes the default
-- EXECUTE that `CREATE FUNCTION` hands out. Without this GRANT the webhook's
-- `supabaseAdmin().rpc(...)` fails with "permission denied for function", and
-- the app's own fallback cannot save it: that retry calls the two-argument
-- signature, which this file dropped. Every inbound message would silently
-- lose its unread bump and its preview text, with nothing but a
-- `console.error` to show for it.
GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT, TEXT, TEXT) TO service_role;
