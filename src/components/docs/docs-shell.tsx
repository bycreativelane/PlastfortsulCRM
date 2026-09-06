'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, Menu, Moon, Sun } from 'lucide-react';

import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { useTheme } from '@/hooks/use-theme';
import { DocsSidebar } from './docs-sidebar';

/**
 * A moldura de `/developers`: barra do topo, trilha à esquerda, o resto
 * da largura para a página.
 *
 * PÚBLICA, E É ESSE O PONTO. Ela mora fora de `(dashboard)`, então não
 * passa pela shell autenticada e não pede sessão: um integrador
 * terceirizado abre o link e lê, sem que alguém tenha de criar uma
 * conta para ele. O que está aqui é contrato de API e prosa — nenhum
 * dado da conta atravessa esta fronteira.
 *
 * O componente é cliente por causa de três coisas e nada mais: a
 * gaveta do telefone, o botão de claro/escuro e a busca lá dentro. O
 * CONTEÚDO continua sendo server component, entregue por `children` —
 * a prosa e o realce de sintaxe chegam prontos do servidor.
 */
export function DocsShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Docs');
  const { mode, toggleMode } = useTheme();
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="bg-background min-h-dvh">
      <header className="border-border bg-background/85 sticky top-0 z-30 border-b backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDrawer(true)}
            aria-label={t('openNav')}
            className="lg:hidden"
          >
            <Menu className="size-4" />
          </Button>

          <Link href="/developers" className="flex items-center gap-2">
            <BrandMark className="size-7" />
            <span className="text-foreground text-sm font-semibold tracking-tight">
              PlastfortSul
            </span>
            <span className="border-border text-muted-foreground text-3xs hidden rounded-md border px-1.5 py-px font-medium sm:block">
              {t('badge')}
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleMode}
              aria-label={t('toggleMode')}
            >
              {mode === 'dark' ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/inbox" />}
            >
              {t('backToApp')}
              <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-8 px-4 lg:px-6">
        {/*
         * `top-14` acompanha a altura da barra, e a altura é calculada
         * em vez de fixa para que a trilha role SOZINHA quando tiver
         * mais linhas que a janela — um `sticky` mais alto que a
         * viewport deixa de grudar em silêncio e some junto com a
         * página, que é o bug clássico de barra lateral longa.
         */}
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 py-6 lg:block xl:w-64">
          <DocsSidebar />
        </aside>

        <main className="min-w-0 flex-1 py-8">{children}</main>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-[19rem] p-4">
          <SheetTitle className="sr-only">{t('navAria')}</SheetTitle>
          <SheetDescription className="sr-only">
            {t('navDescription')}
          </SheetDescription>
          <div className="h-full pt-6">
            <DocsSidebar onNavigate={() => setDrawer(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
