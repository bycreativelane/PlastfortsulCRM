'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useReplayAnimation } from '@/hooks/use-replay-animation';

/**
 * PageTransition's smaller sibling: for a region that changes while the
 * page around it stays put.
 *
 * Settings is the case that demanded it. Eleven panels share one route,
 * and picking a different one in the rail replaced the entire right-hand
 * column between two frames — the single most jarring transition in the
 * app, and the one the route-level animation deliberately does not
 * cover, because re-animating the page title for a panel swap would be
 * worse than not animating at all.
 *
 * `token` is whatever identifies the current content: a settings
 * section, a tab value, a selected record id.
 */
export function SectionTransition({
  token,
  className,
  children,
}: {
  token: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useReplayAnimation(ref, token, 'section-enter');

  /*
   * A ROLAGEM PERTENCE AO CONTEÚDO QUE SAIU.
   *
   * Quando esta região é ela mesma quem rola — em Configurações a coluna
   * do painel é o único contêiner que rola na tela —, trocar de seção
   * mantinha a posição da seção anterior. Sair do fim de "Novidades" e
   * abrir "Seu perfil" entregava o perfil começando no meio, com o título
   * dele acima da dobra. `scroll: false` no `router.push` é sobre a
   * PÁGINA, e não sabe deste contêiner.
   *
   * Sem efeito nenhum quando a região não rola, que é o caso comum.
   */
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollTop !== 0) el.scrollTop = 0;
  }, [token]);

  return (
    <div ref={ref} className={cn('section-enter', className)}>
      {children}
    </div>
  );
}
