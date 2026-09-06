import { getTranslations } from 'next-intl/server';

import { buildSample, SAMPLE_LANGS } from '@/lib/api-docs/samples';
import type { Endpoint } from '@/lib/api-docs/types';
import { Blocks } from './blocks';
import { RequestPanel, ResponsePanel } from './endpoint-panels';
import { MethodBadge } from './method-badge';
import { ParamList } from './param-list';
import { Playground } from './playground';

/**
 * A página de um endpoint, na anatomia da referência do Chatwoot:
 * título e resumo, a barra com método e caminho, e então duas colunas —
 * o contrato à esquerda, o código à direita, grudado enquanto se rola.
 *
 * Abaixo de `xl` as colunas empilham e os painéis de código vão para
 * DEPOIS dos parâmetros: num telefone, quem abriu a página quer ler o
 * que a rota aceita antes de ver o `curl` pronto.
 */
export async function EndpointView({
  endpoint,
  baseUrl,
  group,
}: {
  endpoint: Endpoint;
  baseUrl: string;
  group: string | null;
}) {
  const t = await getTranslations('Docs');

  const samples = SAMPLE_LANGS.map((lang) => ({
    id: lang.id,
    label: lang.label,
    syntax: lang.syntax,
    code: buildSample(endpoint, lang.id, baseUrl),
  }));

  return (
    <article className="space-y-6">
      <header className="space-y-3">
        {group ? <p className="text-primary eyebrow">{group}</p> : null}
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          {endpoint.title}
        </h1>
        <p className="text-muted-foreground text-sm leading-[1.7]">
          {endpoint.summary}
        </p>

        <div className="border-border bg-card-2 flex flex-wrap items-center gap-3 rounded-xl border p-2.5">
          <MethodBadge method={endpoint.method} />
          <code className="text-foreground min-w-0 flex-1 font-mono text-xs break-all">
            {endpoint.path}
          </code>
          <Playground
            method={endpoint.method}
            path={endpoint.path}
            requestExample={endpoint.requestExample}
            scope={endpoint.scope}
          />
        </div>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          {endpoint.intro ? (
            <Blocks blocks={endpoint.intro} baseUrl={baseUrl} />
          ) : null}

          <Section title={t('authorization')}>
            <ParamList
              params={[
                {
                  name: 'Authorization',
                  type: 'header',
                  required: true,
                  description: endpoint.scope
                    ? t('scopeRequired', { scope: endpoint.scope })
                    : t('noScopeRequired'),
                  example: 'Bearer wacrm_live_…',
                },
              ]}
            />
          </Section>

          {endpoint.pathParams?.length ? (
            <Section title={t('pathParams')}>
              <ParamList params={endpoint.pathParams} />
            </Section>
          ) : null}

          {endpoint.query?.length ? (
            <Section title={t('queryParams')}>
              <ParamList params={endpoint.query} />
            </Section>
          ) : null}

          {endpoint.body?.length ? (
            <Section title={t('body')}>
              <ParamList params={endpoint.body} />
            </Section>
          ) : null}

          {endpoint.notes ? (
            <Blocks blocks={endpoint.notes} baseUrl={baseUrl} />
          ) : null}
        </div>

        {/*
         * `min-w-0` E NÃO É DECORAÇÃO. Um item de grid tem
         * `min-width: auto`, então a trilha cresce até caber a linha mais
         * longa do `<pre>` — e num telefone isso empurrava a PÁGINA
         * inteira 90px para fora da tela, cortando o texto de todos os
         * parágrafos ao lado. O `overflow-x-auto` do bloco de código só
         * age depois que o pai aceita encolher.
         */}
        <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">
          <div className="space-y-3">
            <RequestPanel title={endpoint.title} samples={samples} />
            <ResponsePanel responses={endpoint.responses} />
          </div>
        </div>
      </div>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="border-border text-foreground border-b pb-2 text-sm font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}
