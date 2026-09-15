'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ReceiptText } from 'lucide-react';

import { OptionSelect } from '@/components/ui/option-select';
import { Panel, PanelBody, PanelHeader, PanelSub, PanelTitle } from '@/components/ui/panel';

/**
 * "VENDEDOR NO BLING" — o vínculo de cada pessoa da equipe (D8, 085).
 *
 * Aparece só para admin e só quando há conexão com vendedores: sem Bling, a
 * tela Equipe continua igual. O pedido leva o vendedor do responsável pela
 * oportunidade.
 */

interface Pessoa {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface Resposta {
  state: 'ok' | 'none' | 'pending';
  sellers?: Array<{ id: string; label: string; active: boolean }>;
  links?: Array<{ userId: string; sellerId: string }>;
}

export function BlingSellerLinks({ members }: { members: Pessoa[] }) {
  const t = useTranslations('Settings.members.blingSellers');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);

  /** Muda para reler depois de gravar. */
  const [versao, setVersao] = useState(0);
  const carregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const res = await fetch('/api/bling/sellers', { cache: 'no-store' }).catch(() => null);
      const corpo = res && res.ok ? ((await res.json().catch(() => null)) as Resposta | null) : null;
      if (!cancelado) setDados(corpo);
    })();
    return () => {
      cancelado = true;
    };
  }, [versao]);

  if (!dados || dados.state !== 'ok' || !dados.sellers?.length) return null;

  const vinculo = new Map((dados.links ?? []).map((l) => [l.userId, l.sellerId]));
  const doOutro = new Map((dados.links ?? []).map((l) => [l.sellerId, l.userId]));

  async function ligar(userId: string, sellerId: string) {
    setGravando(userId);
    const res = await fetch('/api/bling/sellers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sellerId: sellerId || null }),
    }).catch(() => null);
    setGravando(null);
    if (!res || !res.ok) {
      const corpo = await res?.json().catch(() => ({}));
      toast.error(corpo?.error === 'seller_taken' ? t('taken') : t('saveFailed'));
      return;
    }
    toast.success(t('saved'));
    carregar();
  }

  return (
    <Panel>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle className="flex items-center gap-2">
            <ReceiptText className="text-primary size-4" />
            {t('title')}
          </PanelTitle>
          <PanelSub>{t('description')}</PanelSub>
        </div>
      </PanelHeader>
      <PanelBody>
        <ul className="divide-border divide-y">
          {members.map((m) => {
            const atual = vinculo.get(m.user_id) ?? '';
            return (
              <li
                key={m.user_id}
                className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-foreground min-w-0 truncate text-sm">
                  {m.full_name || m.email || t('unnamed')}
                </span>
                <OptionSelect
                  value={atual}
                  disabled={gravando === m.user_id}
                  aria-label={t('selectLabel', { name: m.full_name || m.email || '' })}
                  onValueChange={(v) => void ligar(m.user_id, v)}
                  className="bg-muted border-border text-foreground w-full sm:w-64"
                >
                  <option value="">{t('none')}</option>
                  {/* Vínculo com um vendedor que saiu do Bling: sem esta opção
                      o seletor desenhava o id cru. */}
                  {atual && !dados.sellers!.some((s) => s.id === atual) ? (
                    <option value={atual}>{t('removedSeller', { id: atual })}</option>
                  ) : null}
                  {dados.sellers!.map((s) => {
                    const outro = doOutro.get(s.id);
                    return (
                      <option key={s.id} value={s.id} disabled={!!outro && outro !== m.user_id}>
                        {s.active ? s.label : t('inactiveSeller', { name: s.label })}
                      </option>
                    );
                  })}
                </OptionSelect>
              </li>
            );
          })}
        </ul>
      </PanelBody>
    </Panel>
  );
}
