"use client";

/**
 * Editor toolbar — flow name / description, status chip, dirty
 * indicator, and the action buttons (Save, Activate/Pause, Delete,
 * View runs, Back).
 *
 * Restyled to the Flow Builder design handoff: a single compact
 * toolbar row (back · icon · inline-editable name · status chip ·
 * edited dot on the left; Runs · Delete · Activate · Save on the
 * right) followed by a subtle, full-width description "note" line.
 * Replaces the old three-row stack so the editor reads as one app
 * chrome bar above the canvas/list stage.
 *
 * Lifted out of flow-builder.tsx so the same toolbar renders above
 * both views in FlowEditorShell. Without this, canvas users had no
 * way to save without toggling to list view.
 *
 * Reads everything from the editor context (`useFlowEditor`) so it
 * stays in sync with whichever view is mutating state, and routes
 * router navigation locally (back to /flows, View runs to
 * /flows/[id]/runs) — those don't belong in the hook.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CircleDot,
  History,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Trash2,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge, StatusDot } from "@/components/ui/status-badge";
import {
  useFlowEditor,
  type BuilderState,
} from "./flow-editor-state";

export function EditorHeader() {
  const router = useRouter();
  const t = useTranslations("Flows.builder");
  const {
    flow,
    state,
    setState,
    dirty,
    saving,
    activating,
    canActivate,
    save,
    setStatus,
    deleteFlow,
  } = useFlowEditor();

  return (
    <div className="flex flex-col gap-1.5 px-4 pt-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        {/* ---- left: back · icon · name · status · edited ---- */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/flows")}
          title={t("back")}
          aria-label={t("back")}
          className="shrink-0 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Workflow className="size-4.5" />
        </span>
        <input
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          placeholder={t("namePlaceholder")}
          spellCheck={false}
          aria-label={t("nameAria")}
          className="min-w-[120px] max-w-[340px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-bold leading-tight tracking-tight text-foreground outline-none transition-colors duration-(--dur-1) hover:bg-muted focus:border-primary focus:bg-transparent focus:shadow-[0_0_0_3px_var(--primary-soft)]"
        />
        <StatusChip status={state.status} />
        {dirty && (
          <span
            className="eyebrow inline-flex shrink-0 items-center gap-1.5 text-human-ink"
            title={t("unsaved")}
            aria-live="polite"
          >
            <StatusDot variant="warn" className="size-1.5" />
            {t("edited")}
          </span>
        )}

        {/* ---- right: runs · delete · activate · save ---- */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* Below `sm` the two secondary actions drop to their glyphs.
              With all four labels the right cluster is ~370px against
              the 328px a 360px phone has, so the toolbar wrapped to two
              rows and pushed the stage down — on the one width where
              the list view is the only view there is. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/flows/${flow.id}/runs`)}
            title={t("runs")}
            aria-label={t("runs")}
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("runs")}</span>
            <span className="ml-0.5 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
              {flow.execution_count}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteFlow()}
            title={t("delete")}
            aria-label={t("delete")}
            className="text-danger-ink hover:bg-danger-soft"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("delete")}</span>
          </Button>
          {state.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("draft")}
              disabled={activating}
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
              {t("pause")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("active")}
              disabled={activating || !canActivate}
              title={
                !canActivate
                  ? t("activateBlocked")
                  : undefined
              }
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              {t("activate")}
            </Button>
          )}
          <Button onClick={() => void save()} disabled={saving} size="sm">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t("save")}
          </Button>
        </div>
      </div>

      {/* ---- description note (subtle, inline-editable) ---- */}
      <input
        value={state.description}
        onChange={(e) =>
          setState((s) => ({ ...s, description: e.target.value }))
        }
        placeholder={t("descriptionPlaceholder")}
        aria-label={t("descriptionAria")}
        // No alpha on the placeholder. `--muted-foreground` is already
        // calibrated with headroom; diluting it to 60% on the white card
        // put this one field at ~2.4:1 while every other input in the app
        // sits at 5.2:1 with the plain token.
        className="w-full max-w-[78ch] rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-muted-foreground outline-none transition-colors duration-(--dur-1) placeholder:text-muted-foreground hover:bg-muted/50 focus:border-primary focus:bg-transparent focus:text-foreground"
      />
    </div>
  );
}

function StatusChip({ status }: { status: BuilderState["status"] }) {
  const t = useTranslations("Flows.builder");
  const cfg = {
    draft: {
      // Neutral, not amber — amber is reserved for the adjacent
      // "Edited" dirty signal, so the two don't read as the same alert.
      variant: "neutral" as const,
      label: t("statusDraft"),
    },
    active: {
      variant: "ok" as const,
      label: t("statusActive"),
    },
    archived: {
      variant: "neutral" as const,
      label: t("statusArchived"),
    },
  }[status];
  return (
    <StatusBadge variant={cfg.variant}>
      <CircleDot />
      {cfg.label}
    </StatusBadge>
  );
}
