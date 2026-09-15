'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Wrench,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { CURRENCIES, formatCurrency } from '@/lib/currency';
import {
  createProduct,
  loadProducts,
  updateProduct,
  type Product,
  type ProductDraft,
} from '@/lib/products/catalog';
import { cn } from '@/lib/utils';
import { PageActions } from '@/components/layout/page-actions';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { FieldLabel, FieldRow } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { IconTile } from '@/components/ui/icon-tile';

/**
 * The catalogue, as a place you go rather than a setting you change.
 *
 * IT MOVED HERE FROM SETTINGS, and the move is the correction of a
 * decision I made without the plan in front of me. `sidebar.tsx` states
 * the test: "is this a place you go to WORK, or a place you go to change
 * how the work behaves?" A packaging catalogue passes the first — an
 * agent opens a product in the MIDDLE of a conversation to check a
 * measurement and a price. That is daily consultation, not occasional
 * configuration.
 *
 * The products plan said so first, and named the precedent: the 0.8.2
 * pass undid exactly this arrangement when Templates and Etiquetas
 * appeared on both surfaces at once. "Escolher uma. Não as duas."
 *
 * ------------------------------------------------------------------
 * TWO ACTS, TWO PERMISSIONS
 * ------------------------------------------------------------------
 *
 * Correcting a product — a price, a measurement, a description — is the
 * work of whoever quotes it, and a catalogue only an admin can fix is a
 * catalogue that stays wrong until somebody remembers to mention it.
 * That is an `agent` act.
 *
 * Creating one, or retiring one, changes the catalogue everybody quotes
 * from. That is an `admin` act, and migration 055 enforces both halves —
 * the policy for INSERT, a trigger for `active`, because RLS constrains
 * rows and "retire" is a column.
 *
 * RETIRE, NEVER DELETE. A product that stops being sold still appears in
 * every deal that ever contained it.
 */
/**
 * O teste do TERMO, isolado do teste de ESTADO.
 *
 * Os dois cortes eram um filtro só, e por isso não havia como perguntar
 * "quantos o termo acharia se o aposentado estivesse ligado?" — que é
 * exatamente a pergunta que o vazio precisa responder.
 */
function matchesTerm(p: Product, term: string): boolean {
  return (
    !term ||
    p.name.toLowerCase().includes(term) ||
    (p.sku ?? '').toLowerCase().includes(term) ||
    (p.category ?? '').toLowerCase().includes(term) ||
    // "40x60" is how the product is asked for on the phone, and
    // `size_label` is generated precisely so this match works.
    (p.size_label ?? '').toLowerCase().includes(term.replace(/\s/g, ''))
  );
}

export function ProductCatalog() {
  const t = useTranslations('Products');
  const { accountId, user, defaultCurrency } = useAuth();
  const { confirm } = useConfirm();
  /** Correcting what a product IS. */
  const canEdit = useCan('send-messages');
  /** Adding one, or taking one out of everybody's catalogue. */
  const canCurate = useCan('edit-settings');

  const [products, setProducts] = useState<Product[] | null>(null);
  const [pending, setPending] = useState(false);
  /**
   * Seeded from `?q=`, which is what makes arriving from the global
   * search land ON the product instead of on the unfiltered catalogue.
   *
   * Read once, as the initial value, and not synced afterwards: this is
   * a text field somebody types in, and a URL that kept writing itself
   * back into it would fight the next keystroke.
   */
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** `'new'` while creating, a product id while editing, null when closed. */
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(() =>
    empty(defaultCurrency)
  );
  /** O produto em edição veio do Bling (084): nome, código, unidade e preço travados. */
  const editingLinked =
    editing !== null &&
    editing !== 'new' &&
    Boolean(products?.find((p) => p.id === editing)?.bling_product_id);

  const fetchProducts = useCallback(async () => {
    if (!accountId) return null;
    return loadProducts(createClient(), accountId, { includeInactive: true });
  }, [accountId]);

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchProducts>>) => {
      if (result === null) return;
      if (result === 'missing-table') {
        setPending(true);
        setProducts([]);
        return;
      }
      setPending(false);
      setProducts(result);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    void fetchProducts().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchProducts, apply]);

  const reload = useCallback(
    () => fetchProducts().then(apply),
    [fetchProducts, apply]
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (products ?? [])
      .filter((p) => showInactive || p.active)
      .filter((p) => matchesTerm(p, term));
  }, [products, query, showInactive]);

  /*
   * Quantos o TERMO acha e só o interruptor está segurando.
   *
   * O corte por estado vem antes do corte por termo, então buscar um
   * produto aposentado respondia "Nada corresponde" — uma afirmação falsa
   * sobre um produto que está a um clique de distância, com o clique fora
   * do painel e abaixo da resposta.
   */
  const retiredMatches = useMemo(() => {
    if (showInactive) return 0;
    const term = query.trim().toLowerCase();
    return (products ?? []).filter((p) => !p.active && matchesTerm(p, term))
      .length;
  }, [products, query, showInactive]);

  const startNew = useCallback(() => {
    setEditing('new');
    setDraft(empty(defaultCurrency));
  }, [defaultCurrency]);

  /*
   * O LÁPIS PERGUNTA ANTES DE APAGAR O RASCUNHO.
   *
   * O painel do formulário e a lista com os lápis ficam na tela ao mesmo
   * tempo. Com "Novo produto" meio preenchido, clicar num lápis
   * sobrescrevia os onze campos — e o painel NÃO desmonta (só troca
   * `editing` de `new` para um id), então nem o foco se move: nada muda na
   * tela e o trabalho some.
   *
   * A comparação é com o rascunho VAZIO e não com `draft.name`: sem nome o
   * Salvar já está desabilitado, e é justamente o caso em que o que se
   * perde é o resto — medidas, material, cor, preço.
   *
   * Os lápis não são desabilitados: um controle que está sempre lá e
   * sempre recusa ensina a desconfiar da linha, não do botão.
   */
  const startEdit = useCallback(
    async (product: Product) => {
      const dirty =
        editing === 'new' &&
        JSON.stringify(draft) !== JSON.stringify(empty(defaultCurrency));
      if (
        dirty &&
        !(await confirm({
          title: t('discardDraftTitle'),
          description: t('discardDraftBody'),
          destructive: true,
        }))
      ) {
        return;
      }
      setEditing(product.id);
      setDraft({
        name: product.name,
        sku: product.sku ?? '',
        description: product.description ?? '',
        unit: product.unit ?? '',
        price: product.price,
        currency: product.currency,
        category: product.category ?? '',
        widthCm: product.width_cm ?? null,
        heightCm: product.height_cm ?? null,
        thicknessMicron: product.thickness_micron ?? null,
        material: product.material ?? '',
        color: product.color ?? '',
      });
    },
    [confirm, draft, editing, defaultCurrency, t]
  );

  const commit = useCallback(async () => {
    if (!accountId || !draft.name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    const db = createClient();
    const result =
      editing === 'new'
        ? await createProduct(db, accountId, user?.id ?? null, draft)
        : await updateProduct(db, editing as string, draft);
    setSaving(false);

    const error = 'error' in result ? result.error : null;
    if (error) {
      toast.error(describe(error, t));
      return;
    }
    setEditing(null);
    toast.success(t('saved'));
    void reload();
  }, [accountId, draft, editing, user?.id, reload, t]);

  const toggleActive = useCallback(
    async (product: Product) => {
      setBusyId(product.id);
      const { error } = await updateProduct(createClient(), product.id, {
        active: !product.active,
      });
      setBusyId(null);
      if (error) {
        toast.error(describe(error, t));
        return;
      }
      /*
       * O RECIBO, com o nome do produto.
       *
       * Aposentar era um ícone fantasma sem rótulo, colado num lápis
       * idêntico, e a linha SUMIA da lista na hora — porque `visible`
       * filtra os inativos. Nenhuma confirmação, nenhum aviso: só um
       * produto a menos, e a dúvida de ter clicado no botão errado.
       *
       * Toast e não `useConfirm`: o ato é reversível pelo mesmo botão,
       * e o arquivo já escreve `RETIRE, NEVER DELETE`. Confirmar algo
       * que se desfaz num clique é atrito sem seguro.
       */
      toast.success(
        t(product.active ? 'retired' : 'restored', { name: product.name })
      );
      void reload();
    },
    [reload, t]
  );

  if (products === null) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (pending) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        <StatePanel
          size="md"
          icon={Wrench}
          title={t('pendingTitle')}
          description={t('pendingBody')}
        />
      </div>
    );
  }

  return (
    <div className="@container space-y-4">
      <PageHeader title={t('title')} description={t('description')} />

      {canCurate && !editing && (
        <PageActions>
          <Button size="sm" onClick={startNew}>
            <Plus className="size-4" />
            {t('newProduct')}
          </Button>
        </PageActions>
      )}

      {editing ? (
        <Panel>
          <PanelHeader>
            <div className="min-w-0">
              <PanelTitle>
                {editing === 'new' ? t('newProduct') : t('editProduct')}
              </PanelTitle>
              <PanelSub>{t('formSub')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody>
            {/* Um `<form>` de verdade, e não onze campos soltos com um
                `onClick` no fim. O Enter salva — que é o que o próprio vazio
                deste catálogo pede ao mandar cadastrar dez produtos
                seguidos — e é a escrita que o formulário de contato já usa.

                O Cancelar ao lado não vira submit: o `Button` da casa é o do
                Base UI, que injeta `type="button"` em `<button>` nativo. */}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void commit();
              }}
            >
              {/* VEM DO BLING (D6). Nome, código, unidade e preço de um
                  produto vinculado são reescritos na próxima importação:
                  deixar editar aqui seria deixar alguém corrigir um preço
                  que volta sozinho amanhã. O resto (medidas, descrição) é do
                  CRM e continua editável. */}
              {editingLinked ? (
                <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-xs">
                  {t('fromBlingNotice')}
                </p>
              ) : null}
              <div className="grid gap-3 @md:grid-cols-[2fr_1fr]">
                <FieldRow label={t('name')} htmlFor="prod-name">
                  <Input
                    id="prod-name"
                    value={draft.name}
                    maxLength={120}
                    autoFocus
                    disabled={editingLinked}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </FieldRow>
                <FieldRow label={t('sku')} htmlFor="prod-sku">
                  <Input
                    id="prod-sku"
                    value={draft.sku}
                    disabled={editingLinked}
                    maxLength={60}
                    placeholder={t('skuPlaceholder')}
                    onChange={(e) =>
                      setDraft({ ...draft, sku: e.target.value })
                    }
                  />
                </FieldRow>
              </div>

              {/* THE MEASUREMENTS, typed (migration 055). The unit is in the
                label because it is in the column: a catalogue with 40 cm
                on one row and 400 mm on the next is a catalogue where a
                search for 40x60 finds half of it. */}
              <fieldset className="border-border space-y-3 rounded-md border p-3">
                <legend className="text-muted-foreground px-1 text-xs font-semibold">
                  {t('dimensions')}
                </legend>
                <p className="text-muted-foreground text-xs">
                  {t('dimensionsHint')}
                </p>
                <div className="grid grid-cols-1 gap-3 @xs:grid-cols-3">
                  <FieldRow label={t('width')} htmlFor="prod-w">
                    <Input
                      id="prod-w"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.5"
                      value={draft.widthCm ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          widthCm: numberOrNull(e.target.value),
                        })
                      }
                    />
                  </FieldRow>
                  <FieldRow label={t('height')} htmlFor="prod-h">
                    <Input
                      id="prod-h"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.5"
                      value={draft.heightCm ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          heightCm: numberOrNull(e.target.value),
                        })
                      }
                    />
                  </FieldRow>
                  <FieldRow label={t('thickness')} htmlFor="prod-t">
                    <Input
                      id="prod-t"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="1"
                      value={draft.thicknessMicron ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          thicknessMicron: numberOrNull(e.target.value),
                        })
                      }
                    />
                  </FieldRow>
                </div>
                {/* A CHAVE DE BUSCA, enquanto ela é digitada.

                    `size_label` é coluna GENERATED: a lista a imprime e a
                    busca casa contra ela — "40x60" é como o produto é pedido
                    no telefone. Quem cadastra só via a string depois de
                    salvar, que é tarde para notar que digitou 400. */}
                {sizeLabel(draft.widthCm, draft.heightCm) ? (
                  <p className="text-muted-foreground text-2xs tabular-nums">
                    {sizeLabel(draft.widthCm, draft.heightCm)}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2">
                  <FieldRow label={t('material')} htmlFor="prod-mat">
                    <Input
                      id="prod-mat"
                      value={draft.material}
                      maxLength={60}
                      placeholder={t('materialPlaceholder')}
                      onChange={(e) =>
                        setDraft({ ...draft, material: e.target.value })
                      }
                    />
                  </FieldRow>
                  <FieldRow label={t('color')} htmlFor="prod-color">
                    <Input
                      id="prod-color"
                      value={draft.color}
                      maxLength={40}
                      placeholder={t('colorPlaceholder')}
                      onChange={(e) =>
                        setDraft({ ...draft, color: e.target.value })
                      }
                    />
                  </FieldRow>
                </div>
              </fieldset>

              <div className="grid gap-3 @md:grid-cols-3">
                <FieldRow label={t('price')} htmlFor="prod-price">
                  <CurrencyInput
                    id="prod-price"
                    disabled={editingLinked}
                    value={draft.price}
                    onValueChange={(v) => setDraft({ ...draft, price: v })}
                    currency={draft.currency}
                    placeholder={t('pricePlaceholder')}
                  />
                </FieldRow>
                <FieldRow label={t('currency')} htmlFor="prod-currency">
                  <OptionSelect
                    id="prod-currency"
                    value={draft.currency}
                    onValueChange={(v) => setDraft({ ...draft, currency: v })}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </OptionSelect>
                </FieldRow>
                <FieldRow label={t('unit')} htmlFor="prod-unit">
                  <Input
                    id="prod-unit"
                    disabled={editingLinked}
                    value={draft.unit}
                    maxLength={16}
                    placeholder={t('unitPlaceholder')}
                    onChange={(e) =>
                      setDraft({ ...draft, unit: e.target.value })
                    }
                  />
                </FieldRow>
              </div>

              <FieldRow
                label={t('category')}
                htmlFor="prod-category"
                hint={t('categoryDesc')}
              >
                <Input
                  id="prod-category"
                  value={draft.category}
                  maxLength={60}
                  placeholder={t('categoryPlaceholder')}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                />
              </FieldRow>

              <FieldRow
                label={t('descriptionLabel')}
                htmlFor="prod-desc"
                hint={t('descriptionHint')}
              >
                <Textarea
                  id="prod-desc"
                  rows={3}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </FieldRow>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  <X className="size-4" />
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saving || !draft.name.trim()}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('save')}
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader className="flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <PanelTitle>{t('listTitle')}</PanelTitle>
            <PanelSub>{t('listSub', { count: visible.length })}</PanelSub>
          </div>
          <div className="relative w-full @sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="pl-8"
              aria-label={t('searchPlaceholder')}
            />
          </div>
        </PanelHeader>

        <PanelBody flush>
          {visible.length === 0 ? (
            <StatePanel
              icon={Package}
              title={query ? t('noMatchTitle') : t('emptyTitle')}
              description={query ? t('noMatchBody') : t('emptyBody')}
              actions={
                retiredMatches > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowInactive(true)}
                  >
                    {t('showRetiredCount', { count: retiredMatches })}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-border divide-y">
              {visible.map((product) => (
                <li
                  key={product.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5',
                    !product.active && 'opacity-60'
                  )}
                >
                  <IconTile size="md">
                    <Package />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground flex min-w-0 items-center gap-2 text-sm font-medium">
                      <span className="truncate">{product.name}</span>
                      {product.bling_product_id ? (
                        <StatusBadge size="sm" variant="neutral" className="shrink-0">
                          {t('fromBlingTag')}
                        </StatusBadge>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground text-2xs truncate">
                      {[
                        product.sku,
                        // The size goes on the identity line, not in the
                        // description — it is how the product is named
                        // out loud.
                        product.size_label,
                        product.thickness_micron
                          ? `${product.thickness_micron}mic`
                          : null,
                        product.category,
                        product.unit ? `/${product.unit}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || t('noCode')}
                    </p>
                    <p className="text-foreground text-2xs mt-0.5 tabular-nums @sm:hidden">
                      {product.price != null
                        ? formatCurrency(product.price, product.currency)
                        : t('onRequest')}
                    </p>
                  </div>
                  <span className="text-foreground hidden shrink-0 text-sm tabular-nums @sm:block">
                    {product.price != null
                      ? formatCurrency(product.price, product.currency)
                      : t('onRequest')}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void startEdit(product)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">{t('edit')}</span>
                      </Button>
                    )}
                    {/* Retiring is the admin half — see the note at the
                        top and the trigger in 055. Hidden rather than
                        disabled: a control that is always there and
                        always refuses teaches people to distrust the
                        row, not the button. */}
                    {canCurate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === product.id}
                        onClick={() => toggleActive(product)}
                      >
                        {product.active ? (
                          <Archive className="size-4" />
                        ) : (
                          <ArchiveRestore className="size-4" />
                        )}
                        <span className="sr-only">
                          {product.active ? t('retire') : t('restore')}
                        </span>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      {(products ?? []).some((p) => !p.active) && (
        // 14px pintado com `accent-primary` era o único checkbox cru do
        // app. O da casa é 16px, com a borda `--control` que o
        // `theme-contrast.test.ts` mede e um anel de foco.
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox
            checked={showInactive}
            onCheckedChange={(v) => setShowInactive(v === true)}
          />
          {t('showRetired')}
        </label>
      )}
    </div>
  );
}

/** Label, optional hint, control — the form's one row shape. */

/**
 * An empty measurement field is NULL, not zero.
 *
 * Zero would pass the CHECK as a positive-only violation and, worse,
 * would read as "this product is 0cm wide" — which is a claim, where the
 * blank was an absence.
 */
function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function describe(
  error: string,
  t: ReturnType<typeof useTranslations>
): string {
  if (error === 'duplicate-sku') return t('duplicateSku');
  if (error === 'missing-table') return t('pendingTitle');
  if (error === 'admin-only') return t('adminOnly');
  if (error === 'empty') return t('nameRequired');

  /*
   * O RESTO NÃO VAI PARA A TELA.
   *
   * O que sobra aqui é `error.message` do Postgres — inglês cru, escrito
   * para quem lê log, num app em português. `catalog.ts:297` devolve
   * exatamente isso quando o código não é um dos casos nomeados.
   *
   * A decisão já estava escrita no `contact-form.tsx:418-422`, com estas
   * palavras: *"`err.message` here is a Supabase/storage string in
   * English, and it always won over the key written for this case. The
   * detail goes to the console; the person gets the sentence."* Este
   * arquivo não tinha recebido o recado.
   */
  console.error('Catálogo de produtos:', error);
  return t('genericError');
}

/**
 * O espelho em JS de `products.size_label` (migração 055).
 *
 * Os QUATRO ramos, e não só o completo: a prévia precisa falar no
 * meio-preenchido, que é justamente onde o erro de digitação aparece.
 */
function sizeLabel(w: number | null, h: number | null): string | null {
  // A coluna é NUMERIC(8,2): arredondar antes, senão a prévia mostra
  // 40.567 onde o banco vai guardar 40.57.
  const n = (v: number) => String(Number(v.toFixed(2)));
  if (w == null && h == null) return null;
  if (w == null) return `${n(h as number)}cm`;
  if (h == null) return `${n(w)}cm`;
  return `${n(w)}x${n(h)}cm`;
}

function empty(currency: string): ProductDraft {
  return {
    name: '',
    sku: '',
    description: '',
    unit: '',
    price: null,
    currency,
    category: '',
    widthCm: null,
    heightCm: null,
    thicknessMicron: null,
    material: '',
    color: '',
  };
}
