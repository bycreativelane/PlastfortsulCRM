import { getTranslations } from 'next-intl/server';

import { cn } from '@/lib/utils';
import type { Param } from '@/lib/api-docs/types';
import { RichText } from './rich-text';

/**
 * A tabela de parâmetros, na forma que a referência do Chatwoot usa e
 * que se lê melhor que uma `<table>`: nome, tipo e obrigatoriedade numa
 * linha; a descrição embaixo, em largura de leitura; os filhos de um
 * objeto recuados atrás de uma guia vertical.
 *
 * Uma tabela de quatro colunas força a descrição — a coluna que a
 * pessoa veio ler — a caber em um terço da largura, e num telefone ela
 * vira uma coluna de duas palavras por linha.
 */
export async function ParamList({
  params,
  depth = 0,
}: {
  params: Param[];
  depth?: number;
}) {
  const t = await getTranslations('Docs');

  return (
    <ul
      className={cn(
        'divide-border/60 divide-y',
        depth > 0 && 'border-border/60 mt-2 ml-1 border-l pl-4'
      )}
    >
      {params.map((param) => (
        <li key={param.name} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="text-foreground font-mono text-sm font-semibold">
              {param.name}
            </code>
            <span className="text-muted-foreground text-2xs font-mono">
              {param.type}
            </span>
            {param.required ? (
              <span className="text-danger-ink text-2xs font-semibold">
                {t('required')}
              </span>
            ) : (
              <span className="text-muted-foreground text-2xs">
                {t('optional')}
              </span>
            )}
          </div>

          <p className="text-secondary-foreground mt-1.5 text-sm leading-[1.7]">
            <RichText text={param.description} />
          </p>

          {param.defaultValue || param.example || param.values ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {param.defaultValue ? (
                <Meta label={t('default')} value={param.defaultValue} />
              ) : null}
              {param.example ? (
                <Meta label={t('example')} value={param.example} />
              ) : null}
              {param.values ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-2xs">
                    {t('values')}
                  </span>
                  {param.values.map((value) => (
                    <code
                      key={value}
                      className="bg-muted text-secondary-foreground text-2xs rounded-[4px] px-1.5 py-px font-mono"
                    >
                      {value}
                    </code>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {param.children?.length ? (
            <ParamList params={param.children} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground text-2xs">{label}</span>
      <code className="bg-muted text-secondary-foreground text-2xs rounded-[4px] px-1.5 py-px font-mono">
        {value}
      </code>
    </span>
  );
}
