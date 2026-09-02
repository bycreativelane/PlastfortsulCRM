'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { Button } from '@/components/ui/button';
import { PageActions } from '@/components/layout/page-actions';
import {
  EMPTY_SEGMENTATION,
  IDLE_OPTIONS,
  applySegmentation,
  countSegmentationFilters,
  isSegmentationActive,
  type Segmentation,
} from '@/components/contacts/segmentation';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  ListFilter,
  Loader2,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tag as TagIcon,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { Tag as TagChip } from '@/components/ui/tag';
import { StatePanel } from '@/components/ui/state-panel';
import { formatPhone } from '@/lib/whatsapp/phone-format';
import { FieldLabel } from '@/components/ui/field';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { OptionSelect } from '@/components/ui/option-select';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

// `useSearchParams` (the `?id=` deep link below) needs a Suspense
// boundary or the production build bails out to client rendering.
// Same thin wrapper the board uses for `?p=` and the inbox for `?c=`.
export default function ContactsPage() {
  return (
    <Suspense fallback={null}>
      <ContactsPageInner />
    </Suspense>
  );
}

function ContactsPageInner() {
  const t = useTranslations('Contacts.page');
  const supabase = createClient();
  const router = useRouter();
  const { accountId } = useAuth();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Tag filter — contacts shown must have ANY of these tags (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [segmentation, setSegmentation] =
    useState<Segmentation>(EMPTY_SEGMENTATION);
  /**
   * Whether the segmentation panel is open — a PHONE-ONLY concern. From
   * `lg` up the panel is always visible and this is ignored (see the
   * note above the panel).
   *
   * Starts shut, and stays shut across a re-render even with filters
   * set: the counter on the toggle is what reports them, and a panel
   * that re-opens itself because state exists would undo the whole
   * point on the one screen with the least room.
   */
  const [segOpen, setSegOpen] = useState(false);
  /** Drives the counter chip on the phone's toggle. */
  const segFilterCount = countSegmentationFilters(segmentation);
  // The tag path runs through filter_contacts_by_tags (migration 025),
  // whose signature has no room for these. Rather than apply half of
  // what the card shows, it stands down and says why.
  const segmentationBlocked = selectedTagIds.length > 0;

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  /**
   * `?id=<contactId>` — open straight into that contact's panel.
   *
   * The global search pushes this for a contact who has no conversation
   * yet. It used to push a bare `/contacts`, so typing a name into
   * Ctrl+K and pressing Enter landed you on the unfiltered table of
   * everyone, and you searched a second time in a different box for the
   * person you had already named.
   *
   * The parameter seeds the panel's state directly rather than being
   * applied by an effect: `react-hooks/set-state-in-effect` rejects the
   * effect form, and it is right to — an effect that immediately sets
   * state renders once with the panel shut and once with it open, so
   * the deep link visibly flickers closed before it opens. A lazy
   * initialiser is one render, and it is read once, which is what a
   * link that survives a refresh needs.
   */
  const searchParams = useSearchParams();
  const [detailContactId, setDetailContactId] = useState<string | null>(() =>
    searchParams.get('id')
  );
  const [detailOpen, setDetailOpen] = useState(
    () => searchParams.get('id') !== null
  );
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly toggling tag filters could let a slower
  // earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
      // Drop any filter selections whose tag no longer exists (e.g. a tag
      // deleted elsewhere) so it can't linger invisibly in the query.
      setSelectedTagIds((prev) => {
        const pruned = prev.filter((id) => map[id]);
        return pruned.length === prev.length ? prev : pruned;
      });
    }
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let contactRows: Contact[];
    let count: number;

    if (selectedTagIds.length > 0) {
      // Tag filter active — resolve it server-side (join + distinct +
      // windowed total count + pagination) so a tag covering many
      // contacts can't silently truncate the result or overflow an IN
      // clause. See migration 025_filter_contacts_by_tags.
      const { data, error } = await supabase.rpc('filter_contacts_by_tags', {
        p_tag_ids: selectedTagIds,
        p_search: term || null,
        p_limit: PAGE_SIZE,
        p_offset: from,
      });
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as { contact: Contact; total_count: number }[];
      contactRows = rows.map((r) => r.contact);
      count = rows.length > 0 ? Number(rows[0].total_count) : 0;
    } else {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      // Scope to the account explicitly, even though RLS already does it.
      // RLS uses `is_account_member(account_id)`, a SECURITY DEFINER SQL
      // function, and Postgres refuses to inline those — so the planner never
      // sees an equality on `account_id` and cannot seek on it. Every index
      // migration 040 added is led by `account_id`, so without this line they
      // are unreachable here and the segmentation degrades to a seq scan.
      // Conditional because `accountId` is null on the first render; RLS keeps
      // the result correct until it resolves.
      if (accountId) query = query.eq('account_id', accountId);

      if (term) {
        const like = `%${term}%`;
        query = query.or(
          `name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
        );
      }

      // Segmentation composes into this query because every one of its
      // filters lives on `contacts` itself. The tag path above cannot take
      // them — it goes through an RPC with a fixed signature — which is why
      // the card disables itself while a tag is selected.
      query = applySegmentation(query, segmentation);

      const { data, count: exactCount, error } = await query;
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      contactRows = data ?? [];
      count = exactCount ?? 0;
    }

    setTotalCount(count);

    if (contactRows.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = contactRows.map((c) => c.id);
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = contactRows.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [
    supabase,
    accountId,
    page,
    search,
    selectedTagIds,
    segmentation,
    tagsMap,
    t,
  ]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error(t('toastFailedDelete'));
    } else {
      toast.success(t('toastDeleted'));
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await supabase.from('contacts').delete().in('id', ids);

    if (error) {
      toast.error(t('toastBulkFailedDelete'));
    } else {
      toast.success(t('toastBulkDeleted', { count: ids.length }));
      setSelected(new Set());
      fetchContacts();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Tag filter helpers. Every change resets to page 0 — the result set
  // shrinks/grows so page N may no longer be valid (mirrors the search box).
  const allTags = Object.values(tagsMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const hasActiveFilters =
    search.trim().length > 0 || selectedTagIds.length > 0;

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
    setPage(0);
  }

  function clearTagFilters() {
    setSelectedTagIds([]);
    setPage(0);
  }

  return (
    <div className="space-y-6">
      <PageActions>
        {/* The label drops out under 640px so the three actions still fit
            the 328px of content a 360px phone has. Hiding the SECONDARY
            label is what buys the primary action its room — the slot they
            share cannot wrap, so whatever does not fit is clipped, and the
            clipped end is always the primary. */}
        {canEditSettings && (
          <Button
            variant="outline"
            onClick={() => setCustomFieldsOpen(true)}
            className="border-border bg-card"
            aria-label={t('customFieldsBtn')}
          >
            <SlidersHorizontal />
            <span className="hidden sm:inline">{t('customFieldsBtn')}</span>
          </Button>
        )}
        <GatedButton
          variant="outline"
          canAct={canEdit}
          gateReason="add or import contacts"
          onClick={() => setImportOpen(true)}
          className="border-border bg-card"
        >
          <Upload />
          {t('importBtn')}
        </GatedButton>
        <GatedButton
          canAct={canEdit}
          gateReason="add or import contacts"
          onClick={openAddForm}
        >
          <Plus />
          {t('addContactBtn')}
        </GatedButton>
      </PageActions>

      <PageHeader
        title={t('title')}
        description={
          totalCount > 0
            ? t('subtitle', { count: totalCount })
            : t('subtitleZero')
        }
      />

      {/* Search + tag filter */}
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative w-full max-w-sm">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Reset pagination when the query changes — the result
                // set shrinks/grows, page N may no longer be valid.
                setPage(0);
              }}
              placeholder={t('searchPlaceholder')}
              className="bg-card border-border text-foreground placeholder:text-muted-foreground pl-8"
            />
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted shrink-0"
                />
              }
            >
              <Filter className="size-4" />
              {t('filterByTags')}
              {selectedTagIds.length > 0 && (
                // 18px, the dense chip height. It had no height at all, so
                // the counter sat a pixel or two off every other chip in the
                // app and changed size with the button's line-height.
                <span className="bg-primary text-primary-foreground text-3xs ml-1 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.5 font-semibold">
                  {selectedTagIds.length}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <div className="border-border flex items-center justify-between border-b px-3 py-2">
                <span className="text-popover-foreground text-sm font-medium">
                  {t('filterByTags')}
                </span>
                {selectedTagIds.length > 0 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={clearTagFilters}
                    className="text-muted-foreground hover:text-foreground -mr-1"
                  >
                    {t('clearAll')}
                  </Button>
                )}
              </div>
              {allTags.length === 0 ? (
                <StatePanel icon={TagIcon} title={t('noTagsYet')} />
              ) : (
                <div className="max-h-64 overflow-y-auto py-1">
                  {allTags.map((tag) => (
                    <label
                      key={tag.id}
                      className="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-3 py-1.5"
                    >
                      <Checkbox
                        checked={selectedTagIds.includes(tag.id)}
                        onCheckedChange={() => toggleTagFilter(tag.id)}
                        aria-label={`Filter by ${tag.name}`}
                      />
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-popover-foreground truncate text-sm">
                        {tag.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Active tag-filter chips */}
        {selectedTagIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedTagIds.map((id) => {
              const tag = tagsMap[id];
              if (!tag) return null;
              return (
                // The dismiss control sits OUTSIDE the chip rather than in
                // its children: `Tag` truncates whatever it is given, and a
                // truncated close button is a close button that disappears
                // exactly when the label is long enough to want removing.
                <span key={id} className="inline-flex items-center gap-0.5">
                  <TagChip color={tag.color}>{tag.name}</TagChip>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => toggleTagFilter(id)}
                    aria-label={`Remove ${tag.name} filter`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </Button>
                </span>
              );
            })}
            <Button
              variant="ghost"
              size="xs"
              onClick={clearTagFilters}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('clearAll')}
            </Button>
          </div>
        )}
      </div>

      {/* Segmentation.
          Every filter here lives on `contacts`, which is what lets them
          compose into the same paginated query the list already runs. The
          tag filter cannot join them — it goes through an RPC with a fixed
          signature — so the card says so instead of quietly computing a
          number from half the conditions.

          ------------------------------------------------------------
          AND ON A PHONE IT STARTS CLOSED, UNDER THE SEARCH FIELD.
          ------------------------------------------------------------

          Open, this panel is five labelled controls in a single column —
          about 350px — plus "Criar campanha com este público". It used
          to sit between the page title and everything else, so on a
          375×812 screen the first row of the CONTACTS TABLE landed at
          the very bottom edge: a page called Contatos that showed no
          contacts until you scrolled.

          Segmentation is desk work. You build an audience here to hand
          it to a broadcast, and that is a thing you do sitting down. The
          question a phone asks on this page is always the other one —
          "what is Marcos's number" — which is why the search field now
          comes first and this comes second, shut, behind a button that
          says how many conditions are set.

          `lg` and not `sm`: at 640–1024px the panel is already two
          columns and costs ~180px, which a tablet can afford.

          Nothing here is conditional in JS. The panel renders at every
          width and the controls keep their state; only its VISIBILITY
          below `lg` is toggled, so opening it costs no re-query and
          collapsing it never silently drops a filter somebody set. */}
      <div className="lg:hidden">
        <button
          type="button"
          data-slot="button"
          onClick={() => setSegOpen((v) => !v)}
          aria-expanded={segOpen}
          aria-controls="segmentation-panel"
          className="border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors"
        >
          {/* `ListFilter`, not the `SlidersHorizontal` in the toolbar
              above — that one already means "campos personalizados" on
              this very page, and two controls with one glyph is a
              question the reader has to answer every time. */}
          <ListFilter className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 text-left">
            {t('segmentation.title')}
          </span>
          {segFilterCount > 0 && (
            // Same 18px counter chip the tag filter above uses. It is the
            // whole reason a collapsed filter is safe: a list narrowed by
            // conditions you cannot see is a list that looks broken.
            <span className="bg-primary text-primary-foreground text-3xs inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1.5 font-semibold">
              {segFilterCount}
            </span>
          )}
          <ChevronDown
            aria-hidden
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform duration-(--dur-1)',
              segOpen && 'rotate-180'
            )}
          />
        </button>
      </div>

      <Panel
        id="segmentation-panel"
        // `hidden lg:block` and not `lg:block` alone: without the
        // breakpoint half, opening it on a phone and then widening the
        // window would leave the desk layout hiding its own panel.
        className={cn(!segOpen && 'hidden lg:block')}
      >
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle>{t('segmentation.title')}</PanelTitle>
            <PanelSub>{t('segmentation.subtitle')}</PanelSub>
          </div>
          <PanelActions>
            {isSegmentationActive(segmentation) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSegmentation(EMPTY_SEGMENTATION);
                  setPage(0);
                }}
                className="text-muted-foreground hover:text-foreground font-semibold"
              >
                {t('clearAll')}
              </Button>
            )}
          </PanelActions>
        </PanelHeader>
        <PanelBody>
          {segmentationBlocked && (
            <p className="bg-human-soft text-human-ink mb-3 rounded-md px-2.5 py-2 text-xs">
              {t('segmentation.blockedByTag')}
            </p>
          )}

          {/* The four controls were two heights: the selects took the
              primitive's 32px and the inputs overrode to 36px, in one row.
              The overrides are gone — nothing here declares a height. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <FieldLabel htmlFor="seg-purchase">
                {t('segmentation.purchase')}
              </FieldLabel>
              <OptionSelect
                id="seg-purchase"
                disabled={segmentationBlocked}
                value={segmentation.purchase}
                onValueChange={(purchase) => {
                  setSegmentation((s) => ({
                    ...s,
                    purchase: purchase as Segmentation['purchase'],
                  }));
                  setPage(0);
                }}
                className="bg-card"
              >
                <option value="any">{t('segmentation.purchaseAny')}</option>
                <option value="bought">
                  {t('segmentation.purchaseBought')}
                </option>
                <option value="never">{t('segmentation.purchaseNever')}</option>
              </OptionSelect>
            </div>

            <div>
              <FieldLabel htmlFor="seg-idle">
                {t('segmentation.idle')}
              </FieldLabel>
              <OptionSelect
                id="seg-idle"
                disabled={segmentationBlocked}
                value={String(segmentation.idleDays)}
                onValueChange={(days) => {
                  setSegmentation((s) => ({
                    ...s,
                    idleDays: Number(days),
                  }));
                  setPage(0);
                }}
                className="bg-card"
              >
                {IDLE_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === 0
                      ? t('segmentation.idleAny')
                      : t('segmentation.idleDays', { days: d })}
                  </option>
                ))}
              </OptionSelect>
            </div>

            <div>
              <FieldLabel htmlFor="seg-city">
                {t('segmentation.city')}
              </FieldLabel>
              <Input
                id="seg-city"
                disabled={segmentationBlocked}
                value={segmentation.city ?? ''}
                onChange={(e) => {
                  setSegmentation((s) => ({
                    ...s,
                    city: e.target.value || null,
                  }));
                  setPage(0);
                }}
                className="border-input bg-card"
              />
            </div>

            <div>
              <FieldLabel htmlFor="seg-state">
                {t('segmentation.state')}
              </FieldLabel>
              <Input
                id="seg-state"
                disabled={segmentationBlocked}
                value={segmentation.state ?? ''}
                maxLength={2}
                placeholder="RS"
                onChange={(e) => {
                  setSegmentation((s) => ({
                    ...s,
                    state: e.target.value.toUpperCase() || null,
                  }));
                  setPage(0);
                }}
                className="border-input bg-card"
              />
            </div>
          </div>

          <div className="border-border mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
            <StatusBadge variant="neutral">
              {t('segmentation.count', { count: totalCount })}
            </StatusBadge>

            <label className="text-secondary-foreground flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={segmentation.excludeOptedOut}
                onCheckedChange={(v) => {
                  setSegmentation((s) => ({
                    ...s,
                    excludeOptedOut: v === true,
                  }));
                  setPage(0);
                }}
              />
              {t('segmentation.excludeOptedOut')}
            </label>

            {/* Hands the audience to the broadcast wizard rather than making
                the operator rebuild the same filter there from memory. */}
            <GatedButton
              variant="outline"
              canAct={canEdit}
              gateReason="create broadcasts"
              disabled={totalCount === 0}
              onClick={() => router.push('/broadcasts/new')}
              className="border-border bg-card ml-auto"
            >
              <Megaphone />
              {t('segmentation.toBroadcast')}
            </GatedButton>
          </div>
        </PanelBody>
      </Panel>

      {/* Bulk action bar.
          Wraps: at 360px "25 selecionados" plus two buttons does not fit
          one line, and this bar sits above the table it acts on. */}
      {selected.size > 0 && (
        <div className="border-border bg-muted/40 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-4 py-2">
          <p className="text-foreground text-sm">
            {t('selectedCount', { count: selected.size })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set())}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('clearSelection')}
            </Button>
            <GatedButton
              variant="destructive"
              canAct={canEdit}
              gateReason="delete contacts"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 />
              {t('deleteSelected')}
            </GatedButton>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border-border overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && someOnPageSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={contacts.length === 0}
                  aria-label={t('selectAllOnPage')}
                />
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('tableColumns.name')}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('tableColumns.phone')}
              </TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">
                {t('tableColumns.email')}
              </TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">
                {t('tableColumns.company')}
              </TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">
                {t('tableColumns.tags')}
              </TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">
                {t('tableColumns.createdAt')}
              </TableHead>
              <TableHead className="text-muted-foreground w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="text-primary size-6 animate-spin" />
                    <p className="text-muted-foreground text-sm">
                      {t('loading')}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-border hover:bg-transparent">
                {/* `whitespace-normal` because TableCell sets nowrap on every
                    cell, and an empty-state sentence that cannot wrap widens
                    the table until it scrolls sideways. */}
                <TableCell colSpan={8} className="p-0 whitespace-normal">
                  <StatePanel
                    icon={Users}
                    title={
                      hasActiveFilters
                        ? t('noContactsMatch')
                        : t('noContactsYet')
                    }
                    actions={
                      hasActiveFilters ? undefined : (
                        <GatedButton
                          canAct={canEdit}
                          gateReason="add or import contacts"
                          variant="outline"
                          onClick={openAddForm}
                        >
                          <Plus />
                          {t('addFirstContact')}
                        </GatedButton>
                      )
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(contact.id)}
                      onCheckedChange={() => toggleSelect(contact.id)}
                      aria-label={`Select ${contact.name || contact.phone}`}
                    />
                  </TableCell>
                  {/* Every text cell caps its own width from an inner block.
                      `TableCell` is `whitespace-nowrap`, the table lays out
                      `auto`, and a max-width on the `<td>` itself is only a
                      suggestion the browser is free to ignore — so one long
                      name used to widen the column and put the WHOLE table
                      into horizontal scroll. A block child is a real box and
                      the column shrinks to it.

                      Two ink levels, not four sizes: the name is the identity
                      of the row, everything else is metadata at 12px. They
                      were 12/14/14/12 in one colour, which is a size ramp
                      that encodes nothing. */}
                  <TableCell className="text-foreground font-semibold">
                    <div
                      className="max-w-[22ch] truncate"
                      title={contact.name || undefined}
                    >
                      {contact.name || (
                        <span className="text-muted-foreground font-normal italic">
                          {t('unnamed')}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {formatPhone(contact.phone)}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                    <div
                      className="max-w-[26ch] truncate"
                      title={contact.email || undefined}
                    >
                      {contact.email || EMPTY}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                    <div
                      className="max-w-[20ch] truncate"
                      title={contact.company || undefined}
                    >
                      {contact.company || EMPTY}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex max-w-[18rem] flex-wrap gap-1.5">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <TagChip key={tag.id} color={tag.color} size="sm">
                            {tag.name}
                          </TagChip>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">{EMPTY}</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-muted-foreground text-3xs self-center">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  {/* O ANO SÓ QUANDO NÃO É ESTE.
                      "24 de ago. de 2026" gastava ~110px na coluna menos
                      consultada da tabela, e o ano era o mesmo em todas
                      as linhas — enquanto NOME está preso em 22ch e
                      E-MAIL trunca em 26ch, perdendo justo o domínio, que
                      é o que identifica a empresa. */}
                  <TableCell className="text-muted-foreground hidden text-xs tabular-nums lg:table-cell">
                    {formatRegisteredAt(contact.created_at)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(contact);
                          }}
                          className="text-popover-foreground focus:bg-muted focus:text-foreground"
                        >
                          <Pencil className="size-4" />
                          {t('editAction')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(contact);
                          }}
                        >
                          <Trash2 className="size-4" />
                          {t('deleteAction')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination.
          Wraps: "Mostrando 1–25 de 1.284" plus the three pager controls does
          not fit 328px on one line, and the controls are the half that would
          have been pushed out of view. */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-muted-foreground text-xs">
            {t('showingPagination', {
              start: page * PAGE_SIZE + 1,
              end: Math.min((page + 1) * PAGE_SIZE, totalCount),
              total: totalCount,
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-muted-foreground px-2 text-xs">
              {t('pageCount', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={setCustomFieldsOpen}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteContactTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteContactDesc', {
                name: deleteTarget?.name || deleteTarget?.phone || '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteBulkTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteBulkDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * O travessão que o resto do app usa para "não tem".
 *
 * Esta tabela imprimia `-`, o hífen-menos, em três colunas; o perfil, o
 * funil e os gráficos imprimem `—`. Numa coluna de nove linhas o hífen
 * lê como sinal de menos, e não como ausência.
 */
const EMPTY = '—';

/**
 * Data de cadastro, sem repetir o ano em todas as linhas.
 *
 * `dd/mm` dentro do ano corrente, `dd/mm/aaaa` fora dele — a mesma
 * regra do cabeçalho de dia da auditoria, pelo mesmo motivo: o ano é
 * informação em janeiro e ruído nos outros onze meses.
 */
function formatRegisteredAt(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(APP_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
