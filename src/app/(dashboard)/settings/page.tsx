'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { SettingsRail } from '@/components/settings/settings-rail';
import { panelFor } from '@/components/settings/settings-panels';
import {
  DEFAULT_SECTION,
  canSeeSection,
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { useCapabilityCheck } from '@/hooks/use-can';
import { PageHeader } from '@/components/layout/page-header';
import { SectionTransition } from '@/components/layout/section-transition';
import { cn } from '@/lib/utils';

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary. Without one, the production build hits
// the "missing Suspense with CSR bailout" error and the whole page bails
// to client-side rendering — shipping a settings screen whose rail never
// wires up its click handlers. You land on the section the URL carried
// and can't navigate away. Mirror the login/signup split: a thin wrapper supplies
// the boundary; the inner component reads the query string.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('Settings');
  const { can, ready } = useCapabilityCheck();

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const requested = resolveSection(searchParams.get('tab'));

  /**
   * A section this person cannot use falls back to the landing.
   *
   * Not a redirect and not a "restricted" panel. A redirect would strip
   * the address somebody was sent, and a refusal panel would tell an
   * agent that a screen exists which is none of their business — the
   * rail already decided not to mention it, and the page saying it out
   * loud undoes that.
   *
   * Held until `ready`, so the fallback is never taken against a profile
   * that has not arrived: every gate reads false while it loads, and
   * without the wait an admin landing on `?tab=whatsapp` would be
   * bounced to Overview on the first frame.
   */
  const section =
    ready && !canSeeSection(requested, can) ? DEFAULT_SECTION : requested;

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    // `push`, not `replace`: switching section is a navigation, and the
    // back button has to walk back through the sections you visited
    // rather than throwing you out of Settings entirely. `PageTransition`
    // is keyed on the pathname, so the query change animates the panel
    // only — the page itself does not re-enter.
    router.push(`/settings?${params.toString()}`, { scroll: false });
  };

  /**
   * No rail hints.
   *
   * There were two — "Light" on Aparência and "BRL" em Oportunidades —
   * and the Overview panel to their right already said both, with more
   * room and more context: "modo Light · acento PlastfortSul" and
   * "BRL — Real brasileiro". The same two facts, twice, on one screen.
   *
   * And they were the only two of seventeen rows carrying anything, so
   * their presence did not read as a rule either — just as two rows
   * that happened to have a note. A navigation index says where things
   * are; the panel it points at says what they hold.
   *
   * The prop stays on `SettingsRail`: it is a legitimate slot for a
   * count that has nowhere else to live (an unread badge, a pending
   * invite). It is simply not for restating the page it links to.
   */

  /*
   * UM SHELL CONTIDO — a rota está em `APP_SHAPED`.
   *
   * O <main> não rola mais nesta tela; quem rola é a COLUNA DO PAINEL, e
   * só ela. O cabeçalho e a trilha ficam parados onde estão, que é o que
   * faltava: a trilha era `sticky` e subia uns 86px antes de grudar.
   *
   * O preço de ser contida é que a página passa a ser dona das próprias
   * margens — o `PageTransition` só dá medida e goteiras para as telas de
   * leitura. Daí `max-w-page` e as goteiras repetidas aqui, iguais às de
   * `dashboard-shell.tsx`, para esta tela continuar alinhada com todas as
   * outras.
   *
   * ------------------------------------------------------------------
   * E CONTIDA SÓ A PARTIR DE `lg`
   * ------------------------------------------------------------------
   *
   * Num telefone prender cabeçalho e tira de chips custa caro: medido a
   * 375×812, sobravam 498px para o painel e 255px iam para moldura
   * parada. Numa tela dessas o cabeçalho tem MESMO que sair de cena
   * quando você rola — é assim que era antes, e estava certo.
   *
   * Então o contêiner rola no telefone e prende no desktop. É a mesma
   * regra do `lg:` que a trilha já usava para virar coluna: abaixo dele
   * não existe "coluna ao lado" nenhuma para manter parada.
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <div className="max-w-page mx-auto w-full shrink-0 px-4 pt-5 sm:px-6 sm:pt-6 lg:px-8">
        <PageHeader title={t('pageTitle')} description={t('pageDesc')} />
      </div>

      {/* `lg:min-h-0 lg:flex-1` é o que entrega a linha inteira às duas
          colunas quando a tela é contida. Abaixo de `lg` a grade tem a
          altura do conteúdo e quem rola é o contêiner de fora, como em
          qualquer página de leitura. */}
      <div className="max-w-page mx-auto grid w-full gap-4 px-4 pt-6 pb-4 sm:px-6 sm:pb-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-6 lg:px-8">
        {/* ONE INDEX AT A TIME ON A PHONE.

            Both of these are complete navigations over the same eighteen
            sections: the rail is the chip strip, and `overview` — the
            landing panel below it — is a list of cards for every one of
            them, with a description and a live status each. Side by side
            on a desk they divide the labour (the rail is a persistent
            column, the landing is the room you arrive in). Stacked on a
            375px screen they are the same question asked twice, one
            above the other, filling everything you can see.

            So below `lg` the rail stands down while you are ON the
            landing, and comes back the moment a section opens — where it
            stops being a duplicate and becomes the way between sections
            without a round trip through the landing. The cards win the
            tie for the landing itself: they carry the description and
            the status, and the chips carry neither.

            `lg:flex` and not `lg:block` — the rail's own base class is
            `flex`, and restoring it with the wrong display would turn
            its chip row into a stack. Above the breakpoint it comes
            back unconditionally, so the desk layout never loses its
            column. Getting BACK to the landing from a section is the
            rail's own "Visão geral" row, which is on screen there. */}
        <SettingsRail
          active={section}
          onSelect={go}
          className={cn(section === DEFAULT_SECTION && 'hidden lg:flex')}
        />
        {/* The panel is the only thing that changed — the title above and
            the rail beside it did not, so only the panel animates.
            `@container` because the panels inside must size themselves
            against THIS box, not the viewport: at 1024px the rail claims
            236px of the row, so the panel gets narrower at exactly the
            breakpoint a viewport query would read as "more room". */}
        {/* A COLUNA QUE ROLA — e, no desktop, a única da tela.
            `lg:min-h-0` porque um item de grade também tem o conteúdo como
            piso: sem ele a coluna cresce até caber o painel inteiro e nada
            rola, e o clipe do pai come o que passou. `lg:pb-2` para a
            última linha não terminar rente à calha. */}
        <SectionTransition
          token={section}
          className="@container min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pb-2"
        >
          {panelFor(section, go)}
        </SectionTransition>
      </div>
    </div>
  );
}
