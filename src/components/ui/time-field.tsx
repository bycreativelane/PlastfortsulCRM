'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { fromMinutes, minutesOf } from '@/lib/hours';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * O par que faltava do `DateField`.
 *
 * Pelo mesmo motivo daquele arquivo, e vale repetir porque o motivo é o que
 * decide a forma: `<input type="time">` entrega o painel ao navegador, e o
 * navegador pinta o dele — seguindo a preferência clara/escura do SISTEMA
 * OPERACIONAL, não a do app. Uma conta no tema claro sobre um Windows escuro
 * abre um relógio escuro no meio de um formulário branco, e nada disso é
 * alcançável por CSS.
 *
 * O QUE SE MANTÉM DO NATIVO: dá para digitar. Quem já sabe que é às 14h
 * digita "14" e vai embora; a lista é o segundo caminho, para quem está
 * escolhendo em vez de saber. `1430`, `14:30`, `14h30`, `2:30 PM` e `14`
 * chegam todos em `14:30` ou `14:00` — a entrada é generosa de propósito,
 * porque digitar hora é a parte chata de marcar um compromisso.
 *
 * Valores entram e saem como `HH:MM` (24 h), que é a forma que uma coluna
 * TIME do Postgres aceita e que `lib/hours.ts` compara. A EXIBIÇÃO segue o
 * locale: quem lê em `en` vê `2:30 PM` e continua podendo digitar `14:30`.
 */

interface TimeFieldProps {
  /** `HH:MM` em 24 h, ou string vazia para "sem hora". */
  value: string;
  onValueChange: (value: string) => void;
  /** Passo da lista, em minutos. O padrão é o `slot_minutes` da conta. */
  step?: number;
  /** Primeira e última hora oferecidas na lista. Digitar ignora os dois. */
  minHour?: number;
  maxHour?: number;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * O que alguém pode ter digitado, em minutos depois da meia-noite.
 *
 * Deliberadamente permissivo: qualquer coisa com um ou dois números e um
 * sufixo opcional de meridiano. O que NÃO se aceita é o que não tem leitura
 * única — `1` é uma hora, `130` é 1:30, mas `13030` não é nada.
 */
export function parseTimeInput(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const meridiem = /(^|\s|\d)(am|pm)\.?$/.exec(text)?.[2] ?? null;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return null;

  let hour: number;
  let minute: number;

  if (digits.length <= 2) {
    // "14" é uma hora cheia. "9" também.
    hour = Number(digits);
    minute = 0;
  } else if (digits.length === 3) {
    // "930" é 9:30 — nunca 93:0.
    hour = Number(digits.slice(0, 1));
    minute = Number(digits.slice(1));
  } else if (digits.length === 4) {
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2));
  } else {
    return null;
  }

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  // 24:00 é meia-noite do dia seguinte, e um campo de hora de um dia não
  // tem como dizer isso — recusar é mais honesto que dobrar para 00:00.
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** `HH:MM` no formato do locale — `14:30` em pt-BR, `2:30 PM` em en. */
export function formatTime(hhmm: string, locale: string): string {
  const minutes = minutesOf(hhmm);
  if (minutes < 0) return '';
  // Um `Date` qualquer: só as horas e os minutos são lidos, e o dia nunca
  // atravessa fuso porque nada aqui é serializado.
  const date = new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function TimeField({
  value,
  onValueChange,
  step = 30,
  minHour = 0,
  maxHour = 24,
  id,
  disabled,
  className,
  'aria-label': ariaLabel,
}: TimeFieldProps) {
  const t = useTranslations('TimeField');

  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [typing, setTyping] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  // O campo espelha o valor, exceto enquanto está sendo digitado — aí o
  // meio-texto tem de sobreviver aos re-renders.
  const shown = typing ? text : value;

  const options = React.useMemo(() => {
    const out: string[] = [];
    const safeStep = step > 0 ? step : 30;
    for (let m = minHour * 60; m < maxHour * 60; m += safeStep) {
      out.push(fromMinutes(m));
    }
    return out;
  }, [step, minHour, maxHour]);

  // Abrir a lista já na hora escolhida. Sem isto, marcar 17:00 começa a
  // rolagem à meia-noite e a opção certa está a trinta e quatro linhas.
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function commit(raw: string) {
    setTyping(false);
    if (!raw.trim()) {
      onValueChange('');
      return;
    }
    const minutes = parseTimeInput(raw);
    // Ilegível: devolve o valor anterior ao campo em vez de apagá-lo. Quem
    // digitou errado quis dizer alguma coisa; perder o que já estava lá é a
    // punição errada.
    onValueChange(minutes === null ? value : fromMinutes(minutes));
  }

  function pick(hhmm: string) {
    onValueChange(hhmm);
    setTyping(false);
    setOpen(false);
  }

  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        data-slot="input"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={t('placeholder')}
        value={shown}
        onChange={(e) => {
          setTyping(true);
          setText(e.target.value);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-field/30 h-8 w-full min-w-0 rounded-lg border bg-transparent py-1 pr-9 pl-2.5 text-base tabular-nums transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          aria-label={t('openList')}
          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
        >
          <Clock className="size-4" />
        </PopoverTrigger>

        <PopoverContent align="end" className="w-auto p-1">
          <div
            ref={listRef}
            role="listbox"
            className="max-h-56 w-28 overflow-y-auto"
          >
            {options.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={option === value}
                data-selected={option === value}
                onClick={() => pick(option)}
                className={cn(
                  'hover:bg-muted w-full rounded-md px-2 py-1 text-left text-sm tabular-nums transition-colors',
                  option === value &&
                    'bg-primary-soft text-primary font-semibold'
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="border-border/70 mt-1 border-t pt-1">
            <button
              type="button"
              onClick={() => pick('')}
              className="text-muted-foreground hover:text-foreground text-2xs w-full rounded-md px-1.5 py-0.5 text-left font-medium transition-colors"
            >
              {t('clear')}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
