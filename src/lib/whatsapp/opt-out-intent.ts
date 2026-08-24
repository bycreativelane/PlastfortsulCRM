/**
 * Whether an inbound WhatsApp payload is the customer asking us to stop.
 *
 * Marketing templates promise two exits: reply SAIR (footer) or tap
 * "Não quero receber" (quick reply). Broadcasts filter `contacts.opted_out`;
 * this is the only place that should set that flag from the wire.
 *
 * Keep this strict. Matching SAIR as a substring would treat "não vou sair"
 * as opt-out. Matching any negative button would treat "Agora não" on a
 * review ask as a legal stop.
 */

const SAIR = /^sair[.!?]*$/i;
const STOP_BUTTON = /^nao quero receber$/i;

function foldPt(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function isOptOutIntent(input: {
  text?: string | null;
  buttonLabel?: string | null;
  buttonPayload?: string | null;
}): boolean {
  const text = input.text?.trim() ?? '';
  if (text && SAIR.test(text)) return true;

  for (const raw of [input.buttonLabel, input.buttonPayload]) {
    if (!raw?.trim()) continue;
    if (STOP_BUTTON.test(foldPt(raw))) return true;
    if (SAIR.test(raw.trim())) return true;
  }
  return false;
}
