import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Ninguém reescreve à mão um átomo que já existe.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE TESTE
 * ------------------------------------------------------------------
 *
 * O inventário de 7 de setembro de 2026 encontrou o mesmo contador escrito
 * seis vezes e o mesmo ladrilho de ícone escrito treze — com quatro
 * escritas diferentes para a mesma medida, nenhuma delas com um comentário
 * defendendo o desvio. Não eram decisões; eram digitações.
 *
 * Extrair `CountBadge` e `IconTile` resolve o passado. Este teste resolve o
 * futuro, que é a parte que sempre volta: um componente novo é escrito por
 * quem não sabe que o átomo existe, e nada no compilador, no lint ou nos
 * outros 1800 testes tem o que dizer sobre isso.
 *
 * ------------------------------------------------------------------
 * O QUE É PROCURADO, E O QUE NÃO É
 * ------------------------------------------------------------------
 *
 * Só a MEDIDA canônica de cada um, não a intenção. `h-4.5 min-w-4.5` com
 * `rounded-full` é um contador em qualquer escrita; um quadrado tingido de
 * 28px com `place-items-center` é um ladrilho. Um `size-7` sozinho não é
 * nada e não é procurado — a busca precisa errar para o lado de deixar
 * passar, senão vira ruído e alguém a desliga.
 *
 * Botões de ícone estão FORA de propósito: um ícone que é a ação pede
 * `<Button variant="ghost" size="icon">`, não `IconTile`, e confundir os
 * dois foi o que fez o ladrilho parecer um problema maior do que era.
 */

const SRC = join(process.cwd(), 'src');

/** A pílula de contagem: altura e largura mínima da casa, redonda. */
const HAND_ROLLED_COUNT = /h-4\.5[^"'`]*min-w-4\.5[^"'`]*rounded-full/;

/**
 * O ladrilho: quadrado com preenchimento tonal EM REPOUSO e ícone centrado.
 *
 * O `(?<![\w:-])` é o que separa um ladrilho de um botão de ícone. Sem ele,
 * `hover:bg-muted` casa com `bg-muted` e a busca acusa toda a família de
 * botões fantasma — que é exatamente a peça que NÃO deve virar `IconTile`.
 * Um preenchimento que só existe no hover é um botão; um que existe em
 * repouso é um ladrilho.
 *
 * O SÓLIDO conta também. `bg-human-strong` e `bg-danger-solid` são a mesma
 * peça com a outra pintura — a linha de atenção do painel e o `StatTile`
 * escreviam os dois com as MESMAS palavras de justificativa, cada um no seu
 * arquivo, e nenhuma busca por tons lavados os alcançava.
 */
const TILE_TONE =
  /(?<![\w:-])(bg-muted|bg-auto-soft|bg-human-soft|bg-ok-soft|bg-danger-soft|bg-primary-soft|bg-human-strong|bg-danger-solid|bg-primary)\b/;

/**
 * A FORMA, e ela tem de estar toda numa linha só.
 *
 * Medida e centragem sempre saem juntas, porque juntas elas são a string
 * literal que abre a chamada de `cn`. Deixá-las vagar pela janela fazia a
 * busca casar a marca de 48px das telas de autenticação com o `size-6` do
 * ÍCONE dentro dela, na linha seguinte — duas medidas de dois objetos
 * diferentes lidas como uma.
 */
const TILE_SHAPE =
  /\bsize-[6789]\b[^\n]*(place-items-center|items-center justify-center)|(place-items-center|items-center justify-center)[^\n]*\bsize-[6789]\b/;

/**
 * Um preenchimento que MUDA no hover é um botão.
 *
 * O ladrilho é decorativo e não tem hover nenhum — quem pinta o repouso e
 * repinta no ponteiro está descrevendo uma ação, e a resposta certa para ela
 * é `<Button size="icon">`. É a mesma frase que justifica o `(?<![\w:-])`,
 * levada até o fim: sem isto o botão de salvar do canal da equipe, que é
 * `bg-primary hover:bg-primary-hover`, entra como ladrilho.
 *
 * A checagem é na LINHA da forma, não na janela: o `hook-deliveries` põe o
 * ladrilho dentro de um botão com `hover:bg-muted/50` três linhas acima, e
 * olhar a janela inteira o deixaria escapar.
 */
const IS_BUTTON = /hover:bg-/;

/**
 * Um disco não é um ladrilho.
 *
 * `rounded-full` com um ícone dentro é outro objeto: a marca de excedente
 * de uma pilha de avatares, o selo de uma sugestão. Forçá-los ao raio do
 * `IconTile` mudaria a forma, e a forma é o que os distingue. Ficam de fora
 * por decisão, e não por a busca não os alcançar.
 */
const IS_CIRCLE = /rounded-full/;

/** Quem implementa o átomo precisa citar a medida dele. */
const ALLOWED = new Set([
  'count-badge.tsx',
  'icon-tile.tsx',
  'atoms.test.ts',
]);

/** Comentários explicam a regra; explicar não é infringir. */
function stripComments(source: string): string {
  return (
    source
      // As quebras de linha do bloco são PRESERVADAS. Apagá-las desloca
      // tudo o que vem depois, e o guarda passa a apontar para um
      // comentário dezenas de linhas acima do problema real — foi o que a
      // primeira versão deste teste fez, e um guarda que indica o lugar
      // errado custa mais tempo do que economiza.
      .replace(/\/\*[\s\S]*?\*\//g, (block) =>
        '\n'.repeat((block.match(/\n/g) ?? []).length)
      )
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (ALLOWED.has(entry)) return [];
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function offenders(pattern: RegExp, skip?: RegExp): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    source.split('\n').forEach((line, i) => {
      if (pattern.test(line) && !skip?.test(line)) {
        found.push(`${file.replace(SRC, 'src')}:${i + 1}`);
      }
    });
  }
  return found;
}

/**
 * O ladrilho, procurado numa JANELA de quatro linhas.
 *
 * ------------------------------------------------------------------
 * POR QUE A BUSCA POR LINHA NÃO SERVIA
 * ------------------------------------------------------------------
 *
 * O ladrilho quase nunca cabe numa linha. A escrita real é
 *
 *     className={cn(
 *       'grid size-8 shrink-0 place-items-center rounded-md',
 *       room.is_default ? 'bg-primary-soft text-primary' : 'bg-muted …'
 *     )}
 *
 * — a forma numa linha, o tom na seguinte, porque é assim que o Prettier
 * quebra e é assim que o tom costuma ser condicional. A versão por linha
 * deste guarda exigia tom E medida E centragem juntos, então **não pegou
 * nenhum dos doze** ladrilhos que a fase 4 encontrou à mão. Um guarda que
 * não pega o caso que motivou o componente é um guarda que dá falsa
 * segurança, que é pior do que não ter.
 *
 * Quatro linhas é o tamanho de uma chamada de `cn` com dois ramos. Menos
 * perde o ternário; mais começa a juntar propriedades vizinhas que não têm
 * relação e a acusar quem não errou.
 *
 * ------------------------------------------------------------------
 * O QUE ELE AINDA NÃO PEGA, MEDIDO
 * ------------------------------------------------------------------
 *
 * Rodado contra a versão anterior dos treze ladrilhos migrados, este guarda
 * acusa nove. Os quatro que escapam escapam pelo mesmo motivo: **o tom não
 * é literal.**
 *
 *     cn('grid size-7 … place-items-center rounded-md', TONE_CHIP[tone])
 *     cn('grid size-6 … place-items-center rounded-md', kindStyle.icon)
 *
 * `TONE_CHIP[tone]` e `kindStyle.icon` são nomes; o texto da classe está em
 * outro arquivo, ou trinta linhas acima num `Record`. Uma busca por texto
 * não alcança isso, e fingir que alcança seria pior do que dizer onde ela
 * para. O quarto é o `StatTile`, que declara a forma numa `cva` e os tons
 * sete linhas abaixo — fora da janela de propósito.
 *
 * Vale o que pega: as nove são a escrita comum, a que alguém repete sem
 * saber que o átomo existe. Quem escreve um mapa de tons já está pensando
 * em sistema.
 */
const SPAN = 4;

function tileOffenders(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!TILE_SHAPE.test(lines[i])) continue;
      if (IS_BUTTON.test(lines[i])) continue;

      // O tom pode estar na linha da forma ou logo abaixo, e o disco é
      // olhado na janela inteira porque o raio às vezes vem depois do tom.
      const win = lines.slice(i, i + SPAN).join(' ');
      if (TILE_TONE.test(win) && !IS_CIRCLE.test(win)) {
        found.push(`${file.replace(SRC, 'src')}:${i + 1}`);
        i += SPAN - 1; // uma janela por achado, senão o mesmo erro sai 4x
      }
    }
  }
  return found;
}

/**
 * O par tonal numa pílula: a assinatura de um `StatusBadge` escrito à mão.
 *
 * ------------------------------------------------------------------
 * POR QUE O PAR, E NÃO A GEOMETRIA
 * ------------------------------------------------------------------
 *
 * A pílula artesanal tem quatro escritas (`px-1.5` ou `px-2`, `py-0.5` ou
 * altura fixa, `font-semibold` ou `font-bold`) e a geometria sozinha acusa
 * meia interface: um filtro de etiqueta, uma reação de emoji e um contador
 * são todos redondos com padding e texto pequeno, e nenhum deles é um
 * estado.
 *
 * O que separa é o PAR `bg-{tom}-soft` + `text-{tom}-ink`. Ele é a
 * gramática de estado da casa — está no `statusBadgeVariants` e no
 * `TONE_CHIP` da agenda, e em lugar nenhum mais por acidente. Quem o
 * escreve numa pílula está reimplementando o `StatusBadge`.
 *
 * ------------------------------------------------------------------
 * AS DUAS EXCEÇÕES, E POR QUE ELAS NÃO SÃO ESTADO
 * ------------------------------------------------------------------
 *
 * `aria-pressed` diz que a peça é um CONTROLE: a etiqueta excluída de um
 * disparo e a reação de emoji vestem o par tonal para dizer "ligado", não
 * para relatar. Um botão não vira `StatusBadge`.
 *
 * `place-items-center` num disco diz que dentro há um GLIFO, não uma
 * palavra: a marca de ocorrência da lista de conversas tem um comentário
 * defendendo o círculo — *"a square reads as a control"* — e o passo de log
 * de automação é a mesma peça. Forçá-los ao chip mudaria o objeto.
 */
const PILL_TONE =
  /(?<![\w:-])bg-(human|ok|danger|auto)-soft\b[^\n]*text-\1-ink\b|(?<![\w:-])text-(human|ok|danger|auto)-ink\b[^\n]*bg-\2-soft\b/;

const IS_CONTROL = /aria-pressed|place-items-center/;

/** Quem implementa a gramática de estado pode citá-la. */
const PILL_ALLOWED = new Set([
  'status-badge.tsx',
  'icon-tile.tsx',
  'settings-chip.tsx',
  'tokens.ts',
]);

function pillOffenders(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    if (PILL_ALLOWED.has(basename(file))) continue;
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!PILL_TONE.test(lines[i])) continue;

      // A forma costuma abrir a chamada de `cn` ACIMA do ternário de tons,
      // então a janela olha para trás também — ao contrário do ladrilho,
      // onde a forma é sempre a primeira linha.
      const win = lines.slice(Math.max(0, i - SPAN), i + SPAN).join(' ');
      if (IS_CIRCLE.test(win) && !IS_CONTROL.test(win)) {
        found.push(`${file.replace(SRC, 'src')}:${i + 1}`);
      }
    }
  }
  return found;
}

describe('atoms', () => {
  it('no one hand-rolls a count badge', () => {
    expect(
      offenders(HAND_ROLLED_COUNT),
      'Use `CountBadge` de @/components/ui/count-badge — ele traz a medida ' +
        'da casa (18px, a mesma família do StatusBadge size="sm"). Se o tom ' +
        'que você quer não existe, passe `className`, como o seg-bar faz.'
    ).toEqual([]);
  });

  it('no one hand-rolls an icon tile', () => {
    expect(
      tileOffenders(),
      'Use `IconTile` de @/components/ui/icon-tile — ele encadeia tamanho e ' +
        'raio, que eram dois eixos soltos. Se o ícone É a ação, o componente ' +
        'certo é `<Button variant="ghost" size="icon">`.'
    ).toEqual([]);
  });

  it('no one hand-rolls a status badge', () => {
    expect(
      pillOffenders(),
      'Use `StatusBadge` de @/components/ui/status-badge — ele fixa a ' +
        'altura, que é o que quase nenhuma dessas pílulas fazia, e nomeia as ' +
        'duas da casa: 20px e 18px (`size="sm"`). Se a peça é um controle, ' +
        'e não um relato, ela não é um StatusBadge.'
    ).toEqual([]);
  });

  it('finds files at all — guards against a silent empty pass', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(200);
  });
});
