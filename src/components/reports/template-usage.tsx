'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { TooManyRowsError } from '@/lib/supabase/paged';
import {
  loadTemplateUsage,
  type TemplateUsageResult,
} from '@/lib/reports/template-usage';
import { periodInputValues, type Period } from '@/lib/dashboard/period';
import { APP_LOCALE } from '@/lib/i18n/locale';
import {
  ChartBarRow,
  ChartBars,
  ChartRankList,
  peakPercent,
} from '@/components/charts/chart-primitives';
import { MetricStrip } from '@/components/dashboard/metric-strip';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';

/**
 * Templates disparados — a base de custo (migração 062).
 *
 * ------------------------------------------------------------------
 * CONTA MENSAGEM, NÃO DINHEIRO — DE PROPÓSITO
 * ------------------------------------------------------------------
 *
 * A pergunta que originou o painel é de custo. A resposta em reais
 * exigiria uma tabela de tarifas, e o modelo de cobrança da Meta está em
 * movimento: uma tarifa fixada hoje ficaria errada em silêncio, e um
 * número errado numa tela de custo é pior do que número nenhum, porque
 * alguém o leva para uma reunião.
 *
 * O que a tela mostra é o que é verificável hoje: quantos saíram, quais
 * a META marcou como faturáveis, sob qual categoria ela cobrou, e de
 * onde partiram. Quando as tarifas entrarem, multiplicam este mesmo
 * agregado — nada aqui muda de forma.
 *
 * ------------------------------------------------------------------
 * "AGUARDANDO" É UMA COLUNA, NÃO UM ZERO
 * ------------------------------------------------------------------
 *
 * O objeto `pricing` chega no webhook de status, minutos depois do
 * envio. Um disparo recente ainda não sabe se foi cobrado. Empilhar isso
 * junto do gratuito faria toda hora de pico parecer barata e depois
 * "encarecer" sozinha — então aguardando tem seu próprio número, sua
 * própria faixa no gráfico e sua própria palavra.
 */
export function TemplateUsage({ period }: { period: Period }) {
  const t = useTranslations('Reports.templateUsage');

  /**
   * A resposta E A PERGUNTA QUE ELA RESPONDE, num estado só.
   *
   * Guardar `data` e `loading` separados obrigaria a zerar os dois no
   * corpo do efeito ao trocar de janela — que é `setState` síncrono em
   * efeito, o que o lint recusa e o React desencoraja. Guardar só
   * `data`, como faz o painel irmão, tem o defeito oposto: durante a
   * troca a tela mostra os números da janela ANTERIOR sob o subtítulo
   * da nova ("Últimos 7 dias" acima de um total de 90).
   *
   * Guardando a chave junto, a comparação `state.key === period.key`
   * responde "isto já é sobre a janela atual?" sem estado extra, e a
   * única escrita acontece no callback assíncrono.
   */
  const [state, setState] = useState<{
    key: string;
    result: TemplateUsageResult | null;
    failed: 'tooBig' | 'error' | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadTemplateUsage(createClient(), period)
      .then((result) => {
        if (cancelled) return;
        setState({ key: period.key, result, failed: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          key: period.key,
          result: null,
          // A janela grande demais é o único erro sobre o qual quem lê
          // pode fazer algo — escolher uma menor. O resto é "falhou".
          failed: err instanceof TooManyRowsError ? 'tooBig' : 'error',
        });
      });

    return () => {
      cancelled = true;
    };
    // Pela identidade da janela, não pelo objeto: dois renders da mesma
    // janela não podem refazer a consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.key]);

  const answered = state?.key === period.key ? state : null;

  if (!answered) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (answered.failed || !answered.result) {
    const tooBig = answered.failed === 'tooBig';
    return (
      <Panel>
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle>{t('perDayTitle')}</PanelTitle>
          </div>
        </PanelHeader>
        <PanelBody>
          <StatePanel
            size="md"
            icon={Send}
            title={t(tooBig ? 'tooBigTitle' : 'errorTitle')}
            description={t(tooBig ? 'tooBigBody' : 'errorBody')}
          />
        </PanelBody>
      </Panel>
    );
  }

  const { summary, coverageStart } = answered.result;

  /**
   * O registro começa depois do início da janela?
   *
   * Então o total é parcial, e a tela diz isso. É o caso NORMAL no
   * primeiro mês — nada antes da 062 existe para ser contado — e sem
   * essa frase um painel quase vazio é lido como "quase não
   * disparamos".
   */
  const partial =
    coverageStart !== null && new Date(coverageStart) > period.from;

  if (summary.total === 0) {
    return (
      // O painel vazio tem a MESMA anatomia do cheio.
      // Sem `PanelHeader` ele ficava ao lado de "Desempenho da equipe"
      // — que tem título dentro da moldura — como uma caixa anônima: dois
      // painéis vizinhos, duas anatomias.
      // E `size="md"` porque este texto é dos mais densos da página
      // (explica por que disparos antigos não podem ser reconstruídos) e
      // em `sm` herdava `max-w-xs` + `text-xs`, virando quatro linhas
      // curtas centralizadas.
      <Panel>
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle>{t('perDayTitle')}</PanelTitle>
            <PanelSub>{windowLabel(t, period)}</PanelSub>
          </div>
        </PanelHeader>
        <PanelBody>
          <StatePanel
            size="md"
            icon={Send}
            title={t('emptyTitle')}
            description={
              coverageStart === null ? t('emptyNoData') : t('emptyWindow')
            }
          />
        </PanelBody>
      </Panel>
    );
  }

  // Chaves ESTÁVEIS, não os rótulos traduzidos. O Tremor indexava a série
  // pelo texto na tela, então trocar uma palavra do catálogo trocava a
  // chave de dados — e a cor da série junto.
  const chartData = summary.daily.map((d) => ({
    day: formatDay(d.day),
    billable: d.billable,
    free: d.free,
    pending: d.pending,
  }));

  // Faturável em destaque, gratuito na segunda matiz, aguardando no cinza
  // da doutrina — a mesma leitura da faixa de métricas acima, na mesma
  // ordem, para os olhos não reaprenderem o código de cores entre um
  // painel e o outro. O cinza não é uma terceira série: "aguardando" é
  // ausência de resposta, e `--auto-500` é exatamente o token que este
  // produto reserva para o que ainda não é fato.
  const series = [
    { key: 'billable', label: t('billable'), color: 'var(--chart-1)' },
    { key: 'free', label: t('free'), color: 'var(--chart-2)' },
    { key: 'pending', label: t('pending'), color: 'var(--auto-500)' },
  ];

  return (
    <div className="space-y-4">
      <MetricStrip
        readings={[
          {
            key: 'total',
            label: t('total'),
            value: summary.total.toLocaleString(APP_LOCALE),
            note: partial
              ? t('since', { date: formatDay(coverageStart!.slice(0, 10)) })
              : undefined,
          },
          {
            key: 'billable',
            label: t('billable'),
            value: summary.billable.toLocaleString(APP_LOCALE),
            note: t('billableNote'),
          },
          {
            key: 'free',
            label: t('free'),
            value: summary.free.toLocaleString(APP_LOCALE),
            note: t('freeNote'),
          },
          {
            key: 'pending',
            label: t('pending'),
            // Falhas ao lado do aguardando, e não somadas a ele: as duas
            // não custam nada e só uma delas ainda pode passar a custar.
            value: summary.pending.toLocaleString(APP_LOCALE),
            note:
              summary.failed > 0
                ? t('failedNote', { count: summary.failed })
                : t('pendingNote'),
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader>
            <div>
              <PanelTitle>{t('perDayTitle')}</PanelTitle>
              <PanelSub>{windowLabel(t, period)}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody>
            <ChartBars
              data={chartData}
              index="day"
              series={series}
              stacked
              height={220}
              ariaLabel={t('perDayTitle')}
              formatValue={(n) => n.toLocaleString(APP_LOCALE)}
              legendTotals={{
                billable: summary.billable.toLocaleString(APP_LOCALE),
                free: summary.free.toLocaleString(APP_LOCALE),
                pending: summary.pending.toLocaleString(APP_LOCALE),
              }}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <div>
              <PanelTitle>{t('byCategoryTitle')}</PanelTitle>
              {/* A categoria é a DA META, não a nossa — e é a linha que
                  explica por que os dois números podem divergir. */}
              <PanelSub>{t('byCategorySub')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody className="space-y-3">
            {summary.byCategory.map((cat) => (
              <div key={cat.category}>
                <ChartBarRow
                  density="compact"
                  label={categoryLabel(t, cat.category)}
                  value={cat.total.toLocaleString(APP_LOCALE)}
                  // Fração da MAIOR categoria, não do total. Era
                  // `cat.total / summary.total`, e com uma categoria
                  // dominante as outras três viravam três tocos —
                  // exatamente o que a nota em `ChartBarRow` descreve.
                  // Elas continuam somando o total; é só que a barra
                  // agora serve para compará-las entre si, que é a
                  // pergunta que o painel faz.
                  percent={peakPercent(
                    cat.total,
                    summary.byCategory.map((c) => c.total)
                  )}
                  ariaLabel={`${categoryLabel(t, cat.category)}: ${cat.total}`}
                />
                <p className="text-muted-foreground text-2xs mt-1 tabular-nums">
                  {t('categoryBreakdown', {
                    billable: cat.billable,
                    pending: cat.pending,
                  })}
                </p>
              </div>
            ))}

            {/* A recategorizacao, quando houve.
                E o numero que nenhuma outra tela do produto sabe
                calcular, e o que faz alguem abrir a tela de templates
                para entender por que um Marketing virou Utility. */}
            {summary.recategorized > 0 && (
              <p className="text-muted-foreground border-border border-t pt-2 text-xs">
                {t('recategorized', { count: summary.recategorized })}
              </p>
            )}
          </PanelBody>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader>
            <div>
              <PanelTitle>{t('topTemplatesTitle')}</PanelTitle>
              <PanelSub>{t('topTemplatesSub')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody>
            {/* Um ranking que MOSTRA o ranking.
                Era uma lista com borda e numeros alinhados a direita —
                uma tabela sem codificacao visual nenhuma, numa pagina
                feita de graficos. Ler qual dos dez templates domina
                exigia comparar "1.284" com "980" como TEXTO. */}
            <ChartRankList
              rows={summary.topTemplates.map((tpl) => ({
                key: tpl.name,
                label: tpl.name,
                sublabel: categoryLabel(t, tpl.category),
                value: tpl.total.toLocaleString(APP_LOCALE),
                meta: t('ofWhichBillable', { count: tpl.billable }),
                amount: tpl.total,
                ariaLabel: `${tpl.name}: ${tpl.total}`,
              }))}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <div>
              <PanelTitle>{t('byOriginTitle')}</PanelTitle>
              {/* "Gastamos muito" não é resposta. "A campanha foi metade
                  do mês" é — e é onde alguém consegue mexer. */}
              <PanelSub>{t('byOriginSub')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody>
            <ChartRankList
              rows={summary.byOrigin.map((org) => ({
                key: org.origin,
                label: originLabel(t, org.origin),
                value: org.total.toLocaleString(APP_LOCALE),
                meta: t('ofWhichBillable', { count: org.billable }),
                amount: org.total,
                ariaLabel: `${originLabel(t, org.origin)}: ${org.total}`,
              }))}
            />
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

type T = ReturnType<typeof useTranslations<'Reports.templateUsage'>>;

/**
 * O nome de uma categoria, com a chave crua como plano B.
 *
 * A coluna não tem CHECK justamente para aceitar um balde que a Meta
 * invente depois (ver a 062). Aqui isso vira: se não há tradução, mostra
 * o que a Meta mandou. Uma palavra em inglês é uma informação; um
 * "desconhecido" genérico apaga a única pista de que algo mudou.
 */
function categoryLabel(t: T, category: string): string {
  const known = [
    'marketing',
    'utility',
    'authentication',
    'service',
    'unknown',
  ];
  return known.includes(category) ? t(`category.${category}`) : category;
}

function originLabel(t: T, origin: string): string {
  const known = ['inbox', 'broadcast', 'automation', 'flow', 'api'];
  return known.includes(origin) ? t(`origin.${origin}`) : origin;
}

/** `YYYY-MM-DD` no formato curto do local, sem passar por UTC. */
function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Como a janela se chama.
 *
 * Uma janela escolhida à mão é nomeada pelas datas — "Últimos 31 dias"
 * para um relatório de julho é uma frase simplesmente falsa, e é a
 * frase que alguém lê para saber o que está olhando. Mesmo raciocínio
 * de `TeamPerformance`.
 */
function windowLabel(t: T, period: Period): string {
  if (period.preset !== null) return t('windowDays', { days: period.days });
  const raw = periodInputValues(period);
  return t('windowRange', {
    from: formatDay(raw.from),
    to: formatDay(raw.to),
  });
}
