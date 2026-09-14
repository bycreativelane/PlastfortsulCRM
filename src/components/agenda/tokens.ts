import {
  AlertTriangle,
  Briefcase,
  Cake,
  CalendarClock,
  ListChecks,
  Radio,
  RefreshCw,
  Zap,
} from 'lucide-react';

import type { AgendaKind, AgendaTone } from '@/lib/dashboard/agenda';

/**
 * O ícone de cada tipo de linha da agenda.
 *
 * Estava escrito duas vezes — no painel do dashboard e na faixa do
 * cabeçalho — palavra por palavra igual, e a `/agenda` seria a terceira.
 * Duas cópias uma pessoa mantém em sincronia por disciplina; três, não: a
 * tarefa entrou nas duas na mesma tarde só porque quem escreveu lembrava
 * das duas, e a próxima fonte não terá essa sorte.
 *
 * Mora em `components/agenda/` e não em `lib/` porque é uma escolha de
 * desenho, não uma regra de negócio: quem decide que uma recompra parece
 * uma seta em círculo é a mesma pessoa que decide o resto da tela.
 */
export const KIND_ICON: Record<
  AgendaKind,
  React.ComponentType<{ className?: string }>
> = {
  task: ListChecks,
  deal: Briefcase,
  repurchase: RefreshCw,
  occurrence: AlertTriangle,
  external: CalendarClock,
  automation: Zap,
  broadcast: Radio,
  birthday: Cake,
};

/**
 * O tom de cada linha, como cor.
 *
 * A mesma história do `KIND_ICON`: dois arquivos, palavra por palavra
 * igual. A nota que justifica o cinza do aniversário estava escrita só num
 * deles, o que é a forma mais barata de uma decisão se perder — a cópia sem
 * comentário parece arbitrária, e arbitrário é o que a próxima pessoa
 * "arruma".
 *
 * Âmbar é "uma pessoa precisa agir"; cinza é "uma máquina cuida disto";
 * vermelho é "quebrou". Um aniversário não é nenhum dos três — é um fato
 * sobre um dia, então fica neutro em vez de tomar emprestada a única cor
 * que significa venha aqui. Peso é o único canal que sobra depois que o
 * matiz acabou, e é o certo: um aniversário é a coisa mais quieta que este
 * calendário tem.
 */
export const TONE_DOT: Record<AgendaTone, string> = {
  human: 'bg-human',
  auto: 'bg-auto',
  danger: 'bg-danger',
  neutral: 'bg-muted-foreground/40',
};

export const TONE_CHIP: Record<AgendaTone, string> = {
  human: 'bg-human-soft text-human-ink',
  auto: 'bg-auto-soft text-auto-ink',
  danger: 'bg-danger-soft text-danger-ink',
  neutral: 'bg-muted text-muted-foreground',
};

/**
 * O BLOCO DA GRADE DE HORAS: fundo claro e uma barra de cor na borda
 * esquerda.
 *
 * É o desenho de todo calendário com eixo de horas, e há um motivo além do
 * costume: a barra carrega o TOM sozinha, então o fundo pode ser suave o
 * bastante para o texto ler bem por cima dele. Um bloco inteiro em cor
 * forte, empilhado numa semana cheia, vira uma parede — foi o que o mês
 * mostrava antes de virar ponto.
 */
export const TONE_BLOCK: Record<AgendaTone, string> = {
  human: 'bg-human-soft text-human-ink border-l-human',
  auto: 'bg-auto-soft text-auto-ink border-l-auto',
  danger: 'bg-danger-soft text-danger-ink border-l-danger',
  neutral: 'bg-muted text-muted-foreground border-l-muted-foreground/40',
};
