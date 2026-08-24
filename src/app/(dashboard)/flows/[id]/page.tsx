"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";
import { FlowEditorShell } from "@/components/flows/flow-editor-shell";
import type { FlowRow, FlowNodeRow } from "@/lib/flows/types";

/**
 * Flow editor shell.
 *
 * Loads `{flow, nodes}` from `/api/flows/[id]` and hands it to
 * `<FlowBuilder>`. Owns the loading/error state so the builder can
 * focus purely on editing.
 *
 * Open to every authenticated user — the beta gate that previously
 * 404'd non-beta accounts was removed in PR #134. The API still
 * 404s on a flow id the caller doesn't own (RLS), which becomes the
 * "Flow not found" state below.
 */
export default function FlowEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const t = useTranslations("Flows.edit");

  const [flow, setFlow] = useState<FlowRow | null>(null);
  const [nodes, setNodes] = useState<FlowNodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as {
          flow: FlowRow;
          nodes: FlowNodeRow[];
        };
        if (!cancelled) {
          setFlow(json.flow);
          setNodes(json.nodes ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t("loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (notFound || !flow) {
    return (
      // Same frame the sibling /runs route uses for the same sentence.
      // This was a bare paragraph plus a link-shaped raw <button>: a
      // 20px touch target on a phone, and the fourth different shape
      // the app had for "this isn't here".
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <StatePanel
          size="md"
          icon={CircleAlert}
          title={t("notFound")}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/flows")}
            >
              {t("backToFlows")}
            </Button>
          }
        />
      </div>
    );
  }

  return <FlowEditorShell initialFlow={flow} initialNodes={nodes} />;
}
