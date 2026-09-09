-- ============================================================
-- 074_quote_fingerprint
--
-- Um orçamento por CONTEÚDO, e não por clique.
--
-- Reportado pelo Gabriel em 8 de setembro de 2026, com o print: oito
-- linhas idênticas no arquivo, mesmo cliente, mesmo pedido, mesmo total,
-- mesmo segundo. Ele apertou "Gerar PDF" oito vezes.
--
-- A 071 guarda uma linha por GERAÇÃO, e o argumento dela continua de pé:
-- o negócio muda depois que o orçamento sai, e o que o cliente recebeu
-- foi a versão daquele dia; sobrescrever apagaria justamente isso. O que
-- estava errado era a implementação — o argumento vale quando o CONTEÚDO
-- muda, e oito documentos idênticos não são oito versões.
--
-- A regra passa a ser a que ele descreveu: guardado por data × produto ×
-- cliente × e o resto. `fingerprint` é o sha256 de tudo que o documento
-- imprime (`lib/quotes/fingerprint.ts` diz campo a campo o que entra).
--
-- ------------------------------------------------------------
-- O ÍNDICE É ÚNICO, e é ele quem garante a regra
-- ------------------------------------------------------------
--
-- A rota procura antes de inserir, mas procurar-e-inserir é uma corrida:
-- dois cliques rápidos passam os dois pela consulta antes de qualquer um
-- gravar. O índice é o que transforma o segundo insert num erro em vez de
-- numa duplicata — e a rota trata esse erro relendo a linha que ganhou.
--
-- Parcial, porque as linhas ANTERIORES a esta migração não têm
-- impressão digital e não podem ser inventadas: elas ficam como estão,
-- inclusive as oito duplicatas do print. Apagá-las seria decidir pelo
-- Gabriel o que é lixo no arquivo dele.
-- ============================================================

ALTER TABLE deal_quotes
  ADD COLUMN IF NOT EXISTS fingerprint TEXT;

COMMENT ON COLUMN deal_quotes.fingerprint IS
  'sha256 do que o documento imprime — data, cliente, linhas, totais, '
  'transportador, observacoes. Dois orcamentos com a mesma impressao '
  'digital sao o mesmo documento, e a rota reaproveita a linha em vez de '
  'gerar outra. Nulo nas linhas anteriores a 074.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_quotes_fingerprint
  ON deal_quotes(account_id, fingerprint)
  WHERE fingerprint IS NOT NULL;
