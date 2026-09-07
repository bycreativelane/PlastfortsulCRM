'use client';

import { Suspense } from 'react';

import { TasksPage } from '@/components/tasks/tasks-page';

/**
 * Tarefas.
 *
 * Invólucro fino, como toda rota deste app. O `Suspense` é obrigatório
 * porque a tela lê `useSearchParams` — o deep link `?task=<id>`, o mesmo
 * que a agenda e as notificações de lembrete apontam.
 */
export default function TasksRoute() {
  return (
    <Suspense>
      <TasksPage />
    </Suspense>
  );
}
