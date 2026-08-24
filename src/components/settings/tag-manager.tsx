'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Tag as TagIcon, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Panel,
  PanelHeader,
  PanelTitle,
  PanelSub,
  PanelBody,
} from '@/components/ui/panel';
import { StatePanel } from '@/components/ui/state-panel';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import type { Tag } from '@/types';

const PRESET_COLORS = [
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'amber', value: '#f59e0b' },
  { name: 'emerald', value: '#10b981' },
  { name: 'cyan', value: '#06b6d4' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'violet', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' },
];

/**
 * Tags card — colour-coded contact labels. Creation is an inline row
 * (name + colour swatch + Add); deletion goes through a confirmation
 * dialog since it detaches the tag from every contact.
 */
export function TagManager() {
  const t = useTranslations('Settings.tagsAndFields');
  const supabase = createClient();
  const { user, accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[3].value);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchTags(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTags(userId: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setTags(data || []);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
      toast.error(t('failedToLoadTags'));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newTagName.trim()) {
      toast.error(t('nameRequired'));
      return;
    }

    try {
      setSaving(true);
      if (!user || !accountId) {
        toast.error(t('notAuthenticated'));
        return;
      }

      // account_id is mandatory on every account-scoped insert (NOT
      // NULL + RLS, no DB default).
      const { error } = await supabase.from('tags').insert({
        user_id: user.id,
        account_id: accountId,
        name: newTagName.trim(),
        color: selectedColor,
      });

      if (error) throw error;

      toast.success(t('tagCreated'));
      setNewTagName('');
      setSelectedColor(PRESET_COLORS[3].value);
      await fetchTags(user.id);
    } catch (err) {
      console.error('Create error:', err);
      toast.error(t('failedToCreateTag'));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(tag: Tag) {
    setTagToDelete(tag);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!tagToDelete) return;

    try {
      setDeleting(true);
      const { error } = await supabase
        .from('tags')
        .delete()
        .eq('id', tagToDelete.id);

      if (error) throw error;

      toast.success(t('tagDeleted'));
      setTags((prev) => prev.filter((t) => t.id !== tagToDelete.id));
      setDeleteDialogOpen(false);
      setTagToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(t('failedToDeleteTag'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle className="flex items-center gap-2">
            <TagIcon className="size-4 text-primary" />
            {t('tagsTitle')}
          </PanelTitle>
          <PanelSub>
            {t('tagsDesc')}
          </PanelSub>
        </div>
      </PanelHeader>
      <PanelBody className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  // Neutral ground, colour in the dot — the contract the
                  // `Tag` primitive states: a tag's colour is user-picked,
                  // so no ink/wash pairing derived from it can be checked
                  // against 4.5:1. This was `color: tag.color` over a
                  // 12%-alpha wash of itself, which for a light preset
                  // (amber, cyan) lands near 2:1 on a white card. Height
                  // is the standard 20px chip; `px-3 py-1.5 text-sm` was a
                  // third height nothing else in the app uses.
                  //
                  // Not `<Tag>` itself only because the primitive truncates
                  // its children, which would clip the delete button's hit
                  // shield.
                  <span
                    key={tag.id}
                    className="bg-muted text-secondary-foreground inline-flex h-5 max-w-full shrink-0 items-center gap-1.5 rounded-sm pr-1 pl-2 text-2xs font-medium whitespace-nowrap"
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="min-w-0 truncate">{tag.name}</span>
                    <button
                      type="button"
                      onClick={() => confirmDelete(tag)}
                      aria-label={t('deleteAria', { name: tag.name })}
                      // Same trade as the swatches below: a raw <button>
                      // gets none of the coarse-pointer hit shield that
                      // [data-slot="button"] does, and 12px is nowhere near
                      // 44. Here the shield is a pseudo-element instead of
                      // real padding so the chip keeps its 20px height.
                      className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground relative grid size-4 shrink-0 place-items-center rounded-full transition-colors duration-(--dur-1) after:absolute after:-inset-2.5"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <StatePanel
                icon={TagIcon}
                title={t('noTagsTitle')}
                description={t('noTags')}
              />
            )}

            {/* Inline create row */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Input
                placeholder={t('placeholder')}
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                disabled={saving}
                maxLength={40}
                className="min-w-0 flex-1"
              />
              {/* Raw <button>s get none of the coarse-pointer hit shield
                  that [data-slot="button"] does, and a 24px swatch is far
                  under any touch minimum. Growing the swatch itself is the
                  honest fix here — 36px each still fits eight across at
                  360px with the wider gap. */}
              <div className="flex gap-1.5 pointer-coarse:gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setSelectedColor(color.value)}
                    aria-label={t('useColor', { color: t(`colors.${color.name}` as Parameters<typeof t>[0]) })}
                    aria-pressed={selectedColor === color.value}
                    className={cn(
                      'size-6 rounded-md transition-transform duration-(--dur-2) hover:scale-110 pointer-coarse:size-9',
                      selectedColor === color.value &&
                        'outline outline-2 outline-offset-2 outline-primary',
                    )}
                    style={{ backgroundColor: color.value }}
                    title={t(`colors.${color.name}` as Parameters<typeof t>[0])}
                  />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreate}
                disabled={saving || !newTagName.trim()}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {t('addTag')}
              </Button>
            </div>
          </>
        )}
      </PanelBody>

      {/* Delete confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteTag')}</DialogTitle>
            <DialogDescription>
              {tagToDelete ? t('deleteConfirm', { name: tagToDelete.name }) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('deleting')}
                </>
              ) : (
                t('deleteTag')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
