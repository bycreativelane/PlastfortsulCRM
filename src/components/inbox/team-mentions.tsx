'use client';

import { useTranslations } from 'next-intl';
import { AtSign } from 'lucide-react';

import type { DirectoryMember } from '@/hooks/use-member-directory';
import { mentionSegments, type MentionMember } from '@/lib/team/mentions';
import type { PresenceStatus } from '@/lib/presence';
import { MemberAvatar } from '@/components/presence/member-avatar';
import { cn } from '@/lib/utils';

/**
 * AS DUAS PEÇAS VISÍVEIS DO `@fulano` — puras, e por isso no `/chart-lab`.
 *
 * A sala da equipe vive atrás do login e busca tudo o que desenha. As
 * menções são inteiramente sobre aparência — "uma cor diferente", nas
 * palavras do pedido —, e sem estas duas peças separadas a única forma de
 * conferir o âmbar no tema escuro seria entrar no app e pedir a um colega
 * que mencionasse você.
 */

/**
 * O corpo da mensagem com as menções pintadas.
 *
 * ÂMBAR quando chama QUEM ESTÁ LENDO, e só então: é a doutrina de cor da
 * casa — âmbar é o único "venha cá", e uma menção a você é literalmente
 * isso. Chamar um colega é informação, não convocação: azul, a cor de
 * "isto é um nome" no resto do produto.
 *
 * Só colore o que está em `mentions` (ver `mentionSegments`): um "@Fulano"
 * digitado à mão, que não avisou ninguém, fica como texto.
 */
export function MentionText({
  body,
  mentions,
  members,
  selfId,
}: {
  body: string;
  mentions: string[] | null | undefined;
  members: Map<string, MentionMember>;
  selfId: string | null;
}) {
  return (
    <>
      {mentionSegments(body, mentions, members, selfId).map((pedaco, i) =>
        pedaco.mention ? (
          <span
            key={i}
            className={cn(
              'rounded px-0.5 font-semibold',
              pedaco.mention.self
                ? 'bg-human-soft text-human-ink'
                : 'text-primary'
            )}
          >
            {pedaco.text}
          </span>
        ) : (
          pedaco.text
        )
      )}
    </>
  );
}

/**
 * O painel de `@`, gêmeo do `/` e do `@` do atendimento: acima do campo,
 * na mesma geometria, com as mesmas teclas.
 *
 * O campo nunca perde o foco — `onMouseDown` com `preventDefault`, porque
 * o `click` chega depois do `blur`, e o `blur` já teria fechado o painel.
 *
 * O POSICIONAMENTO é de quem chama (`className`): na sala ele sai colado
 * no topo do compositor; na bancada, dentro de uma moldura.
 */
export function MentionPanel({
  matches,
  cursor,
  onHover,
  onPick,
  presenceOf,
  className,
}: {
  matches: DirectoryMember[];
  cursor: number;
  onHover: (index: number) => void;
  onPick: (member: DirectoryMember) => void;
  presenceOf: (userId: string) => PresenceStatus;
  className?: string;
}) {
  const t = useTranslations('Inbox.team');
  return (
    <div
      role="listbox"
      aria-label={t('mentionPanel')}
      className={cn(
        'border-border bg-popover max-h-64 overflow-y-auto rounded-lg border p-1 shadow-lg',
        className
      )}
    >
      {matches.length === 0 ? (
        <p className="text-muted-foreground px-3 py-3 text-center text-xs">
          {t('mentionNoMatch')}
        </p>
      ) : (
        matches.map((member, i) => (
          <button
            key={member.user_id}
            type="button"
            role="option"
            aria-selected={i === cursor}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(member);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
              i === cursor && 'bg-muted'
            )}
          >
            <MemberAvatar
              name={member.full_name}
              avatarUrl={member.avatar_url}
              size="sm"
              status={presenceOf(member.user_id)}
            />
            <span className="text-popover-foreground min-w-0 flex-1 truncate text-sm">
              {member.full_name}
            </span>
          </button>
        ))
      )}
      <p className="border-border text-muted-foreground text-3xs flex items-center gap-1 border-t px-2.5 pt-2 pb-1">
        <AtSign className="size-3" />
        {t('mentionHint')}
      </p>
    </div>
  );
}
