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
  if (notification.type === 'new_message') {
    return {
      // The contact's name is the headline, because in a list of ten the
      // question is always WHO, never what kind of event it was. Composed
      // from `contact_id` rather than from the stored title so a contact
      // renamed after the fact reads correctly here too.
      // `|| ...Unknown` and not `|| notification.title`: the writer
      // stores a hardcoded Portuguese 'Contato' when the realtime row has
      // no contact embed, which then renders verbatim on an en/ko install.
      // A stored title is a fallback for text this function cannot
      // compose; it is not a name, and it must not beat the key that is
      // one.
      title:
        names.contact?.trim() ||
        notification.title?.trim() ||
        t('assignedContactUnknown'),
      // The preview IS row data — the customer's own words, in the
      // customer's own language — so unlike the assignment body it is read
      // off the row rather than composed. `t('newMessageNoText')` covers the
      // photo-with-no-caption case, where the trigger stored nothing.
      body: notification.body?.trim() || t('newMessageNoText'),
    };
  }

  if (notification.type === 'task_due') {
    return {
      // O título É a linha da tarefa — as palavras de quem a marcou, como o
      // preview de mensagem acima. Compor "Lembrete: ligar para o Marcos"
      // aqui seria traduzir metade de uma frase cuja outra metade é dado.
      title: notification.title?.trim() || t('taskDueFallbackTitle'),
      body: t('taskDueBody'),
    };
  }

  if (notification.type === 'team_mention') {
    return {
      // QUEM chamou é a manchete, pela mesma razão do `new_message`: numa
      // lista de dez a pergunta é sempre quem. O nome vem de
      // `actor_user_id` resolvido agora — o título gravado pelo gatilho é o
      // nome de quando a mensagem saiu, e é só o fallback.
      title: t('mentionTitle', {
        actor:
          names.actor?.trim() ||
          notification.title?.trim() ||
          t('assignedActorSystem'),
      }),
      // O trecho é DADO — as palavras do colega —, e por isso lido da linha.
      body: notification.body?.trim() || t('mentionNoText'),
    };
  }

  if (notification.type === 'bling_order') {
    // O servidor grava o CÓDIGO do acontecimento em `body` (`manual_change`,
    // `divergent`, `refused`) e o número do pedido em `title`; a frase é
    // composta aqui, na língua da instalação, como as outras.
    const codigo = notification.body?.trim() ?? '';
    const numero = notification.title?.trim() || '—';
    return {
      title: t('blingOrderTitle', { number: numero }),
      body: ['manual_change', 'divergent', 'refused'].includes(codigo)
        ? t(`blingOrderBody.${codigo}`)
        : codigo || null,
    };
  }

  return {
    title: notification.title?.trim() || t('assignedContactUnknown'),
    body: notification.body ?? null,
  };
}
