'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { MISSING_MIGRATION_CODE } from '@/lib/quick-replies/errors';

import { Button } from '@/components/ui/button';
import { StatePanel } from '@/components/ui/state-panel';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from '@/components/interactive/interactive-builder';
import {
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import {
  CHAT_MEDIA_BUCKET,
  MEDIA_MAX_BYTES_BY_KIND,
  deleteAccountMedia,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';
import {
  QUICK_REPLY_MEDIA_ACCEPT,
  mediaKindFromMime,
} from '@/lib/quick-replies/media';
import { SHORTCUT_MAX, normalizeShortcut } from '@/lib/quick-replies/parse';
import { cn } from '@/lib/utils';
import type { QuickReply, QuickReplyKind } from '@/types';

interface DraftState {
  id?: string;
  title: string;
  /** Without the slash — the field renders one, the database stores none. */
  shortcut: string;
  kind: QuickReplyKind;
  content_text: string;
  interactive_payload: InteractiveMessagePayload;
  media_url: string | null;
  media_type: string | null;
  /** Display only. Recovered from the URL when editing an existing row. */
  media_name: string;
}

function emptyDraft(): DraftState {
  return {
    title: '',
    shortcut: '',
    kind: 'text',
    content_text: '',
    interactive_payload: blankButtonsPayload(),
    media_url: null,
    media_type: null,
    media_name: '',
  };
}

/**
 * The stored name of an uploaded object, for the "what did I attach?" line.
 *
 * Upload paths end in the original filename (see `buildMediaPath`), so the
 * last segment is it. Decoded because Storage percent-encodes, and guarded
 * because a URL is not a promise.
 */
function fileNameFromUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

export function QuickRepliesManager() {
  const t = useTranslations('Settings.quickReplies');
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Objects uploaded while this dialog was open.
   *
   * Only these are ever deleted, and only the ones that end up unused —
   * cancelled, or replaced before saving. A file that a SAVED snippet points
   * at is never GC'd, even when the snippet is edited to use a different
   * one: every message ever sent from that snippet stored the same URL, and
   * our own bubbles render it. Deleting the object would blank the picture
   * in conversations that already happened.
   */
  const sessionUploads = useRef<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/quick-replies', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems((data.quick_replies as QuickReply[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // GC every upload from this dialog session except the one that was kept.
  // The public URL ends with the object path, which is how a URL is matched
  // back to the path it came from.
  const dropUnusedUploads = useCallback((keptUrl: string | null) => {
    for (const path of sessionUploads.current) {
      if (keptUrl && keptUrl.endsWith(path)) continue;
      void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
    }
    sessionUploads.current = [];
  }, []);

  const closeDraft = useCallback(
    (keptUrl: string | null) => {
      dropUnusedUploads(keptUrl);
      setDraft(null);
    },
    [dropUnusedUploads]
  );

  const openCreate = () => {
    sessionUploads.current = [];
    setDraft(emptyDraft());
  };

  const openEdit = (qr: QuickReply) => {
    sessionUploads.current = [];
    setDraft({
      id: qr.id,
      title: qr.title,
      shortcut: qr.shortcut ?? '',
      kind: qr.kind,
      content_text: qr.content_text ?? '',
      interactive_payload: qr.interactive_payload ?? blankButtonsPayload(),
      media_url: qr.media_url ?? null,
      media_type: qr.media_type ?? null,
      media_name: fileNameFromUrl(qr.media_url),
    });
  };

  const pickFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    // Same per-kind ceilings the composer enforces — a snippet is sent
    // through exactly the same route, so it inherits exactly the same caps.
    const kind = mediaKindFromMime(file.type);
    const max = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > max) {
      toast.error(
        `${(file.size / 1024 / 1024).toFixed(1)} MB — o limite para ${kind} é ${Math.round(
          max / 1024 / 1024
        )} MB.`
      );
      return;
    }
    setUploading(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(
        CHAT_MEDIA_BUCKET,
        file
      );
      sessionUploads.current.push(path);
      setDraft((d) =>
        d
          ? {
              ...d,
              media_url: publicUrl,
              media_type: file.type,
              media_name: file.name,
            }
          : d
      );
    } catch (err) {
      console.error('Quick reply media upload failed:', err);
      toast.error(t('uploadError'));
    } finally {
      setUploading(false);
    }
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    if (draft.kind === 'media' && !draft.media_url) {
      toast.error(t('mediaRequired'));
      return;
    }

    const common = {
      title: draft.title,
      // Always sent, including empty: clearing the field has to mean "no
      // shortcut" and not "leave whatever was there".
      shortcut: draft.shortcut,
    };
    const payload =
      draft.kind === 'interactive'
        ? {
            ...common,
            kind: 'interactive',
            interactive_payload: draft.interactive_payload,
          }
        : draft.kind === 'media'
          ? {
              ...common,
              kind: 'media',
              media_url: draft.media_url,
              media_type: draft.media_type,
              content_text: draft.content_text,
            }
          : { ...common, kind: 'text', content_text: draft.content_text };

    setSaving(true);
    try {
      const res = await fetch(
        draft.id ? `/api/quick-replies/${draft.id}` : '/api/quick-replies',
        {
          method: draft.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('Quick reply save failed:', data.error);
        toast.error(
          data.error_code === MISSING_MIGRATION_CODE
            ? t('needsMigration')
            : t('saveError')
        );
        return;
      }
      toast.success(draft.id ? t('updated') : t('created'));
      closeDraft(draft.kind === 'media' ? draft.media_url : null);
      await load();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }, [draft, load, t, closeDraft]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm(t('confirmDelete'))) return;
      const res = await fetch(`/api/quick-replies/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('deleteError'));
        return;
      }
      await load();
    },
    [load, t]
  );

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            {t('create')}
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <StatePanel framed icon={MessageSquare} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((qr) => (
            <li
              key={qr.id}
              className="border-border bg-card flex items-start gap-3 rounded-lg border p-3"
            >
              <KindIcon kind={qr.kind} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline gap-1.5">
                  {/* The shortcut leads, exactly as it does in the `/`
                      panel — this list is where somebody comes to find out
                      what they can type. */}
                  {qr.shortcut && (
                    <span className="text-primary shrink-0 font-mono text-sm font-medium">
                      /{qr.shortcut}
                    </span>
                  )}
                  <span className="text-foreground min-w-0 truncate text-sm font-medium">
                    {qr.title}
                  </span>
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {qr.kind === 'interactive' && qr.interactive_payload
                    ? interactivePayloadPreviewText(qr.interactive_payload)
                    : qr.kind === 'media'
                      ? [fileNameFromUrl(qr.media_url), qr.content_text]
                          .filter(Boolean)
                          .join(' · ')
                      : qr.content_text}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEdit(qr)}
                  aria-label={t('edit')}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(qr.id)}
                  aria-label={t('delete')}
                  className="text-danger-ink hover:bg-danger-soft hover:text-danger-ink"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && closeDraft(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? t('editTitle') : t('newTitle')}
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="max-h-vh-70 space-y-3 overflow-y-auto">
              {/* Name and shortcut sit on one row: they are two names for
                  the same snippet — one to read, one to type. */}
              <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    {t('nameLabel')}
                  </label>
                  <Input
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                    placeholder={t('namePlaceholder')}
                    className="bg-muted text-foreground"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">
                    {t('shortcutLabel')}
                  </label>
                  <div className="relative">
                    {/* The slash is drawn, never typed. It is not part of
                        the value — the database stores `frete`, the chat
                        shows `/frete` — and a field that let you type it
                        would immediately be a field that has to decide what
                        `//frete` means. */}
                    <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm">
                      /
                    </span>
                    <Input
                      value={draft.shortcut}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          // Normalised as it is typed, so what the field
                          // shows is what will be saved and what the panel
                          // will match. Silently dropping a space is kinder
                          // than saving a shortcut nobody can reach.
                          shortcut: normalizeShortcut(e.target.value) ?? '',
                        })
                      }
                      placeholder={t('shortcutPlaceholder')}
                      maxLength={SHORTCUT_MAX}
                      className="bg-muted text-foreground pl-6 font-mono"
                    />
                  </div>
                </div>
              </div>
              <p className="text-muted-foreground text-2xs -mt-1">
                {t('shortcutHint')}
              </p>

              <div className="flex gap-2">
                <KindTab
                  active={draft.kind === 'text'}
                  label={t('kindText')}
                  onClick={() => setDraft({ ...draft, kind: 'text' })}
                />
                <KindTab
                  active={draft.kind === 'media'}
                  label={t('kindMedia')}
                  onClick={() => setDraft({ ...draft, kind: 'media' })}
                />
                <KindTab
                  active={draft.kind === 'interactive'}
                  label={t('kindInteractive')}
                  onClick={() => setDraft({ ...draft, kind: 'interactive' })}
                />
              </div>

              {draft.kind === 'text' && (
                <Textarea
                  value={draft.content_text}
                  onChange={(e) =>
                    setDraft({ ...draft, content_text: e.target.value })
                  }
                  placeholder={t('textPlaceholder')}
                  className="bg-muted text-foreground min-h-28"
                />
              )}

              {draft.kind === 'media' && (
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={QUICK_REPLY_MEDIA_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      void pickFile(e.target.files?.[0]);
                      // Same file twice in a row still fires onChange.
                      e.target.value = '';
                    }}
                  />
                  {draft.media_url ? (
                    <div className="border-border bg-muted/40 flex items-center gap-3 rounded-lg border p-3">
                      <MediaThumb
                        url={draft.media_url}
                        type={draft.media_type}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-medium">
                          {draft.media_name || fileNameFromUrl(draft.media_url)}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {draft.media_type}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t('mediaReplace')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('mediaRemove')}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            media_url: null,
                            media_type: null,
                            media_name: '',
                          })
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="border-border text-muted-foreground hover:border-primary/50 hover:text-foreground flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-8 transition-colors duration-(--dur-1) disabled:opacity-60"
                    >
                      {uploading ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <Upload className="size-5" />
                      )}
                      <span className="text-sm">
                        {uploading ? t('uploading') : t('mediaPick')}
                      </span>
                    </button>
                  )}
                  <Textarea
                    value={draft.content_text}
                    onChange={(e) =>
                      setDraft({ ...draft, content_text: e.target.value })
                    }
                    placeholder={t('captionPlaceholder')}
                    className="bg-muted text-foreground min-h-20"
                  />
                  <p className="text-muted-foreground text-2xs">
                    {t('mediaHint')}
                  </p>
                </div>
              )}

              {draft.kind === 'interactive' && (
                <InteractiveBuilder
                  value={draft.interactive_payload}
                  onChange={(p) =>
                    setDraft({ ...draft, interactive_payload: p })
                  }
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => closeDraft(null)}
              disabled={saving}
            >
              {t('cancel')}
            </Button>
            <Button onClick={save} disabled={saving || uploading}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KindIcon({ kind }: { kind: QuickReplyKind }) {
  const Icon =
    kind === 'interactive' ? Zap : kind === 'media' ? Paperclip : MessageSquare;
  return <Icon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />;
}

/** A picture is the fastest way to know you attached the right file. */
function MediaThumb({ url, type }: { url: string; type: string | null }) {
  const kind = mediaKindFromMime(type);
  if (kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="border-border size-12 shrink-0 rounded-md border object-cover"
      />
    );
  }
  if (kind === 'video') {
    return (
      <video
        src={url}
        muted
        className="border-border size-12 shrink-0 rounded-md border object-cover"
      />
    );
  }
  return (
    <span className="border-border text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-md border">
      <FileText className="size-5" />
    </span>
  );
}

function KindTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md border px-3 py-1.5 text-sm font-medium',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}
