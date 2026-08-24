"use client";

/**
 * Validation panel — surfaces every error and warning from
 * `validateFlowForActivation`. Lives once at the bottom of the
 * editor shell so it's visible in both views (canvas + list).
 *
 * Node-scoped issues are clickable: tapping one calls
 * `requestFlash(node_key)` on the editor context. List view's
 * useEffect on `flashKey` expands + scrolls + flashes the row;
 * canvas view's useEffect pans the viewport + flashes the card.
 * Both views read the same flashKey so the panel doesn't need
 * per-view plumbing.
 *
 * Trigger-scoped issues are NOT clickable from canvas — trigger
 * config is a list-only panel (it's a flat form, not a graph
 * concept). User can switch to List to address them.
 */

import { CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ValidationIssue } from "@/lib/flows/validate";
import { useFlowEditor } from "./flow-editor-state";

export function ValidationPanel() {
  const { issues, requestFlash } = useFlowEditor();
  const t = useTranslations("Flows.validation");

  if (issues.length === 0) {
    // Opaque `bg-background` and not a translucent tint: this bar sits
    // over scrolled-behind node cards, which bleed through a tint. The
    // accents are the `ok` doctrine tokens now — the raw emerald
    // families they replaced only ever resolved through a compatibility
    // remap in globals.css, so the intent was invisible at the call site.
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ok/50 bg-background p-3 text-sm font-medium text-ok-ink">
        <CircleCheck className="h-4 w-4 shrink-0" />
        {t("noIssues")}
      </div>
    );
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3",
        errors.length > 0 ? "border-danger/40" : "border-human/40",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {errors.length > 0 ? (
          <CircleAlert className="h-4 w-4 text-danger-ink" />
        ) : (
          <CircleAlert className="h-4 w-4 text-human-ink" />
        )}
        {t("summary", { errorCount: errors.length, warningCount: warnings.length })}
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((i, ix) => (
          <IssueLine key={ix} issue={i} onJump={requestFlash} t={t} />
        ))}
      </div>
    </div>
  );
}

/**
 * Exported so the per-node card (list view) and the trigger panel
 * can render the same "icon + node key chip + message" formatting
 * for their own per-row issue lists without re-implementing the
 * tone / icon / accessibility logic.
 */
export function IssueLine({
  issue,
  onJump,
  t,
}: {
  issue: ValidationIssue;
  onJump?: (key: string) => void;
  t?: ReturnType<typeof useTranslations>;
}) {
  // One tone, not two. The glyph used to be a shade darker than the
  // sentence next to it (`red-400` over `red-300`), but globals.css
  // points 200/300/400 at the same `--danger-700` — the pair had been
  // rendering identically for as long as the remap has existed.
  const tone =
    issue.severity === "error" ? "text-danger-ink" : "text-human-ink";
  const body = (
    <>
      <CircleAlert className={cn("mt-0.5 h-3 w-3 shrink-0", tone)} />
      <span className="min-w-0 flex-1">
        {issue.node_key && (
          <code className="mr-1 rounded-sm bg-muted px-1 py-0.5 text-3xs text-muted-foreground">
            {issue.node_key}
          </code>
        )}
        {issue.message}
      </span>
    </>
  );

  // Only node-scoped issues can jump; trigger-scoped issues have no
  // destination (the trigger panel is list-only and already at the
  // top of that view).
  if (issue.node_key && onJump) {
    return (
      <button
        type="button"
        onClick={() => onJump(issue.node_key!)}
        className={cn(
          // Raw <button>, so it misses the pointer-coarse expansion the
          // <Button> primitive gets — and this jump target is how a
          // phone user reaches a broken node.
          "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors duration-(--dur-1) hover:bg-muted/60 pointer-coarse:min-h-11",
          tone,
        )}
        aria-label={t ? t("jumpToNode", { key: issue.node_key! }) : `Jump to node ${issue.node_key}`}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1 text-xs",
        tone,
      )}
    >
      {body}
    </div>
  );
}
