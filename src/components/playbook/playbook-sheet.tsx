'use client';

import { useTranslations } from 'next-intl';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PlaybookArea } from '@/components/playbook/playbook-area';

/**
 * O Playbook por cima da conversa, sem sair dela.
 *
 * Item 15 do pacote: "durante a conversa o vendedor não deve precisar sair
 * da tela de Atendimento para consultar como responder uma objeção, qual
 * script usar, ou uma regra interna da operação". Até aqui precisava — o
 * Playbook é uma rota, e ir até ela custa a conversa que estava aberta,
 * o rascunho a meio caminho e o lugar na lista.
 *
 * ------------------------------------------------------------------
 * O MESMO COMPONENTE DA PÁGINA, E É O PONTO
 * ------------------------------------------------------------------
 *
 * O item 15 abre com "não recriar o módulo", e o pedido dele — pesquisar,
 * visualizar, copiar script, copiar resposta de objeção — é, item por
 * item, o que `PlaybookArea` já faz. Uma segunda tela de consulta seria
 * duas buscas para manter iguais e duas que divergem: exatamente o defeito
 * que o item 9 relata sobre a ficha do contato, de novo e por escolha.
 *
 * A busca é a parte que mais se ganha ao reaproveitar. Ela atravessa os
 * três tipos de uma vez porque a base é uma tabela só com `type` — o
 * argumento está no topo da migração 064 — então quem digita "frete"
 * durante o atendimento acha o script, a objeção e a regra sem escolher
 * antes em qual das três a empresa guardou.
 *
 * PRODUTOS VÊM JUNTO. O item permite ("se Produtos já estiver integrado ao
 * mesmo Playbook, pode permanecer disponível"), e no meio de uma conversa
 * sobre preço é a seção mais consultada das quatro.
 *
 * `size="record"` e não `panel`: um script de vendas é um parágrafo, e
 * numa gaveta estreita ele vira uma coluna de palavras soltas. É a mesma
 * largura da ficha do contato, que é o outro painel que se abre por cima
 * do atendimento para ler alguma coisa.
 */
export function PlaybookSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('Playbook');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="record"
        className="bg-popover border-border text-popover-foreground flex w-full flex-col gap-0 p-0"
      >
        <SheetHeader className="border-border/50 border-b p-4">
          <SheetTitle className="text-popover-foreground">
            {t('title')}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-xs">
            {t('description')}
          </SheetDescription>
        </SheetHeader>

        {/* A ROLAGEM É DAQUI, e não da gaveta inteira: com o cabeçalho
            preso no topo, a busca e as abas continuam alcançáveis depois
            de descer trinta objeções — que é quando uma lista longa deixa
            de ser útil e vira um documento. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* `open &&` explícito, e não por confiar no portal.
              Fechado, o `Dialog.Portal` do base-ui não renderiza filho
              nenhum hoje — mas o dia em que alguém puser `keepMounted`
              para animar a saída, isto aqui vira uma consulta ao playbook
              em toda conversa aberta, na tela mais usada do produto. Uma
              linha para essa dívida não existir. */}
          {open && <PlaybookArea embedded />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
