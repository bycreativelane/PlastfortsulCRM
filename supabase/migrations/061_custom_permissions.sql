-- ============================================================
-- 061_custom_permissions.sql — a matriz de permissões sai do código
--
-- O pedido: "que seja bem dinâmico a possibilidade de permissões de cada
-- tipo de usuário e que seja possível criar novas permissões
-- personalizadas".
--
-- São dois pedidos, e eles são muito diferentes.
--
-- ------------------------------------------------------------------
-- O PRIMEIRO: A MATRIZ VIRA DADO
-- ------------------------------------------------------------------
--
-- Hoje quem pode o quê está gravado em `lib/auth/capabilities.ts` como
-- `minRole` — `contacts.export` é de agente para cima, e ponto. Mudar
-- isso para uma empresa que quer que só admin exporte é editar código.
--
-- `role_capabilities` inverte: a tabela é a exceção, o código é o
-- padrão. Uma linha diz "nesta conta, papel X pode/não pode Y"; sem
-- linha, vale o `minRole` de sempre. Uma conta que nunca abriu a tela se
-- comporta exatamente como antes desta migração — o que é o teste que
-- toda tabela de override tem que passar.
--
-- ------------------------------------------------------------------
-- O SEGUNDO: E A ARMADILHA DELE
-- ------------------------------------------------------------------
--
-- "Criar novas permissões" soa como criar comportamento. Não é.
--
-- **Uma permissão que nada consulta não faz nada.** Criar
-- `desconto.acima_de_10` não faz aparecer um controle de desconto, nem
-- impede ninguém de dar desconto — só existe uma chave que responde
-- true ou false para quem perguntar, e por enquanto ninguém pergunta.
--
-- Isso é útil de verdade em dois lugares, e é honesto dizer quais:
--
--   · quem for escrever um controle novo já encontra a chave pronta,
--     em vez de precisar de uma migração para criá-la;
--   · a API pública (`/v1/me`) devolve as permissões de quem chamou,
--     então uma integração pode decidir com base nelas.
--
-- Fora isso, é um rótulo. A tela diz isso com todas as letras, porque a
-- alternativa é alguém criar seis permissões e passar uma semana
-- procurando por que não mudaram nada.
--
-- Idempotente.
-- ============================================================


-- ============================================================
-- 1. As permissões que esta conta inventou
-- ============================================================
CREATE TABLE IF NOT EXISTS account_capabilities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  /**
   * A CHAVE, e o formato é apertado de propósito.
   *
   * `area.acao`, minúsculo, sem espaço — a mesma forma das embutidas
   * (`contacts.export`, `reports.view`). Duas razões: o código que lê
   * uma permissão não deve precisar saber se ela é nativa ou inventada,
   * e uma chave com espaço ou acento vira três grafias da mesma coisa
   * na primeira vez que duas pessoas a digitarem.
   */
  key TEXT NOT NULL
    CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),

  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  description TEXT CHECK (description IS NULL OR length(description) <= 240),

  /**
   * O papel mínimo que a recebe por padrão, como as embutidas têm.
   * `role_capabilities` continua podendo alterar por papel.
   */
  min_role account_role_enum NOT NULL DEFAULT 'admin',

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Uma chave por conta. Duas linhas com a mesma chave é uma pergunta
  -- com duas respostas, e quem lê pega a primeira que vier.
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS idx_account_capabilities_account
  ON account_capabilities(account_id);

COMMENT ON TABLE account_capabilities IS
  'Permissões que esta conta criou. Uma permissão só muda alguma coisa '
  'onde o produto pergunta por ela — criar a chave não cria o controle.';


-- ============================================================
-- 2. A matriz por papel
--
-- Guarda só a EXCEÇÃO. Sem linha, vale o padrão do código.
--
-- Poderia guardar a matriz inteira, e seria pior: toda capacidade nova
-- que o produto ganhasse nasceria ausente da tabela, e a pergunta "sem
-- linha significa não pode, ou significa ainda não decidiram?" não teria
-- resposta. Guardando só o que alguém mudou de propósito, a ausência tem
-- um único significado.
-- ============================================================
CREATE TABLE IF NOT EXISTS role_capabilities (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role account_role_enum NOT NULL,
  capability TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,

  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (account_id, role, capability)
);

COMMENT ON TABLE role_capabilities IS
  'Exceções à matriz padrão do código. Sem linha = o minRole embutido '
  'vale. Uma conta que nunca abriu a tela se comporta como antes da 061.';

/**
 * O DONO NUNCA PERDE NADA.
 *
 * Sem esta trava, um administrador pode gravar `owner/settings.edit =
 * false` e ninguém mais consegue desfazer — a conta fica sem quem
 * conserte, e o único caminho de volta é o SQL. É a mesma classe de
 * armadilha que a 034 fechou impedindo alguém de rebaixar o dono.
 */
CREATE OR REPLACE FUNCTION public.guard_owner_capabilities()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.role = 'owner' AND NEW.allowed = FALSE THEN
    RAISE EXCEPTION 'The owner cannot be denied a capability'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS role_capabilities_guard_owner ON role_capabilities;
CREATE TRIGGER role_capabilities_guard_owner
  BEFORE INSERT OR UPDATE ON role_capabilities
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_owner_capabilities();


-- ============================================================
-- 3. RLS: todo membro LÊ, só admin ESCREVE
--
-- Ler é obrigatório para todo mundo: o app decide o que desenhar a
-- partir disto, então um agente que não pudesse ler a própria matriz
-- veria uma interface onde nada é permitido.
-- ============================================================
ALTER TABLE account_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_capabilities_select ON account_capabilities;
CREATE POLICY account_capabilities_select ON account_capabilities FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS account_capabilities_write ON account_capabilities;
CREATE POLICY account_capabilities_write ON account_capabilities FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS role_capabilities_select ON role_capabilities;
CREATE POLICY role_capabilities_select ON role_capabilities FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS role_capabilities_write ON role_capabilities;
CREATE POLICY role_capabilities_write ON role_capabilities FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
