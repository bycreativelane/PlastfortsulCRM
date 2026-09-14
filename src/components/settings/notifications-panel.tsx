'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { AtSign, ListChecks, MessageSquare, UserPlus } from 'lucide-react';

import {
  isNotificationSoundOn,
  isTypeSoundOn,
  playNotificationSound,
  setNotificationSoundOn,
  setTypeSoundOn,
  SOUND_TYPES,
  subscribeNotificationSound,
  type SoundType,
} from '@/lib/notifications/sound';
import { Panel, PanelBody } from '@/components/ui/panel';
import { Switch } from '@/components/ui/switch';
import { IconTile } from '@/components/ui/icon-tile';
import { cn } from '@/lib/utils';

/**
 * O QUE TE INTERROMPE — no perfil de cada pessoa.
 *
 * Pedido do Gabriel em 14 de setembro: *"tá faltando a opção de
 * configuração das notificações no perfil da pessoa e também para mensagem
 * recebida, tarefa, e etc"*.
 *
 * ------------------------------------------------------------------
 * O QUE SE ESCOLHE AQUI É O SOM, E NÃO O AVISO
 * ------------------------------------------------------------------
 *
 * O sino continua listando tudo. Desligar um tipo aqui não apaga a linha
 * dele: esconder uma notificação que existe no banco mostraria "nenhuma"
 * para quem tem três, e o número deixaria de bater com a lista — que é
 * como se ensina alguém a não confiar no sino.
 *
 * O que muda é o que INTERROMPE. Quem atende o dia inteiro quer ouvir o
 * cliente escrevendo e não quer ouvir lembrete de tarefa; quem passa o dia
 * no funil quer o contrário. É uma escolha por pessoa, e por APARELHO — o
 * computador do escritório toca, o notebook da reunião não —, e por isso
 * mora no navegador e não no banco.
 *
 * ------------------------------------------------------------------
 * LIGAR TOCA
 * ------------------------------------------------------------------
 *
 * Cada interruptor que acende toca o próprio som, e isso não é enfeite:
 * o navegador não deixa tocar nada antes de um gesto da pessoa, então o
 * clique é o momento em que dá para provar que o som funciona NESTE
 * aparelho. Sem isso, a única forma de descobrir que o alto-falante está
 * mudo é perder um aviso.
 */

const ICONE: Record<SoundType, typeof MessageSquare> = {
  new_message: MessageSquare,
  conversation_assigned: UserPlus,
  task_due: ListChecks,
  team_mention: AtSign,
};

export function NotificationsPanel() {
  const t = useTranslations('Settings.notifications');

  const ligado = useSyncExternalStore(
    subscribeNotificationSound,
    isNotificationSoundOn,
    () => false
  );
  // Um assinante por tipo seria quatro assinaturas para uma chave só. O
  // estado externo é a preferência inteira; o tipo é lido na renderização.
  const versao = useSyncExternalStore(
    subscribeNotificationSound,
    () => SOUND_TYPES.map((tipo) => (isTypeSoundOn(tipo) ? '1' : '0')).join(''),
    () => '1111'
  );

  return (
    <Panel>
      <PanelBody className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-foreground text-sm font-semibold">
              {t('soundTitle')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t('soundHint')}
            </p>
          </div>
          <Switch
            checked={ligado}
            onCheckedChange={(on) => {
              setNotificationSoundOn(on);
              if (on) playNotificationSound('preview');
            }}
            aria-label={t('soundTitle')}
          />
        </div>

        <div
          className={cn(
            'border-border/60 space-y-1 border-t pt-3 transition-opacity',
            // Desligado no geral, os tipos continuam VISÍVEIS e apagados:
            // sumir faria a pessoa achar que a escolha por tipo não existe.
            !ligado && 'pointer-events-none opacity-50'
          )}
        >
          {SOUND_TYPES.map((tipo, i) => {
            const Icone = ICONE[tipo];
            const marcado = versao[i] === '1';
            return (
              <label
                key={tipo}
                className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
              >
                <IconTile size="xs" tone={marcado ? 'primary' : 'neutral'}>
                  <Icone />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block text-sm">
                    {t(`types.${tipo}`)}
                  </span>
                  <span className="text-muted-foreground text-2xs block">
                    {t(`hints.${tipo}`)}
                  </span>
                </span>
                <Switch
                  checked={marcado}
                  disabled={!ligado}
                  onCheckedChange={(on) => {
                    setTypeSoundOn(tipo, on);
                    if (on) playNotificationSound(tipo);
                  }}
                  aria-label={t(`types.${tipo}`)}
                />
              </label>
            );
          })}
        </div>

        <p className="text-muted-foreground text-2xs">{t('deviceNote')}</p>
      </PanelBody>
    </Panel>
  );
}
