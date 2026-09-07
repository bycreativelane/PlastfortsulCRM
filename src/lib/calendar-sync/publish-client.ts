/**
 * Pedir ao servidor que reconcilie uma tarefa com a agenda da Google.
 *
 * ------------------------------------------------------------------
 * SÍNCRONO NO SERVIDOR, NÃO BLOQUEANTE NA TELA
 * ------------------------------------------------------------------
 *
 * O §D4 pede envio síncrono "porque é o que a pessoa espera ver" — e é o
 * SERVIDOR que empurra na hora, em vez de enfileirar para o cron de cinco
 * minutos. Mas a tela não espera a viagem até a Google para fechar o
 * diálogo: a tarefa já está salva no CRM quando esta chamada começa, e
 * prender o botão por dois segundos de rede alheia sugere que o
 * salvamento depende dela. Não depende.
 *
 * Falha aqui não é erro visível: a caixa de saída da 069 guarda o vínculo
 * em `pending` e o cron drena. O que a pessoa vê é o estado do vínculo na
 * linha da tarefa, que é onde ele é verdade — e não um alerta sobre uma
 * integração que talvez ela nem tenha configurado.
 */
export async function publishTask(taskId: string): Promise<void> {
  try {
    await fetch('/api/calendar/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
  } catch {
    // Silêncio de propósito — ver o comentário acima.
  }
}
