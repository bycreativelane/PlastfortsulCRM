'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';

import { formatCurrency } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody } from '@/components/ui/panel';

/**
 * A FICHA de um produto, não a linha dele no catálogo.
 *
 * ------------------------------------------------------------------
 * POR QUE ISTO NÃO É O `ProductCatalog`
 * ------------------------------------------------------------------
 *
 * A primeira versão desta aba montava a tela de Produtos inteira aqui
 * dentro, e isso estava errado por dois motivos:
 *
 *   · Produtos já tem linha própria no menu. Montar a mesma tela numa
 *     aba do Playbook são duas portas para a mesma sala.
 *   · E, principalmente, o catálogo é uma tela de GESTÃO — adicionar,
 *     editar, desativar, importar. Ninguém edita catálogo com o cliente
 *     esperando no telefone.
 *
 * O que a conversa pede é outra coisa: o cliente perguntou a resistência
 * da bobina, ou a micragem, ou quantos vêm no fardo. Isso é uma FICHA —
 * só leitura, densa, e organizada para ser varrida com o olho em dois
 * segundos, não navegada.
 *
 * Mesma fonte de dados, `products` (migrações 054 e 055). Zero
 * duplicação: o que muda é o que se faz com ela.
 *
 * ------------------------------------------------------------------
 * O QUE APARECE, E O QUE NÃO
 * ------------------------------------------------------------------
 *
 * Aparece o que se fala ao telefone: código, medida, micragem,
 * material, cor, unidade, preço e a descrição comercial. Um campo vazio
 * não desenha rótulo — uma ficha cheia de "—" é uma ficha que se lê
 * mais devagar, e o vendedor está lendo com alguém esperando.
 *
 * Não aparece: ativo/inativo (a lista já só traz ativos), datas, e quem
 * cadastrou. Nada disso se diz para um cliente.
 */

export interface ReferenceProduct {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string | null;
  price: number | null;
  currency: string | null;
  category: string | null;
  size_label: string | null;
  thickness_micron: number | null;
  material: string | null;
  color: string | null;
}

export function ProductReferenceCard({
  product,
  t,
}: {
  product: ReferenceProduct;
  t: ReturnType<typeof useTranslations>;
}) {
  const [copied, setCopied] = useState(false);

  /**
   * O que vai para a área de transferência é a ficha em texto, não o
   * nome. Quem copia daqui está montando a resposta que vai mandar no
   * WhatsApp, e vai querer colar as medidas junto.
   */
  const copy = useCallback(async () => {
    const lines = [
      product.name,
      product.sku ? `${t('sku')}: ${product.sku}` : null,
      product.size_label ? `${t('size')}: ${product.size_label}` : null,
      product.thickness_micron
        ? `${t('thickness')}: ${product.thickness_micron} µm`
        : null,
      product.material ? `${t('material')}: ${product.material}` : null,
      product.color ? `${t('color')}: ${product.color}` : null,
      product.price != null
        ? `${t('price')}: ${formatCurrency(product.price, product.currency ?? 'BRL')}${
            product.unit ? ` / ${product.unit}` : ''
          }`
        : null,
      product.description,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('copyFailed'));
    }
  }, [product, t]);

  const specs: [string, string][] = [
    product.sku ? [t('sku'), product.sku] : null,
    product.size_label ? [t('size'), product.size_label] : null,
    product.thickness_micron
      ? [t('thickness'), `${product.thickness_micron} µm`]
      : null,
    product.material ? [t('material'), product.material] : null,
    product.color ? [t('color'), product.color] : null,
    product.unit ? [t('unit'), product.unit] : null,
  ].filter((row): row is [string, string] => row !== null);

  return (
    <Panel>
      <PanelBody className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-foreground min-w-0 text-sm font-semibold">
            {product.name}
          </h3>
          {product.category && (
            <span className="bg-muted text-secondary-foreground text-2xs rounded-full px-2 py-0.5 font-medium">
              {product.category}
            </span>
          )}
          {/* O PREÇO É O SEGUNDO ITEM MAIS PERGUNTADO, depois do nome —
              então vive no cabeçalho, não perdido entre as medidas.
              "Sob consulta" quando não há preço: `price` é nulável
              porque essa É uma resposta, e imprimir R$ 0,00 seria uma
              resposta diferente e errada. */}
          <span className="text-foreground ml-auto shrink-0 text-sm font-semibold tabular-nums">
            {product.price != null
              ? formatCurrency(product.price, product.currency ?? 'BRL')
              : t('onRequest')}
            {product.price != null && product.unit ? (
              <span className="text-muted-foreground text-2xs font-normal">
                {' / '}
                {product.unit}
              </span>
            ) : null}
          </span>
        </div>

        {specs.length > 0 && (
          // `flex-wrap` e não uma grade de duas colunas: a quantidade de
          // campos preenchidos varia por produto, e uma grade deixaria
          // buracos onde uma ficha densa deveria continuar.
          <dl className="flex flex-wrap gap-x-4 gap-y-1">
            {specs.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground text-2xs">{label}</dt>
                <dd className="text-secondary-foreground text-xs font-medium">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {product.description && (
          <p className="text-secondary-foreground line-clamp-4 text-sm leading-relaxed whitespace-pre-wrap">
            {product.description}
          </p>
        )}

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => void copy()}>
            {copied ? (
              <>
                <Check className="size-3.5" />
                {t('copied')}
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                {t('copySheet')}
              </>
            )}
          </Button>
        </div>
      </PanelBody>
    </Panel>
  );
}
