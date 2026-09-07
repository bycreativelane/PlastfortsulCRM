'use client';

import { Suspense } from 'react';

import { AgendaPage } from '@/components/agenda/agenda-view';

/**
 * Agenda.
 *
 * Um invólucro fino, como toda rota deste app: o trabalho mora no
 * componente e a rota existe para o menu ter para onde apontar.
 *
 * O `Suspense` não é decoração — `useSearchParams` obriga, e sem ele a
 * página inteira sai da renderização estática.
 */
export default function AgendaRoute() {
  return (
    <Suspense>
      <AgendaPage />
    </Suspense>
  );
}
