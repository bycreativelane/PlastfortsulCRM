import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Section header shown at the top of every settings panel — a title,
 * a one-line description, and an optional right-aligned action (e.g.
 * "New template", "Invite member"). Mirrors the mockup's `.panel-head`.
 */
export function SettingsPanelHead({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // 16px, not 20. The vertical rhythm has three steps and only
        // three: 24 between sections, 16 between blocks inside one, 12
        // between a title and the thing it introduces. A panel head is a
        // block boundary.
        'mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
