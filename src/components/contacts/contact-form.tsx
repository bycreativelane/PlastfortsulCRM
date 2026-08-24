'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { withManualName } from '@/lib/contacts/name-source';
import { ContactAvatarField } from './contact-avatar-field';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  CHAT_MEDIA_BUCKET,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';
import { useAuth } from '@/hooks/use-auth';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import {
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DateField } from '@/components/ui/date-field';

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  contactTags?: ContactTag[];
  onSaved: () => void;
  /** Open an existing contact's detail view — used by the duplicate
   *  notice to jump to the contact that already owns this number. */
  onViewExisting?: (contactId: string) => void;
}

export function ContactForm({
  open,
  onOpenChange,
  contact,
  contactTags = [],
  onSaved,
  onViewExisting,
}: ContactFormProps) {
  const t = useTranslations('Contacts.form');
  const supabase = createClient();
  const { accountId } = useAuth();
  const isEdit = !!contact;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  /* The photo, staged rather than uploaded on pick: choosing one and then
     closing the dialog must leave neither an object in the bucket nor a
     change on the contact. */
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');

  /* Commercial fields (migration 040). Behind a disclosure below: most
     contacts are created from an inbound message with nothing but a phone
     number, and putting fourteen fields in front of that would make the
     common case the slow one. */
  const [showCommercial, setShowCommercial] = useState(false);
  const [jobTitle, setJobTitle] = useState('');
  const [taxId, setTaxId] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [source, setSource] = useState('');
  const [birthday, setBirthday] = useState('');
  const [lastPurchaseAt, setLastPurchaseAt] = useState('');
  const [nextPurchaseAt, setNextPurchaseAt] = useState('');
  const [cycleDays, setCycleDays] = useState('');
  const [averageTicket, setAverageTicket] = useState('');
  const [optedOut, setOptedOut] = useState(false);

  const [saving, setSaving] = useState(false);

  // Duplicate-phone detection for NEW contacts. `exact` (same digits)
  // hard-blocks the save; a fuzzy trunk-variant match only warns. The
  // DB unique index (migration 022) is the real backstop — this is the
  // friendly heads-up before we get there.
  const [dupMatch, setDupMatch] = useState<{
    contact: ExistingContact;
    exact: boolean;
  } | null>(null);
  const [checkingDup, setCheckingDup] = useState(false);

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setPendingAvatar(null);
      setAvatarPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setRemoveAvatar(false);
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setJobTitle(contact?.job_title ?? '');
      setTaxId(contact?.tax_id ?? '');
      setCity(contact?.city ?? '');
      setState(contact?.state ?? '');
      setSource(contact?.source ?? '');
      setBirthday(contact?.birthday ?? '');
      setLastPurchaseAt(contact?.last_purchase_at ?? '');
      setNextPurchaseAt(contact?.next_purchase_expected_at ?? '');
      setCycleDays(
        contact?.repurchase_cycle_days != null
          ? String(contact.repurchase_cycle_days)
          : ''
      );
      setAverageTicket(
        contact?.average_ticket != null ? String(contact.average_ticket) : ''
      );
      setOptedOut(contact?.opted_out ?? false);
      // Open the section when the contact already carries any of it, so an
      // edit never hides data the user can see on the record.
      setShowCommercial(
        !!(
          contact?.job_title ||
          contact?.tax_id ||
          contact?.city ||
          contact?.birthday ||
          contact?.last_purchase_at ||
          contact?.next_purchase_expected_at ||
          contact?.opted_out
        )
      );
      setSelectedTagIds(contactTags.map((ct) => ct.tag_id));
      setDupMatch(null);
      fetchTags();
    }
  }, [open, contact]);

  // Look up an existing contact with this number (new contacts only).
  // Runs on blur so we don't query on every keystroke.
  async function checkDuplicate() {
    if (isEdit || !accountId) return;
    const value = phone.trim();
    if (!value) {
      setDupMatch(null);
      return;
    }
    setCheckingDup(true);
    try {
      const existing = await findExistingContact(supabase, accountId, value);
      setDupMatch(
        existing
          ? { contact: existing, exact: isExactMatch(existing, value) }
          : null
      );
    } finally {
      setCheckingDup(false);
    }
  }

  async function fetchTags() {
    setLoadingTags(true);
    const { data } = await supabase.from('tags').select('*').order('name');
    if (data) setTags(data);
    setLoadingTags(false);
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!phone.trim()) {
      toast.error(t('phoneRequired'));
      return;
    }

    // Hard-block an exact duplicate on create (the DB unique index is
    // the real backstop; this avoids a round-trip + a raw error toast).
    if (!isEdit && dupMatch?.exact) {
      toast.error(t('toastConflict'));
      return;
    }

    setSaving(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!accountId)
        throw new Error('Your profile is not linked to an account.');

      let contactId = contact?.id;

      // The photo goes up first, so a failed upload fails the save instead
      // of silently writing everything except the thing the operator just
      // picked.
      //
      // `chat-media` and NOT the `avatars` bucket: that one's policy
      // (migration 008) scopes writes to `auth.uid()` as the first folder,
      // so whoever uploaded a customer's photo would be the only person who
      // could ever replace it. A customer belongs to the account, not to
      // the agent who happened to add them — and `chat-media` (023) is
      // scoped per account, which is the same shape as the fact.
      let nextAvatarUrl: string | null | undefined;
      if (pendingAvatar) {
        const { publicUrl } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          pendingAvatar
        );
        nextAvatarUrl = publicUrl;
      } else if (removeAvatar) {
        nextAvatarUrl = null;
      }

      if (isEdit && contactId) {
        // `withManualName` stamps `name_source: 'manual'` so the inbound
        // webhook stops overwriting this name with the WhatsApp profile's.
        const { error } = await withManualName((nameSource) =>
          supabase
            .from('contacts')
            .update({
              ...nameSource,
              // `undefined` is left out of the payload by supabase-js, so an
              // untouched photo is not overwritten with null.
              ...(nextAvatarUrl !== undefined
                ? { avatar_url: nextAvatarUrl }
                : {}),
              name: name.trim() || null,
              phone: phone.trim(),
              email: email.trim() || null,
              company: company.trim() || null,
              job_title: jobTitle.trim() || null,
              tax_id: taxId.trim() || null,
              city: city.trim() || null,
              // The CHECK only accepts two uppercase letters, so normalise
              // rather than handing the database something it will reject.
              state: state.trim().toUpperCase() || null,
              source: source.trim() || null,
              birthday: birthday || null,
              last_purchase_at: lastPurchaseAt || null,
              next_purchase_expected_at: nextPurchaseAt || null,
              repurchase_cycle_days: cycleDays ? Number(cycleDays) : null,
              average_ticket: averageTicket ? Number(averageTicket) : null,
              opted_out: optedOut,
              // Stamped only on the transition, so the date reflects when they
              // actually asked and not the last time anyone saved the form.
              opted_out_at: optedOut
                ? (contact?.opted_out_at ?? new Date().toISOString())
                : null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', contactId)
        );
        if (error) throw error;
      } else {
        const { data, error } = await withManualName((nameSource) =>
          supabase
            .from('contacts')
            .insert({
              ...nameSource,
              ...(nextAvatarUrl !== undefined
                ? { avatar_url: nextAvatarUrl }
                : {}),
              user_id: user.id,
              account_id: accountId,
              name: name.trim() || null,
              phone: phone.trim(),
              email: email.trim() || null,
              company: company.trim() || null,
              job_title: jobTitle.trim() || null,
              tax_id: taxId.trim() || null,
              city: city.trim() || null,
              // The CHECK only accepts two uppercase letters, so normalise
              // rather than handing the database something it will reject.
              state: state.trim().toUpperCase() || null,
              source: source.trim() || null,
              birthday: birthday || null,
              last_purchase_at: lastPurchaseAt || null,
              next_purchase_expected_at: nextPurchaseAt || null,
              repurchase_cycle_days: cycleDays ? Number(cycleDays) : null,
              average_ticket: averageTicket ? Number(averageTicket) : null,
              opted_out: optedOut,
              // Stamped only on the transition, so the date reflects when they
              // actually asked and not the last time anyone saved the form.
              opted_out_at: optedOut
                ? (contact?.opted_out_at ?? new Date().toISOString())
                : null,
            })
            .select('id')
            .single()
        );
        if (error) throw error;
        contactId = data!.id;
      }

      // Sync tags
      if (contactId) {
        const existingTagIds = new Set(contactTags.map((tag) => tag.tag_id));
        const desiredTagIds = new Set(selectedTagIds);
        const toRemove = [...existingTagIds].filter(
          (id) => !desiredTagIds.has(id)
        );
        const toAdd = [...desiredTagIds].filter(
          (id) => !existingTagIds.has(id)
        );

        for (const tagId of toRemove) {
          await deleteContactTag(contactId, tagId);
        }
        for (const tagId of toAdd) {
          await addContactTag(contactId, tagId);
        }
      }

      toast.success(isEdit ? t('toastSuccessEdit') : t('toastSuccessAdd'));
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      // The unique index (migration 022) rejects a duplicate phone that
      // slipped past the on-blur check (race, or a format that
      // normalizes equal). Surface it as the friendly duplicate notice
      // and, for new contacts, point the user at the existing record.
      if (isUniqueViolation(err)) {
        toast.error(t('toastConflict'));
        if (!isEdit && accountId) {
          const existing = await findExistingContact(
            supabase,
            accountId,
            phone.trim()
          );
          if (existing) setDupMatch({ contact: existing, exact: true });
        }
        return;
      }
      // `err.message` here is a Supabase/storage string in English, and
      // it always won over the key written for this case. The detail goes
      // to the console; the person gets the sentence.
      console.error('Save contact failed:', err);
      toast.error(t('toastError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? t('editTitle') : t('addTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit ? t('editDesc') : t('addDesc')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Above the name, because it is the same fact said two ways and
              a face is the one an agent recognises first. */}
          <ContactAvatarField
            currentUrl={removeAvatar ? null : (contact?.avatar_url ?? null)}
            previewUrl={avatarPreview}
            name={name || phone || ''}
            disabled={saving}
            onPick={(file) => {
              setPendingAvatar(file);
              setRemoveAvatar(false);
              setAvatarPreview((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return URL.createObjectURL(file);
              });
            }}
            onRemove={() => {
              setPendingAvatar(null);
              setRemoveAvatar(true);
              setAvatarPreview((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return null;
              });
            }}
          />

          <div className="space-y-2">
            <FieldLabel htmlFor="cf-name">{t('nameLabel')}</FieldLabel>
            <Input
              id="cf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="cf-phone">
              {t('phoneLabel')} <span className="text-danger-ink">*</span>
            </FieldLabel>
            {/* Masked while typing, stored as E.164. The field used to
                print `+555199000001` straight back — thirteen digits in a
                row that nobody can check against a business card without
                counting them. See `ui/phone-input`. */}
            <PhoneInput
              id="cf-phone"
              value={phone}
              onValueChange={(next) => {
                setPhone(next);
                if (dupMatch) setDupMatch(null);
              }}
              onBlur={checkDuplicate}
              placeholder={t('phonePlaceholder')}
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            />
            {dupMatch ? (
              <div
                className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                  dupMatch.exact
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                }`}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <div className="space-y-1">
                  <p>{dupMatch.exact ? t('dupExact') : t('dupSimilar')}</p>
                  {onViewExisting && (
                    // A `Button`, not a bare `<button>`: this is the way out
                    // of a blocked save on a phone, and only
                    // `[data-slot="button"]` picks up the coarse-pointer
                    // shield that lifts a 16px line to a 44px target.
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={() => onViewExisting(dupMatch.contact.id)}
                      className="-mx-2 h-auto py-0.5 text-xs font-medium text-current underline underline-offset-2 hover:no-underline"
                    >
                      {t('viewExisting', {
                        name: dupMatch.contact.name || dupMatch.contact.phone,
                      })}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">{t('phoneHint')}</p>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="cf-email">{t('emailLabel')}</FieldLabel>
            <Input
              id="cf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="cf-company">{t('companyLabel')}</FieldLabel>
            <Input
              id="cf-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t('companyPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Commercial detail, behind a disclosure.
              A contact created from an inbound WhatsApp message has a phone
              number and nothing else, and that is the overwhelming majority.
              Fourteen fields in front of that turns the thirty-second job
              into the two-minute one. Opens automatically when editing a
              contact that already carries any of it. */}
          <div className="border-border rounded-lg border">
            <button
              type="button"
              onClick={() => setShowCommercial((v) => !v)}
              aria-expanded={showCommercial}
              className="text-secondary-foreground flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold pointer-coarse:py-3"
            >
              <ChevronDown
                className={`size-4 transition-transform duration-(--dur-2) ${showCommercial ? '' : '-rotate-90'}`}
              />
              {t('commercialSection')}
            </button>

            {/* A CONTAINER query, not a viewport one: these pairs live inside
                a dialog whose width is set by the dialog, so the viewport is
                the wrong thing to ask. At 360px this box is ~246px wide and
                two columns leave ~117px for a date input; stacked, each field
                gets the full width. */}
            {showCommercial && (
              <div className="border-border @container space-y-3 border-t p-3">
                <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-job">
                      {t('jobTitleLabel')}
                    </FieldLabel>
                    <Input
                      id="cf-job"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-taxid">
                      {t('taxIdLabel')}
                    </FieldLabel>
                    <Input
                      id="cf-taxid"
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 @xs:grid-cols-[minmax(0,1fr)_5rem]">
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-city">{t('cityLabel')}</FieldLabel>
                    <Input
                      id="cf-city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-state">
                      {t('stateLabel')}
                    </FieldLabel>
                    <Input
                      id="cf-state"
                      value={state}
                      onChange={(e) => setState(e.target.value.toUpperCase())}
                      maxLength={2}
                      placeholder="RS"
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-bday">
                      {t('birthdayLabel')}
                    </FieldLabel>
                    <DateField
                      id="cf-bday"
                      value={birthday}
                      onValueChange={setBirthday}
                      className="[&_input]:bg-muted [&_input]:border-border [&_input]:text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-source">
                      {t('sourceLabel')}
                    </FieldLabel>
                    <Input
                      id="cf-source"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder={t('sourcePlaceholder')}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-last">
                      {t('lastPurchaseLabel')}
                    </FieldLabel>
                    <DateField
                      id="cf-last"
                      value={lastPurchaseAt}
                      onValueChange={setLastPurchaseAt}
                      className="[&_input]:bg-muted [&_input]:border-border [&_input]:text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-next">
                      {t('nextPurchaseLabel')}
                    </FieldLabel>
                    <DateField
                      id="cf-next"
                      value={nextPurchaseAt}
                      onValueChange={setNextPurchaseAt}
                      className="[&_input]:bg-muted [&_input]:border-border [&_input]:text-foreground"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-cycle">
                      {t('cycleLabel')}
                    </FieldLabel>
                    <Input
                      id="cf-cycle"
                      type="number"
                      min={1}
                      value={cycleDays}
                      onChange={(e) => setCycleDays(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                    <p className="text-muted-foreground text-2xs">
                      {t('cycleHint')}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="cf-ticket">
                      {t('ticketLabel')}
                    </FieldLabel>
                    <Input
                      id="cf-ticket"
                      type="number"
                      min={0}
                      step="0.01"
                      value={averageTicket}
                      onChange={(e) => setAverageTicket(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>

                {/* Amber, and it says what it does. This is the one control
                    in this form with a legal consequence: switched on, the
                    contact stops receiving broadcasts and automations. */}
                <label className="border-human-border bg-human-soft flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5">
                  <Checkbox
                    checked={optedOut}
                    onCheckedChange={(v) => setOptedOut(v === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="text-human-ink block text-xs font-semibold">
                      {t('optedOutLabel')}
                    </span>
                    <span className="text-human-ink/80 text-2xs block leading-relaxed">
                      {t('optedOutHint')}
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel>{t('tagsLabel')}</FieldLabel>
            {loadingTags ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-3 animate-spin" />
                {t('loadingTags')}
              </div>
            ) : tags.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t('noTagsAvailable')}
              </p>
            ) : (
              // These are toggles, not labels, so they are Buttons: a raw
              // 22px chip is under every touch minimum there is, and
              // `[data-slot="button"]` is what the coarse-pointer rule in
              // globals.css expands to 44px without moving a pixel. Selection
              // reads as a filled accent instead of a ring-on-ring, which was
              // the only ring-offset in the form.
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  return (
                    <Button
                      key={tag.id}
                      type="button"
                      variant="outline"
                      size="xs"
                      aria-pressed={selected}
                      onClick={() => toggleTag(tag.id)}
                      className={
                        selected
                          ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
                          : 'text-muted-foreground'
                      }
                    >
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={saving || checkingDup || (!isEdit && !!dupMatch?.exact)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? t('update') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
