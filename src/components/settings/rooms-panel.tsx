'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import {
  ArchiveRestore,
  Archive,
  Check,
  Loader2,
  Pencil,
  Plus,
  Users,
  Wrench,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import {
  archiveTeamRoom,
  createTeamRoom,
  loadTeamRooms,
  roomName,
  updateTeamRoom,
  type TeamRoom,
} from '@/lib/team/rooms';
import { cn } from '@/lib/utils';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';

/**
 * The rooms the team talks in.
 *
 * 046 built one room per account and said a second would be "a column
 * with a default"; 052 is that column. This is the screen that uses it —
 * naming the room you already have, describing what it is for, and
 * making the next one.
 *
 * WHAT THIS SCREEN IS NOT: a permissions screen. Every member of the
 * account reads and writes every room, and nothing here suggests
 * otherwise. Rooms are folders for conversations — see the note at the
 * top of migration 052 for why per-room membership was left out rather
 * than half-built.
 *
 * ARCHIVE, NOT DELETE. `team_messages.room_id` cascades, so deleting a
 * room takes every message in it. "Apagar essa sala" almost always means
 * "stop showing it to me", and the two are not recoverable from each
 * other, so the interface only offers the reversible one.
 */
export function RoomsPanel() {
  const t = useTranslations('Settings.rooms');
  const { confirm } = useConfirm();
  const tTeam = useTranslations('Inbox.team');
  const { accountId, user } = useAuth();
  const canEdit = useCan('manage-members');

  const [rooms, setRooms] = useState<TeamRoom[] | null>(null);
  /** True when migration 052 has not been applied. */
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** The room being renamed, and the draft it holds. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * The fetch, with no state in it.
   *
   * Split from `apply` below so the effect can hand the result to a
   * callback rather than calling something that setStates in its body —
   * which `react-hooks/set-state-in-effect` flags, correctly: a setState
   * reached synchronously from an effect body is a second render for
   * every mount.
   */
  const fetchRooms = useCallback(async () => {
    if (!accountId) return null;
    return loadTeamRooms(createClient(), accountId, { includeArchived: true });
  }, [accountId]);

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchRooms>>) => {
      if (result === null) return;
      if (result === 'missing-table') {
        setPending(true);
        setRooms([]);
        return;
      }
      setPending(false);
      setRooms(result);
    },
    []
  );

  const reload = useCallback(
    () => fetchRooms().then(apply),
    [fetchRooms, apply]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchRooms().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchRooms, apply]);

  const startEdit = useCallback((room: TeamRoom) => {
    setEditingId(room.id);
    setDraftName(room.name ?? '');
    setDraftDescription(room.description ?? '');
  }, []);

  const commitEdit = useCallback(async () => {
    if (!editingId) return;
    const room = rooms?.find((r) => r.id === editingId);
    if (!room) return;

    // A named room needs a name. The DEFAULT room does not: clearing it
    // puts the room back to being called whatever the locale calls it,
    // which is a real thing to want after trying out a name.
    if (!room.is_default && !draftName.trim()) {
      toast.error(t('nameRequired'));
      return;
    }

    setSaving(true);
    const { error } = await updateTeamRoom(createClient(), editingId, {
      name: draftName,
      description: draftDescription,
    });
    setSaving(false);

    if (error) {
      toast.error(error);
      return;
    }
    setEditingId(null);
    toast.success(t('saved'));
    void reload();
  }, [editingId, rooms, draftName, draftDescription, reload, t]);

  const create = useCallback(async () => {
    if (!accountId || !newName.trim()) return;
    setSaving(true);
    const { error } = await createTeamRoom(createClient(), {
      accountId,
      createdBy: user?.id ?? null,
      name: newName,
      description: newDescription,
    });
    setSaving(false);

    if (error) {
      toast.error(error === 'empty' ? t('nameRequired') : error);
      return;
    }
    setCreating(false);
    setNewName('');
    setNewDescription('');
    toast.success(t('created'));
    void reload();
  }, [accountId, user?.id, newName, newDescription, reload, t]);

  const toggleArchive = useCallback(
    async (room: TeamRoom) => {
      const archiving = !room.archived_at;
      if (
        archiving &&
        !(await confirm({ title: t('archiveConfirm'), destructive: true }))
      ) {
        return;
      }

      setBusyId(room.id);
      const { error } = await archiveTeamRoom(
        createClient(),
        room.id,
        archiving
      );
      setBusyId(null);

      if (error) {
        toast.error(error);
        return;
      }
      void reload();
    },
    // `confirm` is stable — `useCallback([], …)` in the provider — but it
    // is a dependency and the compiler will not take that on trust.
    [confirm, reload, t]
  );

  if (rooms === null) {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (pending) {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <StatePanel
          size="md"
          icon={Wrench}
          title={t('pendingTitle')}
          description={t('pendingBody')}
        />
      </div>
    );
  }

  const active = rooms.filter((r) => !r.archived_at);
  const archived = rooms.filter((r) => r.archived_at);

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          canEdit && !creating ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              {t('newRoom')}
            </Button>
          ) : null
        }
      />

      {creating && (
        <Panel>
          <PanelHeader>
            <div className="min-w-0">
              <PanelTitle>{t('newRoom')}</PanelTitle>
              <PanelSub>{t('newRoomSub')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="room-name">{t('name')}</FieldLabel>
              <Input
                id="room-name"
                value={newName}
                maxLength={60}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('namePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="room-desc">{t('descriptionLabel')}</FieldLabel>
              {/* The description is the whole reason a second room
                  exists. A room called "Operação" with nothing under it is
                  a room three people will each use for something
                  different. */}
              <p className="text-muted-foreground text-xs">{t('descriptionHint')}</p>
              <Input
                id="room-desc"
                value={newDescription}
                maxLength={280}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                  setNewDescription('');
                }}
              >
                {t('cancel')}
              </Button>
              <Button onClick={create} disabled={!newName.trim() || saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('create')}
              </Button>
            </div>
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle>{t('listTitle')}</PanelTitle>
            <PanelSub>{t('listSub')}</PanelSub>
          </div>
        </PanelHeader>
        <PanelBody flush>
          <ul className="divide-border divide-y">
            {active.map((room) => (
              <RoomRow
                key={room.id}
                room={room}
                fallbackName={tTeam('title')}
                editing={editingId === room.id}
                busy={busyId === room.id}
                saving={saving}
                canEdit={canEdit}
                draftName={draftName}
                draftDescription={draftDescription}
                onDraftName={setDraftName}
                onDraftDescription={setDraftDescription}
                onStartEdit={() => startEdit(room)}
                onCancelEdit={() => setEditingId(null)}
                onCommitEdit={commitEdit}
                onToggleArchive={() => toggleArchive(room)}
                t={t}
              />
            ))}
          </ul>
        </PanelBody>
      </Panel>

      {archived.length > 0 && (
        <Panel>
          <PanelHeader>
            <div className="min-w-0">
              <PanelTitle>{t('archivedTitle')}</PanelTitle>
              {/* Said plainly, because "arquivada" could reasonably be
                  read as "gone". */}
              <PanelSub>{t('archivedSub')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody flush>
            <ul className="divide-border divide-y">
              {archived.map((room) => (
                <li
                  key={room.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md">
                    <Archive className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground truncate text-sm">
                      {roomName(room, tTeam('title'))}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === room.id}
                      onClick={() => toggleArchive(room)}
                    >
                      <ArchiveRestore className="size-4" />
                      {t('restore')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}

function RoomRow({
  room,
  fallbackName,
  editing,
  busy,
  saving,
  canEdit,
  draftName,
  draftDescription,
  onDraftName,
  onDraftDescription,
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
  onToggleArchive,
  t,
}: {
  room: TeamRoom;
  fallbackName: string;
  editing: boolean;
  busy: boolean;
  saving: boolean;
  canEdit: boolean;
  draftName: string;
  draftDescription: string;
  onDraftName: (v: string) => void;
  onDraftDescription: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onCommitEdit: () => void;
  onToggleArchive: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  if (editing) {
    return (
      <li className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`name-${room.id}`}>{t('name')}</FieldLabel>
          <Input
            id={`name-${room.id}`}
            value={draftName}
            maxLength={60}
            autoFocus
            onChange={(e) => onDraftName(e.target.value)}
            placeholder={room.is_default ? fallbackName : t('namePlaceholder')}
          />
          {/* Only the default room can go back to having no name of its
              own, and only it needs telling. */}
          {room.is_default ? (
            <p className="text-muted-foreground text-2xs">
              {t('defaultNameHint', { name: fallbackName })}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`desc-${room.id}`}>
            {t('descriptionLabel')}
          </FieldLabel>
          <Input
            id={`desc-${room.id}`}
            value={draftDescription}
            maxLength={280}
            onChange={(e) => onDraftDescription(e.target.value)}
            placeholder={t('descriptionPlaceholder')}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancelEdit}>
            <X className="size-4" />
            {t('cancel')}
          </Button>
          <Button size="sm" onClick={onCommitEdit} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {t('save')}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-md',
          room.is_default
            ? 'bg-primary-soft text-primary'
            : 'bg-muted text-muted-foreground'
        )}
      >
        <Users className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-8 flex-col justify-center">
          <p className="text-foreground truncate text-sm font-medium">
            {roomName(room, fallbackName)}
          </p>
          {room.description ? (
            <p className="text-muted-foreground truncate text-xs">
              {room.description}
            </p>
          ) : null}
        </div>
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onStartEdit}>
            <Pencil className="size-4" />
            <span className="sr-only">{t('rename')}</span>
          </Button>
          {/* The default room has no archive button. It is what the rail
              card and the inbox open when nothing else is chosen, and the
              database refuses to delete it — so offering the control
              would be offering a button that errors. */}
          {!room.is_default && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onToggleArchive}
            >
              <Archive className="size-4" />
              <span className="sr-only">{t('archive')}</span>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
