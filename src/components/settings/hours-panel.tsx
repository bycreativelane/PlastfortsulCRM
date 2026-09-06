'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarOff, Clock, Globe, Loader2, Plus, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useBusinessHours } from '@/hooks/use-business-hours';
import { toISO } from '@/lib/calendar';
import {
  fromMinutes,
  minutesOf,
  type BusinessHours,
  type HoursException,
} from '@/lib/hours';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FieldLabel } from '@/components/ui/field';
import { OptionSelect } from '@/components/ui/option-select';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Switch } from '@/components/ui/switch';
import { TimeField } from '@/components/ui/time-field';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Horários — o relógio da conta.
 *
 * Esta tela existe porque o produto inteiro só conhecia o DIA. O fuso estava
 * escrito à mão em `lib/automations/local-time.ts`, que dizia em comentário
 * "there is no per-account zone in the schema"; a agenda agrupava no fuso do
 * NAVEGADOR; e não havia nada que soubesse responder "a empresa está aberta
 * agora?". As três coisas passam a sair daqui.
 *
 * UM INTERVALO POR LINHA, e é por isso que não há campo "almoço". Manhã e
 * tarde são dois intervalos do mesmo dia — a mesma forma que a 066 guarda —
 * o que deixa a tela expressar tanto o expediente corrido quanto o partido,
 * quanto o sábado que só abre de manhã, sem um formato privilegiado.
 *
 * SALVA TUDO DE UMA VEZ, por diferença. Editar hora é uma operação de
 * rascunho: quem está montando a semana muda quatro campos antes de estar
 * certo, e um salvamento por campo transformaria isso em dezesseis escritas
 * e quatro estados intermediários inválidos no banco. O botão fica desligado
 * enquanto nada mudou.
 */

/** Domingo a sábado, na ordem de `Date.getDay()` — a mesma da coluna. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** O que a tela edita: a semana, como lista de intervalos por dia. */
type DraftWeek = Record<number, Array<{ opens: string; closes: string }>>;

/**
 * Os fusos oferecidos.
 *
 * `Intl.supportedValuesOf` devolve os ~400 que o runtime conhece, o que é a
 * resposta certa e uma lista impossível de percorrer. Os do Brasil vêm
 * primeiro, nomeados; o resto fica embaixo para quem precisar.
 */
const PRIMARY_ZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
];

function allZones(): string[] {
  try {
    const supported = (
      Intl as typeof Intl & {
        supportedValuesOf?: (key: string) => string[];
      }
    ).supportedValuesOf?.('timeZone');
    if (supported?.length) {
      return supported.filter((zone) => !PRIMARY_ZONES.includes(zone));
    }
  } catch {
    // Runtime antigo: só a lista curta.
  }
  return [];
}

export function HoursPanel() {
  const supabase = createClient();
  const locale = useLocale();
  const t = useTranslations('Settings.hours');
  const { accountId, canEditSettings } = useAuth();
  const { hours, loading, refresh } = useBusinessHours();

  const [timezone, setTimezone] = useState(hours.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(hours.weekStartsOn);
  const [slotMinutes, setSlotMinutes] = useState(hours.slotMinutes);
  const [week, setWeek] = useState<DraftWeek>({});
  const [exceptions, setExceptions] = useState<HoursException[]>([]);
  const [saving, setSaving] = useState(false);

  const otherZones = useMemo(() => allZones(), []);

  const weekdayNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'long' });
    // 2026-02-01 é um domingo, então o índice do passeio é o dia da semana.
    return WEEKDAYS.map((d) => format.format(new Date(2026, 1, 1 + d)));
  }, [locale]);

  // A ordem em que os dias são desenhados segue o primeiro dia da conta —
  // uma semana que começa na segunda tem de ser editada começando na
  // segunda, ou a tela discorda do calendário que ela configura.
  const orderedDays = useMemo(
    () => WEEKDAYS.map((_, i) => (weekStartsOn + i) % 7),
    [weekStartsOn]
  );

  /**
   * O rascunho recomeça quando o banco responde — e depois de cada salvamento.
   *
   * Ajuste DURANTE a renderização e não num efeito. É o padrão que o React
   * documenta para "estado que precisa acompanhar uma prop": o efeito faria
   * o mesmo trabalho um render depois, e nesse render intermediário a tela
   * mostraria o padrão de fábrica como se fosse o horário salvo da conta.
   */
  const [syncedFrom, setSyncedFrom] = useState<BusinessHours | null>(null);
  if (!loading && syncedFrom !== hours) {
    setSyncedFrom(hours);
    setTimezone(hours.timezone);
    setWeekStartsOn(hours.weekStartsOn);
    setSlotMinutes(hours.slotMinutes);
    setWeek(
      WEEKDAYS.reduce<DraftWeek>((acc, weekday) => {
        acc[weekday] = hours.weekly
          .filter((row) => row.weekday === weekday)
          .map(({ opens, closes }) => ({ opens, closes }))
          .sort((a, b) => minutesOf(a.opens) - minutesOf(b.opens));
        return acc;
      }, {})
    );
    setExceptions(hours.exceptions);
  }

  const dirty = useMemo(() => {
    const asKey = (rows: Array<{ opens: string; closes: string }>) =>
      rows.map((r) => `${r.opens}-${r.closes}`).join(',');
    const savedWeek = WEEKDAYS.map((d) =>
      asKey(
        hours.weekly
          .filter((r) => r.weekday === d)
          .map(({ opens, closes }) => ({ opens, closes }))
          .sort((a, b) => minutesOf(a.opens) - minutesOf(b.opens))
      )
    ).join('|');
    const draftWeek = WEEKDAYS.map((d) => asKey(week[d] ?? [])).join('|');

    const asExc = (list: HoursException[]) =>
      list
        .map((e) => `${e.date}-${e.closed}-${e.opens}-${e.closes}-${e.label}`)
        .sort()
        .join('|');

    return (
      timezone !== hours.timezone ||
      weekStartsOn !== hours.weekStartsOn ||
      slotMinutes !== hours.slotMinutes ||
      savedWeek !== draftWeek ||
      asExc(hours.exceptions) !== asExc(exceptions)
    );
  }, [hours, timezone, weekStartsOn, slotMinutes, week, exceptions]);

  /** O erro que o constraint da 066 recusaria, dito antes de tentar. */
  const invalid = useMemo(() => {
    for (const weekday of WEEKDAYS) {
      for (const row of week[weekday] ?? []) {
        if (minutesOf(row.closes) <= minutesOf(row.opens)) return true;
      }
    }
    return exceptions.some(
      (e) =>
        !e.closed &&
        (!e.opens || !e.closes || minutesOf(e.closes) <= minutesOf(e.opens))
    );
  }, [week, exceptions]);

  function addInterval(weekday: number) {
    setWeek((prev) => {
      const rows = prev[weekday] ?? [];
      // Um dia vazio começa às 08:00; um dia que já tem intervalo continua
      // de onde o último parou, que é o que alguém digitaria a seguir.
      const last = rows[rows.length - 1];
      const start = last ? minutesOf(last.closes) + 60 : 8 * 60;
      return {
        ...prev,
        [weekday]: [
          ...rows,
          {
            opens: fromMinutes(Math.min(start, 22 * 60)),
            closes: fromMinutes(Math.min(start + 4 * 60, 23 * 60)),
          },
        ],
      };
    });
  }

  function patchInterval(
    weekday: number,
    index: number,
    patch: Partial<{ opens: string; closes: string }>
  ) {
    setWeek((prev) => ({
      ...prev,
      [weekday]: (prev[weekday] ?? []).map((row, i) =>
        i === index ? { ...row, ...patch } : row
      ),
    }));
  }

  function removeInterval(weekday: number, index: number) {
    setWeek((prev) => ({
      ...prev,
      [weekday]: (prev[weekday] ?? []).filter((_, i) => i !== index),
    }));
  }

  function addException() {
    const today = toISO(new Date());
    if (exceptions.some((e) => e.date === today)) return;
    setExceptions((prev) => [
      ...prev,
      { date: today, closed: true, opens: null, closes: null, label: '' },
    ]);
  }

  async function handleSave() {
    if (!accountId || !dirty || invalid) return;
    setSaving(true);

    // O relógio da conta.
    const account = await supabase
      .from('accounts')
      .update({
        timezone,
        week_starts_on: weekStartsOn,
        slot_minutes: slotMinutes,
      })
      .eq('id', accountId);

    if (account.error) {
      toast.error(t('saveFailed'));
      setSaving(false);
      return;
    }

    // A semana e as exceções, por substituição. Apagar e reinserir em vez
    // de casar linha a linha: a chave natural de um intervalo é (dia, hora
    // de abertura), então mudar a hora de abertura já É outra linha, e a
    // reconciliação seria mais código para o mesmo resultado num conjunto
    // que nunca passa de algumas dezenas de linhas.
    const rows = WEEKDAYS.flatMap((weekday) =>
      (week[weekday] ?? []).map((row) => ({
        account_id: accountId,
        weekday,
        opens_at: row.opens,
        closes_at: row.closes,
      }))
    );

    const clearWeek = await supabase
      .from('business_hours')
      .delete()
      .eq('account_id', accountId)
      .is('user_id', null);

    if (clearWeek.error) {
      toast.error(t('saveFailed'));
      setSaving(false);
      return;
    }

    if (rows.length > 0) {
      const inserted = await supabase.from('business_hours').insert(rows);
      if (inserted.error) {
        toast.error(t('saveFailed'));
        setSaving(false);
        return;
      }
    }

    await supabase
      .from('business_hours_exceptions')
      .delete()
      .eq('account_id', accountId)
      .is('user_id', null);

    if (exceptions.length > 0) {
      await supabase.from('business_hours_exceptions').insert(
        exceptions.map((e) => ({
          account_id: accountId,
          on_date: e.date,
          closed: e.closed,
          opens_at: e.closed ? null : e.opens,
          closes_at: e.closed ? null : e.closes,
          label: e.label || null,
        }))
      );
    }

    await refresh();
    setSaving(false);
    toast.success(t('saveSuccess'));
  }

  const readOnly = !canEditSettings;

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-(--dur-3)">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {readOnly && (
        <p className="text-muted-foreground mb-4 text-xs">
          {t('adminOnlyHint')}
        </p>
      )}

      <div className="space-y-4">
        {/* ---- O fuso e a forma da semana ---- */}
        <Panel>
          <PanelHeader>
            <div className="min-w-0">
              <PanelTitle className="flex items-center gap-2">
                <Globe className="text-primary size-4" />
                {t('clock')}
              </PanelTitle>
              <PanelSub>{t('clockDesc')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <FieldLabel>{t('timezone')}</FieldLabel>
              <OptionSelect
                value={timezone}
                onValueChange={setTimezone}
                disabled={readOnly || loading}
                className="border-border bg-muted text-foreground"
              >
                {PRIMARY_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.split('/')[1]?.replace(/_/g, ' ') ?? zone}
                  </option>
                ))}
                {otherZones.length > 0 && (
                  <optgroup label={t('otherZones')}>
                    {otherZones.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </optgroup>
                )}
              </OptionSelect>
            </div>

            <div className="grid gap-2">
              <FieldLabel>{t('weekStart')}</FieldLabel>
              <OptionSelect
                value={String(weekStartsOn)}
                onValueChange={(v) => setWeekStartsOn(Number(v))}
                disabled={readOnly || loading}
                className="border-border bg-muted text-foreground"
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={String(d)}>
                    {weekdayNames[d]}
                  </option>
                ))}
              </OptionSelect>
            </div>

            <div className="grid gap-2">
              <FieldLabel>{t('slot')}</FieldLabel>
              <OptionSelect
                value={String(slotMinutes)}
                onValueChange={(v) => setSlotMinutes(Number(v))}
                disabled={readOnly || loading}
                className="border-border bg-muted text-foreground"
              >
                {[15, 30, 60].map((m) => (
                  <option key={m} value={String(m)}>
                    {t('slotMinutes', { minutes: m })}
                  </option>
                ))}
              </OptionSelect>
            </div>
          </PanelBody>
        </Panel>

        {/* ---- A semana ---- */}
        <Panel>
          <PanelHeader>
            <div className="min-w-0">
              <PanelTitle className="flex items-center gap-2">
                <Clock className="text-primary size-4" />
                {t('week')}
              </PanelTitle>
              <PanelSub>{t('weekDesc')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody className="divide-border/70 divide-y">
            {orderedDays.map((weekday) => {
              const rows = week[weekday] ?? [];
              return (
                <div
                  key={weekday}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4"
                >
                  <div className="flex w-40 shrink-0 items-center gap-2 pt-1">
                    <Switch
                      checked={rows.length > 0}
                      disabled={readOnly}
                      onCheckedChange={(on) => {
                        if (on) addInterval(weekday);
                        else setWeek((prev) => ({ ...prev, [weekday]: [] }));
                      }}
                      aria-label={weekdayNames[weekday]}
                    />
                    <span
                      className={cn(
                        'text-sm font-medium capitalize',
                        rows.length === 0 && 'text-muted-foreground'
                      )}
                    >
                      {weekdayNames[weekday]}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    {rows.length === 0 ? (
                      <p className="text-muted-foreground pt-1.5 text-xs">
                        {t('closed')}
                      </p>
                    ) : (
                      rows.map((row, index) => {
                        const bad =
                          minutesOf(row.closes) <= minutesOf(row.opens);
                        return (
                          <div
                            key={index}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <TimeField
                              value={row.opens}
                              onValueChange={(v) =>
                                patchInterval(weekday, index, { opens: v })
                              }
                              step={slotMinutes}
                              disabled={readOnly}
                              className="w-28"
                              aria-label={t('opensAt')}
                            />
                            <span className="text-muted-foreground text-xs">
                              {t('to')}
                            </span>
                            <TimeField
                              value={row.closes}
                              onValueChange={(v) =>
                                patchInterval(weekday, index, { closes: v })
                              }
                              step={slotMinutes}
                              disabled={readOnly}
                              className={cn(
                                'w-28',
                                bad && '[&_input]:border-danger'
                              )}
                              aria-label={t('closesAt')}
                            />
                            {bad && (
                              <span className="text-danger text-xs">
                                {t('invalidRange')}
                              </span>
                            )}
                            {!readOnly && (
                              <button
                                type="button"
                                onClick={() => removeInterval(weekday, index)}
                                aria-label={t('removeInterval')}
                                className="text-muted-foreground hover:text-danger hover:bg-muted grid size-7 place-items-center rounded-md transition-colors"
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}

                    {!readOnly && rows.length > 0 && (
                      <button
                        type="button"
                        onClick={() => addInterval(weekday)}
                        className="text-primary hover:bg-primary-soft -ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors"
                      >
                        <Plus className="size-3" />
                        {t('addInterval')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </PanelBody>
        </Panel>

        {/* ---- Feriados e dias diferentes ---- */}
        <Panel>
          <PanelHeader>
            <div className="min-w-0">
              <PanelTitle className="flex items-center gap-2">
                <CalendarOff className="text-primary size-4" />
                {t('exceptions')}
              </PanelTitle>
              <PanelSub>{t('exceptionsDesc')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody className="space-y-3">
            {exceptions.length === 0 && (
              <p className="text-muted-foreground text-xs">
                {t('noExceptions')}
              </p>
            )}

            {exceptions
              .slice()
              .sort((a, b) => (a.date < b.date ? -1 : 1))
              .map((exception) => {
                const index = exceptions.indexOf(exception);
                return (
                  <div
                    key={`${exception.date}-${index}`}
                    className="border-border/70 flex flex-wrap items-center gap-2 rounded-lg border p-2"
                  >
                    <DateField
                      value={exception.date}
                      onValueChange={(v) =>
                        setExceptions((prev) =>
                          prev.map((e, i) =>
                            i === index ? { ...e, date: v } : e
                          )
                        )
                      }
                      disabled={readOnly}
                      className="w-36"
                      aria-label={t('exceptionDate')}
                    />

                    <input
                      type="text"
                      data-slot="input"
                      value={exception.label ?? ''}
                      disabled={readOnly}
                      placeholder={t('exceptionLabel')}
                      onChange={(e) =>
                        setExceptions((prev) =>
                          prev.map((row, i) =>
                            i === index
                              ? { ...row, label: e.target.value }
                              : row
                          )
                        )
                      }
                      className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-field/30 h-8 min-w-0 flex-1 rounded-lg border bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50"
                    />

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!exception.closed}
                        disabled={readOnly}
                        onCheckedChange={(open) =>
                          setExceptions((prev) =>
                            prev.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    closed: !open,
                                    opens: open ? (row.opens ?? '08:00') : null,
                                    closes: open
                                      ? (row.closes ?? '12:00')
                                      : null,
                                  }
                                : row
                            )
                          )
                        }
                        aria-label={t('exceptionOpen')}
                      />
                      <span className="text-muted-foreground text-xs">
                        {exception.closed ? t('closed') : t('exceptionOpen')}
                      </span>
                    </div>

                    {!exception.closed && (
                      <div className="flex items-center gap-2">
                        <TimeField
                          value={exception.opens ?? ''}
                          onValueChange={(v) =>
                            setExceptions((prev) =>
                              prev.map((row, i) =>
                                i === index ? { ...row, opens: v } : row
                              )
                            )
                          }
                          step={slotMinutes}
                          disabled={readOnly}
                          className="w-28"
                          aria-label={t('opensAt')}
                        />
                        <span className="text-muted-foreground text-xs">
                          {t('to')}
                        </span>
                        <TimeField
                          value={exception.closes ?? ''}
                          onValueChange={(v) =>
                            setExceptions((prev) =>
                              prev.map((row, i) =>
                                i === index ? { ...row, closes: v } : row
                              )
                            )
                          }
                          step={slotMinutes}
                          disabled={readOnly}
                          className="w-28"
                          aria-label={t('closesAt')}
                        />
                      </div>
                    )}

                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() =>
                          setExceptions((prev) =>
                            prev.filter((_, i) => i !== index)
                          )
                        }
                        aria-label={t('removeException')}
                        className="text-muted-foreground hover:text-danger hover:bg-muted ml-auto grid size-7 place-items-center rounded-md transition-colors"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}

            {!readOnly && (
              <Button variant="outline" size="sm" onClick={addException}>
                <Plus className="size-4" />
                {t('addException')}
              </Button>
            )}
          </PanelBody>
        </Panel>

        {!readOnly && (
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !dirty || invalid}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
            {invalid && (
              <span className="text-danger text-xs">{t('fixBeforeSave')}</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
