'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { hasUnreadRelease, lastSeenRelease } from '@/lib/releases';
import { useCapabilityCheck } from '@/hooks/use-can';
import {
  RAIL_GROUPS,
  SECTION_META,
  visibleSections,
  type SettingsSection,
} from './settings-sections';

/**
 * The settings left rail — grouped, vertical on desktop and a
 * horizontal scroller on narrow screens (mirrors the mockup's ≤920px
 * behaviour). The active item auto-scrolls into view when the rail is
 * horizontal so a deep-linked section is never off-screen.
 */
export function SettingsRail({
  active,
  onSelect,
  hints,
  className,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
  /** The page uses this to stand the rail down on the phone's landing —
   *  see the note at its call site in `settings/page.tsx`. */
  className?: string;
}) {
  /**
   * The rows this person can actually use.
   *
   * This used to be an `area` prop — one component, two doors. There is
   * one door now and the filter is what they can do, so an agent's rail
   * is seven rows that all work rather than eighteen where eleven refuse.
   * The panels and the policies still refuse on their own; see the note
   * in `settings-sections.ts` about this being the courtesy.
   */
  const { can, ready } = useCapabilityCheck();
  // HELD UNTIL THE PROFILE LANDS. Every gate answers false while it is in
  // flight, so drawing now would paint an admin the seven ungated rows
  // and then pop the other eleven in a moment later — a rail that
  // changes length under the cursor. `ready` is on the hook for exactly
  // this; not using it here was the bug.
  const allowed = ready ? visibleSections(can) : [];
  /**
   * Whether this browser has seen the latest release notes.
   *
   * Read in an effect rather than during render: `localStorage` is not
   * available on the server, and a dot that exists in the client tree and
   * not the server one is a hydration mismatch. One frame without the dot
   * costs nothing.
   */
  const [unreadRelease, setUnreadRelease] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnreadRelease(hasUnreadRelease(lastSeenRelease()));
  }, [active]);

  const t = useTranslations('Settings');
  const activeRef = useRef<HTMLButtonElement>(null);

  /**
   * Keep the active row in view, on BOTH layouts.
   *
   * It used to skip desktop, on the grounds that the column was static
   * and everything in it was already on screen. That stopped being true
   * when the two destinations merged: eighteen rows do not fit an 800px
   * viewport, so the column scrolls now, and a deep link to a section
   * near the bottom — `?tab=whats-new`, the last one — would open with
   * its own row out of sight.
   *
   * `block: 'nearest'` does nothing when the row is already visible, so
   * the common case still costs no movement, and `inline: 'center'` only
   * bites on the horizontal layout.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    activeRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [active]);

  return (
    <nav
      aria-label={t('railAria')}
      className={cn(
        'flex snap-x gap-1 overflow-x-auto pb-2',
        // Chips sized to their content, no scrollbar in either engine:
        // the last visible one could end flush with the edge and read as
        // the end of the list. The edge fade says "there is more this
        // way" without spending a row on arrows. The fade is scoped BELOW
        // `lg`; the hidden scrollbar is not, and the reason is two
        // paragraphs down.
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        'max-lg:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]',
        'border-border border-b',
        /*
         * UMA COLUNA, E NÃO UM ELEMENTO GRUDENTO.
         *
         * ------------------------------------------------------------
         * O QUE ESTAVA AQUI, E POR QUE SAIU
         * ------------------------------------------------------------
         *
         * Isto era `sticky top-6` com um teto de `calc(100dvh-5rem)`, e
         * o comentário que morava aqui era uma página inteira de
         * aritmética para fazer a conta fechar EXATAMENTE:
         *
         *     (100dvh − 5rem) + 1.5rem  =  100dvh − 3.5rem  ✓ exato
         *
         * Uma conta que fecha exato não tem folga nenhuma. Qualquer
         * coisa que mude a altura útil do <main> — um alerta de conta no
         * topo, um cabeçalho que cresce duas linhas — derruba o sticky
         * em silêncio, e um sticky que para de grudar não avisa: ele
         * simplesmente rola junto com a página.
         *
         * E mesmo com a conta fechando, o grudento ANDA antes de grudar.
         * A trilha começa abaixo do cabeçalho da página, então ela sobe
         * uns 86px até encostar no ponto fixo — medido — e é isso que o
         * Gabriel viu em 14 de setembro: *"quando eu rolo a pagina no
         * perfil ou etc o menu arrasta junto"*. Não estava quebrado; era
         * o trajeto de todo `sticky`, e numa tela de configurações o
         * menu não deveria ter trajeto nenhum.
         *
         * A rota entrou em `APP_SHAPED` (ver `dashboard-shell.tsx`): o
         * <main> parou de rolar e quem rola é a COLUNA DO PAINEL. Aqui a
         * trilha vira o que sempre quis ser — uma coluna de altura cheia
         * ao lado dela. Sem sticky, sem teto, sem aritmética: `h-full`
         * resolve contra a linha da grade, que já é a altura disponível.
         * Nada para dar errado quando o layout ao redor mudar.
         *
         * `overflow-x-hidden` fica: `visible` num eixo com o outro
         * não-`visible` computa para `auto`, e isso poria uma barra
         * horizontal fantasma numa coluna que não rola de lado.
         *
         * E sem trilho, mesmo aqui. Quem é DONO vê dezoito seções e o
         * conteúdo passa da altura da tela num notebook; uma calha para
         * isso fica ao lado da calha do painel — *"ta estranho com 2
         * barras de rolagem"*. A última linha aparece CORTADA ao meio,
         * que é o mesmo recado e não gasta uma calha, e a roda do mouse
         * sobre a trilha continua rolando. `pb-2` para o corte cair no
         * meio de uma linha em vez de rente à borda, que leria como fim
         * da lista.
         */
        'lg:h-full lg:min-h-0 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:border-b-0 lg:pb-2',
        className
      )}
    >
      {RAIL_GROUPS.map(({ label, group }) => {
        const items = allowed.filter((s) => SECTION_META[s].group === group);
        // A group with nothing in it draws its own heading over empty
        // space. Reachable now that permissions decide the rows: an agent
        // has nothing under "Espaço de trabalho" except Novidades, and a
        // narrowing override can empty a group outright.
        if (items.length === 0) return null;
        return (
          <div
            key={group}
            className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5"
          >
            {label ? (
              <div className="text-muted-foreground eyebrow hidden px-3 pt-4 pb-1.5 lg:block">
                {t(`groups.${group}`)}
              </div>
            ) : null}
            {items.map((s) => {
              const meta = SECTION_META[s];
              const Icon = meta.icon;
              const isActive = s === active;
              return (
                <button
                  key={s}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    // `py-2.5` on touch, `lg:py-2` back on the pointer
                    // column: a raw <button> gets none of the coarse-pointer
                    // padding that `[data-slot="button"]` does, and 36px is
                    // under the 44px target. Same trade the main sidebar makes.
                    'flex shrink-0 snap-start items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors duration-(--dur-1) lg:py-2',
                    'lg:w-full',
                    isActive
                      ? 'bg-primary-soft text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{t(`sections.${s}`)}</span>
                  {/* The dot is the entire announcement mechanism for a
                      release. It is 6px and it is not amber: nothing here is
                      waiting on the operator, and borrowing the colour that
                      means "act on this" for "there is reading available"
                      is how that colour stops meaning anything. */}
                  {s === 'whats-new' && unreadRelease && (
                    <span
                      aria-hidden
                      className="bg-primary size-1.5 shrink-0 rounded-full"
                    />
                  )}
                  {hints?.[s] != null ? (
                    <span
                      className={cn(
                        'hidden items-center gap-1.5 text-xs lg:inline-flex',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {hints[s]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
