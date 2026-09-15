import type { NotificationType } from '@/types';

/**
 * O SOM DE NOTIFICAÇÃO.
 *
 * Pedido do Gabriel em 8 de setembro de 2026: "precisa implementar
 * notificação em som na plataforma". O sino já conta ao vivo; o que faltava
 * era chamar quem NÃO está olhando para ele — que é justamente quem tem o
 * CRM numa aba de fundo enquanto responde e-mail.
 *
 * ------------------------------------------------------------------
 * QUANDO TOCA
 * ------------------------------------------------------------------
 *
 * Quando uma notificação chega ao sino desta pessoa, e só então. O sino é
 * a lista do que precisa de atenção — mensagem de cliente, conversa
 * atribuída, lembrete de tarefa, menção na sala da equipe —, e cada tipo
 * já passou por um filtro antes de virar linha: a mensagem de cliente, por
 * exemplo, avisa no máximo uma vez a cada cinco minutos por conversa (ver
 * `notifications/new-message.ts`). O som herda esse filtro e não inventa
 * um critério paralelo.
 *
 * Mensagem comum da sala da equipe NÃO toca. Ela não é notificação — é
 * conversa entre colegas, e tocar a cada frase treinaria a equipe a tirar
 * o som. A menção toca, porque ela é uma notificação.
 *
 * ------------------------------------------------------------------
 * UMA ABA SÓ
 * ------------------------------------------------------------------
 *
 * Quem deixa o CRM aberto em três abas ouviria três toques para o mesmo
 * aviso — cada aba recebe o mesmo evento do realtime. A Web Locks API
 * resolve isso sem servidor: a primeira aba a pedir a trava toca e a
 * segura por um instante; as outras desistem na hora.
 *
 * ------------------------------------------------------------------
 * SINTETIZADO, E NÃO UM ARQUIVO
 * ------------------------------------------------------------------
 *
 * Dois tons com envelope, pela Web Audio API. Um arquivo de áudio seria
 * uma requisição a mais, uma licença a conferir e um formato a escolher
 * para cada navegador; dois osciladores são meia dúzia de linhas e soam
 * iguais em todo lugar.
 *
 * O navegador não deixa tocar som antes de a pessoa interagir com a
 * página. `unlockNotificationSound` prepara o áudio no primeiro clique ou
 * tecla; um aviso que chegue antes disso fica em silêncio, e não há o que
 * fazer a respeito — é a política do navegador, não uma escolha daqui.
 */

const SOUND_KEY = 'wacrm.notificationSound';
const TYPES_KEY = 'wacrm.notificationSound.types';
const LOCK_NAME = 'wacrm:notification-sound';
/** Quanto tempo a aba que tocou segura a trava — e o intervalo mínimo. */
const QUIET_MS = 1500;

/** Disparado quando a preferência muda NESTA aba. */
export const SOUND_PREF_EVENT = 'wacrm:notification-sound';

/**
 * Ligado por padrão.
 *
 * O pedido foi para implementar o som, e um som que nasce desligado é um
 * som que ninguém descobre. Quem não quiser desliga no sino, com um clique.
 * No `localStorage` e não no banco: é uma preferência DESTE aparelho — o
 * computador do escritório toca, o notebook da reunião não.
 */
export function isNotificationSoundOn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * POR TIPO, e não só ligado/desligado.
 *
 * Pedido do Gabriel em 14 de setembro: "ta faltando a opção de
 * configuração das notificações no perfil da pessoa e também para mensagem
 * recebida, tarefa, e etc". Faz sentido: quem atende o dia inteiro quer
 * ouvir o cliente escrevendo e não quer ouvir um lembrete de tarefa; quem
 * está fora da caixa de entrada quer o contrário.
 *
 * O que se escolhe aqui é o SOM, e não a existência do aviso. O sino
 * continua listando tudo — esconder uma notificação que existe no banco
 * seria mostrar "nenhuma" para quem tem três, e o número deixaria de
 * bater com a lista. O que a pessoa escolhe é o que a INTERROMPE.
 *
 * Tudo ligado por padrão, e por aparelho, como o interruptor geral.
 */
export type SoundType =
  | 'new_message'
  | 'conversation_assigned'
  | 'task_due'
  | 'team_mention'
  | 'bling_order';

export const SOUND_TYPES: SoundType[] = [
  'new_message',
  'conversation_assigned',
  'task_due',
  'team_mention',
  'bling_order',
];

function lerTipos(): Partial<Record<SoundType, boolean>> {
  if (typeof window === 'undefined') return {};
  try {
    const cru = window.localStorage.getItem(TYPES_KEY);
    return cru ? (JSON.parse(cru) as Partial<Record<SoundType, boolean>>) : {};
  } catch {
    // Chave corrompida ou armazenamento bloqueado: tudo ligado, que é o
    // padrão — uma preferência ilegível não pode calar o produto.
    return {};
  }
}

export function isTypeSoundOn(type: string): boolean {
  return lerTipos()[type as SoundType] !== false;
}

export function setTypeSoundOn(type: SoundType, on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      TYPES_KEY,
      JSON.stringify({ ...lerTipos(), [type]: on })
    );
  } catch {
    /* Uma preferência que não se guarda não vale um erro na tela. */
  }
  window.dispatchEvent(new CustomEvent(SOUND_PREF_EVENT));
}

export function setNotificationSoundOn(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* Uma preferência que não se guarda não vale um erro na tela. */
  }
  window.dispatchEvent(new CustomEvent(SOUND_PREF_EVENT));
}

export function subscribeNotificationSound(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === SOUND_KEY || e.key === TYPES_KEY) listener();
  };
  window.addEventListener(SOUND_PREF_EVENT, listener);
  // As OUTRAS abas: `storage` só dispara nelas, nunca na que escreveu.
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SOUND_PREF_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

let ctx: AudioContext | null = null;
let unlocked = false;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/**
 * Prepara o áudio no primeiro gesto da pessoa.
 *
 * Idempotente: pode ser chamada de qualquer lugar que monte cedo, quantas
 * vezes for; os ouvintes saem sozinhos depois do primeiro gesto.
 */
export function unlockNotificationSound(): void {
  if (typeof window === 'undefined' || unlocked) return;
  unlocked = true;
  const desbloquear = () => {
    const c = audio();
    void c?.resume().catch(() => {});
    window.removeEventListener('pointerdown', desbloquear);
    window.removeEventListener('keydown', desbloquear);
  };
  window.addEventListener('pointerdown', desbloquear);
  window.addEventListener('keydown', desbloquear);
}

/**
 * As notas de cada aviso, em hertz.
 *
 * A menção sobe uma nota a mais. É o mesmo raciocínio da cor: âmbar é o
 * "venha cá" da casa, e alguém chamando você pelo nome merece ser
 * distinguível de ouvido de "chegou mensagem" — sem precisar olhar.
 */
export function notesFor(type: NotificationType | string): number[] {
  if (type === 'team_mention') return [784, 1047, 1319];
  return [880, 1320];
}

function tocar(notas: number[]): void {
  const c = audio();
  if (!c || c.state !== 'running') return;

  const inicio = c.currentTime + 0.01;
  notas.forEach((freq, i) => {
    const osc = c.createOscillator();
    const ganho = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const t0 = inicio + i * 0.11;
    // Ataque curto e queda exponencial: um "plim", não um apito. O volume
    // de pico é baixo de propósito — o som é para ser ouvido numa sala
    // silenciosa, não para assustar quem está de fone.
    ganho.gain.setValueAtTime(0.0001, t0);
    ganho.gain.exponentialRampToValueAtTime(0.12, t0 + 0.012);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);

    osc.connect(ganho).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.34);
  });
}

let ultimoToque = 0;

/**
 * Toca o aviso, se estiver ligado, numa aba só.
 */
export function playNotificationSound(type: NotificationType | string): void {
  // O interruptor geral e o do tipo. A prévia do próprio botão ('preview')
  // não é um tipo e passa pelo geral só — quem acabou de ligar o som quer
  // ouvir que ligou.
  if (!isNotificationSoundOn()) return;
  if (type !== 'preview' && !isTypeSoundOn(type)) return;

  const locks = (
    navigator as Navigator & {
      locks?: {
        request: (
          name: string,
          options: { ifAvailable: boolean },
          callback: (lock: unknown) => Promise<void>
        ) => Promise<void>;
      };
    }
  ).locks;

  if (locks) {
    void locks
      .request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        // Outra aba já está tocando este aviso.
        if (!lock) return;
        tocar(notesFor(type));
        await new Promise((r) => setTimeout(r, QUIET_MS));
      })
      .catch(() => {});
    return;
  }

  // Sem Web Locks (navegador antigo): ao menos esta aba não toca duas vezes
  // seguidas quando dois avisos chegam juntos.
  const agora = Date.now();
  if (agora - ultimoToque < QUIET_MS) return;
  ultimoToque = agora;
  tocar(notesFor(type));
}
