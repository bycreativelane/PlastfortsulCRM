'use client';

import * as React from 'react';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
  Inbox,
  Loader2,
  Mail,
  Timer,
  Trash2,
  UserRound,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import {
  assignConversation,
  deleteConversation,
  hideConversation,
  markConversationUnread,
  setConversationStatus,
  unhideConversation,
  type ConversationPatch,
} from '@/lib/conversations/actions';
import type { Conversation, ConversationStatus } from '@/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Everything you can do to a conversation without opening it.
 *
 * The row in the list was a bare `<button>` — click to open, and that was
 * the entire vocabulary. So marking a thread as Esperando meant opening it,
 * finding the status dropdown in the header, choosing, and going back; and
 * taking it back OUT of Esperando was not possible from anywhere, which is
 * half of what the bug report was about.
 *
 * The sibling of `pipelines/deal-context-menu.tsx`, deliberately: same
 * primitive, same shape, same gating. A board card and an inbox row are the
 * same kind of object — a thing in a list you want to act on while looking
 * at the list.
 *
 * TWO TRIGGERS, ONE MENU. Right-click is the desktop gesture and it does not
 * exist on a phone, where this is needed most (the thread header has no room
 * for these controls at 390px). So the same items render under a `⋯` button
 * as well, and `variant` picks which. Writing them twice would guarantee
 * they drift.
 */

export type ConversationMenuVariant = 'context' | 'dropdown';

interface Props {
  conversation: Conversation;
  /** Apply the write's own patch to local state — no refetch. */
  onPatch: (conversationId: string, patch: ConversationPatch) => void;
  /** Drop the row entirely. Only ever called after a real delete. */
  onRemoved: (conversationId: string) => void;
  /**
   * Account members, `user_id → name`, for the "Atribuir a…" submenu.
   *
   * Passed IN rather than fetched here: this menu renders once per row, and
   * a hook inside it would be one `profiles` query per conversation in the
   * list. The list mounts `useMemberNames` once and hands the same map to
   * every row. Omit it and the submenu does not render — which is what the
   * thread header does, since it already has a dedicated assign control.
   */
  members?: Map<string, string>;
  /**
   * Extra rows above the shared ones. Only for `variant="dropdown"`, where
   * this menu is also the overflow for a toolbar that has run out of width
   * — the thread header on a phone. Pass `DropdownMenuItem`s.
   */
  leadingItems?: ReactNode;
  variant?: ConversationMenuVariant;
  children: ReactNode;
}

export function ConversationMenu({
  conversation,
  onPatch,
  onRemoved,
  members,
  leadingItems,
  variant = 'context',
  children,
}: Props) {
  const t = useTranslations('Inbox.conversationMenu');
  const { user } = useAuth();
  const canWrite = useCan('send-messages');
  // Deleting takes the messages with it, so it is an admin act — and the
  // same rule is written into the RLS policy by migration 045, because a
  // hidden menu item is a suggestion and a policy is not.
  const canDelete = useCan('edit-settings');

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  const status = conversation.status;
  const hidden = !!conversation.hidden_at;
  const name =
    conversation.contact?.name || conversation.contact?.phone || t('untitled');

  async function run(
    action: () => Promise<{ error: string | null; patch: ConversationPatch }>,
    success: string
  ) {
    if (busy) return;
    setBusy(true);
    const { error, patch } = await action();
    setBusy(false);
    if (error) {
      // `hidden_at` arrives with migration 045. Until it is applied the
      // write fails on the unknown column, and the operator deserves "this
      // is waiting on a migration" rather than a raw database string —
      // the same courtesy `occurrence-dialog.tsx` extends.
      toast.error(
        /hidden_at|waiting_since/.test(error)
          ? t('toastNeedsMigration')
          : t('toastFailed')
      );
      return;
    }
    toast.success(success);
    onPatch(conversation.id, patch);
  }

  const assignedTo = conversation.assigned_agent_id ?? null;

  const assignTo = (agentId: string | null) => {
    // Writing the same owner again is a no-op that still costs a round trip
    // and a toast saying something happened. Nothing happened.
    if (agentId === assignedTo) return;
    return run(
      () => assignConversation(createClient(), conversation.id, agentId),
      agentId
        ? t('toastAssigned', { name: members?.get(agentId) ?? '' })
        : t('toastUnassigned')
    );
  };

  const changeStatus = (next: ConversationStatus) =>
    run(
      () =>
        setConversationStatus(
          createClient(),
          conversation.id,
          next,
          conversation.status
        ),
      next === 'pending'
        ? t('toastParked')
        : next === 'closed'
          ? t('toastClosed')
          : t('toastReopened')
    );

  const toggleHidden = () =>
    run(
      () =>
        hidden
          ? unhideConversation(createClient(), conversation.id)
          : hideConversation(createClient(), conversation.id, user?.id ?? null),
      hidden ? t('toastUnhidden') : t('toastHidden')
    );

  const markUnread = () =>
    run(
      () => markConversationUnread(createClient(), conversation.id),
      t('toastMarkedUnread')
    );

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    const { error } = await deleteConversation(createClient(), conversation.id);
    setBusy(false);
    if (error) {
      toast.error(t('toastFailedDelete'));
      return;
    }
    setConfirming(false);
    setTyped('');
    toast.success(t('toastDeleted'));
    onRemoved(conversation.id);
  }

  /**
   * The items, once.
   *
   * Rendered through whichever primitive the variant asked for — the two
   * component families have identical APIs by design (see
   * `ui/context-menu.tsx`), so the only difference is which import the JSX
   * closes over.
   */
  const Item = variant === 'context' ? ContextMenuItem : DropdownMenuItem;
  const Label = variant === 'context' ? ContextMenuLabel : DropdownMenuLabel;
  const Group = variant === 'context' ? ContextMenuGroup : DropdownMenuGroup;
  const Separator =
    variant === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
  const Sub = variant === 'context' ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger =
    variant === 'context' ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent =
    variant === 'context' ? ContextMenuSubContent : DropdownMenuSubContent;

  const items = (
    <>
      {/* The GROUP IS REQUIRED, and its absence is what made right-click
          crash the whole screen.
          `Label` is base-ui's `Menu.GroupLabel`, which reads a context only
          `Menu.Group` provides and THROWS at render when it cannot find
          one — "MenuGroupContext is missing". The throw happens while the
          menu is rendering, so React unwound to the dashboard error
          boundary and every right-click became "Algo quebrou nesta tela".
          `flow-builder.tsx` hit the same trap and wrote it down; this menu
          was built after that note and did not follow it. */}
      <Group>
        <Label className="truncate">{name}</Label>
      </Group>
      <Separator />

      {leadingItems && (
        <>
          {leadingItems}
          <Separator />
        </>
      )}

      {/* The state, as three destinations rather than a toggle.
          The state moves on its own — the customer writing sends a thread to
          Esperando, an agent replying brings it back — so these three are
          the OVERRIDE: put it back in the queue for a colleague, take it out
          without answering, finish it. "Marcar como esperando" with no way
          back was half the original bug report, and a menu that shows all
          three and ticks the current one cannot have that shape of gap. */}
      <Item
        disabled={!canWrite || busy || status === 'open'}
        onClick={() => changeStatus('open')}
      >
        <Inbox className="mr-2 size-4" />
        {t('moveToInbox')}
        {status === 'open' && <Check className="ml-auto size-3.5" />}
      </Item>
      <Item
        disabled={!canWrite || busy || status === 'pending'}
        onClick={() => changeStatus('pending')}
      >
        <Timer className="mr-2 size-4" />
        {t('moveToWaiting')}
        {status === 'pending' && <Check className="ml-auto size-3.5" />}
      </Item>
      <Item
        disabled={!canWrite || busy || status === 'closed'}
        onClick={() => changeStatus('closed')}
      >
        <CheckCheck className="mr-2 size-4" />
        {t('moveToDone')}
        {status === 'closed' && <Check className="ml-auto size-3.5" />}
      </Item>

      <Separator />

      {/* Disabled when it already carries a badge — there is nothing to
          hand back, and a menu item that writes 1 over 1 teaches you it
          did nothing. */}
      <Item
        disabled={!canWrite || busy || conversation.unread_count > 0}
        onClick={markUnread}
      >
        <Mail className="mr-2 size-4" />
        {t('markUnread')}
      </Item>
      {members && members.size > 0 && (
        <Sub>
          <SubTrigger disabled={!canWrite || busy}>
            <UserRound className="mr-2 size-4" />
            {t('assign')}
          </SubTrigger>
          <SubContent className="max-h-vh-62 w-52 overflow-y-auto">
            {/* "Nobody" first, and it is not a cancel — putting a thread
                back in the unassigned pool is the move you make when you
                picked it up by mistake, and it is the one the rotation
                needs in order to hand it out again. */}
            <Item disabled={!canWrite || busy} onClick={() => assignTo(null)}>
              {t('assignNobody')}
              {!assignedTo && <Check className="ml-auto size-3.5" />}
            </Item>
            <Separator />
            {[...members.entries()]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, memberName]) => (
                <Item
                  key={id}
                  disabled={!canWrite || busy}
                  onClick={() => assignTo(id)}
                >
                  <span className="min-w-0 flex-1 truncate">{memberName}</span>
                  {assignedTo === id && <Check className="ml-auto size-3.5" />}
                </Item>
              ))}
          </SubContent>
        </Sub>
      )}
      <Item disabled={!canWrite || busy} onClick={toggleHidden}>
        {hidden ? (
          <Eye className="mr-2 size-4" />
        ) : (
          <EyeOff className="mr-2 size-4" />
        )}
        {hidden ? t('unhide') : t('hide')}
      </Item>

      {canDelete && (
        <>
          <Separator />
          <Item
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            {t('delete')}
          </Item>
        </>
      )}
    </>
  );

  return (
    <>
      {variant === 'context' ? (
        <ContextMenu>
          <ContextMenuTrigger className="block">{children}</ContextMenuTrigger>
          <ContextMenuContent>{items}</ContextMenuContent>
        </ContextMenu>
      ) : (
        <DropdownMenu>
          {/* The caller supplies the button itself (the header's `⋯`), so
              the trigger renders THAT element rather than wrapping it — a
              button inside a button is invalid HTML and breaks the tap
              target on iOS, which is the one place this variant exists
              for. */}
          <DropdownMenuTrigger render={children as React.ReactElement} />
          <DropdownMenuContent align="end">{items}</DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Deleting is the one act in the inbox with no undo anywhere in the
          product, so it asks for the name to be typed rather than for a
          second click. A confirm button under the pointer that just opened
          the menu is a confirm button people press by reflex. */}
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) setTyped('');
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive size-4" />
              {t('deleteTitle')}
            </DialogTitle>
            <DialogDescription>{t('deleteBody', { name })}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              {t('deleteConfirmHint', { name })}
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={name}
              aria-label={t('deleteConfirmHint', { name })}
              className="h-10"
            />
            <p className="text-muted-foreground text-2xs">
              {t('deleteAlternative')}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || typed.trim() !== name.trim()}
              onClick={confirmDelete}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
