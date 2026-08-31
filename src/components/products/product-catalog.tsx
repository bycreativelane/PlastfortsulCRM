'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Wrench,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { CURRENCIES, formatCurrency } from '@/lib/currency';
import {
  createProduct,
  loadProducts,
  updateProduct,
  type Product,
  type ProductDraft,
} from '@/lib/products/catalog';
import { cn } from '@/lib/utils';
import { PageActions } from '@/components/layout/page-actions';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { Textarea } from '@/components/ui/textarea';

/**
 * The catalogue, as a place you go rather than a setting you change.
 *
 * IT MOVED HERE FROM SETTINGS, and the move is the correction of a
 * decision I made without the plan in front of me. `sidebar.tsx` states
 * the test: "is this a place you go to WORK, or a place you go to change
 * how the work behaves?" A packaging catalogue passes the first — an
 * agent opens a product in the MIDDLE of a conversation to check a
 * measurement and a price. That is daily consultation, not occasional
 * configuration.
 *
 * The products plan said so first, and named the precedent: the 0.8.2
 * pass undid exactly this arrangement when Templates and Etiquetas
 * appeared on both surfaces at once. "Escolher uma. Não as duas."
 *
 * ------------------------------------------------------------------
 * TWO ACTS, TWO PERMISSIONS
 * ------------------------------------------------------------------
 *
 * Correcting a product — a price, a measurement, a description — is the
 * work of whoever quotes it, and a catalogue only an admin can fix is a
 * catalogue that stays wrong until somebody remembers to mention it.
 * That is an `agent` act.
 *
 * Creating one, or retiring one, changes the catalogue everybody quotes
 * from. That is an `admin` act, and migration 055 enforces both halves —
 * the policy for INSERT, a trigger for `active`, because RLS constrains
 * rows and "retire" is a column.
 *
 * RETIRE, NEVER DELETE. A product that stops being sold still appears in
 * every deal that ever contained it.
 */
export function ProductCatalog() {
  const t = useTranslations('Products');
  const { accountId, user, defaultCurrency } = useAuth();
  /** Correcting what a product IS. */
  const canEdit = useCan('send-messages');
  /** Adding one, or taking one out of everybody's catalogue. */
  const canCurate = useCan('edit-settings');

  const [products, setProducts] = useState<Product[] | null>(null);
  const [pending, setPending] = useState(false);
  /**
   * Seeded from `?q=`, which is what makes arriving from the global
   * search land ON the product instead of on the unfiltered catalogue.
   *
   * Read once, as the initial value, and not synced afterwards: this is
   * a text field somebody types in, and a URL that kept writing itself
   * back into it would fight the next keystroke.
   */
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** `'new'` while creating, a product id while editing, null when closed. */
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(() => empty(defaultCurrency));

  const fetchProducts = useCallback(async () => {
    if (!accountId) return null;
    return loadProducts(createClient(), accountId, { includeInactive: true });
  }, [accountId]);

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchProducts>>) => {
      if (result === null) return;
      if (result === 'missing-table') {
        setPending(true);
        setProducts([]);
        return;
      }
      setPending(false);
      setProducts(result);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    void fetchProducts().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchProducts, apply]);

  const reload = useCallback(
    () => fetchProducts().then(apply),
    [fetchProducts, apply]
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (products ?? [])
      .filter((p) => showInactive || p.active)
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          (p.sku ?? '').toLowerCase().includes(term) ||
          (p.category ?? '').toLowerCase().includes(term) ||
          // "40x60" is how the product is asked for on the phone, and
          // `size_label` is generated precisely so this match works.
          (p.size_label ?? '').toLowerCase().includes(term.replace(/\s/g, ''))
      );
  }, [products, query, showInactive]);

  const startNew = useCallback(() => {
    setEditing('new');
    setDraft(empty(defaultCurrency));
  }, [defaultCurrency]);

  const startEdit = useCallback((product: Product) => {
    setEditing(product.id);
    setDraft({
      name: product.name,
      sku: product.sku ?? '',
      description: product.description ?? '',
      unit: product.unit ?? '',
      price: product.price,
      currency: product.currency,
      category: product.category ?? '',
      widthCm: product.width_cm ?? null,
      heightCm: product.height_cm ?? null,
      thicknessMicron: product.thickness_micron ?? null,
      material: product.material ?? '',
      color: product.color ?? '',
    });
  }, []);

  const commit = useCallback(async () => {
    if (!accountId || !draft.name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    const db = createClient();
    const result =
      editing === 'new'
        ? await createProduct(db, accountId, user?.id ?? null, draft)
        : await updateProduct(db, editing as string, draft);
    setSaving(false);

    const error = 'error' in result ? result.error : null;
    if (error) {
      toast.error(describe(error, t));
      return;
    }
    setEditing(null);
    toast.success(t('saved'));
    void reload();
  }, [accountId, draft, editing, user?.id, reload, t]);

  const toggleActive = useCallback(
    async (product: Product) => {
      setBusyId(product.id);
      const { error } = await updateProduct(createClient(), product.id, {
        active: !product.active,
      });
      setBusyId(null);
      if (error) {
        toast.error(describe(error, t));
        return;
      }
      void reload();
    },
    [reload, t]
  );

  if (products === null) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (pending) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        <StatePanel
          size="md"
          icon={Wrench}
          title={t('pendingTitle')}
          description={t('pendingBody')}
        />
      </div>
    );
  }

  return (
    <div className="@container space-y-4">
      <PageHeader title={t('title')} description={t('description')} />

      {canCurate && !editing && (
        <PageActions>
          <Button size="sm" onClick={startNew}>
            <Plus className="size-4" />
            {t('newProduct')}
          </Button>
        </PageActions>
      )}

      {editing ? (
        <Panel>
          <PanelHeader>
            <div className="min-w-0">
              <PanelTitle>
                {editing === 'new' ? t('newProduct') : t('editProduct')}
              </PanelTitle>
              <PanelSub>{t('formSub')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody className="space-y-4">
            <div className="grid gap-3 @md:grid-cols-[2fr_1fr]">
              <Field label={t('name')} htmlFor="prod-name">
                <Input
                  id="prod-name"
                  value={draft.name}
                  maxLength={120}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label={t('sku')} htmlFor="prod-sku">
                <Input
                  id="prod-sku"
                  value={draft.sku}
                  maxLength={60}
                  placeholder={t('skuPlaceholder')}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                />
              </Field>
            </div>

            {/* THE MEASUREMENTS, typed (migration 055). The unit is in the
                label because it is in the column: a catalogue with 40 cm
                on one row and 400 mm on the next is a catalogue where a
                search for 40x60 finds half of it. */}
            <fieldset className="border-border space-y-3 rounded-md border p-3">
              <legend className="text-muted-foreground px-1 text-xs font-semibold">
                {t('dimensions')}
              </legend>
              <p className="text-muted-foreground text-xs">
                {t('dimensionsHint')}
              </p>
              <div className="grid grid-cols-1 gap-3 @xs:grid-cols-3">
                <Field label={t('width')} htmlFor="prod-w">
                  <Input
                    id="prod-w"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.5"
                    value={draft.widthCm ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, widthCm: numberOrNull(e.target.value) })
                    }
                  />
                </Field>
                <Field label={t('height')} htmlFor="prod-h">
                  <Input
                    id="prod-h"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.5"
                    value={draft.heightCm ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        heightCm: numberOrNull(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label={t('thickness')} htmlFor="prod-t">
                  <Input
                    id="prod-t"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step="1"
                    value={draft.thicknessMicron ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        thicknessMicron: numberOrNull(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
                <Field label={t('material')} htmlFor="prod-mat">
                  <Input
                    id="prod-mat"
                    value={draft.material}
                    maxLength={60}
                    placeholder={t('materialPlaceholder')}
                    onChange={(e) =>
                      setDraft({ ...draft, material: e.target.value })
                    }
                  />
                </Field>
                <Field label={t('color')} htmlFor="prod-color">
                  <Input
                    id="prod-color"
                    value={draft.color}
                    maxLength={40}
                    placeholder={t('colorPlaceholder')}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  />
                </Field>
              </div>
            </fieldset>

            <div className="grid gap-3 @md:grid-cols-3">
              <Field label={t('price')} htmlFor="prod-price">
                <CurrencyInput
                  id="prod-price"
                  value={draft.price}
                  onValueChange={(v) => setDraft({ ...draft, price: v })}
                  currency={draft.currency}
                  placeholder={t('pricePlaceholder')}
                />
              </Field>
              <Field label={t('currency')} htmlFor="prod-currency">
                <OptionSelect
                  id="prod-currency"
                  value={draft.currency}
                  onValueChange={(v) => setDraft({ ...draft, currency: v })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </OptionSelect>
              </Field>
              <Field label={t('unit')} htmlFor="prod-unit">
                <Input
                  id="prod-unit"
                  value={draft.unit}
                  maxLength={16}
                  placeholder={t('unitPlaceholder')}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                />
              </Field>
            </div>

            <Field
              label={t('category')}
              htmlFor="prod-category"
              hint={t('categoryDesc')}
            >
              <Input
                id="prod-category"
                value={draft.category}
                maxLength={60}
                placeholder={t('categoryPlaceholder')}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
              />
            </Field>

            <Field
              label={t('descriptionLabel')}
              htmlFor="prod-desc"
              hint={t('descriptionHint')}
            >
              <Textarea
                id="prod-desc"
                rows={3}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                <X className="size-4" />
                {t('cancel')}
              </Button>
              <Button onClick={commit} disabled={saving || !draft.name.trim()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('save')}
              </Button>
            </div>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader className="flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <PanelTitle>{t('listTitle')}</PanelTitle>
            <PanelSub>{t('listSub', { count: visible.length })}</PanelSub>
          </div>
          <div className="relative w-full @sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="pl-8"
              aria-label={t('searchPlaceholder')}
            />
          </div>
        </PanelHeader>

        <PanelBody flush>
          {visible.length === 0 ? (
            <StatePanel
              icon={Package}
              title={query ? t('noMatchTitle') : t('emptyTitle')}
              description={query ? t('noMatchBody') : t('emptyBody')}
            />
          ) : (
            <ul className="divide-border divide-y">
              {visible.map((product) => (
                <li
                  key={product.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5',
                    !product.active && 'opacity-60'
                  )}
                >
                  <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md">
                    <Package className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {product.name}
                    </p>
                    <p className="text-muted-foreground truncate text-2xs">
                      {[
                        product.sku,
                        // The size goes on the identity line, not in the
                        // description — it is how the product is named
                        // out loud.
                        product.size_label,
                        product.thickness_micron
                          ? `${product.thickness_micron}mic`
                          : null,
                        product.category,
                        product.unit ? `/${product.unit}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || t('noCode')}
                    </p>
                    <p className="text-foreground text-2xs mt-0.5 tabular-nums @sm:hidden">
                      {product.price != null
                        ? formatCurrency(product.price, product.currency)
                        : t('onRequest')}
                    </p>
                  </div>
                  <span className="text-foreground hidden shrink-0 text-sm tabular-nums @sm:block">
                    {product.price != null
                      ? formatCurrency(product.price, product.currency)
                      : t('onRequest')}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(product)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">{t('edit')}</span>
                      </Button>
                    )}
                    {/* Retiring is the admin half — see the note at the
                        top and the trigger in 055. Hidden rather than
                        disabled: a control that is always there and
                        always refuses teaches people to distrust the
                        row, not the button. */}
                    {canCurate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === product.id}
                        onClick={() => toggleActive(product)}
                      >
                        {product.active ? (
                          <Archive className="size-4" />
                        ) : (
                          <ArchiveRestore className="size-4" />
                        )}
                        <span className="sr-only">
                          {product.active ? t('retire') : t('restore')}
                        </span>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      {(products ?? []).some((p) => !p.active) && (
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="accent-primary size-3.5"
          />
          {t('showRetired')}
        </label>
      )}
    </div>
  );
}

/** Label, optional hint, control — the form's one row shape. */
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {children}
    </div>
  );
}

/**
 * An empty measurement field is NULL, not zero.
 *
 * Zero would pass the CHECK as a positive-only violation and, worse,
 * would read as "this product is 0cm wide" — which is a claim, where the
 * blank was an absence.
 */
function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function describe(error: string, t: ReturnType<typeof useTranslations>): string {
  if (error === 'duplicate-sku') return t('duplicateSku');
  if (error === 'missing-table') return t('pendingTitle');
  if (error === 'admin-only') return t('adminOnly');
  if (error === 'empty') return t('nameRequired');
  return error;
}

function empty(currency: string): ProductDraft {
  return {
    name: '',
    sku: '',
    description: '',
    unit: '',
    price: null,
    currency,
    category: '',
    widthCm: null,
    heightCm: null,
    thicknessMicron: null,
    material: '',
    color: '',
  };
}
