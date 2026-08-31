-- ============================================================
-- 055_product_dimensions.sql — medida e espessura viram consulta
--
-- A 054 entregou o catálogo com `description` em texto livre, e o plano
-- de Produtos tinha previsto exatamente esse buraco antes de ele existir:
--
--   "Me manda a tabela de preços real da PlastfortSul. É o que decide se
--    medida/espessura viram colunas tipadas (filtráveis: 'todos os
--    40x60') ou ficam em `attributes` como texto. Chutar isso agora é
--    escolher errado com confiança."
--
-- A pergunta foi respondida: **colunas tipadas.** "Todos os 40x60" é a
-- consulta que uma distribuidora de embalagens faz o dia inteiro, e ela
-- não existe contra um parágrafo. Texto livre não filtra, não ordena, e
-- não dá ao assistente um número que ele possa comparar — ele devolve a
-- descrição e o cliente recebe prosa onde pediu medida.
--
-- ------------------------------------------------------------------
-- A UNIDADE ESTÁ NO NOME DA COLUNA, E ISSO É DELIBERADO
-- ------------------------------------------------------------------
--
-- O caminho alternativo — `size` mais `size_unit` — é o que produz um
-- catálogo com 40 em centímetros numa linha e 400 em milímetros na
-- outra, as duas "certas", e uma busca por 40x60 que acha metade.
-- Embalagem no Brasil se mede em **centímetros** e a espessura em
-- **micras**; cravar isso na coluna faz a conversão acontecer uma vez,
-- na digitação, em vez de em toda leitura para sempre.
--
-- Idempotente. Depende da 054.
-- ============================================================


-- ============================================================
-- 1. As duas que filtram
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS width_cm NUMERIC(8,2)
    CHECK (width_cm IS NULL OR width_cm > 0),
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(8,2)
    CHECK (height_cm IS NULL OR height_cm > 0),
  ADD COLUMN IF NOT EXISTS thickness_micron INTEGER
    CHECK (thickness_micron IS NULL OR thickness_micron > 0);

COMMENT ON COLUMN products.width_cm IS
  'Largura em CENTÍMETROS. A unidade está no nome porque a alternativa '
  '(um valor mais uma coluna de unidade) produz 40 cm numa linha e 400 '
  'mm na outra, as duas certas, e uma busca por 40x60 que acha metade.';

COMMENT ON COLUMN products.height_cm IS
  'Altura/comprimento em CENTÍMETROS. Ver a nota em width_cm.';

COMMENT ON COLUMN products.thickness_micron IS
  'Espessura em MICRAS — a unidade em que a indústria de embalagem '
  'especifica filme e saco. Inteiro: ninguém compra 12,5 micras.';


-- ============================================================
-- 2. As duas que só descrevem
--
-- Texto livre de propósito. "Material" e "cor" são vocabulário de cada
-- empresa e crescem sem aviso — mesmo argumento que `category` na 054 e
-- que `kind` na 042: acrescentar "PEBD reciclado" tem que ser uma
-- decisão, não uma migração.
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS material TEXT
    CHECK (material IS NULL OR length(trim(material)) <= 60),
  ADD COLUMN IF NOT EXISTS color TEXT
    CHECK (color IS NULL OR length(trim(color)) <= 40);


-- ============================================================
-- 3. "40x60", escrito uma vez.
--
-- GENERATED, então nenhuma tela pode formatar diferente de outra — o
-- rótulo da lista, o item do orçamento e a resposta do assistente lêem a
-- mesma string. E é o que a busca casa quando alguém digita "40x60"
-- literalmente, que é como o produto é chamado ao telefone.
--
-- O `rtrim(rtrim(…, '0'), '.')` tira o zero à direita — 40.00 vira "40",
-- 40.50 vira "40.5" — e não `trim_scale()`, que faria o mesmo e mais
-- limpo. `trim_scale` é PG13+; `rtrim` é de sempre, e uma coluna
-- GENERATED é a última coisa que se quer descobrir incompatível depois
-- de a migração já ter rodado em metade dos ambientes. `rtrim` para no
-- primeiro caractere que não casa, então "100.00" vira "100" e não "1".
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS size_label TEXT GENERATED ALWAYS AS (
    CASE
      WHEN width_cm IS NULL AND height_cm IS NULL THEN NULL
      WHEN width_cm IS NULL
        THEN rtrim(rtrim(height_cm::TEXT, '0'), '.') || 'cm'
      WHEN height_cm IS NULL
        THEN rtrim(rtrim(width_cm::TEXT, '0'), '.') || 'cm'
      ELSE rtrim(rtrim(width_cm::TEXT, '0'), '.')
           || 'x'
           || rtrim(rtrim(height_cm::TEXT, '0'), '.')
           || 'cm'
    END
  ) STORED;

COMMENT ON COLUMN products.size_label IS
  '"40x60cm", derivado. GENERATED para que a lista, o item de orçamento '
  'e a resposta do assistente não possam formatar diferente — e para que '
  'a busca por "40x60" case com o jeito como o produto é chamado ao '
  'telefone.';

-- A consulta que motivou o arquivo: "todos os 40x60".
CREATE INDEX IF NOT EXISTS idx_products_dimensions
  ON products(account_id, width_cm, height_cm)
  WHERE width_cm IS NOT NULL;

-- E a busca por rótulo, que é como as pessoas realmente procuram.
CREATE INDEX IF NOT EXISTS idx_products_size_label
  ON products(account_id, size_label)
  WHERE size_label IS NOT NULL;


-- ============================================================
-- 4. Quem escreve no catálogo — o meio-termo
--
-- A 054 deu escrita ao `agent`, com o argumento de que quem cota o preço
-- é quem percebe que está errado. O plano de Produtos tinha decidido
-- `admin`, com o argumento de que catálogo errado é preço errado na
-- frente do cliente.
--
-- Os dois estão certos sobre riscos diferentes, e o meio-termo separa os
-- dois atos que estavam sendo tratados como um:
--
--   CORRIGIR um produto  → trabalho de quem usa o catálogo  → agent
--   CRIAR ou APOSENTAR   → muda o catálogo de todo mundo    → admin
--
-- INSERT e DELETE cabem numa policy. "Aposentar" **não**: é um UPDATE em
-- `active`, e RLS restringe LINHAS, não COLUNAS — a mesma parede que a
-- 034 encontrou com `account_role` e a 050 com `permission_overrides`.
-- Por isso o gatilho abaixo.
-- ============================================================
DROP POLICY IF EXISTS products_insert ON products;
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

-- UPDATE segue no agente: é a correção de preço, que é o caso comum e o
-- que se quer barato.
DROP POLICY IF EXISTS products_update ON products;
CREATE POLICY products_update ON products FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.guard_product_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- O caso comum: alguém corrigiu um preço. Nada a policiar.
  IF NEW.active IS NOT DISTINCT FROM OLD.active THEN
    RETURN NEW;
  END IF;

  -- Service role, migração, backfill. Já checaram o que tinham que
  -- checar, ou não há ninguém para checar.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT is_account_member(NEW.account_id, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can retire or restore a product'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_guard_active ON products;
CREATE TRIGGER products_guard_active
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_product_active();
