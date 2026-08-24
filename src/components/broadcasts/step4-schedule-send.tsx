'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { APP_LOCALE } from '@/lib/i18n/locale';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true })
            .eq('opted_out', false);
          setEstimatedReach(count ?? 0);
        } else if (
          audience.type === 'tags' &&
          audience.tagIds &&
          audience.tagIds.length > 0
        ) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set(
            (contactTags ?? []).map((ct) => ct.contact_id)
          );
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : t('scheduleSend.audienceField');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('scheduleSend.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="text-foreground mb-1.5 block text-sm font-medium">
          {t('scheduleSend.broadcastName')}
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Summary Card */}
      <div className="border-border bg-card/50 space-y-3 rounded-lg border p-4">
        <p className="text-foreground text-sm font-medium">
          {t('scheduleSend.summary')}
        </p>
        {/* `grid-cols-2` with no small variant put two columns into
            328px of usable width at 360px and clipped both labels. */}
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {/* `templateLabel` / `audienceLabel` rather than the older
              `template` / `audience` keys: those two end in a colon,
              which reads as a run-in label. Stacked above their value in
              a four-cell grid they sat beside two labels that have no
              colon, so half the grid punctuated and half did not. */}
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.templateLabel')}
            </p>
            <p className="text-foreground break-words">{template.name}</p>
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.audienceLabel')}
            </p>
            <p className="text-foreground break-words">{audienceLabel}</p>
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.estimatedReach')}
            </p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
              ) : (
                <>
                  <Users className="text-muted-foreground size-3.5 shrink-0" />
                  <p className="text-foreground font-medium tabular-nums">
                    {estimatedReach.toLocaleString(APP_LOCALE)}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.language')}
            </p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="border-primary/20 bg-primary/5 rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Loader2 className="text-primary size-4 shrink-0 animate-spin" />
              <p className="text-foreground text-sm font-medium">
                {t('scheduleSend.sending')}
              </p>
            </div>
            <span className="text-primary shrink-0 text-xs font-medium tabular-nums">
              {progress}%
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-1.5 rounded-full transition-[width] duration-(--dur-2)"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button variant="outline" onClick={onBack} disabled={isProcessing}>
          <ArrowLeft />
          {t('back')}
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
            >
              <Save />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={<Button disabled={!name.trim() || isProcessing} />}
            >
              <Send />
              {t('scheduleSend.sendNow')}
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('scheduleSend.confirmTitle')}</DialogTitle>
                <DialogDescription>
                  {t.rich('scheduleSend.confirmBody', {
                    count: estimatedReach.toLocaleString(APP_LOCALE),
                    template: template.name,
                    strong: (chunks) => (
                      <span className="text-popover-foreground font-medium">
                        {chunks}
                      </span>
                    ),
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowConfirm(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    onSend();
                  }}
                >
                  <Send />
                  {t('scheduleSend.sendNow')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
