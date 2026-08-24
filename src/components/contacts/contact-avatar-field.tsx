'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { avatarClass, avatarInitials } from '@/lib/avatar-color';

/**
 * The customer's face, on the contact form.
 *
 * HALF OF THIS ALREADY EXISTED. `contacts.avatar_url` has been in the schema
 * and in the type all along, and two surfaces already draw it when it is
 * there — the conversation row and the sidebar's header — falling back to
 * the colour-seeded initials. What was missing was any way to put one in:
 * nothing in the app ever wrote that column.
 *
 * AND IT HAS TO BE MANUAL. Not as a first step towards something automatic:
 * the WhatsApp Cloud API does not hand over a customer's profile picture at
 * all. The inbound webhook receives `contacts[].profile.name` and nothing
 * else, so there is no automatic version waiting to be built later, and this
 * control should be built as the permanent one.
 *
 * The upload itself belongs to the form's submit, not to this component —
 * picking a photo and then cancelling the dialog must not leave an object in
 * the bucket, and it must not change the contact either. So this stages a
 * local preview and hands the `File` up.
 */
export function ContactAvatarField({
  /** The URL currently stored on the contact, if any. */
  currentUrl,
  /** Local preview of a freshly-picked file, if any. Wins over `currentUrl`. */
  previewUrl,
  /** Name, for the initials fallback and its colour seed. */
  name,
  onPick,
  onRemove,
  disabled,
}: {
  currentUrl: string | null;
  previewUrl: string | null;
  name: string;
  onPick: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Contacts.form');
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = previewUrl ?? currentUrl;

  return (
    <div className="flex items-center gap-3">
      {/* The disc is the button. A photo with a separate "choose file"
          control beside it is two things to understand where there is one
          thing to do — and the disc is already the biggest target on the
          form. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label={shown ? t('avatarChange') : t('avatarAdd')}
        title={shown ? t('avatarChange') : t('avatarAdd')}
        className={cn(
          'group/avatar text-avatar-ink focus-visible:ring-ring/50 relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-full text-base font-semibold outline-none focus-visible:ring-3 disabled:opacity-50',
          avatarClass(name)
        )}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="size-14 object-cover" />
        ) : (
          avatarInitials(name)
        )}
        {/* The camera only appears on hover / focus. Painted over a photo
            permanently it would cover the one thing the control exists to
            show you. */}
        <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity duration-(--dur-1) group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
          <Camera className="size-5 text-white" />
        </span>
      </button>

      <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="text-foreground w-fit text-sm font-semibold underline-offset-2 hover:underline disabled:opacity-50"
        >
          {shown ? t('avatarChange') : t('avatarAdd')}
        </button>
        {shown ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive inline-flex w-fit items-center gap-1 text-xs disabled:opacity-50"
          >
            <Trash2 className="size-3" />
            {t('avatarRemove')}
          </button>
        ) : (
          <p className="text-muted-foreground text-2xs">{t('avatarHint')}</p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          // Same value twice in a row must still fire — re-picking the file
          // you just removed is an ordinary thing to do.
          e.target.value = '';
        }}
      />
    </div>
  );
}
