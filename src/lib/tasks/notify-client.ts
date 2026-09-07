/**
 * Avisar o servidor que uma tarefa mudou de estado.
 *
 * Duas coisas do lado de lá reagem a isso e nenhuma delas pode rodar no
 * navegador: publicar na agenda da Google (precisa do refresh token) e o
 * gatilho `task_completed` do motor de automações (precisa ler as
 * automações da conta e mandar mensagem). As duas viram uma chamada cada.
 *
 * Nenhuma bloqueia nem alerta: a tarefa já está salva quando isto começa, e
 * uma integração que a conta talvez nem tenha configurado não deveria
 * produzir um erro vermelho na tela de quem só marcou uma ligação como
 * feita.
 */
async function post(url: string, taskId: string): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
  } catch {
    // Silêncio de propósito — ver o comentário acima.
  }
}

/** Reconciliar com a agenda externa. */
export function publishTask(taskId: string): Promise<void> {
  return post('/api/calendar/publish', taskId);
}

/**
 * Disparar o gatilho `task_completed`.
 *
 * Chamada também ao REABRIR: a rota confere o estado real no banco e não
 * dispara nada quando a tarefa não está concluída. Deixar essa decisão no
 * servidor evita que a tela precise saber quais transições disparam o quê.
 */
export function notifyTaskCompleted(taskId: string): Promise<void> {
  return post('/api/automations/task-completed', taskId);
}
