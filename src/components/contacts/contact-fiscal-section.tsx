'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  formatZip,
  normalizeZip,
  TAXPAYER_INDICATORS,
  type FiscalDraft,
} from '@/lib/contacts/fiscal';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';

/**
 * "DADOS FISCAIS E ENDEREÇO" — a seção do contato que o pedido no Bling
 * precisa (Fase 3, 085).
 *
 * Controlada pelo formulário, como a gaveta dos dados comerciais ao lado:
 * quem grava é o `handleSubmit` de lá, numa escrita só. O CPF/CNPJ, a cidade
 * e a UF continuam na seção comercial (040) — a dica diz isso, para ninguém
 * procurar o documento aqui.
 */

const CAMPO = 'bg-muted border-border text-foreground placeholder:text-muted-foreground';

export function ContactFiscalSection({
  open,
  onToggle,
  value,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  value: FiscalDraft;
  onChange: (patch: Partial<FiscalDraft>) => void;
}) {
  const t = useTranslations('Contacts.form.fiscal');
  const cepIncompleto =
    value.zipCode !== '' && normalizeZip(value.zipCode).length !== 8;

  return (
    <div className="border-border rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-secondary-foreground flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold pointer-coarse:py-3"
      >
        <ChevronDown
          className={`size-4 transition-transform duration-(--dur-2) ${open ? '' : '-rotate-90'}`}
        />
        {t('title')}
      </button>

      {open && (
        <div className="border-border @container space-y-3 border-t p-3">
          <p className="text-muted-foreground text-2xs">{t('hint')}</p>

          <div className="grid gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">{t('personType')}</span>
            <div className="flex flex-wrap gap-1.5">
              {(['F', 'J'] as const).map((tipo) => (
                <ChoiceChip
                  key={tipo}
                  active={value.personType === tipo}
                  onClick={() => onChange({ personType: value.personType === tipo ? '' : tipo })}
                >
                  {t(tipo === 'F' ? 'personF' : 'personJ')}
                </ChoiceChip>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
            <FieldRow label={t('tradeName')} htmlFor="cf-trade-name">
              <Input
                id="cf-trade-name"
                value={value.tradeName}
                maxLength={120}
                onChange={(e) => onChange({ tradeName: e.target.value })}
                className={CAMPO}
              />
            </FieldRow>
            <FieldRow label={t('rg')} htmlFor="cf-rg">
              <Input
                id="cf-rg"
                value={value.rg}
                maxLength={20}
                onChange={(e) => onChange({ rg: e.target.value })}
                className={CAMPO}
              />
            </FieldRow>
          </div>

          <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
            <FieldRow label={t('taxpayer')} htmlFor="cf-taxpayer">
              <OptionSelect
                id="cf-taxpayer"
                value={value.taxpayerIndicator}
                onValueChange={(v) =>
                  onChange({ taxpayerIndicator: v as FiscalDraft['taxpayerIndicator'] })
                }
                className={CAMPO}
              >
                <option value="">{t('taxpayerNone')}</option>
                {TAXPAYER_INDICATORS.map((codigo) => (
                  <option key={codigo} value={codigo}>
                    {`${codigo} · ${t(`taxpayer${codigo}`)}`}
                  </option>
                ))}
              </OptionSelect>
            </FieldRow>
            <FieldRow label={t('stateRegistration')} htmlFor="cf-ie">
              <Input
                id="cf-ie"
                value={value.stateRegistration}
                maxLength={30}
                onChange={(e) => onChange({ stateRegistration: e.target.value })}
                className={CAMPO}
              />
            </FieldRow>
          </div>

          <div className="grid grid-cols-1 gap-3 @xs:grid-cols-[8rem_minmax(0,1fr)]">
            <FieldRow label={t('zipCode')} htmlFor="cf-zip">
              <Input
                id="cf-zip"
                value={value.zipCode}
                inputMode="numeric"
                maxLength={9}
                onChange={(e) => onChange({ zipCode: e.target.value })}
                onBlur={(e) => onChange({ zipCode: formatZip(e.target.value) })}
                aria-invalid={cepIncompleto || undefined}
                className={CAMPO}
              />
              {cepIncompleto ? (
                <p className="text-danger-ink text-2xs">{t('zipIncomplete')}</p>
              ) : null}
            </FieldRow>
            <FieldRow label={t('street')} htmlFor="cf-street">
              <Input
                id="cf-street"
                value={value.street}
                maxLength={120}
                onChange={(e) => onChange({ street: e.target.value })}
                className={CAMPO}
              />
            </FieldRow>
          </div>

          <div className="grid grid-cols-1 gap-3 @xs:grid-cols-[6rem_minmax(0,1fr)]">
            <FieldRow label={t('streetNumber')} htmlFor="cf-number">
              <Input
                id="cf-number"
                value={value.streetNumber}
                maxLength={20}
                onChange={(e) => onChange({ streetNumber: e.target.value })}
                className={CAMPO}
              />
            </FieldRow>
            <FieldRow label={t('complement')} htmlFor="cf-complement">
              <Input
                id="cf-complement"
                value={value.complement}
                maxLength={60}
                onChange={(e) => onChange({ complement: e.target.value })}
                className={CAMPO}
              />
            </FieldRow>
          </div>

          <FieldRow label={t('district')} htmlFor="cf-district">
            <Input
              id="cf-district"
              value={value.district}
              maxLength={60}
              onChange={(e) => onChange({ district: e.target.value })}
              className={CAMPO}
            />
          </FieldRow>

          <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
            <FieldRow label={t('nfeEmail')} htmlFor="cf-nfe-email">
              <Input
                id="cf-nfe-email"
                type="email"
                value={value.nfeEmail}
                maxLength={120}
                onChange={(e) => onChange({ nfeEmail: e.target.value })}
                className={CAMPO}
              />
            </FieldRow>
            <FieldRow label={t('landline')} htmlFor="cf-landline">
              <Input
                id="cf-landline"
                value={value.landlinePhone}
                inputMode="tel"
                maxLength={30}
                onChange={(e) => onChange({ landlinePhone: e.target.value })}
                className={CAMPO}
              />
            </FieldRow>
          </div>
        </div>
      )}
    </div>
  );
}
