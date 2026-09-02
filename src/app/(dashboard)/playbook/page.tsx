'use client';

import { PlaybookArea } from '@/components/playbook/playbook-area';

/**
 * Playbook — a base de consulta comercial.
 *
 * Casca fina, como toda rota deste app: o trabalho vive no componente e
 * a rota existe para o menu ter para onde apontar.
 */
export default function PlaybookPage() {
  return <PlaybookArea />;
}
