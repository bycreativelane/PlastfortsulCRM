'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import { APP_LOCALE } from '@/lib/i18n/locale';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('Broadcasts.wizard');

  const OPERATOR_OPTIONS = useMemo<
    { value: CustomFieldOperator; label: string }[]
  >(
    () => [
      { value: 'is', label: t('selectAudience.operatorIs') },
      { value: 'is_not', label: t('selectAudience.operatorIsNot') },
      { value: 'contains', label: t('selectAudience.operatorContains') },
    ],
    [t]
  );

  const audienceOptions = useMemo<
    {
      type: AudienceType;
      label: string;
      description: string;
      icon: typeof Users;
    }[]
  >(
    () => [
      {
        type: 'all',
        label: t('selectAudience.method.all'),
        description: t('selectAudience.allDescLoading'),
        icon: Users,
      },
      {
        type: 'tags',
        label: t('selectAudience.method.tags'),
        description: t('selectAudience.tagDesc'),
        icon: Tags,
      },
      {
        type: 'custom_field',
        label: t('selectAudience.method.customField'),
        description: t('selectAudience.customFieldDesc'),
        icon: Filter,
      },
      {
        type: 'csv',
        label: t('selectAudience.method.csv'),
        description: t('selectAudience.csvDesc'),
        icon: Upload,
      },
    ],
    [t]
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  const fetchEstimatedCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      const supabase = createClient();

      // Base query — produces the superset before exclude is applied.
      let baseIds: Set<string> | null = null; // null means "all contacts"

      if (audience.type === 'all') {
        // Handled below — full-table count adjusted by excludes.
      } else if (
        audience.type === 'tags' &&
        audience.tagIds &&
        audience.tagIds.length > 0
      ) {
        const { data } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.tagIds);
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (
        audience.type === 'custom_field' &&
        audience.customField?.fieldId &&
        audience.customField.value
      ) {
        const { fieldId, operator, value } = audience.customField;
        let q = supabase
          .from('contact_custom_values')
          .select('contact_id')
          .eq('custom_field_id', fieldId);
        if (operator === 'is') q = q.eq('value', value);
        else if (operator === 'is_not') q = q.neq('value', value);
        else q = q.ilike('value', `%${value}%`);
        const { data } = await q;
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (
        audience.type === 'csv' &&
        audience.csvContacts &&
        audience.csvContacts.length > 0
      ) {
        setEstimatedCount(audience.csvContacts.length);
        return;
      } else {
        // Partially-configured audience — wait for the user to finish.
        setEstimatedCount(null);
        return;
      }

      // Apply exclude tags
      let excludeSet: Set<string> | null = null;
      if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
        const { data: excludeRows } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.excludeTagIds);
        excludeSet = new Set((excludeRows ?? []).map((r) => r.contact_id));
      }

      if (baseIds) {
        const effective = [...baseIds].filter((id) => !excludeSet?.has(id));
        setEstimatedCount(effective.length);
      } else {
        // "All" — fetch the total, then subtract exclude set if any.
        // Opted-out contacts never receive the send, so they must not be
        // in the number the operator reads before pressing the button.
        const { count } = await supabase
          .from('contacts')
          .select('*', { count: 'exact', head: true })
          .eq('opted_out', false);
        const total = count ?? 0;
        setEstimatedCount(
          excludeSet ? Math.max(0, total - excludeSet.size) : total
        );
      }
    } finally {
      setLoadingCount(false);
    }
  }, [
    audience.type,
    audience.tagIds,
    audience.customField,
    audience.csvContacts,
    audience.excludeTagIds,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('selectAudience.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('selectAudience.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {audienceOptions.map(
          (option: {
            type: AudienceType;
            label: string;
            description: string;
            icon: typeof Users;
          }) => {
            const isSelected = audience.type === option.type;
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                onClick={() =>
                  onUpdate({
                    ...audience,
                    type: option.type,
                    // Wipe shape fields from other types to avoid stale
                    // config leaking across selections.
                    tagIds:
                      option.type === 'tags' ? audience.tagIds : undefined,
                    customField:
                      option.type === 'custom_field'
                        ? audience.customField
                        : undefined,
                    csvContacts:
                      option.type === 'csv' ? audience.csvContacts : undefined,
                  })
                }
                aria-pressed={isSelected}
                // No `ring-1` over the border: it painted the selected
                // card's outline at 2px against its siblings' 1px, which
                // is two thicknesses for one role in a single grid.
                className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors duration-(--dur-1) ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card/50 hover:bg-card'
                }`}
              >
                <div
                  className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                    isSelected
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-secondary-foreground'
                  }`}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-medium">
                    {option.label}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          }
        )}
      </div>

      {audience.type === 'tags' && (
        <div className="border-border bg-card/50 rounded-lg border p-4">
          <p className="text-foreground mb-3 text-sm font-medium">
            {t('selectAudience.selectTags')}
          </p>
          {loadingTags ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : tags.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.noTagsFound')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  // A raw `<button>`, so it does not inherit the 44px
                  // coarse-pointer target the design system gives
                  // `[data-slot="button"]`. This wizard is used on the
                  // phone, so it asks for the target itself.
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    aria-pressed={isSelected}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-(--dur-1) [@media(pointer:coarse)]:min-h-11 ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-secondary-foreground'
                    }`}
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="border-border bg-card/50 space-y-3 rounded-lg border p-4">
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.method.customField')}
          </p>
          {loadingFields ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : customFields.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.errorLoadFields')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <OptionSelect
                value={audience.customField?.fieldId ?? ''}
                onValueChange={(fieldId) => updateCustomField({ fieldId })}
                className="border-border bg-muted text-foreground"
              >
                <option value="">{t('selectAudience.selectField')}</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </OptionSelect>
              <OptionSelect
                value={audience.customField?.operator ?? 'is'}
                onValueChange={(operator) =>
                  updateCustomField({
                    operator: operator as CustomFieldOperator,
                  })
                }
                className="border-border bg-muted text-foreground"
              >
                {OPERATOR_OPTIONS.map(
                  (op: { value: CustomFieldOperator; label: string }) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  )
                )}
              </OptionSelect>
              {/* The `Input` primitive, not a hand-rolled `<input>`. The
                  raw one stood 36px tall beside the two 32px selects it
                  shares this row with, and wore a 1px focus ring against
                  their 3px — one field in three lining up with neither of
                  its neighbours. */}
              <Input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder={t('selectAudience.valuePlaceholder')}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
              />
            </div>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="border-border bg-card/50 rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="text-danger-ink size-4" />
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.excludeTags')}
          </p>
        </div>
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('selectAudience.noTagsFound')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleExcludeTag(tag.id)}
                  aria-pressed={isExcluded}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-(--dur-1) [@media(pointer:coarse)]:min-h-11 ${
                    isExcluded
                      ? 'border-danger-ink/25 bg-danger-soft text-danger-ink'
                      : 'border-border bg-muted text-secondary-foreground'
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="border-border bg-card/50 rounded-lg border p-4">
        <p className="text-foreground mb-2 text-sm font-medium">
          {t('selectAudience.summaryTitle')}
        </p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
            <span className="text-muted-foreground text-xs">
              {t('selectAudience.calculating')}
            </span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Users className="text-muted-foreground size-4 shrink-0" />
            <span className="text-foreground text-sm font-medium tabular-nums">
              {estimatedCount.toLocaleString(APP_LOCALE)}
            </span>
            <span className="text-muted-foreground text-xs">
              {t('selectAudience.estimatedRecipients')}
            </span>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t('selectAudience.summaryEmpty')}
          </p>
        )}
      </div>

      <div className="border-border flex items-center justify-between gap-2 border-t pt-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft />
          {t('back')}
        </Button>
        <Button onClick={onNext} disabled={!isValid}>
          {t('next')}
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
