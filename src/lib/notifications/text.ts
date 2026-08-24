import type { Notification } from '@/types';

/**
 * A notification's text, composed HERE rather than read off the row.
 *
 * `notifications.title` and `.body` are written by a Postgres trigger
 * (`notify_conversation_assigned`, migration 027) at the moment an
 * assignment happens, in English, as literals inside the function:
 *
 *     'New conversation assigned',
 *     COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
 *       || COALESCE(v_contact_name, 'a contact')
 *
 * That is display copy living in the database, which this product has
 * already decided against once: the language of the interface is a property
 * of the installation, not of the row and not of the browser (see the
 * `APP_LOCALE` decision). A trigger cannot know the locale, and translating
 * it in SQL would bake one language into the schema and still leave every
 * row already written in English.
 *
 * So the row's stored text becomes a FALLBACK and the interface composes
 * from the two things that are actually facts — the `type`, and the names of
 * the people involved. That fixes the rows already in the table, which a
 * migration could not.
 *
 * The fallback is not decoration: `type` has one value today and the column
 * is `NOT NULL`, so anything a future trigger writes still renders as
 * whatever it wrote, rather than as an empty row.
 */
export interface NotificationNames {
  /** Display name of `actor_user_id`, when it resolves to a teammate. */
  actor?: string | null;
  /** Display name of `contact_id`. */
  contact?: string | null;
}

type Translator = (key: string, values?: Record<string, string>) => string;

export function notificationText(
  notification: Notification,
  t: Translator,
  names: NotificationNames = {}
): { title: string; body: string | null } {
  if (notification.type === 'conversation_assigned') {
    return {
      title: t('assignedTitle'),
      body: t('assignedBody', {
        // `Someone` in the trigger means the assignment came from an
        // automation rather than a person, and that distinction is worth
        // keeping — it is the difference between "a colleague handed you
        // this" and "the system did".
        actor: names.actor?.trim() || t('assignedActorSystem'),
        contact: names.contact?.trim() || t('assignedContactUnknown'),
      }),
    };
  }
  return { title: notification.title, body: notification.body ?? null };
}
