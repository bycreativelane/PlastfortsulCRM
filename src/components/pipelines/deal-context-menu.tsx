'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  Check,
  Copy,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import type { Deal, PipelineStage } from '@/types';
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
  ContextMenuActionsTrigger,
} from '@/components/ui/context-menu';

interface DealContextMenuProps {
  deal: Deal;
  stages: PipelineStage[];
  onEdit: (deal: Deal) => void;
  /** The board's own optimistic mover — same path the drag uses. */
  onMove: (dealId: string, stageId: string) => void;
  /** Reload the board after a write this menu made directly. */
  onChanged: () => void;
  /**
   * Hand a won/lost decision to the board's gates instead of writing it.
   *
   * Returns true when it took the decision. Optional so the menu still works
   * on its own; when it is wired, marking a deal from here asks for the sale
   * value or the loss reason exactly as the sheet and the drag do.
   */
  onRequestOutcome?: (deal: Deal, status: 'won' | 'lost') => boolean;
  children: React.ReactNode;
}

/**
 * Right-click on a deal card.
 *
 * The board already lets you do all of this, and every route to it is slow in
 * the same way: moving a deal means dragging it to a column that is usually
 * off-screen (the board scrolls sideways, so the target may be three stages
 * away), and winning, losing or deleting one means opening the edit sheet,
 * finding the button, and closing the sheet again. None of those are decisions
 * you make in the sheet — you make them looking at the board.
 *
 * So the menu is the board's shortcuts, and only those: the moves that were
 * already possible, minus the travel. Nothing here can be done ONLY from the
 * right-click menu, which is the rule that keeps a hidden affordance honest —
 * a user who never discovers it loses time, never a capability.
 *
 * Delete confirms in place rather than opening a dialog. A confirm dialog for
 * a row you are pointing at is a second window to read and dismiss; a second
 * click on an item that has visibly changed its own label is the same
 * safeguard with none of the travel, and Escape still cancels it.
 */
export function DealContextMenu({
  deal,
  stages,
  onEdit,
  onMove,
  onChanged,
  onRequestOutcome,
  children,
}: DealContextMenuProps) {
  const t = useTranslations('Pipelines.menu');
  const supabase = createClient();
  const router = useRouter();
  const canWrite = useCan('send-messages');

  // Two-step delete. Reset whenever the menu closes so the armed state can
  // never survive into the next right-click on another card.
  const [open, setOpen] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const status = deal.status ?? 'open';
  const phone = deal.contact?.phone ?? null;

  async function setStatus(next: 'won' | 'lost' | 'open') {
    if (busy) return;
    // Reopening never gates — it asks for nothing and takes nothing away.
    if (next !== 'open' && onRequestOutcome?.(deal, next)) return;
    setBusy(true);
    const { error } = await supabase
      .from('deals')
      .update({ status: next })
      .eq('id', deal.id);
    setBusy(false);
    if (error) {
      toast.error(t('toastFailedStatus'));
      return;
    }
    toast.success(
      next === 'won'
        ? t('toastMarkedWon')
        : next === 'lost'
          ? t('toastMarkedLost')
          : t('toastReopened')
    );
    onChanged();
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from('deals').delete().eq('id', deal.id);
    setBusy(false);
    if (error) {
      toast.error(t('toastFailedDelete'));
      return;
    }
    toast.success(t('toastDeleted'));
    onChanged();
  }

  async function openConversation() {
    // The deal may carry the conversation it was created from. When it does
    // not, the newest thread with the same contact is what "the conversation"
    // means on a board — the one you would have scrolled the inbox to find.
    if (deal.conversation_id) {
      router.push(`/inbox?c=${deal.conversation_id}`);
      return;
    }
    if (!deal.contact_id) {
      toast.info(t('toastNoConversation'));
      return;
    }
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', deal.contact_id)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      toast.info(t('toastNoConversation'));
      return;
    }
    router.push(`/inbox?c=${data.id}`);
  }

  async function copyPhone() {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      toast.success(t('toastCopied'));
    } catch {
      toast.error(t('toastCopyFailed'));
    }
  }

  const gate = canWrite ? undefined : t('readOnly');

  return (
    <ContextMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setArmedDelete(false);
      }}
    >
      <ContextMenuTrigger className="block">{children}</ContextMenuTrigger>

      {/* AS ACOES DO CARTAO ATIVO.
          Sete coisas vivem neste menu e todas custavam um clique-direito, que
          e um gesto que nada na tela anuncia. O botao aparece sob o ponteiro
          e no foco de teclado — em repouso o cartao continua so o cartao,
          que e o que mantem a coluna legivel.

          So em ponteiro fino: no toque o pressionar-longo ja abre o mesmo
          menu, e a borda direita do cartao pertence a alca de arrasto. */}
      <ContextMenuActionsTrigger
        onOpen={() => setOpen(true)}
        // O menu e portalado para fora do cartao, entao mover o ponteiro ate
        // ele tira o hover do cartao e o botao sumiria com o proprio menu
        // aberto. Este atributo e o que o resto do app usa para o mesmo caso;
        // aqui ele vem a mao porque este botao nao e um gatilho do base-ui.
        data-popup-open={open ? '' : undefined}
        aria-label={t('actions')}
        title={t('actions')}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring bg-card/80 absolute top-1 right-1 z-10 hidden size-6 place-items-center rounded-md opacity-0 backdrop-blur-[2px] transition-opacity duration-(--dur-1) group-hover/deal:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none data-popup-open:opacity-100 pointer-fine:grid"
      >
        <MoreHorizontal className="size-3.5" />
      </ContextMenuActionsTrigger>

      <ContextMenuContent>
        {/* The title, because the menu covers the card that carried it.
            Inside a `ContextMenuGroup` because `ContextMenuLabel` is
            base-ui's `Menu.GroupLabel` and THROWS at render without a
            `Menu.Group` ancestor — which turned every right-click on a card
            into the dashboard error screen. Same trap `flow-builder.tsx`
            documented and `conversation-menu.tsx` also fell into. */}
        <ContextMenuGroup>
          <ContextMenuLabel>{deal.title}</ContextMenuLabel>
        </ContextMenuGroup>

        <ContextMenuItem onClick={() => onEdit(deal)}>
          <Pencil />
          {t('open')}
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!canWrite || stages.length < 2}>
            <ArrowRightLeft />
            {t('moveTo')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {stages.map((stage) => (
              <ContextMenuItem
                key={stage.id}
                disabled={stage.id === deal.stage_id}
                onClick={() => onMove(deal.id, stage.id)}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
                <span className="truncate">{stage.name}</span>
                {stage.id === deal.stage_id && (
                  <Check className="ml-auto size-3.5" />
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {status !== 'won' && (
          <ContextMenuItem
            disabled={!canWrite}
            title={gate}
            onClick={() => setStatus('won')}
          >
            <Check />
            {t('markWon')}
          </ContextMenuItem>
        )}
        {status !== 'lost' && (
          <ContextMenuItem
            disabled={!canWrite}
            title={gate}
            onClick={() => setStatus('lost')}
          >
            <X />
            {t('markLost')}
          </ContextMenuItem>
        )}
        {status !== 'open' && (
          <ContextMenuItem
            disabled={!canWrite}
            title={gate}
            onClick={() => setStatus('open')}
          >
            <RotateCcw />
            {t('reopen')}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onClick={openConversation}>
          <MessageSquare />
          {t('openConversation')}
        </ContextMenuItem>
        {phone && (
          <ContextMenuItem onClick={copyPhone}>
            <Copy />
            {t('copyPhone')}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem
          variant="destructive"
          disabled={!canWrite}
          title={gate}
          // The first click arms, it does not delete — so it must not close
          // the menu, or there would be nothing left to confirm against.
          closeOnClick={armedDelete}
          onClick={() => {
            if (!armedDelete) {
              setArmedDelete(true);
              return;
            }
            remove();
          }}
        >
          <Trash2 />
          {armedDelete ? t('confirmDelete') : t('delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
