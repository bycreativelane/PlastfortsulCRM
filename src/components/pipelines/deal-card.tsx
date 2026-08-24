'use client';

import type { Deal, PipelineStage } from '@/types';
import { Calendar, ListChecks } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { avatarClass, avatarInitials } from '@/lib/avatar-color';
import { StatusBadge } from '@/components/ui/status-badge';

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  /** Present only when the deal's stage has a playbook. */
  playbook?: { done: number; total: number };
  isOverlay?: boolean;
  className?: string;
}

/**
 * One deal in a Kanban column.
 *
 * Identical 1px frame on all four sides — no coloured left bar. The bar was a
 * second signalling channel repeating what the column's top band already says:
 * every card in a column has the same stage, so tagging each one with the
 * stage colour tells you nothing you did not know from its position, and it
 * broke the alignment of the stack.
 *
 * `stage` is still taken because the drag overlay renders a card outside its
 * column, where it genuinely has no position to read the stage from.
 */
export function DealCard({
  deal,
  stage,
  onEdit,
  playbook,
  isOverlay,
  className,
}: DealCardProps) {
  const t = useTranslations('Pipelines.card');
  const format = useFormatter();
  const contactLabel =
    deal.contact?.name || deal.contact?.phone || t('noContact');
  const assigneeLabel = deal.assignee?.full_name || null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      // Reads in the order the card now does: who, then what, then where.
      aria-label={
        stage
          ? `${contactLabel} — ${deal.title} — ${stage.name}`
          : `${contactLabel} — ${deal.title}`
      }
      className={cn(
        'border-border bg-card w-full cursor-grab rounded-lg border px-2.5 py-2.5 text-left transition-colors duration-(--dur-1)',
        isOverlay
          ? 'cursor-grabbing shadow-lg'
          : 'hover:border-input hover:shadow-sm',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* WHO first, then what.
              
              The card led with the deal's title and put the person under it
              in small grey — which reads as though the opportunity is the
              thing and the customer is a detail of it. On a board you scan
              for the person: "onde está o Marcos" is the question, and the
              title is how you tell two of his deals apart once you have
              found him.
              
              Company on its own line and only when there is one, because a
              contact created from an inbound message has nothing but a
              phone number. */}
          <h4 className="text-foreground truncate text-sm leading-tight font-semibold">
            {contactLabel}
          </h4>
          {deal.contact?.company && (
            <p className="text-muted-foreground text-2xs mt-0.5 truncate leading-tight">
              {deal.contact.company}
            </p>
          )}
          {/* Two lines, then an ellipsis. `deal.title` is free text and a
              long one grew the card to five lines, so the card next to it in
              the same column no longer lined up with anything. line-clamp and
              not truncate: a deal title needs its second line to be
              recognisable, and clamping does not set `white-space: nowrap`,
              so it cannot push the row wider than the column. */}
          <p className="text-secondary-foreground mt-1 line-clamp-2 text-xs leading-tight">
            {deal.title}
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold tracking-tight tabular-nums">
          {formatCurrency(deal.value, deal.currency)}
        </span>
      </div>

      {(deal.status !== 'open' ||
        deal.expected_close_date ||
        playbook ||
        assigneeLabel) && (
        <div className="border-muted mt-2 flex items-center gap-1.5 border-t pt-1.5">
          {deal.status === 'won' && (
            <StatusBadge variant="ok" size="sm">
              {t('won')}
            </StatusBadge>
          )}
          {deal.status === 'lost' && (
            <StatusBadge variant="danger" size="sm">
              {t('lost')}
            </StatusBadge>
          )}
          {/* What is still owed on this deal, in three characters. Amber
              while there is work left, because a playbook step is a person's
              job — the one thing this design lets shout. It goes quiet the
              moment the list is finished rather than turning green: "done"
              is the absence of a demand, not a second announcement. */}
          {playbook && (
            <span
              title={t('playbook')}
              className={
                playbook.done >= playbook.total
                  ? 'text-muted-foreground text-2xs flex items-center gap-1 tabular-nums'
                  : 'bg-human-soft text-human-ink text-2xs flex items-center gap-1 rounded-full px-1.5 font-semibold tabular-nums'
              }
            >
              <ListChecks className="size-3" />
              {playbook.done}/{playbook.total}
            </span>
          )}
          {deal.expected_close_date && (
            <span className="text-muted-foreground text-2xs flex items-center gap-1">
              <Calendar className="size-3" />
              {/* Formatted through next-intl, so the date reads in the app's
                  locale. It was hard-coded to en-US, which printed
                  "Mar 14, 2026" in a Portuguese interface. */}
              {format.dateTime(new Date(deal.expected_close_date), {
                day: 'numeric',
                month: 'short',
              })}
            </span>
          )}
          {assigneeLabel && (
            <span
              title={assigneeLabel}
              className={cn(
                'text-avatar-ink text-3xs ml-auto grid size-5 shrink-0 place-items-center rounded-full font-semibold',
                avatarClass(assigneeLabel)
              )}
            >
              {avatarInitials(assigneeLabel, '?')}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
