'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { toast } from 'sonner';
import type {
  Contact,
  Tag,
  ContactTag,
  ContactNote,
  CustomField,
  ContactCustomValue,
  Deal,
  MessageTemplate,
} from '@/types';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  X,
  DollarSign,
  LayoutTemplate,
  StickyNote,
} from 'lucide-react';
import { Tag as TagChip } from '@/components/ui/tag';
import { Badge } from '@/components/ui/badge';
import { StatePanel } from '@/components/ui/state-panel';
import { useTranslations } from 'next-intl';
import { APP_LOCALE } from '@/lib/i18n/locale';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const t = useTranslations('Contacts.detailView');
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase
        .from('contact_tags')
        .select('tag_id')
        .eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*, pipeline:pipelines(name))')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
    }
  }, [
    open,
    contactId,
    fetchContact,
    fetchTags,
    fetchNotes,
    fetchCustomFields,
    fetchDeals,
  ]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  /**
   * ONE Save for the whole record.
   *
   * The registration fields and the custom fields used to be two tabs
   * with a Save button each, which asked an operator to know that
   * "Empresa" and a custom "CNPJ" live in different tables. They do —
   * the second is a delete-and-reinsert into `contact_custom_values` —
   * but that is this schema's problem, not theirs.
   *
   * The contact row goes first and the custom values only if it landed.
   * A failure there is the one the operator can actually act on (the
   * phone is required), and writing half a record on top of a rejected
   * half is how the two halves start disagreeing.
   */
  async function saveRecord() {
    if (!contactId || !editPhone.trim()) {
      toast.error(t('toastPhoneRequired'));
      return;
    }

    setSavingDetails(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error(t('toastUpdateFailed'));
      setSavingDetails(false);
      return;
    }

    if (customFields.length > 0 && !(await writeCustomValues(contactId))) {
      toast.error(t('toastCustomFieldsFailed'));
      setSavingDetails(false);
      return;
    }

    toast.success(t('toastUpdated'));
    fetchContact();
    onUpdated();
    setSavingDetails(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    try {
      if (isSelected) {
        await deleteContactTag(contactId, tagId);
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
      } else {
        await addContactTag(contactId, tagId);
        setContactTagIds((prev) => [...prev, tagId]);
      }
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('toastUpdateFailed')
      );
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error(t('toastNotAuthenticated'));
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error(t('toastNoteAddFailed'));
    } else {
      setNewNote('');
      fetchNotes();
      toast.success(t('toastNoteAdded'));
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error(t('toastNoteDeleteFailed'));
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success(t('toastNoteDeleted'));
    }
  }

  /**
   * Custom values are ROWS, so a save is a delete and a re-insert.
   *
   * Returns whether it worked instead of raising its own toast: the
   * caller owns the one message the operator sees, and two toasts for
   * one Save is the interface admitting it is two writes.
   */
  async function writeCustomValues(id: string): Promise<boolean> {
    try {
      await supabase
        .from('contact_custom_values')
        .delete()
        .eq('contact_id', id);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: id,
          custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .insert(rows);
        if (error) throw error;
      }
      return true;
    } catch {
      return false;
    }
  }

  async function handleSendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues
  ) {
    if (!contactId) return;
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No conversation_id — the route find-or-creates one for this
          // contact, mirroring the inbox template-send payload otherwise.
          contact_id: contactId,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        toast.error(t('toastTemplateFailed', { reason }));
        return;
      }

      toast.success(t('toastTemplateSent', { name: template.name }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      toast.error(`Failed to send template: ${reason}`);
    } finally {
      setSendingTemplate(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  /**
   * The two things you want to know before reading anything else: who this
   * contact IS, and where their business currently STANDS.
   *
   * Both already lived in this sheet, one tab away each — the tags under
   * Etiquetas, the stage under Oportunidades. A fact you have to go looking
   * for is a fact you decide without, so they move to the header. Editing
   * stays in the tabs: the strip states, it does not offer.
   *
   * The OPEN deal, specifically. A won or lost one describes a negotiation
   * that finished, and heading a record with last quarter's outcome is worse
   * than heading it with nothing.
   */
  const currentDeal = deals.find((d) => d.status === 'open') ?? null;
  const contactTags = allTags.filter((t) => contactTagIds.includes(t.id));
  const identityLine = [
    contact?.job_title,
    contact?.company,
    [contact?.city, contact?.state].filter(Boolean).join('/'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          size="record"
          className="bg-popover border-border text-popover-foreground w-full p-0"
        >
          {loading || !contact ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Header */}
              <SheetHeader className="border-border/50 border-b p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="border-border size-12 border">
                    <AvatarFallback
                      seed={contact.name}
                      className="text-sm font-medium"
                    >
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SheetTitle className="text-popover-foreground truncate">
                        {contact.name || t('unnamed')}
                      </SheetTitle>
                      {/* The stage, on the title line and NEUTRAL.

                          It was a filled chip at the head of the tag run,
                          which made the loudest object on the record the one
                          fact you already knew — and doubled its width with
                          the funnel's name in front of it. The prototype's
                          record does exactly this instead: a plain badge
                          beside the name, with the filled treatment reserved
                          for the conversation list, where it is what you scan
                          a hundred rows for.

                          The funnel and the deal's own title move into the
                          tooltip, which is where the "Em andamento exists in
                          both funnels" disambiguation actually belongs. */}
                      {currentDeal?.stage && (
                        <Badge
                          variant="secondary"
                          title={[
                            currentDeal.stage.pipeline?.name,
                            currentDeal.title,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          {currentDeal.stage.name}
                        </Badge>
                      )}
                    </div>
                    {/* "Gerente de suprimentos · Cooperativa Cotrisel ·
                        Santa Maria/RS" — a line that says who you are looking
                        at. It read "Dados do cliente" on every contact, under
                        the contact's own name, inside a sheet that IS the
                        contact record. Kept as `SheetDescription` because the
                        dialog wants one for its accessible description. */}
                    <SheetDescription className="text-muted-foreground mt-0.5 text-xs">
                      {identityLine || t('contactDetailsDesc')}
                    </SheetDescription>
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                      {/* A `Button`, not a raw `<button>`: this sheet is
                          full-width on a phone and the coarse-pointer shield
                          in globals.css only reaches `[data-slot="button"]`,
                          so as a bare element the only copy affordance on the
                          record was a ~20px target. `text-xs` keeps it on the
                          same step as the e-mail and company beside it. */}
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={copyPhone}
                        className="text-muted-foreground hover:text-primary -mx-2 text-xs font-normal"
                      >
                        <Phone className="size-3" />
                        {contact.phone}
                        {copiedPhone ? (
                          <Check className="text-primary size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </Button>
                      {contact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="size-3" />
                          {contact.email}
                        </span>
                      )}
                      {contact.company && (
                        <span className="flex items-center gap-1">
                          <Building2 className="size-3" />
                          {contact.company}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* The tags, and only the tags. The stage moved up to the
                    title line — see the note there. All of them are shown
                    here rather than capped at three the way the inbox panel
                    is: this sheet is the record, and the record is where the
                    full set is supposed to be readable. */}
                {contactTags.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {contactTags.map((tag) => (
                      <TagChip key={tag.id} color={tag.color}>
                        {tag.name}
                      </TagChip>
                    ))}
                  </div>
                )}

                <div className="mt-3">
                  <Button
                    size="sm"
                    onClick={() => setTemplatePickerOpen(true)}
                    disabled={sendingTemplate}
                  >
                    {sendingTemplate ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LayoutTemplate className="size-4" />
                    )}
                    {t('sendTemplateBtn')}
                  </Button>
                </div>
              </SheetHeader>

              {/* Tabs */}
              <Tabs
                defaultValue="details"
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* FOUR tabs, and no scroller.
                    Five with Portuguese labels overran the strip, and the
                    fix at the time was to cap its width and let it scroll
                    sideways — which puts a scrollbar inside a tab strip and
                    hides a whole tab behind a gesture nobody is told about.
                    Both causes are gone: the sheet is 42rem now (it had
                    been rendering at 24 no matter what it asked for), and
                    "Campos personalizados" moved into Dados, where the
                    other fields of the same record already were.
                    `flex-wrap` is the floor, not the plan: below ~340px the
                    last tab drops to a second line, which costs a row and
                    hides nothing. */}
                <TabsList className="bg-muted/50 border-border mx-4 mt-3 flex-wrap justify-start gap-y-1 border-b group-data-horizontal/tabs:h-auto">
                  <TabsTrigger
                    value="details"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground h-7"
                  >
                    {t('tabs.details')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="tags"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground h-7"
                  >
                    {t('tabs.tags')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="notes"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground h-7"
                  >
                    {t('tabs.notes')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="deals"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground h-7"
                  >
                    {t('tabs.deals')}
                  </TabsTrigger>
                </TabsList>

                {/* Details Tab — registration fields AND the account's own.
                    Two columns once the PANEL is wide enough — a
                    container query, not `sm:`, because the thing that
                    decides is the sheet's width and not the window's. A
                    460px window gets one column from `sm:` while the sheet
                    it is looking at is 460px wide and has room for two.
                    At 42rem a single column left half the sheet empty and
                    pushed Save below the fold. */}
                <TabsContent
                  value="details"
                  className="@container flex-1 overflow-y-auto px-4 py-3"
                >
                  <div className="space-y-4">
                    {/* `htmlFor`/`id` on every pair: `FieldLabel` renders a
                        real `<label>` but does not wrap its control here, so
                        without the wiring clicking the label focused nothing
                        and the screen reader read four unlabelled inputs. */}
                    <div className="grid gap-3 @sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="cd-name">{t('name')}</FieldLabel>
                        <Input
                          id="cd-name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="bg-muted border-border text-foreground"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="cd-phone">
                          {t('phone')}{' '}
                          <span className="text-danger-ink">*</span>
                        </FieldLabel>
                        <Input
                          id="cd-phone"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="bg-muted border-border text-foreground"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="cd-email">{t('email')}</FieldLabel>
                        <Input
                          id="cd-email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="bg-muted border-border text-foreground"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="cd-company">
                          {t('company')}
                        </FieldLabel>
                        <Input
                          id="cd-company"
                          value={editCompany}
                          onChange={(e) => setEditCompany(e.target.value)}
                          className="bg-muted border-border text-foreground"
                        />
                      </div>
                    </div>

                    {/* The account's own fields, under the same Save. Hidden
                        entirely when there are none: a heading over an empty
                        state, on a tab that is not about them, is two kinds
                        of noise. Settings is where they get created. */}
                    {loadingCustom ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="text-muted-foreground size-5 animate-spin" />
                      </div>
                    ) : customFields.length > 0 ? (
                      <div className="border-border space-y-3 border-t pt-4">
                        <p className="text-muted-foreground eyebrow">
                          {t('tabs.custom')}
                        </p>
                        <div className="grid gap-3 @sm:grid-cols-2">
                          {customFields.map((field) => (
                            <div key={field.id} className="space-y-1.5">
                              <FieldLabel
                                htmlFor={`cd-custom-${field.id}`}
                                className="capitalize"
                              >
                                {field.field_name}
                              </FieldLabel>
                              <Input
                                id={`cd-custom-${field.id}`}
                                value={customValues[field.id] ?? ''}
                                onChange={(e) =>
                                  setCustomValues((prev) => ({
                                    ...prev,
                                    [field.id]: e.target.value,
                                  }))
                                }
                                placeholder={t('enterCustomField', {
                                  name: field.field_name,
                                })}
                                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Full width in a narrow panel, its own size in a
                        wide one: a 40rem Save is a target nobody can miss
                        and a proportion nobody chose. */}
                    <Button
                      onClick={saveRecord}
                      disabled={savingDetails}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full @sm:w-auto"
                      size="sm"
                    >
                      {savingDetails ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {t('saveChangesBtn')}
                    </Button>
                  </div>
                </TabsContent>

                {/* Tags Tab */}
                <TabsContent
                  value="tags"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">
                      {t('tagsTab.clickTagDesc')}
                    </p>
                    {allTags.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t('tagsTab.noTagsAvailable')}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((tag) => {
                          const selected = contactTagIds.includes(tag.id);
                          return (
                            // Same toggle, same treatment as the one in
                            // contact-form: a Button so the coarse-pointer
                            // rule gives it a 44px target, and selection as a
                            // filled accent rather than a ring around a pill.
                            <Button
                              key={tag.id}
                              variant="outline"
                              size="xs"
                              aria-pressed={selected}
                              onClick={() => toggleTag(tag.id)}
                              disabled={savingTags}
                              className={
                                selected
                                  ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
                                  : 'text-muted-foreground'
                              }
                            >
                              {selected ? (
                                <Check />
                              ) : (
                                <span
                                  aria-hidden
                                  className="size-1.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: tag.color }}
                                />
                              )}
                              {tag.name}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Notes Tab */}
                <TabsContent
                  value="notes"
                  className="flex min-h-0 flex-1 flex-col px-4 py-3"
                >
                  <div className="mb-3 space-y-2">
                    <Textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder={t('notesTab.placeholder')}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-16 resize-none"
                    />
                    <Button
                      onClick={addNote}
                      disabled={!newNote.trim() || savingNote}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      size="sm"
                    >
                      {savingNote ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                      {t('notesTab.save')}
                    </Button>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto">
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="text-muted-foreground size-5 animate-spin" />
                      </div>
                    ) : notes.length === 0 ? (
                      <StatePanel
                        icon={StickyNote}
                        title={t('notesTab.noNotes')}
                      />
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="bg-muted/50 border-border/50 group rounded-lg border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            {/* The note is CONTENT — a person typed it. It was
                                `muted`, the same ink as its own timestamp
                                below, which left 14px vs 12px as the only
                                thing separating the thing from the label on
                                the thing. */}
                            <p className="text-secondary-foreground flex-1 text-sm whitespace-pre-wrap">
                              {note.note_text}
                            </p>
                            {/* `pointer-coarse:opacity-100`: reveal-on-hover
                                means no reveal at all on a phone, and this is
                                the only way to delete a note. */}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => deleteNote(note.id)}
                              aria-label={t('notesTab.deleteNote')}
                              className="text-muted-foreground hover:text-destructive -mt-1 -mr-1 shrink-0 opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <p className="text-muted-foreground mt-1.5 text-xs">
                            {new Date(note.created_at).toLocaleDateString(
                              APP_LOCALE,
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                {/* Deals Tab */}
                <TabsContent
                  value="deals"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingDeals ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-primary size-5 animate-spin" />
                    </div>
                  ) : deals.length === 0 ? (
                    <StatePanel
                      icon={DollarSign}
                      title={t('dealsTab.noDeals')}
                    />
                  ) : (
                    <div className="space-y-2">
                      {deals.map((deal) => (
                        <div
                          key={deal.id}
                          className="border-border bg-muted/50 rounded-lg border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-foreground text-sm font-medium">
                              {deal.title}
                            </p>
                            {/* Grey chip, coloured dot. `stage.color` at 20%
                                alpha behind `stage.color` as ink is a pairing
                                nothing can verify — a pale stage colour lands
                                somewhere near 1.5:1. */}
                            {deal.stage && (
                              <TagChip color={deal.stage.color} size="sm">
                                {deal.stage.name}
                              </TagChip>
                            )}
                          </div>
                          <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1">
                              <DollarSign className="size-3" />
                              {formatCurrency(
                                deal.value ?? 0,
                                deal.currency || defaultCurrency
                              )}
                            </span>
                            {/* Green for won, red for lost. It was `primary`
                                for won — the accent is not a signal, and the
                                doctrine already reserves `ok` for "confirmed".
                                The label was also the raw enum, in English. */}
                            {deal.status && deal.status !== 'open' && (
                              <span
                                className={
                                  deal.status === 'won'
                                    ? 'text-ok-ink font-medium'
                                    : 'text-danger-ink font-medium'
                                }
                              >
                                {deal.status === 'won'
                                  ? t('dealsTab.statusWon')
                                  : t('dealsTab.statusLost')}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <TemplatePicker
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        onSelect={handleSendTemplate}
      />
    </>
  );
}
