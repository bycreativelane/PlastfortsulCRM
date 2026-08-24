'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { AlertCircle, FileText, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tag } from '@/components/ui/tag';
import { StatePanel } from '@/components/ui/state-panel';
import { Skeleton } from '@/components/dashboard/skeleton';

interface Step1Props {
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({
  selectedTemplate,
  onSelect,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        // Only APPROVED templates can be sent via Meta — anything else
        // would 400 at broadcast time. Hide them rather than letting
        // the user pick a template that will fail.
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        setTemplates(data ?? []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t('chooseTemplate.errorLoad')
        );
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  // The placeholder has the template grid's own shape, so the step does
  // not jump when the fetch lands.
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <StatePanel
        size="md"
        framed
        icon={AlertCircle}
        title={t('chooseTemplate.errorLoad')}
        description={error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('chooseTemplate.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('chooseTemplate.subtitle')}
        </p>
      </div>

      {templates.length === 0 ? (
        <StatePanel
          size="md"
          framed
          icon={FileText}
          title={t('chooseTemplate.noTemplates')}
          description={t('chooseTemplate.createFirst')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;

            return (
              <button
                key={template.id}
                onClick={() => onSelect(template)}
                aria-pressed={isSelected}
                // The selected card used to add `ring-1` ON TOP of its
                // border, so it painted a 2px outline against the 1px of
                // every sibling in the grid — two thicknesses for one
                // role. The accent border alone is the selection.
                className={`flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors duration-(--dur-1) ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card/50 hover:bg-card'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-foreground min-w-0 text-sm font-medium">
                    {template.name}
                  </h3>
                  {/* Category is taxonomy, not state: a grey `Tag`, not
                      one of three hand-picked hues. Purple and orange
                      were outside the palette entirely and neither is
                      remapped for light mode. */}
                  <Tag size="sm">{template.category}</Tag>
                </div>
                <p className="text-muted-foreground line-clamp-3 text-xs">
                  {template.body_text}
                </p>
                <div className="text-muted-foreground flex items-center gap-2 text-2xs">
                  <span>{template.language ?? 'en_US'}</span>
                  {/* Status is omitted on purpose — every template
                      shown here is already filtered to APPROVED,
                      so the chip carried no information. */}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="border-border flex items-center justify-between gap-2 border-t pt-4">
        <Button variant="outline" onClick={onBack}>
          {t('back')}
        </Button>
        <Button onClick={onNext} disabled={!selectedTemplate}>
          {t('next')}
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
