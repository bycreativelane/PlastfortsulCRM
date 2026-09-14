'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { fromISO, toISO } from '@/lib/calendar';
import type { AgendaItem } from '@/lib/dashboard/agenda';
import { dayBounds, type BusinessHours } from '@/lib/hours';
import {
  allDayItems,
  durationOf,
  hourSlots,
  laneOf,
  positionOf,
  timedItems,
  overflowOf,
} from '@/lib/agenda/view';
import { cn } from '@/lib/utils';

import { AgendaChip } from './agenda-chip';

/**
 * O eixo de horas — a peça que faltava no produto inteiro.
 *
 * A semana e o dia são a MESMA grade com um número de colunas diferente, e
 * escrevê-las duas vezes seria manter dois eixos em sincronia para ganhar
 * zero: as duas leem os mesmos limites, posicionam com a mesma conta e
 * desenham a mesma faixa de "o dia todo". Sete colunas ou uma é um
 * argumento, não um componente.
 *
 * ------------------------------------------------------------------
 * ONDE O EIXO COMEÇA E TERMINA
 * ------------------------------------------------------------------
 *
 * Nos limites do expediente da conta (§B), mais uma hora de folga de cada
 * lado — não em 00:00–24:00. Um dia inteiro desenhado por igual gasta dois
 * terços da altura em horas que a empresa está fechada, e espreme as oito
 * em que ela trabalha na faixa do meio.
 *
 * E `dayBounds` recebe os dias EM TELA, não a semana inteira: uma exceção
 * de sábado não deve esticar a grade de uma semana que não mostra sábado.
 *
 * ------------------------------------------------------------------
 * A FAIXA DE CIMA NÃO É UM DETALHE
 * ------------------------------------------------------------------
 *
 * Metade da agenda não tem hora — aniversário, campanha, fechamento
 * previsto, e toda tarefa marcada só para o dia. Um eixo de horas não tem
 * onde pôr isso, e a tentação é jogar tudo às 00:00, que inventa uma
 * precisão que o dado não tem e ainda empilha sete itens num canto.
 * A faixa acima do eixo é onde essas coisas são verdadeiras.
 */
export function TimeGrid({
  days,
  items,
  hours,
  onSelectTask,
  onPickDay,
  renderHeader,
}: {
  days: string[];
  /** Já filtrados. A grade não decide o que aparece. */
  items: AgendaItem[];
  hours: BusinessHours;
  onSelectTask: (item: AgendaItem) => void;
  /**
   * Levar para o dia inteiro, quando a coluna não cabe o que há nela.
   *
   * É a mesma saída que o "+N" do mês já oferece. Ausente, o excedente
   * ainda é contado — só não é clicável.
   */
  onPickDay?: (iso: string) => void;
  /**
   * O rótulo de cada coluna. Ausente, a faixa inteira não é desenhada.
   *
   * A visão de DIA não passa: com uma coluna só, o rótulo dela é a data,
   * e a data já é o título da faixa de navegação logo acima. Duas linhas
   * dizendo "8 de setembro" uma embaixo da outra são uma banda de cromo
   * cobrando espaço do eixo para repetir o que já foi lido.
   */
  renderHeader?: (iso: string) => React.ReactNode;
}) {
  const t = useTranslations('Agenda');
  const { startHour, endHour } = React.useMemo(
    () => dayBounds(hours, days),
    [hours, days]
  );
  const slots = React.useMemo(
    () => hourSlots(startHour, endHour, hours.slotMinutes),
    [startHour, endHour, hours.slotMinutes]
  );

  const byDay = React.useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const iso of days) map.set(iso, []);
    for (const item of items) map.get(item.day)?.push(item);
    return map;
  }, [days, items]);

  const anyAllDay = days.some(
    (iso) => allDayItems(byDay.get(iso) ?? []).length > 0
  );

  /** As faixas de cada dia — ver `laneOf`. Um dia, um cálculo. */
  const lanes = React.useMemo(() => {
    const map = new Map<string, ReturnType<typeof laneOf>>();
    for (const iso of days) map.set(iso, laneOf(byDay.get(iso) ?? []));
    return map;
  }, [days, byDay]);

  // A altura de uma linha vezes o número de linhas. Fixa em px e não em
  // fração da viewport: a grade rola dentro da página, e uma hora que muda
  // de altura conforme a janela torna impossível comparar dois dias.
  const slotHeight = hours.slotMinutes >= 60 ? 56 : 40;
  const bodyHeight = slots.length * slotHeight;

  /*
   * QUANTAS FAIXAS A COLUNA COMPORTA.
   *
   * Dividir a largura por quantos colidem funciona até três: numa semana
   * de sete colunas isso dá fatias de 60px, e uma fatia de 60px não
   * mostra nem a hora nem o título — mostra uma tira de cor. Medido: três
   * tarefas às 09:00 viravam três slivers ilegíveis.
   *
   * Então a coluna mostra o que cabe e DIZ quantas ficaram, com a mesma
   * saída que o "+N" do mês já dá: leva ao dia, onde a coluna é uma só e
   * as mesmas três aparecem inteiras. Uma regra de excedente no produto,
   * não duas.
   *
   * No dia não há teto porque não há aperto: uma coluna só reparte 640px.
   */
  const maxLanes = days.length === 1 ? 4 : 2;

  /*
   * A LINHA DO AGORA.
   *
   * A coisa que todo calendário tem e esta grade não tinha. Sem ela, "onde
   * eu estou no dia" é uma conta que a pessoa faz de cabeça comparando o
   * relógio do sistema com uma régua de números — e é a pergunta que se faz
   * toda vez que a tela abre.
   *
   * Só desenha no dia que está em tela e dentro do eixo: uma linha às 23h
   * numa grade que termina às 19h seria uma barra colada na borda dizendo
   * algo falso.
   *
   * Reavalia a cada minuto. Um `setInterval` de um segundo redesenharia 60
   * vezes por minuto para mover a linha meio pixel.
   */
  const [nowMinutes, setNowMinutes] = React.useState<number | null>(null);
  const [todayIso, setTodayIso] = React.useState<string | null>(null);

  React.useEffect(() => {
    const tick = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
      setTodayIso(toISO(now));
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const nowTop =
    nowMinutes !== null &&
    nowMinutes >= startHour * 60 &&
    nowMinutes <= endHour * 60
      ? ((nowMinutes - startHour * 60) / ((endHour - startHour) * 60)) * 100
      : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border">
      {/* Cabeçalho: o rótulo de cada dia, alinhado às colunas de baixo. */}
      {renderHeader ? (
        <div
          className="bg-muted/30 grid border-b"
          style={{
            gridTemplateColumns: `4rem repeat(${days.length}, 1fr)`,
          }}
        >
          <div aria-hidden />
          {days.map((iso) => (
            <div key={iso} className="border-l px-2 py-2 text-center">
              {renderHeader(iso)}
            </div>
          ))}
        </div>
      ) : null}

      {/* A faixa do dia todo, só quando há o que pôr nela. */}
      {anyAllDay ? (
        <div
          className="bg-muted/10 grid border-b"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, 1fr)` }}
        >
          <div className="text-muted-foreground text-2xs px-2 py-1.5">
            {t('allDay')}
          </div>
          {days.map((iso) => (
            /*
              TETO NA FAIXA, e não um "+N".

              Sem ele, oito aniversários numa quinta empurram o eixo de
              horas para fora da tela — a faixa cresce e a grade que a
              pessoa veio ver desaparece.

              Limita a ALTURA e não o número: o "+N" do mês só funciona
              porque a célula é um botão que leva ao dia, e aqui não há
              destino nenhum. Cortar em três deixaria o quarto
              aniversário inalcançável em qualquer lugar do produto.
            */
            <div
              key={iso}
              className="max-h-18 space-y-0.5 overflow-y-auto border-l p-1"
            >
              {allDayItems(byDay.get(iso) ?? []).map((item) => (
                <AgendaChip
                  key={item.id}
                  item={item}
                  density="tight"
                  onSelect={item.kind === 'task' ? onSelectTask : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {/* O eixo. */}
      <div className="overflow-y-auto">
        {/*
          UM DIA NÃO É UMA PÁGINA.

          Com `repeat(1, 1fr)` a coluna do dia comia a largura inteira, e
          uma tarefa de trinta minutos virava uma barra de 1355 × 40 px —
          medido. Proporção de 34 para 1: aquilo lê como uma régua, não
          como um compromisso.

          O teto vale só quando há um dia. Numa semana as sete colunas
          dividem ~195px cada, que é largura de coluna de calendário, e
          apertá-las seria trocar um defeito por outro.

          É a mesma decisão do cal.com por outro caminho: lá nenhuma
          visão tem coluna elástica — a `column_view` mostra seis colunas
          justamente para que um dia sozinho nunca ocupe a tela toda.

          MAS ELE ESTAVA ENCOSTADO À ESQUERDA, e essa metade da decisão
          estava errada. Num monitor de 1900px o dia virava uma faixa de
          704px grudada na margem com mil pixels de nada ao lado — que foi
          o que o Gabriel viu ("mal dimensionada, distribuída"). Um teto
          de largura CENTRALIZADO lê como coluna; o mesmo teto encostado
          lê como página cortada.

          E 56rem em vez de 44: a proporção que o teto protege continua
          protegida (uma tarefa de 30min fica em 896×40, 22 para 1, contra
          34 para 1 sem teto nenhum), e a coluna deixa de parecer estreita
          ao lado do resto da tela.
        */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: `4rem repeat(${days.length}, 1fr)`,
            height: bodyHeight,
            maxWidth: days.length === 1 ? '56rem' : undefined,
            marginInline: days.length === 1 ? 'auto' : undefined,
          }}
        >
          {/*
            A régua de horas.

            O PRIMEIRO RÓTULO NÃO SOBE. Todos usavam `-translate-y-1/2` para
            centrar o texto na linha, e o de cima ficava metade fora do
            scroller: a grade abria mostrando "07:00" cortado ao meio, que é
            a primeira coisa que se lê nela.

            O do topo alinha por baixo da linha; os demais seguem centrados,
            porque para eles existe linha acima e abaixo.
          */}
          <div className="relative">
            {slots.map((slot, i) =>
              // SÓ A HORA CHEIA GANHA NÚMERO. Com meia em meia hora a
              // régua virava uma coluna de vinte e quatro números para um
              // dia com quatro tarefas, e o eixo competia com o conteúdo.
              // A subdivisão continua existindo para posicionar e para o
              // encaixe — ela só não tem mais régua, que é o que o
              // cal.com faz e escreve o porquê.
              slot.endsWith(':00') ? (
                <div
                  key={slot}
                  className={cn(
                    'text-muted-foreground text-2xs absolute right-2 tabular-nums',
                    i > 0 && '-translate-y-1/2'
                  )}
                  style={{ top: (i / slots.length) * 100 + '%' }}
                >
                  {slot}
                </div>
              ) : null
            )}
          </div>

          {days.map((iso) => {
            const timed = timedItems(byDay.get(iso) ?? []);
            const closed = !isOpenDay(hours, iso);
            return (
              <div
                key={iso}
                className={cn(
                  'relative border-l',
                  // Um dia fechado não some da grade — fica visivelmente
                  // fechado. Sumir responderia "não existe sábado", que é
                  // falso e esconde a tarefa que alguém marcou nele.
                  //
                  // LISTRADO, e não cinza liso. Medido na tela: o cinza do
                  // domingo fechado e o véu azul de hoje saíam quase da
                  // mesma cor, e a grade dizia "hoje" em dois dias. Listra
                  // é o sinal de "indisponível" de todo calendário, e um
                  // sinal que não se confunde com tom nenhum.
                  closed &&
                    'bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--muted-foreground)_9%,transparent)_6px_7px)]',
                  // HOJE ganha um véu da cor primária, quase nada. A bolinha
                  // azul no cabeçalho diz qual é o dia; o véu diz isso de
                  // novo a 600px de distância, quando o cabeçalho já saiu
                  // de vista e o olho está no meio da tarde.
                  //
                  // Só com MAIS DE UM dia na tela. O véu é um contraste
                  // entre colunas; na visão de dia não há outra coluna para
                  // contrastar, e ele só acinzentava a grade inteira.
                  days.length > 1 && iso === todayIso && 'bg-primary/[0.05]'
                )}
              >
                {/* Uma linha por HORA, e não por meia hora. Eram
                    vinte e quatro réguas atravessando a coluna inteira;
                    metade delas não separava nada que a pessoa fosse
                    ler. A meia hora continua no cálculo de posição. */}
                {slots.map((slot, i) =>
                  slot.endsWith(':00') ? (
                    <div
                      key={slot}
                      // `border-border` inteiro, e não `/60`: sobre o card
                      // claro o `/60` dava uma régua de ~0,95 de
                      // luminosidade, que some. Sem régua visível a grade
                      // vira uma folha branca com blocos flutuando, e ler
                      // "isto é às 14h" passa a exigir contar a partir da
                      // borda.
                      className="border-border absolute inset-x-0 border-t"
                      style={{ top: (i / slots.length) * 100 + '%' }}
                      aria-hidden
                    />
                  ) : null
                )}
                {/*
                  A LINHA DO AGORA, só na coluna de hoje.
                  `z-20` para passar por cima dos cartões: ela é a régua
                  contra a qual eles são lidos, não mais um deles.
                */}
                {iso === todayIso && nowTop !== null ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                    style={{ top: `${nowTop}%` }}
                  >
                    <span className="bg-danger size-1.5 shrink-0 rounded-full" />
                    <span className="bg-danger h-px flex-1" />
                  </div>
                ) : null}

                {timed.map((item) => {
                  const pos = positionOf(
                    item,
                    startHour,
                    endHour,
                    durationOf(item)
                  );
                  if (!pos) return null;
                  // Fora do teto: não desenha, e o contador abaixo o
                  // conta. A faixa que ele ocuparia fica com o "+N".
                  const laneOfItem = lanes.get(iso)?.get(item.id);
                  if ((laneOfItem?.index ?? 0) >= maxLanes) return null;
                  /*
                    A FAIXA. Dois itens na mesma hora ficavam um EXATAMENTE
                    em cima do outro, e o de baixo sumia — nem o título, nem
                    a existência dele. Numa agenda o conflito de horário é a
                    informação mais cara da tela, e era a única que ela não
                    sabia mostrar.
                  */
                  const lane = laneOfItem;
                  const of = Math.min(lane?.of ?? 1, maxLanes);
                  const index = lane?.index ?? 0;
                  // A altura em PIXELS, que é o que decide se hora e título
                  // cabem em duas linhas. A posição chega em porcentagem;
                  // quem sabe quanto é isso na tela é a grade.
                  const alturaPx = (pos.height / 100) * bodyHeight - 2;
                  // Linhas de título que cabem embaixo da hora: tira os 8px
                  // de respiro vertical e a linha da própria hora, e divide
                  // pelo passo de uma linha de `text-2xs leading-tight`
                  // (11px × 1,25). Arredonda PARA BAIXO — meia linha é a
                  // tira cortada que isto existe para não desenhar.
                  const linhaPx = 11 * 1.25;
                  const titleLines = Math.max(
                    1,
                    Math.floor((alturaPx - 8 - linhaPx) / linhaPx)
                  );
                  return (
                    <AgendaChip
                      key={item.id}
                      item={item}
                      // `block`, e não `tight`: aqui a altura é a duração.
                      // Ver a nota "O BLOCO" em `agenda-chip.tsx` — o
                      // `tight` virou ponto para o mês e levou a semana
                      // junto.
                      density="block"
                      short={alturaPx < 36}
                      titleLines={titleLines}
                      onSelect={item.kind === 'task' ? onSelectTask : undefined}
                      className="absolute z-10 overflow-hidden shadow-xs"
                      style={{
                        top: `calc(${pos.top}% + 1px)`,
                        // `height` e não `minHeight`: com `minHeight` um
                        // título de duas linhas esticava o bloco além da
                        // duração e ele invadia a hora de baixo — o
                        // desenho mentia sobre quanto tempo aquilo ocupa.
                        // Um piso de 18px garante que o mais curto ainda
                        // seja clicável.
                        height: `max(calc(${pos.height}% - 2px), 18px)`,
                        left: `calc(${(index / of) * 100}% + 0.25rem)`,
                        width: `calc(${(1 / of) * 100}% - 0.5rem)`,
                      }}
                    />
                  );
                })}

                {/* O "+N" do excedente, uma vez por colisão. */}
                {overflowOf(timed, lanes.get(iso), maxLanes, {
                  startHour,
                  endHour,
                }).map((group) => (
                  <button
                    key={group.top}
                    type="button"
                    disabled={!onPickDay}
                    onClick={() => onPickDay?.(iso)}
                    title={group.titles.join(', ')}
                    className="bg-muted text-secondary-foreground hover:bg-muted-2 focus-visible:ring-ring text-3xs absolute right-1 z-10 rounded px-1 font-semibold tabular-nums focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none"
                    style={{ top: `calc(${group.top}% + 0.125rem)` }}
                  >
                    +{group.count}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function isOpenDay(hours: BusinessHours, iso: string): boolean {
  const date = fromISO(iso);
  if (!date) return true;
  const exception = hours.exceptions.find((e) => e.date === iso);
  if (exception) return !exception.closed;
  return hours.weekly.some((row) => row.weekday === date.getDay());
}
