'use client';

import { useCallback, useState } from 'react';
import {
  Download,
  FileText,
  ImageOff,
  Loader2,
  Maximize2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { Message } from '@/types';
import { downloadMediaMessage } from '@/lib/media/download';
import { useMediaBlobUrl } from '@/hooks/use-media-blob-url';

/**
 * The media renderers behind `<MessageBubble>`'s image / video / audio /
 * document cases. Split out of message-bubble.tsx so that file stays a
 * thin content switch — everything here is about the two affordances
 * issue #373 asked for: open it full-size, and save it.
 *
 * Both are less trivial than they look, because the two flavours of
 * `media_url` behave differently in the browser. See
 * `@/lib/media/blob-cache` for the proxy-vs-bucket split and
 * `@/lib/media/download` for why `<a download>` alone isn't enough.
 */

type Translator = ReturnType<typeof useTranslations>;

/** Inline media size cap, shared so the four bubbles can't drift apart. */
const MEDIA_BOX = 'max-h-64 max-w-60';

export function MediaUnavailable({
  label,
  t,
}: {
  label: string;
  t: Translator;
}) {
  return (
    <div className="bg-wa-inset text-foreground/70 flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
      <ImageOff className="text-foreground/60 h-4 w-4 shrink-0" />
      <span>{t('unavailable', { label })}</span>
    </div>
  );
}

/**
 * Kicks off a download and reports failure as a toast. Kept as a hook so
 * each bubble owns its own in-flight state — a slow 16 MB video shouldn't
 * put a spinner on every other attachment in the thread.
 */
function useMediaDownload(message: Message, t: Translator) {
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadMediaMessage(message);
    } catch {
      toast.error(t('downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }, [downloading, message, t]);

  return { downloading, download };
}

function MediaActionButton({
  icon: Icon,
  label,
  onClick,
  busy = false,
  onBubble = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
  /** The button sits on the bubble itself, not over media. See below. */
  onBubble?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      // TWO surfaces, because there are two situations.
      //
      // Over an image or a video the button floats on pixels it cannot
      // predict, so it brings its own opaque ground and a blur — that is
      // the only thing that reads on an arbitrary photo.
      //
      // On an audio or document bubble there is no photo: the button sits
      // on the bubble and nothing else, and an opaque near-white pill with
      // a cool grey ring on a light-green fill is the second grey object
      // in the same bubble. There it derives from the bubble like every
      // other inset.
      //
      // (The comment this replaces claimed the opaque version "reads on
      // the primary outbound fill". That fill has not existed since the
      // outbound bubble became `bg-wa-out`.)
      //
      // 28px is the drawing; on a coarse pointer it becomes the target it
      // has to be. Save-this-file is the whole affordance on the audio and
      // document bubbles, and those have no lightbox to fall back to.
      className={cn(
        'text-foreground flex size-7 items-center justify-center rounded-full border shadow-sm transition-colors duration-(--dur-1) disabled:opacity-60 [@media(pointer:coarse)]:size-11',
        onBubble
          ? 'border-foreground/10 bg-wa-inset hover:bg-foreground/12'
          : 'border-border/60 bg-background/85 hover:bg-background backdrop-blur-sm'
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
    </button>
  );
}

function MediaPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-wa-inset flex h-40 w-60 items-center justify-center rounded-lg">
      {children}
    </div>
  );
}

export function MediaImageBubble({
  message,
  onOpen,
  t,
}: {
  message: Message;
  /** Opens the thread's lightbox on this message. Omitted ⇒ not clickable. */
  onOpen?: () => void;
  t: Translator;
}) {
  const { src, status } = useMediaBlobUrl(message.media_url);
  // The fetch can succeed and the bytes still not be a decodable image.
  const [broken, setBroken] = useState(false);
  const { downloading, download } = useMediaDownload(message, t);

  if (status === 'error' || broken) {
    return (
      <MediaPlaceholder>
        <ImageOff className="text-muted-foreground h-8 w-8" />
      </MediaPlaceholder>
    );
  }

  if (status !== 'ready' || !src) {
    return (
      <MediaPlaceholder>
        <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
      </MediaPlaceholder>
    );
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={t('imageAlt')}
      className={cn(MEDIA_BOX, 'rounded-lg object-contain')}
      onError={() => setBroken(true)}
    />
  );

  return (
    <div className="group/media relative w-fit">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('viewImage')}
          className="focus-visible:ring-ring block cursor-zoom-in rounded-lg ring-offset-2 ring-offset-transparent outline-none focus-visible:ring-2"
        >
          {image}
        </button>
      ) : (
        image
      )}
      {/* Hover-only: on touch there is no hover, but tapping the image opens
          the viewer, which carries a full-size Download button. */}
      <div className="absolute right-2 bottom-2 opacity-0 transition-opacity duration-(--dur-1) group-focus-within/media:opacity-100 group-hover/media:opacity-100">
        <MediaActionButton
          icon={Download}
          label={t('download')}
          onClick={download}
          busy={downloading}
        />
      </div>
    </div>
  );
}

export function MediaVideoBubble({
  message,
  onOpen,
  t,
}: {
  message: Message;
  onOpen?: () => void;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);

  return (
    <div className="relative w-fit">
      {/* Plain URL, not a blob: the element should stream rather than wait
          for up to 16 MB to land. */}
      <video
        src={message.media_url}
        controls
        preload="metadata"
        className={cn(MEDIA_BOX, 'rounded-lg')}
      />
      {/* Top-right, clear of the native controls — and always visible, since
          expanding is the only way to watch a clip capped at 15rem wide and
          a touch device gets no hover. */}
      <div className="absolute top-2 right-2 flex gap-1">
        {onOpen && (
          <MediaActionButton
            icon={Maximize2}
            label={t('expandVideo')}
            onClick={onOpen}
          />
        )}
        <MediaActionButton
          icon={Download}
          label={t('download')}
          onClick={download}
          busy={downloading}
        />
      </div>
    </div>
  );
}

export function MediaAudioBubble({
  message,
  t,
}: {
  message: Message;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);

  return (
    <div className="flex items-center gap-2">
      <audio src={message.media_url} controls className="max-w-60" />
      <MediaActionButton
        icon={Download}
        label={t('download')}
        onClick={download}
        busy={downloading}
        onBubble
      />
    </div>
  );
}

export function MediaDocumentBubble({
  message,
  t,
}: {
  message: Message;
  t: Translator;
}) {
  const { downloading, download } = useMediaDownload(message, t);

  return (
    <div className="flex items-center gap-2">
      <a
        href={message.media_url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-wa-inset hover:bg-foreground/10 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors duration-(--dur-1)"
      >
        <FileText className="text-foreground/60 size-5 shrink-0" />
        <span className="truncate">
          {message.content_text || t('document')}
        </span>
      </a>
      <MediaActionButton
        icon={Download}
        label={t('download')}
        onClick={download}
        busy={downloading}
        onBubble
      />
    </div>
  );
}
