'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  FileText,
  MessageCircle,
  Clock,
  Users,
  PhoneCall,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { useTranslations } from 'next-intl';
import type { Automation } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { PageActions } from '@/components/layout/page-actions';
import { StatusBadge, StatusDot } from '@/components/ui/status-badge';
import { StatePanel } from '@/components/ui/state-panel';
import { SectionTitle } from '@/components/ui/section-title';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { type TemplateSlug } from '@/lib/automations/templates';
import { triggerLabelKey, formatRelative } from '@/lib/automations/trigger-meta';
import { PageHeader } from '@/components/layout/page-header';

const TEMPLATE_ORDER: TemplateSlug[] = [
  'welcome_message',
  'out_of_office',
  'lead_qualifier',
  'follow_up_reminder',
];

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  out_of_office: Clock,
  lead_qualifier: Users,
  follow_up_reminder: PhoneCall,
};

export default function AutomationsPage() {
  const router = useRouter();
  const canCreate = useCan('send-messages');
  const t = useTranslations('Automations.list');
  // The template gallery's own words — see lib/automations/templates.ts,
  // which holds the shape of each template and none of its text.
  const tpl = useTranslations('Automations.templates');
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      setAutomations((data ?? []) as Automation[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadErrorDesc'));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(a: Automation, next: boolean) {
    // Optimistic flip so the switch feels instant.
    setAutomations(
      (prev) =>
        prev?.map((x) => (x.id === a.id ? { ...x, is_active: next } : x)) ??
        prev
    );
    const res = await fetch(`/api/automations/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      // Roll back on error.
      setAutomations(
        (prev) =>
          prev?.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x)) ??
          prev
      );
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.updateError'));
      return;
    }
    toast.success(next ? t('toasts.activated') : t('toasts.paused'));
  }

  async function duplicate(a: Automation) {
    const res = await fetch(`/api/automations/${a.id}/duplicate`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.duplicateError'));
      return;
    }
    toast.success(t('toasts.duplicated'));
    load();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await fetch(`/api/automations/${pendingDelete.id}`, {
      method: 'DELETE',
    });
    setDeleting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.deleteError'));
      return;
    }
    toast.success(t('toasts.deleted'));
    setPendingDelete(null);
    load();
  }

  async function startFromTemplate(slug: TemplateSlug) {
    router.push(`/automations/new?template=${slug}`);
  }

  if (error) {
    return (
      <StatePanel
        size="md"
        icon={AlertTriangle}
        title={t('loadErrorTitle')}
        description={error}
        actions={
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t('retry')}
          </Button>
        }
      />
    );
  }

  if (automations === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  const showTemplates = automations.length < 3;

  return (
    <div className="space-y-6">
      <PageActions>
        <GatedButton
          size="sm"
          canAct={canCreate}
          gateReason="create automations"
          onClick={() => router.push('/automations/new')}
        >
          <Plus className="mr-1 size-3.5" />
          {t('create')}
        </GatedButton>
      </PageActions>

      <PageHeader title={t('title')} description={t('subtitle')} />

      {showTemplates && (
        <section>
          <SectionTitle>{t('templatesTitle')}</SectionTitle>
          {/* The house ladder for a row of four: one column, two at sm,
              four at xl. It was md:2 here, which left a 900px window
              showing two template cards while every other four-up row in
              the app showed two at 640. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {TEMPLATE_ORDER.map((slug) => {
              const Icon = TEMPLATE_ICON[slug];
              return (
                <button
                  key={slug}
                  onClick={() => startFromTemplate(slug)}
                  className="surface-interactive group border-border bg-card flex flex-col items-start rounded-lg border p-4 text-left"
                >
                  <div className="bg-auto-soft text-auto-ink mb-3 grid size-8 place-items-center rounded-lg">
                    <Icon className="size-4" />
                  </div>
                  <div className="text-foreground text-sm font-semibold">
                    {tpl(`${slug}.name`)}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {tpl(`${slug}.description`)}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {automations.length === 0 ? (
        <StatePanel
          framed
          icon={Zap}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <ul className="space-y-3">
          {automations.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              onToggle={(next) => toggleActive(a, next)}
              onEdit={() => router.push(`/automations/${a.id}/edit`)}
              onDuplicate={() => duplicate(a)}
              onLogs={() => router.push(`/automations/${a.id}/logs`)}
              onDelete={() => setPendingDelete(a)}
              t={t}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteDesc', { name: pendingDelete?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutomationCard({
  automation,
  onToggle,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
  t,
}: {
  automation: Automation;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onLogs: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  // The trigger's name comes from the builder's own catalogue, so the chip
  // in this list and the picker inside the editor never disagree.
  const tTrigger = useTranslations('Automations.builder.triggers');
  const labelKey = triggerLabelKey(automation.trigger_type);
  const triggerLabel = labelKey
    ? tTrigger(`${labelKey}.label`)
    : automation.trigger_type;
  const lastRun = formatRelative(automation.last_executed_at);
  return (
    <li className="surface-interactive border-border bg-card rounded-lg border">
      <div className="flex items-center gap-4 p-4">
        <div
          className="bg-auto-soft text-auto-ink grid size-9 shrink-0 place-items-center rounded-lg"
          aria-hidden
        >
          <Zap className="size-4" />
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold">
              {automation.name}
            </span>
            {/* State, in words. The dot alone said "active" in hue only —
                invisible to a red-green eye, and its aria-label never
                reached anyone because StatusDot is aria-hidden. The dot
                stays as decoration; the word carries the meaning. */}
            {automation.is_active && (
              <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1">
                <StatusDot variant="ok" />
                <span className="eyebrow">{t('activeState')}</span>
              </span>
            )}
          </div>
          {automation.description && (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {automation.description}
            </p>
          )}
          {/* The trigger type is a CATEGORY, not a signal. It used to get a
              hue each — teal/purple/cyan/pink straight from Tailwind, none
              of them remapped by the theme, all of them picked for a dark
              background and reading at ~1.3:1 on the light card this list
              actually ships. One of them was amber, which spends the
              "a person must act" colour on "this fires on a tag". The
              wording identifies the trigger; grey is enough. */}
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge>{triggerLabel}</StatusBadge>
            <span className="tabular-nums">
              {automation.execution_count === 1
                ? t('runs', { count: automation.execution_count })
                : t('runsPlural', { count: automation.execution_count })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {lastRun ? t('lastRunAt', { time: lastRun }) : t('lastRunNever')}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-3">
          <Switch
            checked={automation.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={automation.is_active ? t('deactivate') : t('activate')}
          />

          <DropdownMenu>
            {/* The coarse-pointer shield in globals.css keys off
                [data-slot="button"], and a menu trigger is not one — so
                this 32px target stayed 32px on a phone. The pseudo-element
                is the same trick globals.css uses: 6px of hit area on each
                side takes it to 44 without moving a pixel. */}
            <DropdownMenuTrigger
              aria-label={t('openMenu')}
              className="text-muted-foreground hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted relative inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-(--dur-1) pointer-coarse:before:absolute pointer-coarse:before:-inset-1.5 pointer-coarse:before:content-['']"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                {t('edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4" />
                {t('duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogs}>
                <FileText className="h-4 w-4" />
                {t('viewLogs')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                {t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
