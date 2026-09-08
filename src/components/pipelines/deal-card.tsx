'use client';

import type { Deal, PipelineStage } from '@/types';
import { Calendar, ListChecks } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { MemberAvatar } from '@/components/presence/member-avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tag } from '@/components/ui/tag';
import { fromISO } from '@/lib/calendar';

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  /** Present only when the deal's stage has a playbook. */
  playbook?: { done: number; total: number };
  isOverlay?: boolean;
  className?: string;
}

/**
 * One deal in a Kanban column.
 *
 * ------------------------------------------------------------------
 * A SUPERFÍCIE: SOMBRA, NÃO BORDA
 * ------------------------------------------------------------------
 *
 * As nove referências fazem a mesma coisa sem exceção: o cartão é uma
 * superfície um passo mais clara que o canvas, com uma sombra macia embaixo
 * e **nenhum contorno visível**. Este desenhava uma borda de 1px, e um
 * cartão com borda dentro de uma raia com borda é um retângulo dentro de um
 * retângulo — é o que faz uma pilha ler como grade cinza em vez de como um
 * conjunto de objetos.
 *
 * A borda continua no DOM, transparente, porque é o canal que o
 * `surface-interactive` esquenta no ponteiro. Em repouso quem separa é o
 * `--card-shadow`; no escuro esse token vira um fio de luz, porque numa
 * superfície escura não existe sombra para projetar.
 *
 * `rounded-xl` e não `rounded-lg`: 8px num cartão de 260px é um canto de
 * controle, e cantos mais macios são o que separa uma página de superfícies
 * de uma página de caixas — o argumento está escrito no `Panel`.
 *
 * ------------------------------------------------------------------
 * A ANATOMIA
 * ------------------------------------------------------------------
 *
 *   quem            ← o contato, que é por quem se procura no quadro
 *   empresa
 *   o que
 *   R$ VALOR        ← a linha que o Bond CRM ensina a destacar
 *   ▓▓▓▓░░░░        ← o playbook, quando há um
 *   ───────────
 *   prazo · tempo na etapa                              foto
 *
 * **O valor ganhou a própria linha.** Ele dividia a primeira com o nome e
 * competia com ele — dois pesos fortes na mesma altura, e o olho não sabia
 * qual era o assunto. Embaixo e sozinho ele é lido depois do nome, que é a
 * ordem em que a pergunta é feita.
 *
 * **QUEM primeiro, ainda.** O cartão já tinha invertido isso de propósito:
 * num quadro procura-se pela pessoa — "onde está o Marcos" — e o título é
 * como se separam dois negócios dele depois de achá-lo.
 *
 * **A barra do playbook** é o que o Bond CRM faz com a probabilidade: uma
 * régua fina diz "quanto falta" sem que ninguém leia dois números. Âmbar
 * enquanto falta, porque um passo de playbook é trabalho de uma pessoa — e
 * ela some quando acaba, em vez de virar verde: concluído é a ausência de
 * uma cobrança, não um segundo anúncio.
 *
 * **O tempo na etapa** é a informação que o Bond CRM põe no rodapé ("41d in
 * stage") e a que este produto tinha no banco desde a migração 065 sem
 * mostrar a ninguém. O motor de automação já lê `stage_entered_at` para
 * disparar em negócio parado; quem olha o quadro não sabia.
 *
 * Sem barra colorida na esquerda: era um segundo canal repetindo o que a
 * bolinha da coluna já diz — todo cartão de uma coluna tem a mesma etapa.
 *
 * `stage` é recebido porque o clone do arrasto desenha um cartão fora da
 * coluna dele, onde ele não tem posição de onde ler a etapa.
 */
export function DealCard({
  deal,
  stage,
  onEdit,
  playbook,
  isOverlay,
  className,
}: DealCardProps) {
  const t = useTranslations('Pipelines.card');
  const format = useFormatter();
  const contactLabel =
    deal.contact?.name || deal.contact?.phone || t('noContact');
  const assigneeLabel = deal.assignee?.full_name || null;
  const daysHere = daysInStage(deal.stage_entered_at);
  const tags = deal.contact?.tags ?? [];
  const closeOverdue =
    deal.status === 'open' &&
    !!deal.expected_close_date &&
    deal.expected_close_date < todayIso();

  /*
   * `fromISO`, e NUNCA `new Date(iso)`.
   *
   * `expected_close_date` é uma coluna DATE — `2026-09-08`, sem hora. O
   * `new Date()` parseia isso como MEIA-NOITE UTC, que a oeste de Greenwich
   * é o dia anterior: no fuso de São Paulo o cartão imprimia "7 de set." para
   * um negócio que fecha no dia 8.
   *
   * O `lib/calendar.ts` documenta exatamente este defeito no cabeçalho —
   * "the off-by-one that shows a deal closing on the 22nd" — e existe para
   * evitá-lo. Sete telas o cometiam mesmo assim.
   */
  const closeDate = deal.expected_close_date
    ? fromISO(deal.expected_close_date)
    : null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      // Reads in the order the card now does: who, then what, then where.
      aria-label={
        stage
          ? `${contactLabel} — ${deal.title} — ${stage.name}`
          : `${contactLabel} — ${deal.title}`
      }
      className={cn(
        'bg-card w-full cursor-grab rounded-xl border border-transparent p-3.5 text-left',
        // O `KeyboardSensor` está ligado nos dois quadros: dá para pegar um
        // cartão e movê-lo pelo teclado. Sem anel de foco não dava para ver
        // QUAL cartão estava pego.
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        // `surface-interactive` é a receita única de hover da casa: a borda
        // esquenta, o cartão sobe 1px e o `:active` cancela o lift.
        isOverlay
          ? 'cursor-grabbing shadow-lg'
          : 'surface-interactive shadow-(--card-shadow)',
        className
      )}
    >
      {/* WHO first, then what.

          Company on its own line and only when there is one, because a
          contact created from an inbound message has nothing but a phone
          number. */}
      {/* O CHIP DE ESTADO AO LADO DO NOME, como o `New`/`Warm`/`Renewal`
          do Bond CRM. Ele estava no rodapé, embaixo do divisor, junto com
          prazo e foto — que é onde se põe metadado, não o fato de o negócio
          já estar ganho ou perdido. */}
      <div className="flex items-start gap-2">
        <h4 className="text-foreground min-w-0 flex-1 truncate text-sm leading-tight font-semibold">
          {contactLabel}
        </h4>
        {deal.status === 'won' && (
          <StatusBadge variant="ok" size="sm">
            {t('won')}
          </StatusBadge>
        )}
        {deal.status === 'lost' && (
          <StatusBadge variant="danger" size="sm">
            {t('lost')}
          </StatusBadge>
        )}
      </div>
      {deal.contact?.company && (
        <p className="text-muted-foreground text-2xs mt-0.5 truncate leading-tight">
          {deal.contact.company}
        </p>
      )}

      {/*
        AS ETIQUETAS DO CONTATO, no máximo duas.

        É a fileira de chips que todo cartão das referências tem, e aqui ela
        finalmente tem material: `Tag` desenha o retângulo com a bolinha na
        cor da etiqueta, que é exatamente o chip da imagem 2.

        Duas e um excedente, e não todas: uma delas é livre e um contato com
        seis etiquetas empurraria o cartão para o dobro da altura. Duas
        respondem "que tipo de cliente é este"; a sexta é para a ficha.
      */}
      {tags.length > 0 && (
        <span className="mt-2 flex flex-wrap items-center gap-1">
          {tags.slice(0, 2).map((tag) => (
            <Tag key={tag.id} size="sm" color={tag.color}>
              {tag.name}
            </Tag>
          ))}
          {tags.length > 2 && (
            <span className="text-muted-foreground text-2xs tabular-nums">
              +{tags.length - 2}
            </span>
          )}
        </span>
      )}

      {/* Duas linhas, depois reticências. `deal.title` é texto livre e um
          título longo crescia o cartão para cinco linhas, então o cartão ao
          lado na mesma coluna deixava de alinhar com nada. `line-clamp` e
          não `truncate`: um título de negócio precisa da segunda linha para
          ser reconhecível, e o clamp não fixa `white-space: nowrap`, então
          ele não pode empurrar a largura da coluna. */}
      <p className="text-secondary-foreground mt-1.5 line-clamp-2 text-xs leading-snug">
        {deal.title}
      </p>

      <p className="text-foreground mt-2 text-base leading-none font-bold tracking-tight tabular-nums">
        {formatCurrency(deal.value, deal.currency)}
      </p>

      {playbook && playbook.total > 0 && playbook.done < playbook.total && (
        <span
          role="img"
          aria-label={t('playbookProgress', {
            done: playbook.done,
            total: playbook.total,
          })}
          title={t('playbookProgress', {
            done: playbook.done,
            total: playbook.total,
          })}
          className="bg-muted mt-2.5 block h-1 w-full overflow-hidden rounded-full"
        >
          <span
            className="bg-human-strong block h-full rounded-full"
            style={{
              width: `${Math.round((playbook.done / playbook.total) * 100)}%`,
            }}
          />
        </span>
      )}

      {(deal.expected_close_date ||
        daysHere !== null ||
        playbook ||
        assigneeLabel) && (
        <div className="border-muted mt-3 flex items-center gap-1.5 border-t pt-2.5">
          {/* Já concluído, o playbook não tem barra e não tem pílula: só o
              par de números, em cinza, para quem quiser conferir. */}
          {playbook && playbook.done >= playbook.total && (
            <span
              title={t('playbook')}
              className="text-muted-foreground text-2xs flex items-center gap-1 tabular-nums"
            >
              <ListChecks className="size-3" />
              {playbook.done}/{playbook.total}
            </span>
          )}

          {/* O PRAZO VENCIDO É VERMELHO, como o de uma tarefa.
              Ele saía cinza qualquer que fosse a data — um negócio que devia
              ter fechado há três semanas tinha exatamente a mesma aparência
              de um que fecha na semana que vem, no lugar do quadro onde essa
              é a única pergunta que importa. */}
          {closeDate &&
            (closeOverdue ? (
              <StatusBadge variant="danger" size="sm" className="tabular-nums">
                <Calendar />
                {format.dateTime(closeDate, {
                  day: 'numeric',
                  month: 'short',
                })}
              </StatusBadge>
            ) : (
              <span className="text-muted-foreground text-2xs flex items-center gap-1">
                <Calendar className="size-3" />
                {/* Pelo next-intl, então a data lê no idioma do app. Estava
                    fixada em en-US, o que imprimia "Mar 14, 2026" numa
                    interface em português. */}
                {format.dateTime(closeDate, {
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            ))}

          {daysHere !== null && (
            <span
              title={t('inStageTitle')}
              className="text-muted-foreground/80 text-2xs shrink-0 tabular-nums"
            >
              {t('inStage', { days: daysHere })}
            </span>
          )}

          {assigneeLabel && (
            // A FOTO, e as iniciais só quando não há foto. `MemberAvatar` é
            // onde a regra mora: imagem quando existe, iniciais com a cor
            // semeada pelo nome quando não. Um segundo disco escrito à mão é
            // como a divergência volta.
            <MemberAvatar
              size="2xs"
              name={assigneeLabel}
              avatarUrl={deal.assignee?.avatar_url}
              className="ml-auto"
            />
          )}
        </div>
      )}
    </button>
  );
}

/** Hoje, em ISO local — o mesmo formato de `expected_close_date`. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Quantos dias inteiros o negócio está nesta etapa, ou `null`.
 *
 * `null` em três casos, e todos os três significam "não diga nada": banco
 * anterior à 065 (a coluna não existe), data inválida, e **o próprio dia em
 * que ele entrou** — "0d" ocuparia espaço para dizer "acabou de chegar", que
 * é o estado normal de todo negócio novo e não é notícia.
 */
function daysInStage(enteredAt: string | null | undefined): number | null {
  if (!enteredAt) return null;
  const entered = new Date(enteredAt);
  if (Number.isNaN(entered.getTime())) return null;
  const days = Math.floor((Date.now() - entered.getTime()) / 86_400_000);
  return days > 0 ? days : null;
}
