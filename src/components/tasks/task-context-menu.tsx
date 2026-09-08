'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ban, Check, MoreHorizontal, Pencil, RotateCcw } from 'lucide-react';

import type { Task, TaskStatus } from '@/types';
import {
  ContextMenu,
  ContextMenuActionsTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface TaskContextMenuProps {
  task: Task;
  onOpen: () => void;
  /** O mesmo caminho que o arrasto usa — o quadro já é dono dele. */
  onChangeStatus: (status: TaskStatus) => void;
  children: React.ReactNode;
}

/**
 * As ações do cartão de tarefa.
 *
 * ------------------------------------------------------------------
 * POR QUE ELE PASSOU A EXISTIR
 * ------------------------------------------------------------------
 *
 * O cartão do FUNIL tem sete ações num menu e um botão que as revela sob o
 * ponteiro. O de TAREFA não tinha nenhuma: clique abria a gaveta, arrasto
 * mudava a coluna, e acabava aí. Os dois quadros voltaram a divergir — que é
 * exatamente o que a `BoardLane` foi extraída para impedir, e o que abriu
 * este redesenho quando o quadro de tarefas nasceu cópia da geometria do
 * funil sem as decisões dele.
 *
 * E a divergência custava caro no lugar mais óbvio: **concluir uma tarefa
 * pelo quadro exigia arrastá-la entre colunas**. Num desktop é um gesto
 * longo; num celular é um arrasto preciso numa coluna que rola de lado. A
 * ação mais comum da tela era a mais cara dela.
 *
 * ------------------------------------------------------------------
 * O QUE ESTE MENU NÃO FAZ
 * ------------------------------------------------------------------
 *
 * Não escreve no banco. Cada item chama o `onChangeStatus` que o quadro já
 * passa para o arrasto, então menu e arrasto seguem o MESMO caminho — o que
 * carimba `completed_at` ao concluir e não carimba ao cancelar, e o que
 * dispara o aviso e a releitura. Um `update` próprio aqui seria uma segunda
 * verdade sobre o que "concluir" significa.
 *
 * Não exclui. Excluir vive na gaveta, atrás de uma confirmação, e um item de
 * menu num cartão arrastável é perto demais do dedo para uma ação sem volta.
 *
 * Não move para uma coluna qualquer. A coluna É o estado, então "mover para"
 * e "concluir/cancelar/reabrir" seriam dois nomes para a mesma coisa — o
 * mesmo argumento que tirou a caixa de concluir do cartão.
 */
export function TaskContextMenu({
  task,
  onOpen,
  onChangeStatus,
  children,
}: TaskContextMenuProps) {
  const t = useTranslations('Tasks.menu');
  const tTask = useTranslations('Tasks');
  const [open, setOpen] = useState(false);

  const isOpen = task.status === 'open';

  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger className="block">{children}</ContextMenuTrigger>

      {/* O BOTÃO DO CARTÃO ATIVO.
          Em repouso o cartão continua só o cartão — é isso que mantém a
          coluna legível com quinze itens, e é a ideia central das
          referências. O botão aparece sob o ponteiro e no foco de teclado.

          Só em ponteiro fino: no toque o pressionar-longo abre o mesmo menu,
          e a borda direita do cartão pertence à alça de arrasto. Mesma
          decisão, palavra por palavra, do cartão do funil. */}
      <ContextMenuActionsTrigger
        onOpen={() => setOpen(true)}
        // O menu é portalado para fora do cartão, então mover o ponteiro até
        // ele tira o hover do cartão e o botão sumiria com o próprio menu
        // aberto.
        data-popup-open={open ? '' : undefined}
        aria-label={t('actions')}
        title={t('actions')}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring bg-card/80 absolute top-1 right-1 z-10 hidden size-6 place-items-center rounded-md opacity-0 backdrop-blur-[2px] transition-opacity duration-(--dur-1) group-hover/task:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none data-popup-open:opacity-100 pointer-fine:grid"
      >
        <MoreHorizontal className="size-3.5" />
      </ContextMenuActionsTrigger>

      <ContextMenuContent>
        {/* O título, porque o menu cobre o cartão que o carregava. Dentro de
            um `ContextMenuGroup` porque o `ContextMenuLabel` é o
            `Menu.GroupLabel` do base-ui e ESTOURA sem um `Menu.Group` acima
            — a mesma armadilha que o menu do funil documenta. */}
        <ContextMenuGroup>
          <ContextMenuLabel>{task.title}</ContextMenuLabel>
        </ContextMenuGroup>

        <ContextMenuItem onClick={onOpen}>
          <Pencil />
          {t('open')}
        </ContextMenuItem>

        <ContextMenuSeparator />

        {isOpen ? (
          <>
            <ContextMenuItem onClick={() => onChangeStatus('done')}>
              <Check />
              {tTask('complete')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onChangeStatus('cancelled')}>
              <Ban />
              {tTask('cancel')}
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem onClick={() => onChangeStatus('open')}>
            <RotateCcw />
            {tTask('reopen')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
