'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Package, Plus, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/currency';
import {
  lineTotal,
  loadDealItems,
  loadProducts,
  type DealItemDraft,
  type Product,
} from '@/lib/products/catalog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';

/**
 * What the opportunity actually contains.
 *
 * Spec §10: "cada oportunidade deve possuir … produtos". Until now it
 * had `value` — a number a person typed — which is why every total in
 * Relatórios is only as true as the last person to remember to update
 * it. Lines make the total arithmetic instead of memory: the database
 * computes each line and a trigger sums them onto the deal (054).
 *
 * ------------------------------------------------------------------
 * THE PRICE IS COPIED, NOT LINKED
 * ------------------------------------------------------------------
 *
 * Picking a product seeds the unit price from the catalogue and then
 * the number belongs to the line. That is what makes a discount
 * expressible, what stops a catalogue price change from rewriting last
 * quarter's closed deals, and what lets a deal outlive a product that
 * has since been retired.
 *
 * ------------------------------------------------------------------
 * A FREE-TEXT LINE IS ALLOWED
 * ------------------------------------------------------------------
 *
 * "Frete" and "montagem" are on half the quotes a distributor sends and
 * are in nobody's product catalogue. Forcing every line to reference a
 * product would mean either a fake product called Frete or the line
 * being left off — and the second is how a quote total stops matching
 * the invoice.
 */

export interface DealItemsHandle {
  items: DealItemDraft[];
  /** True when this account has no catalogue yet (migration 054). */
  pending: boolean;
}

export function DealItemsEditor({
  accountId,
  dealId,
  currency,
  disabled,
  onChange,
}: {
  accountId: string | null;
  /** Null while creating — lines are saved after the deal has an id. */
  dealId: string | null;
  currency: string;
  disabled?: boolean;
  onChange: (state: DealItemsHandle) => void;
}) {
  const t = useTranslations('Pipelines.items');
  const [products, setProducts] = useState<Product[]>([]);
  const [pending, setPending] = useState(false);
  const [items, setItems] = useState<DealItemDraft[]>([]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void loadProducts(createClient(), accountId).then((result) => {
      if (cancelled) return;
      if (result === 'missing-table') {
        setPending(true);
        return;
      }
      setProducts(result);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (!dealId) return;
    let cancelled = false;
    void loadDealItems(createClient(), dealId).then((result) => {
      if (cancelled || result === 'missing-table') return;
      setItems(
        result.map((row) => ({
          productId: row.product_id,
          name: row.name,
          quantity: Number(row.quantity),
          unitPrice: Number(row.unit_price),
          discountPercent: Number(row.discount_percent),
        }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  // The parent saves these after the deal has an id, so it needs the
  // current list — and it needs to know whether the catalogue exists at
  // all, because on a pre-054 database the manual value field is the
  // only thing that works.
  useEffect(() => {
    onChange({ items, pending });
  }, [items, pending, onChange]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + lineTotal(item), 0),
    [items]
  );

  const patch = useCallback((index: number, next: Partial<DealItemDraft>) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...next } : item))
    );
  }, []);

  const add = useCallback(() => {
    setItems((prev) => [
      ...prev,
      { productId: null, name: '', quantity: 1, unitPrice: 0, discountPercent: 0 },
    ]);
  }, []);

  if (pending) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>{t('title')}</FieldLabel>
        {!disabled && (
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="size-3.5" />
            {t('addLine')}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs">
          {t('empty')}
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-md border">
          {items.map((item, index) => (
            <li key={index} className="space-y-2 p-2.5">
              {/* One column on a phone, four on a desk. A quote line is
                  five numbers and a name; side by side they are a table,
                  stacked they are a form — and a table at 360px is a
                  horizontal scrollbar inside a dialog. */}
              <div className="flex items-start gap-2">
                <span className="bg-muted text-muted-foreground mt-1 grid size-6 shrink-0 place-items-center rounded">
                  <Package className="size-3" />
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <OptionSelect
                    value={item.productId ?? ''}
                    disabled={disabled}
                    aria-label={t('product')}
                    onValueChange={(value) => {
                      const product = products.find((p) => p.id === value);
                      // Choosing a product seeds the name and the price;
                      // clearing it back to free text keeps whatever was
                      // typed, because the line is usually being renamed
                      // rather than emptied.
                      patch(index, {
                        productId: product?.id ?? null,
                        name: product?.name ?? item.name,
                        unitPrice: product?.price ?? item.unitPrice,
                      });
                    }}
                  >
                    <option value="">{t('freeText')}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {[p.sku, p.name, p.size_label]
                          .filter(Boolean)
                          .join(' — ')}
                      </option>
                    ))}
                  </OptionSelect>

                  <Input
                    value={item.name}
                    disabled={disabled}
                    placeholder={t('namePlaceholder')}
                    aria-label={t('lineName')}
                    onChange={(e) => patch(index, { name: e.target.value })}
                  />

                  {/* Three across from 320px of CONTAINER, one column
                      below it. A quote line's three numbers at ~95px each
                      is tight and readable; at ~70px — which is what a
                      360px phone leaves once the dialog padding, the
                      product disc and the delete button are paid for —
                      the value is hidden behind the stepper arrows. */}
                  <div className="grid grid-cols-1 gap-2 @xs:grid-cols-3">
                    <NumberField
                      label={t('quantity')}
                      value={item.quantity}
                      min={0}
                      step="0.001"
                      disabled={disabled}
                      onChange={(v) => patch(index, { quantity: v })}
                    />
                    <NumberField
                      label={t('unitPrice')}
                      value={item.unitPrice}
                      min={0}
                      step="0.01"
                      disabled={disabled}
                      onChange={(v) => patch(index, { unitPrice: v })}
                    />
                    <NumberField
                      label={t('discount')}
                      value={item.discountPercent}
                      min={0}
                      max={100}
                      step="0.01"
                      disabled={disabled}
                      onChange={(v) => patch(index, { discountPercent: v })}
                    />
                  </div>
                </div>

                {!disabled && (
                  <button
                    type="button"
                    onClick={() =>
                      setItems((prev) => prev.filter((_, i) => i !== index))
                    }
                    aria-label={t('removeLine')}
                    className="text-muted-foreground hover:bg-muted hover:text-destructive mt-1 grid size-7 shrink-0 place-items-center rounded transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              <p className="text-muted-foreground text-right text-xs tabular-nums">
                {formatCurrency(lineTotal(item), currency)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        // The deal's value stops being a field somebody fills in and
        // becomes what the lines add up to — which is the whole reason
        // line items exist.
        <p className="text-foreground flex items-center justify-between gap-2 text-sm font-semibold">
          <span>{t('total')}</span>
          <span className="tabular-nums">{formatCurrency(total, currency)}</span>
        </p>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={cn('block space-y-1')}>
      <span className="text-muted-foreground text-3xs block">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className="tabular-nums"
      />
    </label>
  );
}
