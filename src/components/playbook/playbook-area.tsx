'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  BookOpen,
  Check,
  Copy,
  MessageSquareWarning,
  Package,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Trash2,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import {
  deletePlaybookEntry,
  loadPlaybook,
  matchesQuery,
  savePlaybookEntry,
  type PlaybookEntry,
  type PlaybookType,
} from '@/lib/playbook/entries';

import {
  ProductReferenceCard,
  type ReferenceProduct,
} from '@/components/playbook/product-reference';
import { loadReferenceProducts, matchesProduct } from '@/lib/playbook/products';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { Panel, PanelBody } from '@/components/ui/panel';
import { SegBar } from '@/components/ui/seg-bar';
import { StatePanel } from '@/components/ui/state-panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * A base de consulta comercial.
 *
 * ------------------------------------------------------------------
 * O QUE ESTA TELA É, E O QUE ELA DELIBERADAMENTE NÃO É
 * ------------------------------------------------------------------
 *
 * É o que o vendedor abre DURANTE a conversa: o script do follow-up, a
 * resposta para "tá caro", a regra de qual região prospectar em março, a
 * medida de um produto.
 *
 * Não é treinamento, não é IA sugerindo resposta, e não dispara
 * automação nenhuma. Consultar a objeção "Preço" não move etapa, não põe
 * etiqueta e não manda mensagem — quem decide é quem está conversando.
 * O valor inteiro está em achar rápido.
 *
 * ------------------------------------------------------------------
 * QUATRO SEÇÕES, TRÊS DELAS DA MESMA TABELA
 * ------------------------------------------------------------------
 *
 * Scripts, objeções e regras são `playbook_entries` com `type`
 * diferente — mesma forma, mesma edição, mesma busca.
 *
 * Produtos é a quarta e não é uma lista desta tabela: é a FICHA de
 * consulta de `products` (migrações 054 e 055), só leitura. Não é o
 * catálogo — aquele é tela de gestão, e ninguém edita catálogo com o
 * cliente esperando no telefone. Ver `product-reference.tsx`.
 *
 * ------------------------------------------------------------------
 * A BUSCA ATRAVESSA OS TRÊS TIPOS
 * ------------------------------------------------------------------
 *
 * Procurar "frete" acha a objeção, a regra e o script — e diz em qual
 * seção cada um está. É o §9 do pedido, e é a razão de a base ser uma
 * tabela só: uma busca que precisa saber quantos tipos existem é uma
 * busca que esquece o quarto.
 *
 * Com busca ativa a divisão em abas sai de cena, porque nesse momento a
 * pergunta não é "onde isto está guardado", é "onde está a palavra".
 */

/** As abas. `products` não é um `PlaybookType` — vem de outra fonte. */
type Section = PlaybookType | 'products';

const SECTION_ICON: Record<Section, typeof ScrollText> = {
  sales_script: ScrollText,
  objection: MessageSquareWarning,
  operation_rule: BookOpen,
  products: Package,
};

export function PlaybookArea() {
  const t = useTranslations('Playbook');
  const { accountId, user } = useAuth();
  // `edit-settings` é o portão que o produto já usa para "isto é
  // configuração da conta, não trabalho do dia". A RLS da 064 exige
  // `admin` de qualquer forma — este booleano só decide se os botões
  // aparecem, para ninguém clicar em algo que o banco vai recusar.
  const canEdit = useCan('edit-settings');
  const { confirm } = useConfirm();

  const [section, setSection] = useState<Section>('sales_script');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [products, setProducts] = useState<ReferenceProduct[]>([]);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<{
    entry: PlaybookEntry | null;
    type: PlaybookType;
  } | null>(null);

  /** Recarrega depois de salvar. Chamado de handler, nunca de efeito. */
  const reload = useCallback(async () => {
    if (!accountId) return;
    const result = await loadPlaybook(createClient(), accountId);
    setMissing(result === 'missing-table');
    setEntries(result === 'missing-table' ? [] : result);
  }, [accountId]);

  // O `.then` e não `await` dentro do corpo: um `setState` na linha reta
  // de um efeito é a cascata de renders que o lint reclama, e a forma
  // com callback é a que o resto do app já usa em todo carregamento.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void loadPlaybook(createClient(), accountId).then((result) => {
      if (cancelled) return;
      setMissing(result === 'missing-table');
      setEntries(result === 'missing-table' ? [] : result);
    });
    // Os produtos vêm de outra tabela e falham por conta própria: a
    // 064 pode não estar aplicada e o catálogo estar de pé, ou o
    // contrário. Uma consulta não pode apagar a outra da tela.
    void loadReferenceProducts(createClient(), accountId).then((result) => {
      if (cancelled) return;
      setProducts(result === 'missing-table' ? [] : result);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const searching = query.trim().length > 0;

  const visible = useMemo(() => {
    const all = entries ?? [];
    if (searching) return all.filter((e) => matchesQuery(e, query));
    if (section === 'products') return [];
    return all.filter((e) => e.type === section);
  }, [entries, section, query, searching]);

  /**
   * Os produtos que a tela mostra agora.
   *
   * Com busca ativa eles entram no MESMO resultado dos outros três — é a
   * promessa de "uma busca só". Procurar "bobina" tem que trazer o
   * produto e o script que o menciona; o vendedor não sabe de antemão
   * qual dos dois vai resolver a frase que ele precisa dizer.
   */
  const visibleProducts = useMemo(() => {
    if (searching) return products.filter((p) => matchesProduct(p, query));
    return section === 'products' ? products : [];
  }, [products, section, query, searching]);

  const countFor = useCallback(
    (type: PlaybookType) =>
      (entries ?? []).filter((e) => e.type === type).length,
    [entries]
  );

  const remove = useCallback(
    async (entry: PlaybookEntry) => {
      const ok = await confirm({
        title: t('deleteTitle'),
        description: entry.title,
        confirmLabel: t('delete'),
        destructive: true,
      });
      if (!ok) return;
      const { error } = await deletePlaybookEntry(createClient(), entry.id);
      if (error) {
        toast.error(t('saveFailed'));
        return;
      }
      setEntries((prev) => (prev ?? []).filter((e) => e.id !== entry.id));
    },
    [confirm, t]
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      {/* A BUSCA FICA ACIMA DAS ABAS, e não dentro de uma delas.
          Ela atravessa os três tipos — pôr uma caixa por seção diria o
          contrário, e a pessoa que procura "frete" teria que adivinhar
          em qual aba a empresa guardou. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-80">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-8"
            aria-label={t('searchPlaceholder')}
          />
        </div>
        {canEdit && !searching && section !== 'products' && (
          <Button
            size="sm"
            onClick={() => setEditing({ entry: null, type: section })}
            className="sm:ml-auto"
          >
            <Plus className="size-3.5" />
            {t(`new.${section}`)}
          </Button>
        )}
      </div>

      {!searching && (
        <SegBar
          label={t('title')}
          value={section}
          onValueChange={(value) => setSection(value)}
          segments={[
            {
              value: 'sales_script',
              label: t('tab.sales_script'),
              count: countFor('sales_script'),
            },
            {
              value: 'objection',
              label: t('tab.objection'),
              count: countFor('objection'),
            },
            {
              value: 'operation_rule',
              label: t('tab.operation_rule'),
              count: countFor('operation_rule'),
            },
            { value: 'products', label: t('tab.products') },
          ]}
        />
      )}

      {missing && section !== 'products' ? (
        <StatePanel
          size="md"
          icon={BookOpen}
          title={t('missingTitle')}
          description={t('missingBody')}
        />
      ) : entries === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 && visibleProducts.length === 0 ? (
        <StatePanel
          size="md"
          icon={searching ? Search : SECTION_ICON[section]}
          title={searching ? t('noResults', { query }) : t('empty')}
          description={
            searching
              ? undefined
              : section === 'products'
                ? t('emptyProducts')
                : t('emptyHint')
          }
        />
      ) : (
        <ol className="space-y-3">
          {visible.map((entry) => (
            <li key={entry.id}>
              <EntryCard
                entry={entry}
                t={t}
                canEdit={canEdit}
                showType={searching}
                onEdit={() => setEditing({ entry, type: entry.type })}
                onDelete={() => void remove(entry)}
              />
            </li>
          ))}
          {/* Os produtos DEPOIS das entradas quando a busca mistura os
              quatro: script, objeção e regra são o que alguém escreveu
              pensando nesta conversa; a ficha do produto é referência.
              Numa lista de resultados, o que foi escrito para o caso
              ganha do que serve para todos. */}
          {visibleProducts.map((product) => (
            <li key={product.id}>
              <ProductReferenceCard product={product} t={t} />
            </li>
          ))}
        </ol>
      )}

      {editing && accountId && user && (
        <EntryDialog
          t={t}
          accountId={accountId}
          authorId={user.id}
          type={editing.type}
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * Uma entrada.
 *
 * O conteúdo aparece inteiro e não numa prévia de uma linha. O pedido
 * original falava em prévia, e prévia é o que se faz quando a lista é
 * longa e o item é grande — aqui o item É a resposta, e cortá-la obriga
 * a um clique a mais no exato momento em que o cliente está esperando.
 * `line-clamp-6` existe só para o texto de dez parágrafos não empurrar o
 * resto da lista para fora da tela.
 */
function EntryCard({
  entry,
  t,
  canEdit,
  showType,
  onEdit,
  onDelete,
}: {
  entry: PlaybookEntry;
  t: ReturnType<typeof useTranslations>;
  canEdit: boolean;
  /** Com busca ativa a lista mistura tipos, então cada card diz o seu. */
  showType: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(entry.content);
      setCopied(true);
      // Dois segundos: tempo de ver que funcionou, curto o bastante para
      // o botão estar pronto de novo antes de alguém querer o segundo
      // script. Sem isto, copiar não tem retorno nenhum na tela.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('copyFailed'));
    }
  }, [entry.content, t]);

  return (
    <Panel>
      <PanelBody className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-foreground min-w-0 text-sm font-semibold">
            {entry.title}
          </h3>
          {entry.category && (
            <span className="bg-muted text-secondary-foreground text-2xs rounded-full px-2 py-0.5 font-medium">
              {entry.category}
            </span>
          )}
          {showType && (
            <span className="text-muted-foreground text-2xs">
              {t(`tab.${entry.type}`)}
            </span>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copy()}
              aria-label={t('copy')}
            >
              {copied ? (
                <>
                  <Check className="size-3.5" />
                  {t('copied')}
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  {t('copy')}
                </>
              )}
            </Button>
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onEdit}
                  aria-label={t('edit')}
                  title={t('edit')}
                  className="size-8 p-0"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onDelete}
                  aria-label={t('delete')}
                  title={t('delete')}
                  className="text-danger-ink size-8 p-0"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        <p className="text-secondary-foreground line-clamp-6 text-sm leading-relaxed whitespace-pre-wrap">
          {entry.content}
        </p>
      </PanelBody>
    </Panel>
  );
}

/** Criar ou editar. Três campos, e nenhum a mais. */
function EntryDialog({
  t,
  accountId,
  authorId,
  type,
  entry,
  onClose,
  onSaved,
}: {
  t: ReturnType<typeof useTranslations>;
  accountId: string;
  authorId: string;
  type: PlaybookType;
  entry: PlaybookEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(entry?.title ?? '');
  const [category, setCategory] = useState(entry?.category ?? '');
  const [content, setContent] = useState(entry?.content ?? '');
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    setSaving(true);
    const { error } = await savePlaybookEntry(createClient(), {
      id: entry?.id,
      accountId,
      authorId,
      type,
      title,
      category: category || null,
      content,
    });
    setSaving(false);
    if (error) {
      toast.error(error === 'EMPTY' ? t('requiredFields') : t('saveFailed'));
      return;
    }
    onSaved();
  }, [
    entry?.id,
    accountId,
    authorId,
    type,
    title,
    category,
    content,
    onSaved,
    t,
  ]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? t('editTitle') : t(`new.${type}`)}</DialogTitle>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="pb-title">{t('fieldTitle')}</FieldLabel>
          <Input
            id="pb-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pb-category">{t('fieldCategory')}</FieldLabel>
          <Input
            id="pb-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t(`categoryHint.${type}`)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pb-content">
            {t(`fieldContent.${type}`)}
          </FieldLabel>
          <Textarea
            id="pb-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
          />
          {/* As variáveis são orientação visual, não motor de template.
              Substituir automaticamente aqui duplicaria as respostas
              rápidas do atendimento, que já fazem isso — ver §12 do
              pedido: script de venda e template da Meta são coisas
              diferentes e não se misturam. */}
          <p className="text-muted-foreground text-2xs mt-1">
            {t('variablesHint')}
          </p>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !title.trim() || !content.trim()}
          >
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
