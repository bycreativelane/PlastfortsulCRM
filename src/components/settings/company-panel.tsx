'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import {
  MEDIA_MAX_BYTES,
  deleteAccountMedia,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { Panel, PanelBody } from '@/components/ui/panel';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { Textarea } from '@/components/ui/textarea';

/**
 * Quem é a empresa — e é isto que o orçamento imprime.
 *
 * A migração 072 abriu sete colunas em `accounts` porque o documento
 * precisava delas e o CRM não sabia dizer nenhuma: `accounts` tinha nome,
 * dono, fuso, moeda e horário, e `whatsapp_config` guarda o
 * `phone_number_id` da Meta, que é um id e não um telefone que se imprima.
 *
 * Sem esta tela as sete colunas existiriam sem ninguém para preenchê-las,
 * que é a pior forma de entregar um campo.
 *
 * ------------------------------------------------------------------
 * TUDO OPCIONAL, E A TELA DIZ ISSO
 * ------------------------------------------------------------------
 *
 * O documento omite o que falta — sem CNPJ não há linha de CNPJ, sem logo
 * não há buraco onde ela iria. Então nenhum campo aqui é obrigatório, e a
 * frase do topo promete exatamente isso, para ninguém achar que precisa
 * preencher tudo antes de gerar o primeiro orçamento.
 *
 * ------------------------------------------------------------------
 * A LOGO SOBE PELO CAMINHO DA CONTA
 * ------------------------------------------------------------------
 *
 * `uploadAccountMedia` monta `account-<id>/…`, que é o que a política de
 * escrita da 073 exige — `(storage.foldername(name))[1]` tem de ser a
 * conta de quem grava. Reaproveitar o helper não é economia de linhas: é
 * o que garante que o caminho e a política combinem, e a 072 saiu com
 * elas descombinadas justamente por eu ter escrito o caminho à mão.
 *
 * A anterior é APAGADA ao trocar. Um bucket público acumulando cada logo
 * que a empresa já teve é lixo que ninguém vai limpar depois.
 */

interface Identidade {
  legal_name: string;
  tax_id: string;
  company_phone: string;
  company_email: string;
  company_site: string;
  company_address: string;
}

const VAZIA: Identidade = {
  legal_name: '',
  tax_id: '',
  company_phone: '',
  company_email: '',
  company_site: '',
  company_address: '',
};

/** Os campos de uma linha, na ordem em que um documento os lê. */
const CAMPOS: Array<{ chave: keyof Identidade; largo?: boolean }> = [
  { chave: 'legal_name' },
  { chave: 'tax_id' },
  { chave: 'company_phone' },
  { chave: 'company_email' },
  { chave: 'company_site' },
];

export function CompanyPanel() {
  const t = useTranslations('Settings.company');
  const { account, accountId, refreshProfile } = useAuth();
  // `edit-settings` é o portão que o produto usa para 'isto é configuração
  // da conta, não trabalho do dia' — o mesmo do Playbook.
  const canWrite = useCan('edit-settings');

  const [dados, setDados] = useState<Identidade>(VAZIA);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  // Sincronização vinda de prop: a conta chega depois do primeiro render
  // e os campos partem do que ela diz. Sem o `if` acima isto seria uma
  // cascata; com ele, roda uma vez por carga da conta.
  useEffect(() => {
    if (!account) return;
    setDados({
      legal_name: account.legal_name ?? '',
      tax_id: account.tax_id ?? '',
      company_phone: account.company_phone ?? '',
      company_email: account.company_email ?? '',
      company_site: account.company_site ?? '',
      company_address: account.company_address ?? '',
    });
    setLogoUrl(account.logo_url ?? null);
  }, [account]);

  const salvar = useCallback(async () => {
    if (!accountId) return;
    setSalvando(true);
    // Vazio vira NULL, e não string vazia: o documento pergunta "existe?"
    // e um `''` responderia que sim, imprimindo uma linha em branco.
    const limpo = Object.fromEntries(
      Object.entries(dados).map(([k, v]) => [k, v.trim() || null])
    );
    const { error } = await createClient()
      .from('accounts')
      .update(limpo)
      .eq('id', accountId);
    setSalvando(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(t('saved'));
    // A gaveta do orçamento lê a marca do `useAuth`; sem isto o próximo
    // documento sairia com os dados velhos até um recarregamento.
    await refreshProfile();
  }, [accountId, dados, refreshProfile, t]);

  const trocarLogo = useCallback(
    async (file: File) => {
      if (!accountId) return;
      if (file.size > MEDIA_MAX_BYTES) {
        toast.error(t('logoTooBig'));
        return;
      }
      setSubindo(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia('brand', file);
        const { error } = await createClient()
          .from('accounts')
          .update({ logo_url: publicUrl })
          .eq('id', accountId);
        if (error) throw new Error(error.message);
        // A antiga só depois de a nova estar gravada: falhar no meio com a
        // velha já apagada deixaria a empresa sem logo nenhuma.
        if (logoPath)
          void deleteAccountMedia('brand', logoPath).catch(() => {});
        setLogoUrl(publicUrl);
        setLogoPath(path);
        toast.success(t('logoSaved'));
        await refreshProfile();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('saveFailed'));
      } finally {
        setSubindo(false);
      }
    },
    [accountId, logoPath, refreshProfile, t]
  );

  const tirarLogo = useCallback(async () => {
    if (!accountId) return;
    const { error } = await createClient()
      .from('accounts')
      .update({ logo_url: null })
      .eq('id', accountId);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    if (logoPath) void deleteAccountMedia('brand', logoPath).catch(() => {});
    setLogoUrl(null);
    setLogoPath(null);
    await refreshProfile();
  }, [accountId, logoPath, refreshProfile, t]);

  return (
    <div className="space-y-4">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Panel>
        <PanelBody className="space-y-5">
          {/* A LOGO PRIMEIRO, porque é a única coisa aqui que não é texto
              e a única que a pessoa reconhece de longe no documento. */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="border-border bg-muted grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt=""
                  className="size-full object-contain p-1"
                />
              ) : (
                <span className="text-muted-foreground text-2xs px-1 text-center">
                  {t('noLogo')}
                </span>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canWrite || subindo}
                  onClick={() => arquivoRef.current?.click()}
                >
                  {subindo ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {logoUrl ? t('logoReplace') : t('logoUpload')}
                </Button>
                {logoUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canWrite || subindo}
                    onClick={() => void tirarLogo()}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    {t('logoRemove')}
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground text-2xs">{t('logoHint')}</p>
            </div>
            <input
              ref={arquivoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void trocarLogo(f);
              }}
            />
          </div>

          <div className="grid gap-4 @lg:grid-cols-2">
            {CAMPOS.map(({ chave }) => (
              <div key={chave} className="grid gap-2">
                <FieldLabel htmlFor={`co-${chave}`}>{t(chave)}</FieldLabel>
                <Input
                  id={`co-${chave}`}
                  value={dados[chave]}
                  onChange={(e) =>
                    setDados((d) => ({ ...d, [chave]: e.target.value }))
                  }
                  placeholder={t(`${chave}Placeholder`)}
                  disabled={!canWrite}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-2">
            <FieldLabel htmlFor="co-address">{t('company_address')}</FieldLabel>
            <Textarea
              id="co-address"
              value={dados.company_address}
              onChange={(e) =>
                setDados((d) => ({ ...d, company_address: e.target.value }))
              }
              placeholder={t('company_addressPlaceholder')}
              disabled={!canWrite}
              className="min-h-16"
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => void salvar()}
              disabled={!canWrite || salvando}
            >
              {salvando && <Loader2 className="size-4 animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
