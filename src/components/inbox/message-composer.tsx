'use client';

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  KeyboardEvent,
} from 'react';
import {
  Send,
  LayoutTemplate,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
  Plus,
  MessageSquareDashed,
  Paperclip,
  UserMinus,
  UserPlus,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MISSING_MIGRATION_CODE } from '@/lib/quick-replies/errors';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  CHAT_MEDIA_BUCKET,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { ReplyQuote } from './reply-quote';
import { useTranslations } from 'next-intl';
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from '@/components/interactive/interactive-builder';
import { validateInteractivePayload } from '@/lib/whatsapp/interactive';
import type { InteractiveMessagePayload, QuickReply } from '@/types';
import { QuickReplyPicker } from './quick-reply-picker';
import { filterQuickReplies, slashQuery } from './slash-command';
import { mediaKindFromMime } from '@/lib/quick-replies/media';
import { signMessage, useSignature } from '@/hooks/use-signature';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { extensionForMime } from '@/lib/media/filename';
import { Switch } from '@/components/ui/switch';
import {
  assignQuery,
  filterAssignCandidates,
  type AssignCandidate,
} from './assign-mention';

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = 'image' | 'video' | 'document' | 'audio';

/**
 * Supabase Storage bucket holding agent-sent chat attachments (migration
 * 023). Defined in the storage layer now that the settings editor uploads
 * to it too; re-exported here because message-thread has always imported it
 * from the composer.
 */
export { CHAT_MEDIA_BUCKET };

/** Meta caps media captions at 1024 chars. Enforced here and in the send route. */
export const MEDIA_CAPTION_MAX = 1024;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /**
   * Storage object path — lets the caller GC the object if the send fails.
   *
   * NULL when the file came from a media quick reply: that object belongs to
   * the snippet library, not to this message, and deleting it would empty
   * the snippet for the whole account. Whoever holds this must check.
   */
  path: string | null;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<'image' | 'video' | 'document', string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document:
    'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain',
};

interface MediaDraft {
  kind: ComposerMediaKind;
  mediaUrl: string;
  /**
   * Storage path — used to GC the object if the draft is discarded. Null for
   * a file staged from a media quick reply: see SendMediaPayload.path.
   */
  path: string | null;
  filename: string;
  caption: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (payload: SendMediaPayload) => void;
  onSendInteractive: (
    payload: InteractiveMessagePayload,
    replyToId?: string
  ) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /**
   * Who this conversation can be handed to, already ordered. Empty disables
   * the `@` panel entirely — see ./assign-mention.
   */
  assignCandidates?: AssignCandidate[];
  onAssign?: (userId: string | null) => void;
  /** Signed-in agent's name — the signature's default. See `use-signature`. */
  agentName?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = '/opus/encoderWorker.min.js';

export function MessageComposer({
  conversationId,
  agentName,
  sessionExpired,
  onSend,
  onSendMedia,
  onSendInteractive,
  onOpenTemplates,
  assignCandidates = [],
  onAssign,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const t = useTranslations('Inbox.composer');

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Interactive-message builder dialog + quick-reply picker.
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactivePayload, setInteractivePayload] =
    useState<InteractiveMessagePayload>(blankButtonsPayload);
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // attachment; `busy` covers the upload/transcode window.
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `draft` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with a staged-but-unsent
  // attachment GCs the orphaned object.
  const draftRef = useRef<MediaDraft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | null | undefined) => {
    if (!path) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import('opus-recorder').default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan('send-messages');
  const readOnly = !canSend;
  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled = readOnly || sessionExpired;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC a staged-but-unsent
  // attachment so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      removeStaged(draftRef.current?.path);
    };
  }, [clearTimer, removeStaged]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const signature = useSignature(conversationId, agentName ?? '');
  const touch = useCoarsePointer();

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      // Signed at the point of SENDING, not while typing: the field holds
      // what the agent wrote, and the signature is part of the envelope. It
      // also means toggling it off after typing does the obvious thing.
      onSend(
        signature.enabled ? signMessage(trimmed, signature.name) : trimmed,
        replyTo?.id
      );
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setSending(false);
    }
  }, [
    text,
    sending,
    sessionExpired,
    onSend,
    replyTo?.id,
    signature.enabled,
    signature.name,
  ]);

  // `@` at the start of the field opens the assign panel. Derived from the
  // text rather than stored, so there is no way for the panel's idea of the
  // query to drift from what is actually typed.
  const mention = assignQuery(text);
  const assignOpen =
    mention !== null && !!onAssign && assignCandidates.length > 0;
  const assignMatches = useMemo(
    () =>
      assignOpen ? filterAssignCandidates(assignCandidates, mention ?? '') : [],
    [assignOpen, assignCandidates, mention]
  );
  const [assignCursor, setAssignCursor] = useState(0);

  /* ---- `/` quick replies, inline ------------------------------------
   *
   * Same shape as `@` above and derived the same way, from the text rather
   * than stored, so the panel's idea of the query cannot drift from what is
   * on screen.
   *
   * The list is fetched the first time somebody types `/` and kept. Loading
   * it on mount would be a request per conversation opened for a feature
   * most of them never use; refetching on every `/` would put a spinner in
   * front of a shortcut whose whole point is speed. */
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickRepliesLoaded, setQuickRepliesLoaded] = useState(false);
  const [slashCursor, setSlashCursor] = useState(0);
  /**
   * Through a ref, and not through the dependency array.
   *
   * `handleKeyDown` is defined above `openInteractiveBuilder`, which the
   * apply needs for an interactive snippet. Naming the callback in this
   * handler's deps would read it during render, before it exists — a
   * temporal-dead-zone crash on the first keystroke rather than a type
   * error. The ref is filled in below, where both halves are in scope.
   */
  const applyQuickReplyRef = useRef<(qr: QuickReply) => void>(() => {});

  const slash = slashQuery(text);
  const slashOpen = slash !== null && !readOnly;
  const slashMatches = useMemo(
    () => (slashOpen ? filterQuickReplies(quickReplies, slash ?? '') : []),
    [slashOpen, quickReplies, slash]
  );

  useEffect(() => {
    if (slash === null || quickRepliesLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/quick-replies', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setQuickReplies((data.quick_replies as QuickReply[]) ?? []);
      } finally {
        if (!cancelled) setQuickRepliesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slash, quickRepliesLoaded]);

  const applyAssign = useCallback(
    (candidate: AssignCandidate) => {
      onAssign?.(candidate.userId);
      setText('');
      setAssignCursor(0);
    },
    [onAssign]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (assignOpen && assignMatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setAssignCursor((c) => (c + 1) % assignMatches.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setAssignCursor(
            (c) => (c - 1 + assignMatches.length) % assignMatches.length
          );
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          applyAssign(
            assignMatches[Math.min(assignCursor, assignMatches.length - 1)]
          );
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setText('');
          return;
        }
      }

      // `/` quick replies — the same keys as `@`, so there is one thing to
      // learn rather than two.
      if (slashOpen && slashMatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashCursor((c) => (c + 1) % slashMatches.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashCursor(
            (c) => (c - 1 + slashMatches.length) % slashMatches.length
          );
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          applyQuickReplyRef.current(
            slashMatches[Math.min(slashCursor, slashMatches.length - 1)]
          );
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setText('');
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      assignOpen,
      assignMatches,
      assignCursor,
      applyAssign,
      handleSend,
      slashOpen,
      slashMatches,
      slashCursor,
    ]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      setAssignCursor(0);
      setSlashCursor(0);
      adjustHeight();
    },
    [adjustHeight]
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(t('toastAiNotConfigured'));
        } else {
          console.error('AI draft failed:', data.error);
          toast.error(t('toastAiDraftFailed'));
        }
        return;
      }
      const draftText = typeof data.draft === 'string' ? data.draft.trim() : '';
      if (!draftText) {
        toast.error(t('toastAiNoReply'));
        return;
      }
      setText(draftText);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch {
      toast.error(t('toastAiUnreachable'));
    } finally {
      setDrafting(false);
    }
  }, [drafting, conversationId, adjustHeight]);

  // ---- Interactive message + quick replies --------------------------

  const openInteractiveBuilder = useCallback(
    (seed?: InteractiveMessagePayload) => {
      setInteractivePayload(seed ?? blankButtonsPayload());
      setInteractiveOpen(true);
    },
    []
  );

  const sendInteractive = useCallback(() => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSendInteractive(interactivePayload, replyTo?.id);
    setInteractiveOpen(false);
    onClearReply?.();
  }, [interactivePayload, onSendInteractive, replyTo?.id, onClearReply]);

  // Persist the current builder payload as a reusable interactive snippet.
  const saveAsQuickReply = useCallback(async () => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const title = window.prompt(t('quickReplyNamePrompt'))?.trim();
    if (!title) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          kind: 'interactive',
          interactive_payload: interactivePayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The route's `error` is English prose — including migration 044's
        // whole explanation, which used to land in a toast verbatim. The
        // code is what the UI reads; the prose stays in the console.
        console.error('Quick reply save failed:', data.error);
        toast.error(
          data.error_code === MISSING_MIGRATION_CODE
            ? t('quickReplyNeedsMigration')
            : t('quickReplySaveError')
        );
        return;
      }
      toast.success(t('quickReplySaved'));
    } catch {
      toast.error(t('quickReplySaveError'));
    } finally {
      setSavingQuickReply(false);
    }
  }, [interactivePayload, t]);

  // A picked quick reply: text fills the composer; interactive opens the
  // builder pre-filled so the agent can tweak before sending.
  const handlePickQuickReply = useCallback(
    (qr: QuickReply) => {
      setQuickReplyOpen(false);
      if (qr.kind === 'interactive' && qr.interactive_payload) {
        openInteractiveBuilder(qr.interactive_payload);
        return;
      }
      if (qr.kind === 'media' && qr.media_url) {
        // The file is already in chat-media — it was uploaded once, when the
        // snippet was saved. Staging it as an ordinary draft means the send
        // path is the one that already exists, and the caption arrives
        // editable rather than fixed.
        //
        // `path: null` is the whole point: this object is the LIBRARY's.
        // Discarding the draft, replacing it, or a failed send must not
        // delete it, or using `/catalogo` once would destroy it for everyone.
        removeStaged(draftRef.current?.path);
        setDraft({
          kind: mediaKindFromMime(qr.media_type),
          mediaUrl: qr.media_url,
          path: null,
          filename: qr.title,
          caption: qr.content_text ?? '',
        });
        return;
      }
      const body = qr.content_text ?? '';
      // Separate the snippet from any existing draft with a newline so the
      // words don't run together ("Thanks" + "we'll…" → "Thankswe'll…").
      setText((prev) =>
        prev && !/\s$/.test(prev) ? `${prev}\n${body}` : `${prev}${body}`
      );
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [openInteractiveBuilder, adjustHeight, removeStaged]
  );

  /**
   * Picking from the `/` panel, which is not the same as picking from the
   * modal: the text in the field is the COMMAND, not a draft. `/pra` has to
   * disappear and be replaced by the snippet, where the modal's version
   * appends to whatever was already written.
   *
   * Both `setText` calls are functional updates in one batch, so the second
   * sees the first's empty string and the snippet lands alone.
   */
  const applyQuickReply = useCallback(
    (qr: QuickReply) => {
      setText('');
      setSlashCursor(0);
      handlePickQuickReply(qr);
    },
    [handlePickQuickReply]
  );

  useEffect(() => {
    applyQuickReplyRef.current = applyQuickReply;
  }, [applyQuickReply]);

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: ComposerMediaKind, file: File) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          t('toastFileTooLarge', {
            size: (file.size / 1024 / 1024).toFixed(1),
            // The attach menu's own word for this kind, so the sentence
            // does not switch languages halfway through.
            kind: t(kind === 'image' ? 'photo' : kind),
            limit: Math.round(max / 1024 / 1024),
          })
        );
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        // Replacing an existing draft? GC the previous object first.
        removeStaged(draftRef.current?.path);
        setDraft({
          kind,
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
        });
      } catch (err) {
        // `uploadAccountMedia` throws English prose. It belongs in the
        // console, not in a toast on a pt-BR install.
        console.error('Upload failed:', err);
        toast.error(t('toastUploadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, t]
  );

  const handlePicked = useCallback(
    (kind: 'image' | 'video' | 'document', file: File | undefined) => {
      if (file) void stageUpload(kind, file);
    },
    [stageUpload]
  );

  /**
   * Ctrl+V with a screenshot on the clipboard.
   *
   * There was no paste path at all — attachments only ever arrived through
   * the three hidden `<input type="file">`s behind the clip menu — so
   * copying a print and pasting it did nothing at all, silently. On a
   * support desk a screenshot IS the message half the time: the customer's
   * error, the label on the wrong bag, the printed order.
   *
   * The pasted file goes through `stageUpload` like any other attachment,
   * so it lands in the caption preview rather than firing off immediately.
   * A screenshot almost always needs a sentence next to it.
   */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (inputsDisabled || busy) return;

      const item = Array.from(event.clipboardData?.items ?? []).find(
        (candidate) =>
          candidate.kind === 'file' && candidate.type.startsWith('image/')
      );
      if (!item) return;

      const file = item.getAsFile();
      if (!file) return;

      // Text pasted alongside an image (some apps put both on the
      // clipboard) would otherwise land in the field behind the preview.
      event.preventDefault();

      // A pasted screenshot usually has no name, or a generic one the OS
      // invented. `buildMediaPath` needs a real extension to key the
      // storage object off, so it comes from the MIME type instead — the
      // same table `@/lib/media/filename` already maintains.
      const named =
        file.name && file.name.includes('.')
          ? file
          : new File([file], `print.${extensionForMime(file.type)}`, {
              type: file.type,
            });

      void stageUpload('image', named);
    },
    [inputsDisabled, busy, stageUpload]
  );

  /**
   * The same file, dragged onto the thread.
   *
   * The second gesture everybody tries after Ctrl+V, and free once the
   * first one exists. Images and video are staged by kind; anything else is
   * a document, which is what the clip menu would have called it too.
   */
  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (inputsDisabled || busy) return;
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();

      const kind: ComposerMediaKind = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : 'document';
      void stageUpload(kind, file);
    },
    [inputsDisabled, busy, stageUpload]
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File(
        [bytes as unknown as BlobPart],
        `voice-${Date.now()}.ogg`,
        {
          type: 'audio/ogg',
        }
      );
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error(t('toastRecordingTooLong'));
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        removeStaged(draftRef.current?.path);
        setDraft({
          kind: 'audio',
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
        });
      } catch (err) {
        // `uploadAccountMedia` throws English prose. It belongs in the
        // console, not in a toast on a pt-BR install.
        console.error('Upload failed:', err);
        toast.error(t('toastUploadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, t]
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      toast.error(t('toastRecordingUnsupported'));
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import('opus-recorder');
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(
        () => setRecordSeconds((s) => s + 1),
        1000
      );
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error(t('toastMicDenied'));
    }
  }, [inputsDisabled, busy, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  const sendDraft = useCallback(() => {
    if (!draft || busy) return;
    onSendMedia({
      kind: draft.kind,
      mediaUrl: draft.mediaUrl,
      path: draft.path,
      // Audio takes no caption (Meta rejects it). Everything else: the
      // trimmed caption, or undefined when blank.
      caption:
        draft.kind === 'audio' ? undefined : draft.caption.trim() || undefined,
      filename: draft.kind === 'document' ? draft.filename : undefined,
      replyToId: replyTo?.id,
    });
    // The object is now owned by the sent message — clear without GC.
    setDraft(null);
    onClearReply?.();
  }, [draft, busy, onSendMedia, replyTo?.id, onClearReply]);

  // Discard GCs the staged object — it was uploaded but never sent.
  const discardDraft = useCallback(() => {
    removeStaged(draft?.path);
    setDraft(null);
  }, [draft?.path, removeStaged]);

  const setCaption = useCallback((caption: string) => {
    setDraft((d) => (d ? { ...d, caption } : d));
  }, []);

  // ---- Render --------------------------------------------------------

  return (
    // No fill and no top rule: the thread's wallpaper runs behind the
    // composer and only the pill below floats on it. See
    // DOODLE_BG_CLASSES in message-thread.tsx.
    // 12px on a phone, where the header cannot spare a pixel either; 16px
    // above it, which is the gutter the thread header (`px-3 sm:px-4`) and the
    // message list (`px-4`) already use. The composer was the only edge in
    // this column sitting 4px outside that line.
    <div
      className="px-3 py-3 sm:px-4"
      // Drop anywhere over the composer, not on a target you have to aim
      // for. `onDragOver` has to preventDefault or the browser navigates to
      // the file instead of handing it over — the default that turns a
      // dropped PDF into a lost draft.
      onDragOver={(e) => {
        if (!inputsDisabled && !busy) e.preventDefault();
      }}
      onDrop={handleDrop}
    >
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {/* The 24-hour notice used to live here, as a strip across the top of
          the composer. It is now a dismissible chip at the end of the
          message stream — see `WindowClosedNotice`. Saying it in both places
          would say it twice, 500px apart. */}

      {/* Who is writing.
          
          The inbox is one number for the whole team, so from the customer's
          side every reply comes from the same sender — the signature is the
          only thing that answers "quem escreveu isso", and it has to be part
          of the message, because the customer never sees this interface.

          The switch is per CONVERSATION and the name is per agent. Signing
          every message of a thread you have held for an hour turns the
          signature into noise; the question is only asked when the voice
          changes. See `use-signature` for both halves.

          Hidden while the window is closed — a template send does not carry
          a free-text prefix, so offering the toggle there would be a promise
          the send path cannot keep. */}
      {!sessionExpired && !readOnly && (
        <div className="mb-2 flex items-center gap-2">
          <Switch
            id="composer-signature"
            checked={signature.enabled}
            onCheckedChange={signature.setEnabled}
            aria-label={t('signatureToggle')}
          />
          <label
            htmlFor="composer-signature"
            className="text-muted-foreground shrink-0 text-xs font-medium"
          >
            {t('signatureToggle')}
          </label>
          {signature.enabled && (
            <input
              value={signature.name}
              onChange={(e) => signature.setName(e.target.value)}
              placeholder={t('signaturePlaceholder')}
              aria-label={t('signatureNameLabel')}
              // Borderless on purpose: it is a value you correct once, not a
              // field you fill in. A boxed input here would read as another
              // thing to complete before the message can be sent.
              className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none"
            />
          )}
        </div>
      )}

      {/* Hidden file inputs driven by the attach menu. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          handlePicked('image', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        className="hidden"
        onChange={(e) => {
          handlePicked('video', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        className="hidden"
        onChange={(e) => {
          handlePicked('document', e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {draft ? (
        <MediaDraftPreview
          draft={draft}
          busy={busy}
          readOnly={readOnly}
          onCaptionChange={setCaption}
          onDiscard={discardDraft}
          onSend={sendDraft}
          t={t}
        />
      ) : recording ? (
        // Recording bar — replaces the composer while the mic is live.
        <div className="border-border bg-muted flex items-center gap-3 rounded-xl border px-4 py-2.5">
          {/* Static, and a token rather than a raw palette red. The dot is
              beside a timer that is already counting up, so the pulse was
              a second thing moving to say the same thing — and this is a
              screen someone sits in front of for eight hours. */}
          <span className="bg-danger flex size-2.5 shrink-0 rounded-full" />
          <span className="text-foreground flex-1 text-sm">
            {t('recording', {
              current: formatDuration(recordSeconds),
              max: formatDuration(MAX_RECORDING_SECONDS),
            })}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="text-muted-foreground hover:bg-card hover:text-foreground rounded-md px-2 py-1 text-xs"
          >
            {t('cancel')}
          </button>
          <Button
            size="sm"
            onClick={stopRecording}
            className="bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0"
            title={t('stopAndAttach')}
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        // The floating pill. Everything the agent can press lives
        // inside one white surface, so the composer reads as a single
        // object on the wallpaper instead of a row of loose buttons.
        <div className="bg-wa-in relative flex items-end gap-1 rounded-2xl p-1.5 shadow-[var(--wa-shadow)]">
          {assignOpen && (
            // Floats above the pill rather than pushing it down: the field
            // must not move under the cursor while somebody is typing into
            // it.
            <div
              role="listbox"
              aria-label={t('assignPanelLabel')}
              className="max-h-vh-46 border-border bg-popover absolute right-0 bottom-[calc(100%+8px)] left-0 z-30 overflow-y-auto rounded-lg border p-1 shadow-lg"
            >
              {assignMatches.length === 0 ? (
                <p className="text-muted-foreground px-3 py-3 text-center text-xs">
                  {t('assignNoMatch')}
                </p>
              ) : (
                assignMatches.map((candidate, i) => (
                  <button
                    key={candidate.userId ?? 'unassign'}
                    type="button"
                    role="option"
                    aria-selected={i === assignCursor}
                    onMouseEnter={() => setAssignCursor(i)}
                    onMouseDown={(e) => {
                      // mousedown, not click: click fires after blur, and the
                      // textarea losing focus would close the panel first.
                      e.preventDefault();
                      applyAssign(candidate);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                      i === assignCursor && 'bg-muted',
                      candidate.isUnassign
                        ? 'text-human-ink'
                        : 'text-popover-foreground'
                    )}
                  >
                    {candidate.isUnassign ? (
                      <UserMinus className="size-4 shrink-0" />
                    ) : (
                      <UserPlus className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 truncate font-medium">
                      {candidate.label}
                    </span>
                  </button>
                ))
              )}
              <p className="border-border text-muted-foreground text-3xs border-t px-2.5 pt-2 pb-1">
                {t('assignHint')}
              </p>
            </div>
          )}
          {slashOpen && (
            // The `/` panel, and deliberately the assign panel's twin:
            // same position, same geometry, same keys. Two shortcuts that
            // look and behave alike is one thing to learn.
            <div
              role="listbox"
              aria-label={t('quickReplies')}
              className="max-h-vh-46 border-border bg-popover absolute right-0 bottom-[calc(100%+8px)] left-0 z-30 overflow-y-auto rounded-lg border p-1 shadow-lg"
            >
              {slashMatches.length === 0 ? (
                <p className="text-muted-foreground px-3 py-3 text-center text-xs">
                  {quickRepliesLoaded
                    ? t('quickReplyNoMatch')
                    : t('quickReplyLoading')}
                </p>
              ) : (
                slashMatches.map((qr, i) => (
                  <button
                    key={qr.id}
                    type="button"
                    role="option"
                    aria-selected={i === slashCursor}
                    onMouseEnter={() => setSlashCursor(i)}
                    onMouseDown={(e) => {
                      // mousedown, not click: click fires after blur, and
                      // the textarea losing focus closes the panel first.
                      e.preventDefault();
                      applyQuickReplyRef.current(qr);
                    }}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left',
                      i === slashCursor && 'bg-muted'
                    )}
                  >
                    {/* The SHORTCUT leads when there is one — it is what was just
                        typed, and reading back the thing you typed is how you
                        know the panel understood you. The title follows it,
                        quieter, because by then it is a reminder and not a
                        label. Snippets without a shortcut keep the title as
                        the headline; nothing else changes for them. */}
                    <span className="flex w-full min-w-0 items-baseline gap-1.5">
                      {qr.shortcut && (
                        <span className="text-primary shrink-0 font-mono text-sm font-medium">
                          /{qr.shortcut}
                        </span>
                      )}
                      <span
                        className={cn(
                          'min-w-0 truncate',
                          qr.shortcut
                            ? 'text-muted-foreground text-2xs'
                            : 'text-popover-foreground text-sm font-medium'
                        )}
                      >
                        {qr.title}
                      </span>
                    </span>
                    {qr.kind === 'interactive' ? (
                      <span className="text-muted-foreground text-2xs">
                        {t('quickReplyInteractive')}
                      </span>
                    ) : qr.kind === 'media' ? (
                      // The attachment is the point of this one, so it is
                      // named before the caption — a row that showed only
                      // "Segue o catálogo" reads like a text snippet, and
                      // choosing it would surprise somebody with a file.
                      <span className="text-muted-foreground text-2xs flex w-full min-w-0 items-center gap-1">
                        <Paperclip className="size-3 shrink-0" />
                        <span className="truncate">
                          {qr.content_text || t('quickReplyMedia')}
                        </span>
                      </span>
                    ) : (
                      qr.content_text && (
                        <span className="text-muted-foreground text-2xs w-full truncate">
                          {qr.content_text}
                        </span>
                      )
                    )}
                  </button>
                ))
              )}
              <p className="border-border text-muted-foreground text-3xs border-t px-2.5 pt-2 pb-1">
                {t('quickReplyHint')}
              </p>
            </div>
          )}

          {/* Everything accessory lives behind the plus.

              The TRIGGER is gated on `readOnly`, not on `inputsDisabled`.
              It used to be the latter, which locked the whole menu whenever
              the 24-hour window closed — including "Enviar template", the
              one action that still works outside the window and the only
              reason to open this menu then. The gate belongs on the items
              that actually need it, below. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={readOnly || busy}
              title={readOnly ? t('readOnlyTitle') : t('moreActions')}
              className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full p-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Plus className="size-5" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="min-w-56">
              {/* Everything that sends free-form content is disabled once
                  the window has closed — Meta will not deliver it. */}
              <DropdownMenuItem
                disabled={inputsDisabled}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImageIcon className="mr-2 size-4" />
                {t('photo')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={inputsDisabled}
                onClick={() => videoInputRef.current?.click()}
              >
                <Video className="mr-2 size-4" />
                {t('video')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={inputsDisabled}
                onClick={() => documentInputRef.current?.click()}
              >
                <FileText className="mr-2 size-4" />
                {t('document')}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                disabled={inputsDisabled}
                onClick={() => setQuickReplyOpen(true)}
              >
                <Zap className="mr-2 size-4" />
                {t('quickReplies')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={inputsDisabled}
                onClick={() => openInteractiveBuilder()}
              >
                <MessageSquareDashed className="mr-2 size-4" />
                {t('interactiveMessage')}
              </DropdownMenuItem>
              {onOpenTemplates && (
                <DropdownMenuItem disabled={readOnly} onClick={onOpenTemplates}>
                  <LayoutTemplate className="mr-2 size-4" />
                  {t('sendTemplate')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                disabled={inputsDisabled || drafting}
                onClick={handleDraft}
              >
                <Sparkles className="mr-2 size-4" />
                {t('draftWithAI')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              readOnly
                ? t('readOnlyPlaceholder')
                : sessionExpired
                  ? t('sessionExpiredPlaceholder')
                  : // "Escreva uma mensagem... (Shift+Enter quebra linha)" is
                    // 45 characters in a one-row textarea. On a phone it
                    // wraps and the second line is clipped by the field's own
                    // height — the reported "texto quebrado no input".
                    //
                    // The short one is not a truncation, it is the correct
                    // copy for the device: there is no Shift+Enter on a touch
                    // keyboard, so the hint was never addressed to this reader
                    // in the first place.
                    touch
                    ? t('typeMessagePlaceholderShort')
                    : t('typeMessagePlaceholder')
            }
            disabled={sessionExpired || readOnly}
            rows={1}
            // Portuguese sentences start with a capital and the field was
            // not asking the keyboard for one. `sentences` is the browser
            // default for a textarea, but "default" is decided by the
            // engine, and on the in-app browsers this runs in it was not
            // happening. Stating it costs nothing and removes the question.
            //
            // Not done in JavaScript on purpose: capitalising as the agent
            // types would fight product codes ("pE 40"), abbreviations and
            // the cursor.
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            // Textarea keeps its own inline title — the GatedButton
            // wrapping pattern doesn't apply to non-button inputs.
            // The placeholder text also surfaces the read-only state.
            title={readOnly ? t('readOnlyTitle') : undefined}
            className={cn(
              // Borderless and transparent — the pill around it is the
              // visible field. A bordered input inside a bordered pill
              // is two frames for one control.
              'text-foreground placeholder-muted-foreground flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none',
              (sessionExpired || readOnly) && 'cursor-not-allowed opacity-50'
            )}
          />

          {/* Empty field → microphone. Typed → send. One slot, never both:
              a send button that is disabled most of the time is a button
              you learn to ignore. */}
          {!text.trim() && !sessionExpired && !readOnly ? (
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={inputsDisabled || busy}
              title={t('voiceNote')}
              aria-label={t('voiceNote')}
              className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mic className="size-5" />
            </button>
          ) : (
            <GatedButton
              size="sm"
              canAct={!readOnly}
              gateReason="send messages"
              disabled={!text.trim() || sessionExpired || sending}
              onClick={handleSend}
              className="bg-primary hover:bg-primary-hover size-9 shrink-0 rounded-full p-0 disabled:opacity-40"
            >
              <Send className="size-4" />
            </GatedButton>
          )}
        </div>
      )}

      {/* Interactive-message builder dialog. */}
      <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('interactiveMessage')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-vh-70 overflow-y-auto">
            <InteractiveBuilder
              value={interactivePayload}
              onChange={setInteractivePayload}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingQuickReply}
              onClick={saveAsQuickReply}
            >
              {savingQuickReply ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1 h-4 w-4" />
              )}
              {t('saveAsQuickReply')}
            </Button>
            <Button onClick={sendInteractive}>
              <Send className="mr-1 h-4 w-4" />
              {t('send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-reply picker. */}
      <QuickReplyPicker
        open={quickReplyOpen}
        onOpenChange={setQuickReplyOpen}
        onPick={handlePickQuickReply}
      />
    </div>
  );
}

/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
function MediaDraftPreview({
  draft,
  busy,
  readOnly,
  onCaptionChange,
  onDiscard,
  onSend,
  t,
}: {
  draft: MediaDraft;
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (caption: string) => void;
  onDiscard: () => void;
  onSend: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="border-border bg-muted/40 rounded-xl border p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === 'video' && (
            <video
              src={draft.mediaUrl}
              controls
              className="max-h-40 rounded-lg"
            />
          )}
          {draft.kind === 'audio' && (
            <audio src={draft.mediaUrl} controls className="w-full" />
          )}
          {draft.kind === 'document' && (
            <div className="text-foreground flex items-center gap-2 text-sm">
              <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          aria-label={t('removeAttachment')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        {draft.kind !== 'audio' && (
          <input
            value={draft.caption}
            maxLength={MEDIA_CAPTION_MAX}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={t('addCaption')}
            className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 rounded-xl border px-4 py-2.5 text-sm transition-colors duration-(--dur-1) outline-none"
          />
        )}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={busy}
          onClick={onSend}
          className={cn(
            'bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0 disabled:opacity-40',
            draft.kind === 'audio' && 'ml-auto'
          )}
        >
          <Send className="h-4 w-4" />
        </GatedButton>
      </div>
    </div>
  );
}
