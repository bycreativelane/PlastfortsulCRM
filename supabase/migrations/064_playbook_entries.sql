-- ============================================================
-- 064_playbook_entries.sql — a base de consulta comercial
--
-- Scripts de venda, mapa de objeções e regras da operação: o que o
-- vendedor abre DURANTE a conversa para saber o que dizer.
--
-- ------------------------------------------------------------
-- UMA TABELA COM `type`, E NÃO TRÊS TABELAS
-- ------------------------------------------------------------
--
-- Os três têm exatamente a mesma forma — título, categoria, conteúdo,
-- quem escreveu, quando — e a única coisa que os separa é onde
-- aparecem na tela.
--
-- O que decide não é a forma, é a BUSCA. Procurar "frete" tem que varrer
-- os três: a objeção "o frete ficou caro", a regra da operação sobre
-- frete e o script que menciona frete. Com três tabelas isso é um UNION
-- de três SELECTs — e o quarto tipo, quando entrar, vai ser esquecido em
-- exatamente um desses UNIONs, num lugar que não dá erro, só devolve
-- menos resultado.
--
-- Com uma tabela, a busca não sabe que existem tipos.
--
-- ------------------------------------------------------------
-- PRODUTOS NÃO ENTRAM AQUI
-- ------------------------------------------------------------
--
-- A quarta seção da tela é Produtos, e ela lê `products` (migração 054).
-- Duplicar catálogo numa tabela de texto livre seria criar uma segunda
-- verdade sobre preço e medida, e a errada é sempre a que alguém
-- consulta.
--
-- ------------------------------------------------------------
-- O NOME
-- ------------------------------------------------------------
--
-- `playbook_steps` (migração 041) é outra coisa: o checklist por etapa
-- do funil, com progresso por oportunidade. As duas convivem porque
-- respondem perguntas diferentes — "o que falta fazer nesta
-- oportunidade" contra "o que eu digo quando ele reclamar do preço" — e
-- a palavra "Playbook" na interface passou a ser desta; o checklist de
-- etapa é rotulado "Passos da etapa".
-- ============================================================

CREATE TABLE IF NOT EXISTS playbook_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (type IN ('sales_script', 'objection', 'operation_rule')),

  title TEXT NOT NULL CHECK (length(trim(title)) > 0),

  -- Texto livre e não uma FK para uma tabela de categorias. São sete
  -- palavras por tipo, elas mudam quando a operação muda, e uma tela de
  -- gestão de categorias é mais produto do que o recurso inteiro vale.
  category TEXT,

  content TEXT NOT NULL CHECK (length(trim(content)) > 0),

  -- Quem escreveu. `SET NULL` e não `RESTRICT`: ao contrário de uma
  -- mensagem da equipe, um script continua sendo o script depois de a
  -- pessoa sair da empresa — o texto é da operação, não do autor.
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE playbook_entries IS
  'Base de consulta comercial: scripts, objeções e regras. Produtos NÃO '
  'entram aqui — a seção Produtos da tela lê `products` (migração 054).';

-- A listagem é sempre "esta conta, deste tipo, mais recente primeiro".
CREATE INDEX IF NOT EXISTS idx_playbook_entries_account_type
  ON playbook_entries(account_id, type, updated_at DESC);

-- ============================================================
-- updated_at, por gatilho
--
-- A tela grava por `update` direto do cliente, e confiar no cliente para
-- carimbar a data é confiar em que ninguém vai esquecer o campo num
-- formulário novo. O gatilho não esquece.
-- ============================================================

CREATE OR REPLACE FUNCTION touch_playbook_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS playbook_entries_touch ON playbook_entries;
CREATE TRIGGER playbook_entries_touch
  BEFORE UPDATE ON playbook_entries
  FOR EACH ROW EXECUTE FUNCTION touch_playbook_entry();

-- ============================================================
-- RLS — todo mundo lê, admin escreve
--
-- Mesma forma da 041, e pelo mesmo motivo: a base existe para ser
-- consultada por quem atende, incluindo `viewer`, e o conteúdo é o
-- combinado da empresa — não é coisa que cada um edita no meio de uma
-- conversa.
-- ============================================================

ALTER TABLE playbook_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS playbook_entries_select ON playbook_entries;
DROP POLICY IF EXISTS playbook_entries_insert ON playbook_entries;
DROP POLICY IF EXISTS playbook_entries_update ON playbook_entries;
DROP POLICY IF EXISTS playbook_entries_delete ON playbook_entries;

CREATE POLICY playbook_entries_select ON playbook_entries FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY playbook_entries_insert ON playbook_entries FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY playbook_entries_update ON playbook_entries FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY playbook_entries_delete ON playbook_entries FOR DELETE
  USING (is_account_member(account_id, 'admin'));
