'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
} from 'lucide-react';

import { useTranslations } from 'next-intl';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { PageActions } from '@/components/layout/page-actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS = (
  t: ReturnType<typeof useTranslations>
): Record<FlowRow['status'], string> => ({
  draft: t('statusDraft'),
  active: t('statusActive'),
  archived: t('statusArchived'),
});

// Grey for draft and archived, green only for the one that is actually
// running: under the colour doctrine `ok` is the scarce "confirmed"
// tone, and three tinted chips in a card grid would have spent it on
// nothing. The icon carries the draft/archived distinction.
const STATUS_VARIANTS: Record<FlowRow['status'], 'neutral' | 'ok' | 'auto'> = {
  draft: 'neutral',
  active: 'ok',
  archived: 'neutral',
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: 'MessageSquare' | 'HelpCircle' | 'UserPlus';
  trigger_type: string;
  node_count: number;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

export default function FlowsPage() {
  const router = useRouter();
  const canCreate = useCan('send-messages');
  const t = useTranslations('Flows.list');
  const { confirm } = useConfirm();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes] = await Promise.all([
          fetch('/api/flows'),
          fetch('/api/flows/templates'),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const tmplJson = (await tmplRes.json()) as {
            templates: TemplateSummary[];
          };
          if (!cancelled) setTemplates(tmplJson.templates ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t('loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: 'keyword',
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName('');
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error(t('createError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Clone failed: ${res.status}`);
      }
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      // `err.message` always won here, so the `cloneError` key below never
      // rendered — the user got the route's English HTTP string instead of
      // the sentence that was written for them.
      console.error('Flow clone failed:', err);
      toast.error(t('cloneError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = await confirm({
      title: t('deleteConfirm', { name: flow.name }),
      destructive: true,
    });
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success(t('deleteSuccess'));
    } catch (err) {
      console.error(err);
      toast.error(t('deleteError'));
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        badge={
          // Same chip the sidebar's Beta row renders, down to the token —
          // it was hand-rolled amber here and `human-*` there, so the two
          // drifted apart in the dark mode nobody checked.
          <span className="border-human-border bg-human-soft text-human-ink eyebrow rounded-full border px-1.5 py-0.5">
            {t('beta')}
          </span>
        }
      />

      <PageActions>
        <GatedButton
          size="sm"
          canAct={canCreate}
          // `title` and not `gateReason`: GatedButton builds the gated
          // tooltip from an English template it owns, so the only way to
          // say this in the operator's language is to pass the whole
          // sentence ourselves.
          title={canCreate ? undefined : t('readOnly')}
          onClick={() => setCreateOpen(true)}
          className="h-8 text-xs"
        >
          <Plus className="mr-1 size-3.5" />
          {t('newFlow')}
        </GatedButton>
      </PageActions>

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          canCreate={canCreate}
          t={t}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/flows/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
              t={t}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        {/* The height cap is here and not in DialogContent because the
            primitive has none: it is `fixed` and centred by a -50%
            translate, so a body taller than the viewport overflows off
            BOTH edges with no way to scroll to the footer. With the
            template gallery open this dialog passes 720px. */}
        <DialogContent className="bg-popover text-popover-foreground max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('createDesc')}
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div>
              <SectionTitle>{t('startTemplate')}</SectionTitle>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((template) => {
                  const Icon = TEMPLATE_ICONS[template.icon] ?? FileText;
                  return (
                    <button
                      key={template.slug}
                      type="button"
                      onClick={() => handleUseTemplate(template.slug)}
                      disabled={creating}
                      className="border-border bg-background hover:border-primary/40 hover:bg-muted flex flex-col gap-2.5 rounded-lg border p-4 text-left transition-colors duration-(--dur-1) disabled:opacity-50"
                    >
                      <Icon className="text-primary h-5 w-5" />
                      <span className="text-popover-foreground text-sm font-semibold">
                        {template.name}
                      </span>
                      <span className="text-muted-foreground text-xs leading-relaxed">
                        {template.description}
                      </span>
                      <span className="border-border text-muted-foreground text-2xs mt-auto border-t pt-2">
                        {t('nodeCount', { count: template.node_count })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-border border-t pt-4">
            <SectionTitle>{t('startBlank')}</SectionTitle>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('placeholderName')}
              className="bg-muted"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('createBlank')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  canCreate,
  t,
}: {
  onCreate: () => void;
  canCreate: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <StatePanel
      size="md"
      framed
      icon={Workflow}
      title={t('emptyTitle')}
      description={t('emptyDesc')}
      actions={
        <GatedButton
          canAct={canCreate}
          title={canCreate ? undefined : t('readOnly')}
          onClick={onCreate}
        >
          <Plus className="h-4 w-4" />
          {t('createFirst')}
        </GatedButton>
      }
    />
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
  t,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const triggerSummary = describeTrigger(flow, t);
  const StatusIcon =
    flow.status === 'active'
      ? PlayCircle
      : flow.status === 'archived'
        ? Archive
        : PauseCircle;
  return (
    <div className="surface-interactive border-border bg-card flex flex-col rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="text-primary h-4 w-4 shrink-0" />
          <h3 className="text-foreground truncate text-sm font-semibold">
            {flow.name}
          </h3>
        </div>
        <StatusBadge variant={STATUS_VARIANTS[flow.status]} size="sm">
          <StatusIcon />
          {STATUS_LABELS(t)[flow.status]}
        </StatusBadge>
      </div>

      <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">
        {flow.description || triggerSummary}
      </p>

      <div className="text-muted-foreground text-2xs mt-4 flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {t('runCount', { count: flow.execution_count })}
        </span>
      </div>

      <div className="border-border mt-4 flex items-center justify-end gap-2 border-t pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          {t('edit')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-danger-ink hover:bg-danger-soft"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('delete')}
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(
  flow: FlowRow,
  t: ReturnType<typeof useTranslations>
): string {
  if (flow.trigger_type === 'keyword') {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return t('triggerKeywordNone');
    return t('triggerKeyword', { keywords: keywords.join(', ') });
  }
  if (flow.trigger_type === 'first_inbound_message') {
    return t('triggerFirstInbound');
  }
  return t('triggerManual');
}
