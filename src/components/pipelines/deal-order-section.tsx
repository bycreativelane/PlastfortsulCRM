'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2, CircleDashed, Loader2, Lock, Scale } from 'lucide-react';

import { formatCurrencyExact } from '@/lib/currency';
import { fromCents } from '@/lib/money';
import type { DealOrderFields } from '@/lib/deals/row';
import type { OrderLock } from '@/lib/deals/order-lock';
import { isColumnFree } from '@/lib/deals/order-lock';
import type { Readiness, ReadinessKey } from '@/lib/deals/order-rules';
import type { DealItemDraft } from '@/lib/products/catalog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { DateField } from '@/components/ui/date-field';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';

/**
 * A ÁREA PEDIDO DA GAVETA — Fase 3 do plano Bling (085).
 *
 * O que o pedido de venda precisa além do que a gaveta já tinha: as datas,
 * a categoria de receita (com a escolha do misto), o peso calculado dos
 * snapshots, os volumes confirmados, as observações internas e a lista
 * "Pronto para o Bling". Nada aqui envia: a Fase 4 é que registra o pedido.
 *
 * As travas por situação chegam prontas (`lock`): cada campo pergunta a
 * `isColumnFree` pela coluna dele, a mesma regra do gatilho da 085 — um
 * campo aceso que o banco recusaria é um "salvar" que falha depois.
 */

const ORDER_STATUS_VARIANT: Record<string, 'ok' | 'human' | 'danger' | 'neutral'> = {
  em_aberto: 'neutral',
  em_andamento: 'ok',
  atendido: 'ok',
  compra_futura: 'human',
  cancelado: 'danger',
};

const SYNC_VARIANT: Record<string, 'ok' | 'human' | 'danger' | 'neutral'> = {
  not_sent: 'neutral',
  syncing: 'neutral',
  synced: 'ok',
  pending: 'human',
  error: 'danger',
  divergent: 'danger',
};

function focar(id: string) {
  const alvo = document.getElementById(id);
  if (!alvo) return;
  alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
  alvo.focus({ preventScroll: true });
}

export function DealOrderSection({
  orderStatus,
  syncStatus,
  syncError,
  blingOrderNumber,
  lock,
  disabled,
  canAuthorizeWeight,
  fields,
  onChange,
  readiness,
  lines,
  categoryLabels,
  grossWeight,
  onUseWeight,
  currency,
  showReadiness,
  ordersEnabled = false,
  syncBusy = false,
  onSync,
}: {
  /** A chave geral dos pedidos (086): mostra "Registrar no Bling". */
  ordersEnabled?: boolean;
  syncBusy?: boolean;
  onSync?: () => void;
  orderStatus: string | null;
  syncStatus: string | null;
  syncError: string | null;
  blingOrderNumber: string | null;
  lock: OrderLock;
  disabled: boolean;
  /** Admin: só quem pode autorizar a exceção de peso. */
  canAuthorizeWeight: boolean;
  fields: DealOrderFields;
  onChange: (patch: Partial<DealOrderFields>) => void;
  readiness: Readiness;
  lines: DealItemDraft[];
  categoryLabels: ReadonlyMap<string, string>;
  grossWeight: number | null;
  onUseWeight: (kg: number) => void;
  currency: string;
  /** A lista só faz sentido com o Bling configurado na conta. */
  showReadiness: boolean;
}) {
  const t = useTranslations('Pipelines.order');

  const livre = (coluna: string) => !disabled && isColumnFree(coluna, lock);
  const nomeDaLinha = (i: number) => lines[i]?.name?.trim() || t('lineN', { n: i + 1 });
  const nomeCategoria = (id: string) => categoryLabels.get(id) ?? t('categoryUnknown', { id });

  const { weight, category, customer, installments } = readiness;
  const pesoDiferente =
    weight.totalKg > 0 && (grossWeight === null || Math.abs(grossWeight - weight.totalKg) > 0.0005);

  const detalhe = (key: ReadinessKey): string | null => {
    switch (key) {
      case 'customer':
        if (customer.document === 'missing') return t('detail.documentMissing');
        if (customer.document === 'invalid') return t('detail.documentInvalid');
        if (customer.document === 'type_mismatch') return t('detail.documentMismatch');
        if (customer.address.length > 0) {
          return t('detail.addressMissing', {
            fields: customer.address.map((f) => t(`address.${f}`)).join(', '),
          });
        }
        if (customer.stateRegistration) return t('detail.stateRegistration');
        return null;
      case 'products':
        if (lines.length === 0) return t('detail.noLines');
        return readiness.unlinkedLines.length
          ? t('detail.unlinked', { names: readiness.unlinkedLines.map(nomeDaLinha).join(', ') })
          : null;
      case 'weight':
        return weight.missing.length
          ? t('detail.noWeight', { names: weight.missing.map(nomeDaLinha).join(', ') })
          : null;
      case 'category':
        if (category.status === 'ambiguous') return t('detail.categoryAmbiguous');
        if (category.status === 'missing') {
          return t('detail.categoryMissing', { names: category.lines.map(nomeDaLinha).join(', ') });
        }
        if (category.status === 'empty') return t('detail.noLines');
        return null;
      case 'payment':
        if (installments.missingMethod.length) {
          return t('detail.methodMissing', { count: installments.missingMethod.length });
        }
        if (installments.methodNotAllowed.length) {
          return t('detail.methodNotAllowed', { count: installments.methodNotAllowed.length });
        }
        return null;
      case 'installments':
        if (installments.diffCents < 0) {
          return t('detail.installmentsShort', {
            value: formatCurrencyExact(fromCents(-installments.diffCents), currency),
          });
        }
        if (installments.diffCents > 0) {
          return t('detail.installmentsOver', {
            value: formatCurrencyExact(fromCents(installments.diffCents), currency),
          });
        }
        if (installments.missingDue.length) return t('detail.dueMissing');
        return null;
      case 'carrier':
        return null;
    }
  };

  return (
    <section
      aria-labelledby="deal-order-title"
      className="border-border space-y-4 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p id="deal-order-title" className="text-muted-foreground eyebrow mr-auto">
          {t('title')}
        </p>
        {orderStatus && (
          <StatusBadge variant={ORDER_STATUS_VARIANT[orderStatus] ?? 'neutral'} size="sm">
            {t(`status.${orderStatus}`)}
          </StatusBadge>
        )}
        {blingOrderNumber && (
          <span className="text-muted-foreground text-2xs tabular-nums">
            {t('blingNumber', { number: blingOrderNumber })}
          </span>
        )}
        {syncStatus && syncStatus !== 'not_sent' && (
          <StatusBadge variant={SYNC_VARIANT[syncStatus] ?? 'neutral'} size="sm">
            {t(`sync.${syncStatus}`)}
          </StatusBadge>
        )}
      </div>

      {syncError && (syncStatus === 'error' || syncStatus === 'divergent' || syncStatus === 'syncing') && (
        <p
          className={cn(
            'rounded-md px-2.5 py-1.5 text-xs break-words',
            syncStatus === 'syncing' ? 'bg-human-soft text-human-ink' : 'bg-danger-soft text-danger-ink'
          )}
        >
          {describeSyncError(syncError, t)}
        </p>
      )}
      {syncStatus === 'pending' && (
        <p className="bg-human-soft text-human-ink rounded-md px-2.5 py-1.5 text-xs">{t('sendPending')}</p>
      )}

      {lock !== 'open' && (
        <p className="border-border bg-muted text-secondary-foreground flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          {lock === 'in_progress'
            ? t('lockedInProgress')
            : t('lockedClosed', { status: orderStatus ? t(`status.${orderStatus}`) : '' })}
        </p>
      )}

      {/* AS DATAS DO PEDIDO. Venda e validade são do orçamento; saída,
          prevista e prazo são da produção, e seguem editáveis Em andamento. */}
      <div className="grid gap-3 @lg:grid-cols-2">
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="deal-sale-date">{t('saleDate')}</FieldLabel>
          <DateField
            id="deal-sale-date"
            value={fields.saleDate}
            onValueChange={(iso) => onChange({ saleDate: iso })}
            disabled={!livre('sale_date')}
          />
          <p className="text-muted-foreground text-2xs">{t('saleDateHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="deal-valid-until">{t('validUntil')}</FieldLabel>
          <DateField
            id="deal-valid-until"
            value={fields.validUntil}
            onValueChange={(iso) => onChange({ validUntil: iso })}
            disabled={!livre('valid_until')}
          />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="deal-delivery-days">{t('deliveryDays')}</FieldLabel>
          <Input
            id="deal-delivery-days"
            type="number"
            inputMode="numeric"
            min={0}
            max={3650}
            step="1"
            value={fields.deliveryDays ?? ''}
            onChange={(e) =>
              onChange({ deliveryDays: e.target.value === '' ? null : Number(e.target.value) })
            }
            disabled={!livre('delivery_days')}
            className="border-border bg-muted text-foreground tabular-nums"
          />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="deal-departure-date">{t('departureDate')}</FieldLabel>
          <DateField
            id="deal-departure-date"
            value={fields.departureDate}
            onValueChange={(iso) => onChange({ departureDate: iso })}
            disabled={!livre('departure_date')}
          />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="deal-expected-date">{t('expectedDate')}</FieldLabel>
          <DateField
            id="deal-expected-date"
            value={fields.expectedDate}
            onValueChange={(iso) => onChange({ expectedDate: iso })}
            disabled={!livre('expected_date')}
          />
        </div>
      </div>

      {/* CATEGORIA DE RECEITA — automática na venda simples; no misto a
          pessoa escolhe entre as categorias que os itens trazem, e a
          escolha fica registrada com quem e por quê (D7). */}
      {(category.status !== 'empty' || fields.revenueCategoryBlingId) && (
        <div id="deal-category" tabIndex={-1} className="grid gap-1.5 outline-none">
          <FieldLabel>{t('category')}</FieldLabel>
          {category.status === 'resolved' && (
            <p className="text-secondary-foreground text-xs">
              {t(category.via === 'single' ? 'categoryAuto' : 'categoryAuxiliary', {
                name: nomeCategoria(category.categoryId),
              })}
            </p>
          )}
          {(category.status === 'ambiguous' || category.status === 'chosen') && (
            <>
              <p className="text-human-ink text-2xs">{t('categoryChoose')}</p>
              <div className="flex flex-wrap gap-1.5">
                {category.options.map((id) => (
                  <ChoiceChip
                    key={id}
                    active={fields.revenueCategoryBlingId === id}
                    disabled={!livre('revenue_category_bling_id')}
                    onClick={() =>
                      onChange({
                        revenueCategoryBlingId: fields.revenueCategoryBlingId === id ? '' : id,
                      })
                    }
                  >
                    {nomeCategoria(id)}
                  </ChoiceChip>
                ))}
              </div>
              <Input
                id="deal-category-note"
                value={fields.revenueCategoryNote}
                onChange={(e) => onChange({ revenueCategoryNote: e.target.value })}
                placeholder={t('categoryNotePlaceholder')}
                maxLength={240}
                disabled={!livre('revenue_category_note')}
                className="border-border bg-muted text-foreground"
              />
            </>
          )}
          {category.status === 'missing' && (
            <p className="text-danger-ink text-2xs">
              {t('detail.categoryMissing', { names: category.lines.map(nomeDaLinha).join(', ') })}
            </p>
          )}
        </div>
      )}

      {/* PESO — a soma dos snapshots. Produto físico sem peso bloqueia a
          emissão, salvo exceção autorizada (admin) e registrada aqui. */}
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-secondary-foreground flex items-center gap-1.5 text-xs">
            <Scale className="text-muted-foreground size-3.5" />
            {t('weightComputed', { kg: weight.totalKg.toLocaleString(undefined, { maximumFractionDigits: 3 }) })}
          </p>
          {pesoDiferente && livre('gross_weight') && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onUseWeight(weight.totalKg)}
              className="text-muted-foreground"
            >
              {t('useWeight')}
            </Button>
          )}
        </div>
        {weight.missing.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-human-ink text-2xs">
              {t('detail.noWeight', { names: weight.missing.map(nomeDaLinha).join(', ') })}
            </p>
            <Input
              id="deal-weight-exception"
              value={fields.weightExceptionNote}
              onChange={(e) => onChange({ weightExceptionNote: e.target.value })}
              placeholder={
                canAuthorizeWeight ? t('weightExceptionPlaceholder') : t('weightExceptionAdminOnly')
              }
              maxLength={240}
              disabled={!canAuthorizeWeight || !livre('weight_exception_note')}
              className="border-border bg-muted text-foreground"
            />
          </div>
        )}
      </div>

      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox
          checked={fields.freightVolumesConfirmed}
          onCheckedChange={(v) => onChange({ freightVolumesConfirmed: v === true })}
          disabled={!livre('freight_volumes_confirmed')}
          className="mt-0.5"
        />
        <span className="text-secondary-foreground text-xs">{t('volumesConfirmed')}</span>
      </label>

      <div className="grid gap-1.5">
        <FieldLabel htmlFor="deal-internal-notes">{t('internalNotes')}</FieldLabel>
        <Textarea
          id="deal-internal-notes"
          value={fields.internalNotes}
          onChange={(e) => onChange({ internalNotes: e.target.value })}
          maxLength={4000}
          disabled={!livre('internal_notes')}
          className="border-border bg-muted text-foreground min-h-[72px]"
        />
        <p className="text-muted-foreground text-2xs">{t('internalNotesHint')}</p>
      </div>

      {/* PRONTO PARA O BLING — cada item diz o que falta e leva ao campo. */}
      {showReadiness && (
        <div className="grid gap-1.5">
          <p className="text-muted-foreground eyebrow">
            {readiness.ready ? t('readyTitleOk') : t('readyTitle')}
          </p>
          <ul className="grid gap-1">
            {readiness.items.map((item) => {
              const texto = detalhe(item.key);
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => focar(item.field)}
                    className="hover:bg-muted flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left"
                  >
                    {item.ok ? (
                      <CheckCircle2 className="text-ok-ink mt-0.5 size-3.5 shrink-0" />
                    ) : (
                      <CircleDashed className="text-human-ink mt-0.5 size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block text-xs',
                          item.ok ? 'text-muted-foreground' : 'text-foreground font-medium'
                        )}
                      >
                        {t(`ready.${item.key}`)}
                      </span>
                      {!item.ok && texto && (
                        <span className="text-muted-foreground text-2xs block">{texto}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* D2: o botão explícito, para quando o orçamento sai por outro
              canal. O envio pelo WhatsApp faz o mesmo antes de mandar. */}
          {ordersEnabled && onSync && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant={blingOrderNumber ? 'outline' : 'default'}
                onClick={onSync}
                disabled={disabled || syncBusy || lock !== 'open' || !readiness.ready}
              >
                {syncBusy && <Loader2 className="size-3.5 animate-spin" />}
                {blingOrderNumber ? t('syncUpdate') : t('syncCreate')}
              </Button>
              {!readiness.ready && (
                <span className="text-muted-foreground text-2xs">{t('syncNeedsReady')}</span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A mensagem de erro gravada pela fila, na língua de quem lê.
 *
 * Os códigos do CRM (`contact_ambiguous`, `payload:no_category,…`) viram
 * frase; o que o Bling disse (`bling:400:…`) vai como veio, sem o prefixo.
 */
export function describeSyncError(
  erro: string,
  t: (chave: string, valores?: Record<string, string | number>) => string
): string {
  if (erro.startsWith('bling:')) {
    const [, status, ...resto] = erro.split(':');
    return t('errors.bling', { status, detail: resto.join(':') });
  }
  if (erro.startsWith('payload:')) {
    return erro
      .slice('payload:'.length)
      .split(',')
      .map((codigo) => (CODIGOS_DE_MONTAGEM.has(codigo) ? t(`errors.payload.${codigo}`) : codigo))
      .join(' ');
  }
  if (erro.startsWith('diff:')) {
    return t('errors.diff', { fields: erro.slice('diff:'.length) });
  }
  return CODIGOS_DE_ERRO.has(erro) ? t(`errors.${erro}`) : erro;
}

const CODIGOS_DE_ERRO = new Set([
  'orders_disabled',
  'not_connected',
  'company_mismatch',
  'contact_document_missing',
  'contact_ambiguous',
  'contact_link_broken',
  'order_not_created',
  'order_launched',
  'duplicate_remote',
  'remote_not_open',
  'remote_missing',
  'daily_limit',
  'unexpected',
  'refresh_busy',
  'refresh_throttled',
  'limiter_unavailable',
  'revoked',
  'not_configured',
]);

const CODIGOS_DE_MONTAGEM = new Set([
  'no_contact',
  'no_items',
  'item_not_linked',
  'no_category',
  'no_installments',
  'installment_without_method',
  'installment_without_due',
  'installments_mismatch',
  'no_open_status',
  'invalid_id',
]);
