'use client';

import { useState, useEffect, useCallback, type ComponentProps } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Contact, Deal, ContactNote, Tag } from '@/types';
import {
  AlertTriangle,
  BellOff,
  CalendarClock,
  Building2,
  ChevronRight,
  Pencil,
  Phone,
  Plus,
  ShoppingCart,
  Sliders,
  StickyNote,
  Target,
  UserRound,
  Camera,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatePanel } from '@/components/ui/state-panel';
import { cn } from '@/lib/utils';
import { formatPhone } from '@/lib/whatsapp/phone-format';
import { avatarClass, avatarInitials } from '@/lib/avatar-color';
import { useFormatter, useTranslations } from 'next-intl';
import { formatCurrency } from '@/lib/currency';
import { contactHasOccurrence } from '@/components/inbox/conversation-filters';
import { Tag as TagChip } from '@/components/ui/tag';
import {
  KeyValue,
  QuickAction,
  QuickActionGrid,
  SidePanelLabel,
  SidePanelSection,
} from '@/components/ui/side-panel';

/**
 * This panel's section, one gutter narrower than the shared primitive.
 *
 * `SidePanelSection` ships 16px because other side panels are wider. This
 * rail faces the conversation list across the thread, and that list is on
 * 12px — two rails framing the same conversation with different gutters is
 * the first asymmetry the eye finds in a three-column layout.
 */
function Section({
  className,
  ...props
}: ComponentProps<typeof SidePanelSection>) {
  return <SidePanelSection className={cn('px-3', className)} {...props} />;
}

interface ContactSidebarProps {
  contact: Contact | null;
  /**
   * Overrides for the root. Below `xl` this panel is rendered inside a
   * sheet instead of as a column, where it wants the full width and no
   * left rule of its own.
   */
  className?: string;
  /**
   * Open the customer editor in place.
   *
   * The panel EMITS the intent and the page mounts the dialog, for one
   * concrete reason: the inbox renders this component twice — once as the
   * xl column and once inside the mobile sheet — so state held here would
   * be two independent copies of the same dialog.
   */
  onEditContact?: (contact: Contact) => void;
  /** Same, for a deal. `null` means create one for this contact. */
  onEditDeal?: (contact: Contact, deal: Deal | null) => void;
  /** Open the full record over the thread instead of navigating to it. */
  onOpenRecord?: (contact: Contact) => void;
  /** Open the occurrence history — and the form that adds to it. */
  onOpenOccurrences?: (contact: Contact) => void;
  /** Write down a call that already happened. */
  onLogCall?: (contact: Contact) => void;
  /** Open the "come back to me in September" dialog. */
  onScheduleFuturePurchase?: (contact: Contact) => void;
  /** Bumped by the page after a save, so this panel refetches. */
  refreshToken?: number;
}

export function ContactSidebar({
  contact,
  className,
  onEditContact,
  onEditDeal,
  onOpenRecord,
  onOpenOccurrences,
  onLogCall,
  onScheduleFuturePurchase,
  refreshToken = 0,
}: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');
  const format = useFormatter();

  const { accountId, defaultCurrency } = useAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from('deals')
        // The owner comes along for the ride: `assigned_to` was already on
        // the row and the panel simply never asked for the name behind it.
        .select(
          '*, stage:pipeline_stages(*), assignee:profiles!deals_assigned_to_fkey(*)'
        )
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change, and again whenever the page says something was
  // saved. setContactData/setTags run inside async Supabase callbacks, not
  // synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData, refreshToken]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div
        className={cn(
          'border-border bg-card flex h-full w-72 items-center justify-center border-l',
          className
        )}
      >
        <StatePanel icon={UserRound} title={tThread('selectConversation')} />
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = avatarInitials(displayName);
  const DATE = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;

  // The open deal is the one worth showing at the top. A won or lost one
  // describes a negotiation that is over, and heading today's conversation
  // with last quarter's outcome is worse than showing nothing.
  const currentDeal = deals.find((d) => d.status === 'open') ?? null;

  const hasCommercial =
    !!contact.last_purchase_at ||
    !!contact.next_purchase_expected_at ||
    contact.repurchase_cycle_days != null ||
    contact.average_ticket != null;
  // `contacts.occurrence_count` (migration 042, maintained by trigger) with
  // the old tag as a fallback — see `contactHasOccurrence` for why the tag
  // was never a reliable answer.
  const occurrenceCount = contact.occurrence_count ?? 0;
  const occurrence = contactHasOccurrence({ ...contact, tags });

  return (
    <div
      className={cn(
        'border-border bg-card flex h-full w-72 flex-col border-l',
        className
      )}
    >
      {/* `min-h-0` is what makes this scroll AT ALL, and without it the
          panel silently truncates.

          A flex item defaults to `min-height: auto`, which refuses to
          shrink below its content — so `flex-1` alone let the scroll area
          grow to the height of everything inside it (1680px measured
          against a 500px panel) instead of being bounded by the panel.
          The viewport then matched, `scrollHeight === clientHeight`, and
          nothing scrolled: every section past the fold was clipped by the
          inbox row's `overflow-hidden` with no way to reach it. Reported as
          "tem dados muito no final da sessão" — the last rows of DADOS
          CADASTRAIS simply did not exist on screen.

          `conversation-list.tsx` already carries the same two classes for
          the same reason. */}
      <ScrollArea className="min-h-0 flex-1">
        {/* Identity. Centred, because it is the only block on this panel
            that is about who rather than what.

            `p-3`, not `p-4`: this rail and the conversation list sit on
            either side of the thread, and a 12px gutter facing a 16px one
            is the first thing you see in a three-column layout. */}
        <div className="border-border border-b p-3 text-center">
          {/* The photo is the way to change the photo. It opens the contact
              form, which is where the upload lives — a second uploader here
              would be a second code path writing the same column, and the
              form is one click away either way. */}
          <button
            type="button"
            disabled={!onEditContact}
            onClick={() => onEditContact?.(contact)}
            aria-label={tSidebar('editContact')}
            title={onEditContact ? tSidebar('editContact') : undefined}
            className={cn(
              'text-avatar-ink focus-visible:ring-ring/50 group/photo relative mx-auto grid size-13 place-items-center overflow-hidden rounded-lg text-lg font-semibold outline-none focus-visible:ring-3 disabled:pointer-events-none',
              avatarClass(displayName)
            )}
          >
            {contact.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={contact.avatar_url}
                alt=""
                className="size-13 object-cover"
              />
            ) : (
              initials
            )}
            <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity duration-(--dur-1) group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100">
              <Camera className="size-4 text-white" />
            </span>
          </button>
          <h3 className="text-foreground mt-2 text-base font-semibold tracking-tight">
            {displayName}
          </h3>
          {/* "Síndico · Cond. Solar das Palmeiras" — the sentence that says
              who you are talking to. The role was already on the contact
              (migration 040) and was only being printed far below, in the
              registration block, where nobody reads it first. */}
          {(contact.job_title || contact.company) && (
            <p className="text-muted-foreground text-xs">
              {[contact.job_title, contact.company].filter(Boolean).join(' · ')}
            </p>
          )}
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
              {/* Capped at three, exactly as the contacts table does. A
                  contact carrying six tags turned the identity block into a
                  wall of chips, and the fourth one is never the one you
                  opened the panel to read. The rest are one click away in
                  the record. */}
              {tags.slice(0, 3).map((tag) => (
                <TagChip key={tag.contact_tag_id} color={tag.color}>
                  {tag.name}
                </TagChip>
              ))}
              {tags.length > 3 && (
                <span
                  className="text-muted-foreground text-2xs"
                  title={tags
                    .slice(3)
                    .map((tag) => tag.name)
                    .join(', ')}
                >
                  +{tags.length - 3}
                </span>
              )}
            </div>
          )}
          {/* The record OVER the thread, not instead of it.
              
              This was a link to `/contacts`, which threw away the
              conversation to show the same person's details — and you open
              the record precisely because you are in the middle of
              answering them. It stays an anchor only as a fallback for a
              caller that does not pass the handler; `data-slot="button"`
              and the coarse-pointer height are on both, because this panel
              is a sheet on a phone and the control is a touch target either
              way. */}
          {onOpenRecord ? (
            <button
              type="button"
              data-slot="button"
              onClick={() => onOpenRecord(contact)}
              className="border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground mt-3 inline-flex h-7 w-full items-center justify-center gap-1 rounded-md border text-xs font-semibold [@media(pointer:coarse)]:h-11"
            >
              {tSidebar('fullRecord')}
              <ChevronRight className="size-3" />
            </button>
          ) : (
            <Link
              href={`/contacts?id=${contact.id}`}
              data-slot="button"
              className="border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground mt-3 inline-flex h-7 w-full items-center justify-center gap-1 rounded-md border text-xs font-semibold [@media(pointer:coarse)]:h-11"
            >
              {tSidebar('fullRecord')}
              <ChevronRight className="size-3" />
            </Link>
          )}
        </div>

        {contact.opted_out && (
          <Section>
            <div className="border-human-border bg-human-soft text-human-ink flex items-start gap-2 rounded-md border px-2.5 py-2">
              <BellOff className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold">{tSidebar('optedOut')}</p>
                <p className="text-2xs leading-relaxed">
                  {tSidebar('optedOutHint')}
                </p>
              </div>
            </div>
          </Section>
        )}

        {/* The customer's history of problems, above the commercial detail
            because it changes how you read everything under it.

            This used to read the `Possui Ocorrência` tag, and the tag was
            never written by anything — registering an occurrence produced
            no warning here, no triangle in the list and no filter match.
            Migration 042 keeps `contacts.occurrence_count` by trigger, so
            the count is the fact now and the tag is only kept for accounts
            that applied it by hand before the table existed. */}
        <Section>
          <SidePanelLabel>
            <AlertTriangle />
            {tSidebar('occurrenceHistory')}
          </SidePanelLabel>
          {/* The warning IS the way in, which is what section 15 asks for:
              "ao clicar, abrir rapidamente o histórico". Somebody who has
              just read that this customer had a problem should not have to
              go looking for what it was. */}
          {occurrence ? (
            <button
              type="button"
              data-slot="button"
              disabled={!onOpenOccurrences}
              onClick={() => onOpenOccurrences?.(contact)}
              className="border-danger/25 bg-danger-soft text-danger-ink hover:bg-danger-soft/70 flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold">
                  {tSidebar('occurrenceWarning')}
                </p>
                <p className="text-2xs leading-relaxed">
                  {/* "2 ocorrências no histórico" beats "já teve um
                      problema": how MANY is the difference between an
                      accident and a pattern, and it is the thing an agent
                      about to promise a delivery date needs. Falls back to
                      the old sentence for a contact carrying only the
                      legacy tag, where there is no number to show. */}
                  {occurrenceCount > 0
                    ? tSidebar('occurrenceCount', { count: occurrenceCount })
                    : tSidebar('occurrenceHint')}
                </p>
              </div>
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                {tSidebar('noOccurrences')}
              </p>
              {onOpenOccurrences && (
                <button
                  type="button"
                  onClick={() => onOpenOccurrences(contact)}
                  className="text-muted-foreground hover:text-foreground text-2xs font-semibold underline-offset-2 hover:underline"
                >
                  {tSidebar('registerOccurrence')}
                </button>
              )}
            </div>
          )}
        </Section>

        {/* What is being negotiated right now. */}
        <Section>
          <SidePanelLabel className="justify-between">
            <span className="flex items-center gap-1.5">
              <Target />
              {tSidebar('currentDeal')}
            </span>
            {currentDeal && onEditDeal && (
              <button
                type="button"
                onClick={() => onEditDeal(contact, currentDeal)}
                aria-label={tSidebar('editDeal')}
                title={tSidebar('editDeal')}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="size-3" />
              </button>
            )}
          </SidePanelLabel>
          {!currentDeal ? (
            <p className="text-muted-foreground text-xs">
              {tSidebar('noDeals')}
            </p>
          ) : (
            <>
              <KeyValue label={tSidebar('dealName')}>
                {currentDeal.title}
              </KeyValue>
              <KeyValue label={tSidebar('dealValue')}>
                <span className="tabular-nums">
                  {formatCurrency(
                    currentDeal.value,
                    currentDeal.currency ?? defaultCurrency
                  )}
                </span>
              </KeyValue>
              {currentDeal.stage && (
                /* A grey chip with a coloured dot, not a filled one. The
                   filled treatment is earned in the conversation LIST,
                   where contact type and stage are what you scan a hundred
                   rows for; in a panel you have already navigated to, a
                   solid colour block is the loudest thing on screen saying
                   something you came here knowing. The prototype makes the
                   same split — `tag--cheia` appears in its conversation
                   list and nowhere else. */
                <KeyValue label={tSidebar('dealStage')}>
                  <TagChip color={currentDeal.stage.color}>
                    {currentDeal.stage.name}
                  </TagChip>
                </KeyValue>
              )}
              {currentDeal.assignee?.full_name && (
                <KeyValue label={tSidebar('dealOwner')}>
                  {currentDeal.assignee.full_name}
                </KeyValue>
              )}
              {currentDeal.expected_close_date && (
                <KeyValue label={tSidebar('dealClose')}>
                  {format.dateTime(new Date(currentDeal.expected_close_date), {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </KeyValue>
              )}
            </>
          )}
        </Section>

        {/* Commercial history. Renders only when the contact carries any of
            it — an empty card of dashes on every conversation would be five
            rows of nothing in the densest panel in the app.

            This is also what the birthday / recompra / compra-futura
            automations read, so a blank section here is a direct signal that
            those three cannot fire for this contact. */}
        {hasCommercial && (
          <Section>
            <SidePanelLabel>
              <ShoppingCart />
              {tSidebar('commercial')}
            </SidePanelLabel>
            {contact.last_purchase_at && (
              <KeyValue label={tSidebar('lastPurchase')}>
                {format.dateTime(new Date(contact.last_purchase_at), DATE)}
              </KeyValue>
            )}
            {contact.next_purchase_expected_at && (
              <KeyValue label={tSidebar('nextPurchase')}>
                {format.dateTime(
                  new Date(contact.next_purchase_expected_at),
                  DATE
                )}
              </KeyValue>
            )}
            {contact.repurchase_cycle_days != null && (
              <KeyValue label={tSidebar('cycle')}>
                {tSidebar('cycleDays', { days: contact.repurchase_cycle_days })}
              </KeyValue>
            )}
            {contact.average_ticket != null && (
              <KeyValue label={tSidebar('averageTicket')}>
                <span className="tabular-nums">
                  {formatCurrency(contact.average_ticket, defaultCurrency)}
                </span>
              </KeyValue>
            )}
          </Section>
        )}

        <Section>
          <SidePanelLabel>
            <Sliders />
            {tSidebar('quickActions')}
          </SidePanelLabel>
          {/* Same reason as the record link: quick actions are 32px of
              padding-derived height, which is a comfortable click and a
              missed tap. */}
          <QuickActionGrid className="[@media(pointer:coarse)]:[&>*]:py-3">
            {/* These were `window.open(path, '_self')` — a full document
                navigation out of the inbox, which threw away the realtime
                subscription and the open thread to show a form. Both
                editors are already dialogs; they were simply never mounted
                anywhere near here. */}
            <QuickAction
              disabled={!onEditDeal}
              onClick={() => onEditDeal?.(contact, null)}
            >
              <Target />
              {tSidebar('newDeal')}
            </QuickAction>
            <QuickAction
              disabled={!onEditContact}
              onClick={() => onEditContact?.(contact)}
            >
              <Pencil />
              {tSidebar('editContact')}
            </QuickAction>
            {/* `human` because scheduling a return IS a promise a person
                made — it is one of the two the tone was written for (see
                side-panel.tsx). */}
            <QuickAction
              tone="human"
              disabled={!onScheduleFuturePurchase}
              onClick={() => onScheduleFuturePurchase?.(contact)}
            >
              <CalendarClock />
              {tSidebar('futurePurchase')}
            </QuickAction>
            <QuickAction
              tone="danger"
              disabled={!onOpenOccurrences}
              onClick={() => onOpenOccurrences?.(contact)}
            >
              <AlertTriangle />
              {tSidebar('registerOccurrence')}
            </QuickAction>
            <QuickAction
              disabled={!onLogCall}
              onClick={() => onLogCall?.(contact)}
            >
              <Phone />
              {tSidebar('logCall')}
            </QuickAction>
            {/* "Copiar número" used to be here. It came out because the
                number is already one tap away in Dados cadastrais, and a
                quick action is meant to be a decision about the customer —
                confirm the order, schedule the return, record what went
                wrong — not a clipboard utility sitting among them. */}
          </QuickActionGrid>
        </Section>

        {/* Internal notes. Account-scoped since migration 017, so these are
            the team's shared memory of this customer, not a private pad. */}
        <Section>
          <SidePanelLabel>
            <StickyNote />
            {tSidebar('notes')}
          </SidePanelLabel>
          <div className="flex gap-1.5">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder={tSidebar('addNotePlaceholder')}
              rows={2}
              className="border-border bg-card-2 text-foreground placeholder:text-muted-foreground focus:border-primary/50 min-w-0 flex-1 resize-none rounded-md border px-2.5 py-1.5 text-xs outline-none"
            />
            <Button
              size="sm"
              className="h-auto shrink-0 px-2"
              onClick={handleAddNote}
              disabled={!newNote.trim() || addingNote}
              aria-label={tSidebar('addNote')}
            >
              <Plus className="size-3" />
            </Button>
          </div>
          <div className="mt-2 space-y-1.5">
            {notes.map((note) => (
              <div
                key={note.id}
                className="border-human-border bg-human-soft rounded-md border px-2.5 py-2"
              >
                <p className="text-human-ink text-xs leading-relaxed whitespace-pre-wrap">
                  {note.note_text}
                </p>
                <p className="text-human-ink/70 text-3xs mt-1 text-right">
                  {format.dateTime(new Date(note.created_at), {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section>
          <SidePanelLabel>
            <Building2 />
            {tSidebar('registration')}
          </SidePanelLabel>
          <KeyValue label={tSidebar('phone')}>
            {formatPhone(contact.phone)}
          </KeyValue>
          {contact.email && (
            <KeyValue label={tSidebar('email')}>
              <span title={contact.email}>{contact.email}</span>
            </KeyValue>
          )}
          {/* Empresa and Cargo are the line under the name now, and the
              prototype's own Dados cadastrais block omits both for exactly
              that reason. */}
          {contact.tax_id && (
            <KeyValue label={tSidebar('taxId')}>{contact.tax_id}</KeyValue>
          )}
          {(contact.city || contact.state) && (
            <KeyValue label={tSidebar('location')}>
              {[contact.city, contact.state].filter(Boolean).join('/')}
            </KeyValue>
          )}
          {contact.birthday && (
            <KeyValue label={tSidebar('birthday')}>
              {/* Day and month only. The year on a birthday is either unknown
                  or nobody's business, and the automation ignores it too. */}
              {format.dateTime(new Date(contact.birthday), {
                day: '2-digit',
                month: '2-digit',
              })}
            </KeyValue>
          )}
          {contact.source && (
            <KeyValue label={tSidebar('source')}>{contact.source}</KeyValue>
          )}
          {contact.created_at && (
            <KeyValue label={tSidebar('since')}>
              {format.dateTime(new Date(contact.created_at), {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </KeyValue>
          )}
        </Section>
      </ScrollArea>
    </div>
  );
}
