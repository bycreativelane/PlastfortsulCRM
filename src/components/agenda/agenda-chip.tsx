'use client';

import * as React from 'react';
import Link from 'next/link';

import { AGENDA_TONE, type AgendaItem } from '@/lib/dashboard/agenda';
import { cn } from '@/lib/utils';

import { KIND_ICON, TONE_BLOCK, TONE_CHIP, TONE_DOT } from './tokens';

/**
 * Um item da agenda, do tamanho que a tela couber.
 *
 * As três telas desenham a MESMA linha em três larguras: no mês ela é uma
 * tira de 18px dentro de uma célula, na semana uma caixa numa coluna de um
 * sétimo, no dia uma faixa larga. O que muda é o espaço, não o conteúdo —
 * então o componente é um só e a densidade é um parâmetro.
 *
 * Uma tarefa ABRE em vez de navegar: `onSelect` recebe o item e a página
 * põe `?task=<id>` na URL, que é o que o diálogo escuta. Os outros seis
 * tipos continuam sendo links de verdade (`href`), porque o destino deles é
 * outra tela e não uma gaveta.
 */
export function AgendaChip({
  item,
  density = 'comfortable',
  short = false,
  titleLines = 2,
  onSelect,
  interactive = true,
  className,
  style,
}: {
  item: AgendaItem;
  /**
   * `tight` — um marcador dentro da célula do mês ou da faixa "dia todo".
   * `comfortable` — uma linha solta, fora de grade.
   * `block` — um compromisso POSICIONADO na grade de horas, cuja altura é
   *   a duração. Ver a nota "BLOCO" abaixo.
   */
  density?: 'tight' | 'comfortable' | 'block';
  /**
   * Só para `block`: o bloco é baixo demais para duas linhas (menos de
   * ~36px) e hora e título vão lado a lado. Quem sabe a altura em pixels é
   * a grade, não o chip — a posição chega em porcentagem.
   */
  short?: boolean;
  /**
   * Só para `block`: quantas linhas de título CABEM embaixo da hora.
   *
   * Um `line-clamp-2` fixo cortava a segunda linha AO MEIO num bloco de
   * trinta minutos — 40px têm lugar para a hora e uma linha, e a segunda
   * aparecia como uma tira de meio caractere na borda de baixo. O número
   * vem da altura real; o chip só obedece.
   */
  titleLines?: number;
  onSelect?: (item: AgendaItem) => void;
  /**
   * `false` quando o chip está DENTRO de outro controle.
   *
   * A célula do mês é um `<button>`, e um `<a>` ali é aninhamento inválido
   * e dois cliques num só.
   */
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = KIND_ICON[item.kind];
  const tight = density === 'tight';
  const block = density === 'block';

  /*
   * NO MÊS, PONTO; NA GRADE DE HORAS, BLOCO.
   *
   * ------------------------------------------------------------------
   * O QUE ESTAVA ERRADO, COM PRINT
   * ------------------------------------------------------------------
   *
   * O mês desenhava cada item como uma BARRA PREENCHIDA de âmbar. Com
   * quatro tarefas na semana o resultado é o print que o Gabriel mandou:
   * no claro, tiras amarelas de ponta a ponta; no escuro, lajes marrons
   * com o texto por cima. Ele resumiu em "mal dá pra ver as coisas".
   *
   * Três coisas somadas: âmbar quer dizer "uma pessoa precisa agir" e
   * TODA tarefa é isso, então a cor deixa de separar qualquer coisa;
   * preenchimento é o canal mais forte que existe e estava sendo gasto na
   * coisa mais repetida da tela; e texto sobre fundo tingido lê pior do
   * que sobre a própria célula.
   *
   * No mês o item não tem duração — ele é um MARCADOR de que há algo
   * naquele dia. Então vira ponto + hora + título, que é o que todo
   * calendário faz com um evento com hora, e a cor volta a significar
   * alguma coisa por aparecer em pouca quantidade.
   *
   * Na semana e no dia o bloco PREENCHIDO continua, e ali ele está certo:
   * lá o retângulo tem altura proporcional à duração — ele não é enfeite,
   * é a própria informação de quanto tempo aquilo ocupa.
   *
   * ------------------------------------------------------------------
   * O BLOCO — e o defeito que o parágrafo de cima prometia não ter
   * ------------------------------------------------------------------
   *
   * A frase acima era verdade na intenção e falsa na tela. A grade de
   * horas desenhava os compromissos com `density="tight"`, e quando o
   * `tight` virou ponto para o mês, a SEMANA virou ponto junto: uma
   * reunião de uma hora aparecia como uma linha de texto de 18px com uma
   * bolinha, solta no meio de uma faixa vazia. A duração — a única coisa
   * que uma grade de horas sabe mostrar e uma lista não — tinha sumido.
   *
   * Por isso `block` é uma densidade própria, e não um apelido de outra:
   * o mês, a faixa "dia todo" e a grade de horas fazem três perguntas
   * diferentes, e emprestar o desenho de uma para a outra é como uma
   * mudança feita para uma quebra a outra sem ninguém ver.
   *
   * O bloco é fundo claro + barra de cor na borda esquerda (ver
   * `TONE_BLOCK`), hora em cima e título embaixo — ou lado a lado, quando
   * o bloco é baixo demais para duas linhas.
   */
  // Concluída perde a cor: âmbar quer dizer "uma pessoa precisa agir", e
  // uma tarefa fechada não pede nada. Mesmo idioma da linha da lista
  // (`task-row.tsx`), e obedece à regra do espelho da Google — concluída
  // não some da agenda.
  const toneKey = item.done ? 'neutral' : AGENDA_TONE[item.kind];
  const tone = tight
    ? 'text-secondary-foreground hover:bg-muted'
    : block
      ? TONE_BLOCK[toneKey]
      : TONE_CHIP[toneKey];

  /*
   * `interactive` existe por causa da célula do mês, que é um `<button>`.
   *
   * O comentário do `month-view.tsx` já defendia não passar `onSelect`
   * ali — "botão dentro de botão" — e não percebeu que sem `onSelect` o
   * ramo do `<Link>` dispara igual, porque toda tarefa tem `href`. Um
   * `<a>` dentro de um `<button>` é aninhamento inválido E dois cliques
   * num só.
   */
  const clickable = Boolean(onSelect) || (interactive && Boolean(item.href));

  const inner = block ? (
    // Duas linhas quando cabem: a HORA é o que se lê primeiro numa grade
    // (é por ela que o olho acha o bloco), e o título ganha a largura
    // inteira em vez de dividir a linha com "09:00". Baixo demais, lado a
    // lado — como no mês, mas sobre o fundo do bloco.
    <>
      {item.time ? (
        <span
          className={cn(
            'shrink-0 tabular-nums opacity-75',
            short ? 'mr-1' : 'block'
          )}
        >
          {item.time}
        </span>
      ) : null}
      <span
        className={cn(
          'font-medium',
          short || titleLines <= 1 ? 'truncate' : 'break-words',
          item.done && 'line-through'
        )}
        style={
          short || titleLines <= 1
            ? undefined
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: titleLines,
                overflow: 'hidden',
              }
        }
      >
        {item.title}
      </span>
    </>
  ) : (
    <>
      {tight ? (
        // O PONTO no lugar do ícone: numa tira de 18px, o glifo de tipo e
        // o ponto de tom seriam dois marcadores disputando o mesmo papel,
        // e o que a célula precisa responder é "tem coisa aqui, desta
        // natureza". O tipo continua a um clique, no dia.
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            TONE_DOT[toneKey],
            item.done && 'opacity-60'
          )}
        />
      ) : (
        <Icon className="size-3.5 shrink-0" />
      )}
      {item.time ? (
        <span
          className={cn(
            'shrink-0 font-medium tabular-nums',
            tight ? 'text-muted-foreground' : 'opacity-80'
          )}
        >
          {item.time}
        </span>
      ) : null}
      <span
        className={cn(
          'truncate',
          item.done && 'line-through',
          item.done && tight && 'text-muted-foreground'
        )}
      >
        {item.title}
      </span>
    </>
  );

  const classes = cn(
    'w-full rounded-md text-left',
    block
      ? cn(
          // `border-l-[3px]`: a barra de tom. O resto da borda não existe —
          // o bloco é separado da grade pelo fundo, e uma moldura inteira
          // em volta de cada compromisso vira um quadriculado.
          'text-2xs border-l-[3px] px-1.5 leading-tight',
          short ? 'flex items-center py-0.5' : 'flex flex-col py-1'
        )
      : cn(
          'flex items-center gap-1.5',
          tight ? 'px-1 py-0.5 text-2xs' : 'px-2 py-1 text-xs'
        ),
    tone,
    clickable &&
      'hover:brightness-95 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
    className
  );

  // O clique que abre a gaveta ganha do link. Uma tarefa TEM href — aponta
  // para `/agenda?task=<id>`, que é exatamente esta tela — então seguir o
  // link recarregaria a página inteira para chegar onde já se está.
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(item)}
        className={classes}
        style={style}
        title={item.title}
      >
        {inner}
      </button>
    );
  }

  if (interactive && item.href) {
    return (
      <Link
        href={item.href}
        className={classes}
        style={style}
        title={item.title}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={classes} style={style} title={item.title}>
      {inner}
    </div>
  );
}
