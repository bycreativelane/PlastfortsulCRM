'use client';

import { useEffect, useId, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * "A etiqueta que a automação pendurou tem que aparecer sozinha."
 *
 * O outro lado da migração 067. Metade do que uma automação faz já
 * chegava viva na tela porque `messages` e `conversations` estão na
 * publicação `supabase_realtime` desde a 001 — a mensagem que ela manda
 * aparece na hora. A outra metade (`add_tag`, `remove_tag`,
 * `update_contact_field`, `create_deal`, `move_deal_stage`) escrevia em
 * tabelas que a publicação não carregava, e ficava invisível até o F5.
 * Lido de fora, isso não é "faltou atualizar": é "a automação não rodou".
 *
 * DELIBERADAMENTE SEM FILTRO POR CONTATO. O payload de um DELETE traz só
 * a chave primária — remover uma etiqueta chega como um uuid de
 * `contact_tags` e nada mais, sem o `contact_id` para comparar. Então o
 * contrato aqui é o mais fraco que ainda resolve: "alguma coisa do lado
 * do contato mudou, recarregue o que você mostra". Quem chama já sabe o
 * que tem na tela; o hook não precisa saber.
 *
 * As rajadas são reais — uma automação que põe etiqueta e cria
 * oportunidade emite dois eventos em milissegundos — e por isso o
 * `onChange` sai uma vez só por rajada, depois de `debounceMs`.
 *
 * UM CANAL POR CONSUMIDOR, pelo mesmo motivo de `use-total-unread`: o
 * cliente do browser é memoizado e `.channel(nome)` devolve o MESMO canal
 * para o mesmo nome, então um `.on()` depois do `subscribe()` de outro
 * componente é um throw dentro de um efeito — a tela inteira vira "algo
 * quebrou". `useId` é estável entre renders e único por instância, que é
 * exatamente o escopo de uma assinatura.
 *
 * Sem a 067 aplicada isto é inerte: assina, nunca recebe nada, e não
 * quebra nada.
 */
export function useContactRealtime({
  onChange,
  enabled = true,
  debounceMs = 250,
}: {
  onChange: () => void;
  enabled?: boolean;
  debounceMs?: number;
}): void {
  const instanceId = useId();

  // O callback vive num ref porque quem chama passa uma closure nova a
  // cada render; sem isto, cada render derrubaria e reabriria o websocket.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChangeRef.current();
      }, debounceMs);
    };

    const channel = supabase
      .channel(`contact-surface:${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contact_tags' },
        schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts' },
        schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deals' },
        schedule
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [instanceId, enabled, debounceMs]);
}
