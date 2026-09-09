'use client';

import { useTranslations } from 'next-intl';
import { Plus, Trash2, Wand2 } from 'lucide-react';

import { formatCurrencyExact } from '@/lib/currency';
import { addDays, fromISO, toISO } from '@/lib/calendar';
import {
  generateInstallments,
  installmentsTotal,
  MAX_INSTALLMENTS,
  parseTerms,
  type InstallmentDraft,
} from '@/lib/deals/installments';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DateField } from '@/components/ui/date-field';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * CONDIÇÃO DE PAGAMENTO — o bloco do pedido de venda do Bling.
 *
 * Uma linha de texto e um botão que a transforma em parcelas. É
 * literalmente o desenho de lá, e é o único que a operação já sabe usar:
 * digita-se `30/60/90`, aperta-se "Gerar parcelas", e o que aparece é
 * editável — porque a parte que sempre precisa de ajuste é uma data que
 * caiu no domingo ou um valor que se arredonda para fechar o pedido.
 *
 * ------------------------------------------------------------------
 * CONTROLADO PELO FORMULÁRIO, e não dono do próprio estado
 * ------------------------------------------------------------------
 *
 * Ao contrário do editor de produtos ao lado, que guarda as linhas dele e
 * avisa o pai. A diferença é que gerar parcelas precisa do TOTAL do
 * pedido, que só o formulário sabe — ele vem dos produtos mais o frete. Um
 * componente que guardasse as parcelas teria de receber o total mesmo
 * assim, e aí teria dois donos para o mesmo estado.
 *
 * ------------------------------------------------------------------
 * `days` CONTINUA SENDO GRAVADO, mesmo sem campo na tela
 * ------------------------------------------------------------------
 *
 * O Bling guarda os dois lados — dias e data — e deixa os dois editáveis.
 * Numa gaveta de 24rem, dois campos que dizem a mesma coisa é um a mais:
 * a data é o que se confere com o cliente. Então a tela mostra a data e o
 * `days` é RECALCULADO a partir dela, para a coluna não guardar o `30` de
 * uma parcela que alguém moveu para o dia 45.
 */

export function DealInstallments({
  terms,
  onTermsChange,
  value,
  onChange,
  total,
  currency,
  issuedOn,
  disabled,
}: {
  terms: string;
  onTermsChange: (terms: string) => void;
  value: InstallmentDraft[];
  onChange: (parcelas: InstallmentDraft[]) => void;
  /** O que as parcelas dividem: produtos + frete. */
  total: number;
  currency: string;
  /** A data do pedido, de onde os vencimentos são contados. */
  issuedOn: string;
  disabled?: boolean;
}) {
  const t = useTranslations('Pipelines.form');

  const soma = installmentsTotal(value);
  const fecha = Math.abs(soma - total) < 0.005;

  const gerar = () => {
    onChange(
      generateInstallments({
        terms,
        total,
        issuedOn,
        // A forma da primeira parcela vira a de todas: numa condição
        // parcelada a forma é quase sempre a mesma, e digitá-la três
        // vezes é trabalho que o botão existe para poupar.
        method: value[0]?.method ?? null,
      })
    );
  };

  const patch = (index: number, next: Partial<InstallmentDraft>) => {
    onChange(value.map((p, i) => (i === index ? { ...p, ...next } : p)));
  };

  /** Dias entre a emissão e o vencimento — a conta que o Bling espera. */
  const diasAte = (dueOn: string | null): number => {
    const emissao = fromISO(issuedOn);
    const vence = dueOn ? fromISO(dueOn) : null;
    if (!emissao || !vence) return 0;
    return Math.max(
      0,
      Math.round((vence.getTime() - emissao.getTime()) / 86_400_000)
    );
  };

  const adicionar = () => {
    if (value.length >= MAX_INSTALLMENTS) return;
    const anterior = value[value.length - 1];
    // A parcela nova nasce 30 dias depois da última, que é o intervalo de
    // toda condição parcelada que esta operação usa. Continua editável.
    const dias = (anterior ? diasAte(anterior.dueOn) : 0) + 30;
    const emissao = fromISO(issuedOn);
    onChange([
      ...value,
      {
        days: dias,
        dueOn: emissao ? toISO(addDays(emissao, dias)) : null,
        amount: 0,
        method: anterior?.method ?? null,
        note: null,
      },
    ]);
  };

  return (
    <div className="space-y-2">
      <FieldLabel htmlFor="deal-terms">{t('paymentTerms')}</FieldLabel>
      {/* O campo e o botão na mesma linha, como no Bling: o botão só faz
          sentido em relação ao que está escrito ao lado dele. */}
      <div className="flex items-end gap-2">
        <Input
          id="deal-terms"
          value={terms}
          onChange={(e) => onTermsChange(e.target.value)}
          placeholder={t('paymentTermsPlaceholder')}
          disabled={disabled}
          className="border-border bg-muted text-foreground"
        />
        <Button
          type="button"
          variant="outline"
          onClick={gerar}
          // Sem número na condição não há parcela para gerar — "a
          // combinar" é uma condição de pagamento perfeitamente válida de
          // se escrever, e o botão diz isso ficando apagado.
          disabled={disabled || parseTerms(terms).length === 0}
          className="shrink-0"
        >
          <Wand2 className="size-4" />
          {t('generateInstallments')}
        </Button>
      </div>

      {value.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-md border">
          {value.map((parcela, index) => (
            <li key={index} className="space-y-2 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-2xs font-semibold">
                  {t('installmentNumber', { n: index + 1 })}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange(value.filter((_, i) => i !== index))
                    }
                    aria-label={t('removeInstallment')}
                    className="text-muted-foreground hover:bg-muted hover:text-destructive grid size-7 shrink-0 place-items-center rounded transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 @xs:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-muted-foreground text-3xs block">
                    {t('installmentDue')}
                  </span>
                  <DateField
                    value={parcela.dueOn ?? ''}
                    disabled={disabled}
                    aria-label={t('installmentDue')}
                    onValueChange={(iso) =>
                      patch(index, {
                        dueOn: iso || null,
                        // O `days` acompanha a data, ou a coluna guardaria
                        // o 30 de uma parcela movida para o dia 45.
                        days: diasAte(iso || null),
                      })
                    }
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-muted-foreground text-3xs block">
                    {t('installmentAmount')}
                  </span>
                  <CurrencyInput
                    value={parcela.amount}
                    currency={currency}
                    disabled={disabled}
                    aria-label={t('installmentAmount')}
                    onValueChange={(v) => patch(index, { amount: v ?? 0 })}
                    className="border-border bg-muted text-foreground"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-muted-foreground text-3xs block">
                  {t('installmentMethod')}
                </span>
                <Input
                  value={parcela.method ?? ''}
                  disabled={disabled}
                  aria-label={t('installmentMethod')}
                  onChange={(e) => patch(index, { method: e.target.value })}
                  className="border-border bg-muted text-foreground"
                />
              </label>
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/*
            A CONTA QUE FECHA, ou a frase que diz que não fecha.

            Sem isto, três parcelas de R$ 333,33 num pedido de R$ 1.000,00
            saem no documento e ninguém percebe até o cliente somar. A
            diferença de meio centavo no teste é o arredondamento das
            próprias parcelas, não uma folga.
          */}
          <p
            className={
              fecha
                ? 'text-muted-foreground text-2xs'
                : 'text-danger-ink bg-danger-soft rounded px-2 py-1 text-2xs'
            }
          >
            {fecha
              ? t('installmentsSum', {
                  sum: formatCurrencyExact(soma, currency),
                })
              : t('installmentsMismatch', {
                  sum: formatCurrencyExact(soma, currency),
                  total: formatCurrencyExact(total, currency),
                })}
          </p>
          {!disabled && value.length < MAX_INSTALLMENTS && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={adicionar}
              className="text-muted-foreground"
            >
              <Plus className="size-3.5" />
              {t('addInstallment')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
