'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Truck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { FREIGHT_LABEL_KEY, FREIGHT_PAYER_CODES } from '@/lib/deals/freight';
import type { Carrier } from '@/lib/deals/order-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import { Panel, PanelBody, PanelHeader, PanelSub, PanelTitle } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * TRANSPORTADORAS — o cadastro da 085 (D8).
 *
 * A oportunidade escolhe daqui em vez de digitar o nome. Cada transportadora
 * leva o contato dela no Bling (o transportador do pedido) e o frete-por-conta
 * padrão, que a gaveta preenche ao escolher. A semente da 085 trouxe os nomes
 * que já estavam escritos nas oportunidades; o que falta é ligar cada um ao
 * Bling.
 *
 * Grava direto pela RLS (`carriers_insert/update` exigem admin). Sem DELETE:
 * pedido antigo aponta para a transportadora, então ela sai de uso com
 * "ativa" desligado.
 */

type Rascunho = Pick<
  Carrier,
  | 'name'
  | 'bling_contact_id'
  | 'bling_contact_name'
  | 'default_freight_payer_code'
  | 'requires_freight_value'
  | 'is_customer_pickup'
  | 'active'
>;

function rascunhoDe(c: Carrier): Rascunho {
  return {
    name: c.name,
    bling_contact_id: c.bling_contact_id,
    bling_contact_name: c.bling_contact_name,
    default_freight_payer_code: c.default_freight_payer_code,
    requires_freight_value: c.requires_freight_value,
    is_customer_pickup: c.is_customer_pickup,
    active: c.active,
  };
}

const TABELA_AUSENTE = ['PGRST205', '42P01'];

export function CarriersPanel() {
  const t = useTranslations('Settings.carriers');
  const tForm = useTranslations('Pipelines.form');
  const { accountId, canEditSettings } = useAuth();
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [estado, setEstado] = useState<'loading' | 'ready' | 'pending'>('loading');
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [novo, setNovo] = useState('');
  const [gravando, setGravando] = useState(false);

  /** Muda para reler a lista depois de gravar. */
  const [versao, setVersao] = useState(0);
  const carregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    if (!accountId) return;
    let cancelado = false;
    (async () => {
      const { data, error } = await createClient()
        .from('carriers')
        .select('*')
        .eq('account_id', accountId)
        .order('name');
      if (cancelado) return;
      if (error) {
        const ausente = TABELA_AUSENTE.includes(error.code ?? '');
        setEstado(ausente ? 'pending' : 'ready');
        if (!ausente) toast.error(t('loadFailed'));
        return;
      }
      setCarriers((data ?? []) as Carrier[]);
      setEstado('ready');
    })();
    return () => {
      cancelado = true;
    };
  }, [accountId, t, versao]);

  async function criar() {
    const nome = novo.trim();
    if (!nome || !accountId) return;
    setGravando(true);
    const { error } = await createClient()
      .from('carriers')
      .insert({ account_id: accountId, name: nome.slice(0, 120) });
    setGravando(false);
    if (error) {
      toast.error(error.code === '23505' ? t('duplicate') : t('saveFailed'));
      return;
    }
    setNovo('');
    toast.success(t('created'));
    carregar();
  }

  async function salvar(id: string) {
    if (!rascunho) return;
    const nome = rascunho.name.trim();
    if (!nome) return;
    setGravando(true);
    const { error } = await createClient()
      .from('carriers')
      .update({
        name: nome.slice(0, 120),
        bling_contact_id: rascunho.bling_contact_id?.trim() || null,
        bling_contact_name: rascunho.bling_contact_name?.trim() || null,
        default_freight_payer_code: rascunho.default_freight_payer_code || null,
        requires_freight_value: rascunho.requires_freight_value,
        is_customer_pickup: rascunho.is_customer_pickup,
        active: rascunho.active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    setGravando(false);
    if (error) {
      toast.error(error.code === '23505' ? t('duplicate') : t('saveFailed'));
      return;
    }
    setEditando(null);
    setRascunho(null);
    toast.success(t('saved'));
    carregar();
  }

  if (estado === 'pending') return null;

  return (
    <Panel>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle className="flex items-center gap-2">
            <Truck className="text-primary size-4" />
            {t('title')}
          </PanelTitle>
          <PanelSub>{t('description')}</PanelSub>
        </div>
      </PanelHeader>
      <PanelBody className="space-y-3">
        {estado === 'loading' ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            {t('loading')}
          </p>
        ) : carriers.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <ul className="border-border divide-border divide-y rounded-md border">
            {carriers.map((c) => (
              <li key={c.id} className="space-y-2 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                    {c.name}
                  </span>
                  {c.is_customer_pickup && (
                    <StatusBadge variant="neutral" size="sm">
                      {t('pickup')}
                    </StatusBadge>
                  )}
                  {!c.is_customer_pickup &&
                    (c.bling_contact_id ? (
                      <StatusBadge variant="ok" size="sm">
                        {t('mapped')}
                      </StatusBadge>
                    ) : (
                      <StatusBadge variant="human" size="sm">
                        {t('notMapped')}
                      </StatusBadge>
                    ))}
                  {!c.active && (
                    <StatusBadge variant="neutral" size="sm">
                      {t('inactive')}
                    </StatusBadge>
                  )}
                  {canEditSettings && editando !== c.id && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditando(c.id);
                        setRascunho(rascunhoDe(c));
                      }}
                    >
                      {t('edit')}
                    </Button>
                  )}
                </div>

                {editando === c.id && rascunho && (
                  <div className="@container grid gap-3">
                    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                      <div className="grid gap-1.5">
                        <FieldLabel htmlFor={`carrier-name-${c.id}`}>{t('name')}</FieldLabel>
                        <Input
                          id={`carrier-name-${c.id}`}
                          value={rascunho.name}
                          maxLength={120}
                          onChange={(e) => setRascunho({ ...rascunho, name: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel htmlFor={`carrier-freight-${c.id}`}>
                          {t('defaultFreight')}
                        </FieldLabel>
                        <OptionSelect
                          id={`carrier-freight-${c.id}`}
                          value={rascunho.default_freight_payer_code ?? ''}
                          onValueChange={(v) =>
                            setRascunho({ ...rascunho, default_freight_payer_code: v || null })
                          }
                        >
                          <option value="">{tForm('freightModeNone')}</option>
                          {FREIGHT_PAYER_CODES.map((codigo) => (
                            <option key={codigo} value={codigo}>
                              {`${codigo} · ${tForm(FREIGHT_LABEL_KEY[codigo])}`}
                            </option>
                          ))}
                        </OptionSelect>
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel htmlFor={`carrier-bling-${c.id}`}>
                          {t('blingContactId')}
                        </FieldLabel>
                        <Input
                          id={`carrier-bling-${c.id}`}
                          value={rascunho.bling_contact_id ?? ''}
                          inputMode="numeric"
                          maxLength={30}
                          onChange={(e) =>
                            setRascunho({
                              ...rascunho,
                              bling_contact_id: e.target.value.replace(/\D/g, '') || null,
                            })
                          }
                        />
                        <p className="text-muted-foreground text-2xs">{t('blingContactHint')}</p>
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel htmlFor={`carrier-bling-name-${c.id}`}>
                          {t('blingContactName')}
                        </FieldLabel>
                        <Input
                          id={`carrier-bling-name-${c.id}`}
                          value={rascunho.bling_contact_name ?? ''}
                          maxLength={120}
                          onChange={(e) =>
                            setRascunho({ ...rascunho, bling_contact_name: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {(
                        [
                          ['is_customer_pickup', t('pickupLabel')],
                          ['requires_freight_value', t('requiresFreight')],
                          ['active', t('activeLabel')],
                        ] as const
                      ).map(([campo, rotulo]) => (
                        <label key={campo} className="flex cursor-pointer items-center gap-2 text-xs">
                          <Checkbox
                            checked={rascunho[campo]}
                            onCheckedChange={(v) => setRascunho({ ...rascunho, [campo]: v === true })}
                          />
                          {rotulo}
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditando(null);
                          setRascunho(null);
                        }}
                      >
                        {t('cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={gravando || !rascunho.name.trim()}
                        onClick={() => salvar(c.id)}
                      >
                        {gravando && <Loader2 className="size-3.5 animate-spin" />}
                        {t('save')}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEditSettings ? (
          <div className="flex gap-2">
            <Input
              id="carrier-new"
              value={novo}
              maxLength={120}
              placeholder={t('newPlaceholder')}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void criar();
                }
              }}
            />
            <Button type="button" variant="outline" disabled={gravando || !novo.trim()} onClick={criar}>
              <Plus className="size-3.5" />
              {t('add')}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{t('adminOnly')}</p>
        )}
      </PanelBody>
    </Panel>
  );
}
