import { cn } from '@/lib/utils';
import type { Method } from '@/lib/api-docs/types';

/**
 * O verbo HTTP, colorido pela convenção que toda referência de API usa:
 * azul lê, verde cria, âmbar altera, vermelho apaga.
 *
 * Reusa os pares soft/ink do sistema em vez de inventar quatro cores —
 * e vale dizer por que isso não contradiz a doutrina do `StatusBadge`,
 * onde cor significa ESTADO. Ali o objeto é um estado e a cor é a única
 * coisa que o distingue; aqui o objeto é um verbo, ele está escrito por
 * extenso ao lado, e a cor é redundante de propósito — quem não separa
 * o âmbar do verde lê "PATCH" e "POST" do mesmo jeito.
 */
const METHOD_CLASS: Record<Method, string> = {
  GET: 'bg-auto-soft text-auto-ink',
  POST: 'bg-ok-soft text-ok-ink',
  PATCH: 'bg-human-soft text-human-ink',
  PUT: 'bg-human-soft text-human-ink',
  DELETE: 'bg-danger-soft text-danger-ink',
};

export function MethodBadge({
  method,
  className,
  size = 'default',
}: {
  method: Method;
  className?: string;
  size?: 'default' | 'sm';
}) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center justify-center rounded-md font-mono font-semibold tracking-tight uppercase',
        size === 'sm'
          ? 'text-3xs h-4 min-w-11 px-1'
          : 'text-2xs h-5.5 min-w-14 px-1.5',
        METHOD_CLASS[method],
        className
      )}
    >
      {method}
    </span>
  );
}
