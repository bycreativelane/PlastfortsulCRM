# O plano de Produtos, comparado com o que foi feito

> Na passagem noturna eu escrevi: *"Não encontrei um arquivo com esse
> nome."* Estava certo sobre o arquivo e errado sobre a conclusão — **o
> plano existe**, e é uma sessão de chat (`Plano de implementação de
> Produtos`, 24/08), não um documento no repositório. Procurei no disco;
> ele estava no histórico.
>
> Este arquivo compara o plano com a migração 054 e com o que foi
> construído em cima dela.

---

## O que o plano decidiu, e o que eu fiz

> **Atualizado depois da conversa.** Três das quatro divergências foram
> resolvidas — ver "O que foi corrigido" no fim. A tabela abaixo é o
> estado em que a comparação foi feita.

| # | O plano | O que fiz | |
| - | ------- | --------- | - |
| 1 | Linha própria no menu, `/products`, grupo Operação, abaixo de Contatos | Aba em **Configurações › Produtos** | ❌ → **corrigido** |
| 2 | Escrita em `products` = **admin** | Escrita = **agent** | ❌ → **meio-termo** |
| 3 | `contact_products`, tabela de ligação com PK composta | `contacts.product_interest UUID[]` + GIN | ❌ → mantido, com ressalva |
| 4 | `attributes JSONB` — medida, espessura, material, cor | Não existe | ❌ → **colunas tipadas (055)** |
| 5 | `unit NOT NULL`, vocabulário controlado em `lib/products/units.ts` | `unit` anulável, texto livre | ❌ em aberto |
| 6 | Coluna `code` | Coluna `sku` | ⚠️ |
| 7 | `currency` NULL = usa `accounts.default_currency` | `NOT NULL DEFAULT 'BRL'` | ⚠️ |
| 8 | `deal_items` com `name_snapshot`, `unit_price`, `quantity`, `position` | Igual, com `name` no lugar de `name_snapshot` | ✅ |
| 9 | `product_id` SET NULL + snapshot do nome | Igual, e pelo mesmo argumento | ✅ |
| 10 | Índice único parcial `(account_id, lower(code)) WHERE code IS NOT NULL` | Igual, com `trim()` a mais | ✅ |
| 11 | Gatilho: havendo itens, eles mandam; sem itens, o valor digitado vale | Igual | ✅ |
| 12 | RLS de `deal_items` e ligação = agent | Igual | ✅ |
| — | *(não estava no plano)* | `discount_percent` e `total` GENERATED | ➕ |

---

## As quatro divergências, uma a uma

### 1. Onde a área mora — e esta o plano rejeitou por escrito

O plano recomendou rota própria e **antecipou exatamente a minha
escolha**, para descartá-la:

> *"A alternativa é uma aba em Configurações (como Etiquetas e Modelos).
> Ela é mais barata — mas foi exatamente o arranjo que a 0.8.2 desfez
> quando Templates e Etiquetas apareciam nas duas superfícies ao mesmo
> tempo. **Escolher uma. Não as duas.**"*

E o critério não é gosto — é o teste que o próprio `sidebar.tsx`
documenta: *"é um lugar onde você TRABALHA, ou onde você muda como o
trabalho se comporta?"*. Um catálogo de embalagens passa no primeiro: o
atendente abre o produto **no meio da conversa** para consultar medida e
preço.

**O plano está certo e eu estou errado.** Configurações é onde se muda o
comportamento do sistema; consultar preço é o trabalho. E a 0.8.2 já
pagou por essa lição uma vez.

### 2. Quem pode escrever no catálogo

O plano: **admin**. *"Catálogo é configuração (admin); usar o catálogo é
trabalho (agent)."* E: *"Catálogo errado é preço errado na frente do
cliente."*

Eu escrevi o contrário, com argumento contrário: *"a pessoa que cota o
preço é a que percebe que está errado, e um catálogo que só um admin
conserta é um catálogo que fica errado até alguém lembrar de comentar."*

**Os dois argumentos são bons e são sobre riscos diferentes** — um teme o
preço errado na frente do cliente, o outro teme o preço errado que
ninguém conserta. O plano é a sua decisão declarada; a minha foi tomada
sem conhecê-la. Vale escolher de propósito, e há um meio-termo que
nenhum dos dois considerou: agente **edita**, admin **cria e aposenta**.

### 3. Tabela de ligação × array

O plano pediu `contact_products` com PK composta, *"mesmo padrão de
`deal_playbook_progress` (041)"*. Eu usei um array com índice GIN.

**Aqui eu defenderia o que fiz**, e com uma ressalva: o array é lido
inteiro, escrito inteiro, nunca é feito join A PARTIR dele, e o teste que
importa é de contenção (`overlaps`) — que é para o que o GIN existe. Uma
tabela de ligação seriam três políticas a mais para uma lista de seis
uuids.

A ressalva: **o array não guarda metadado da ligação.** Se um dia
"produto de interesse" precisar de *desde quando*, *quem marcou* ou
*derivado ou escolhido à mão* — e a pergunta 3 do plano diz que essa
última distinção vai importar — a tabela volta. É migração nova, não
correção.

### 4. `attributes JSONB` — a lacuna real

O plano previu a coluna e disse explicitamente que **não ia chutar o
schema dela**:

> *"`attributes` é o único ponto onde eu **não** chuto o schema."*
> *"Me manda a tabela de preços real da PlastfortSul. É o que decide se
> medida/espessura viram colunas tipadas (filtráveis: 'todos os 40x60')
> ou ficam em `attributes` como texto."*

Eu não sabia da pergunta e não pus coluna nenhuma. O que existe hoje é
`description`, texto livre — e **texto livre não filtra**. "Todos os
40x60" é exatamente a consulta que uma distribuidora de embalagens faz, e
hoje ela não existe.

Isso também limita a ferramenta de catálogo do assistente: ela devolve a
descrição inteira em vez de campos que o modelo possa comparar.

---

## As três perguntas do plano, hoje

O plano terminou com três perguntas que mudam o SQL. Duas se
responderam sozinhas:

| Pergunta | Estado |
| -------- | ------ |
| 1. A tabela de preços real da PlastfortSul | **Em aberto** — é o que decide o item 4 acima |
| 2. O valor da oportunidade passa a ser calculado pelos itens? | **Respondida na prática:** sim, com fallback para o valor digitado quando não há item — exatamente a recomendação |
| 3. Produto de interesse é lista à mão ou derivada do que já comprou? | **Metade:** a lista à mão está feita (P1 do plano). A derivada era P2 e não existe |

---

## As fases do plano, contra o que existe

**P0 — a área existe.** Feito, no lugar errado. Migração, tipos, `lib`,
lista com busca, formulário, aposentar/restaurar, i18n nos três idiomas,
gating por papel. Falta a linha no menu e a rota.

**P1 — o produto pega valor.** Feito, com duas faltas:

- `deal_items` no formulário da oportunidade + sincronização — ✅
- produtos de interesse na ficha do contato — ✅
- **no painel lateral da conversa** — ❌ não fiz
- **busca global (§69)** — ❌ não fiz

**P2.** Uma das cinco:

- público de campanha por produto (§40/§44) — ✅ feito
- relatório de receita e volume por produto — ❌
- recompra por produto (§32) — ❌
- importação CSV da tabela de preços — ❌
- `/api/v1/products` + `docs/public-api.md` — ❌

---

## O que eu proporia, em ordem

1. **Mover para `/products`** — é a decisão do plano, o argumento dele é
   melhor que o meu, e quanto mais tempo a aba fica em Configurações mais
   caro fica mudar. Junto vão a linha do menu, `pageTitles['/products']`
   no `header.tsx` (*"sem isso o título mente"*, diz o plano) e a
   capacidade em `capabilities.ts`.
2. **Decidir o nível de escrita** — admin, agent, ou o meio-termo.
3. **Responder a pergunta 1** (a tabela de preços real) e então
   `attributes` ou colunas tipadas, numa **055**.
4. **Busca global e o painel da conversa** — o resto do P1, e é onde o
   catálogo passa a servir no meio do atendimento.
5. O P2 restante, quando fizer sentido.

---

## A lição de processo

Procurei o plano no disco e concluí que não existia. **O histórico de
sessões era um lugar onde procurar, e eu não procurei** — e a
consequência não foi só perder tempo: foi tomar quatro decisões de
arquitetura que já estavam tomadas, duas delas na direção contrária, uma
delas contra um argumento que o próprio plano escreveu para me impedir.

Quando um pedido diz "tem um plano", vale gastar uma chamada procurando
no histórico antes de assumir que ele não existe.


---

## O que foi corrigido

Três decisões voltaram para a mesa e três foram tomadas de propósito.

### 1. A área mudou de lugar

`/products`, linha própria no grupo Operação, abaixo de Contatos — como o
plano decidiu. Foram junto:

- a rota (`app/(dashboard)/products/page.tsx`) e o componente
  (`components/products/product-catalog.tsx`);
- a linha no menu, com a capacidade `products.view`;
- `pageTitles['/products']` no `header.tsx` — o plano dizia *"sem isso o
  título mente"*, e no celular esse é o único lugar que diz onde você
  está;
- a aba saiu de Configurações. **Uma superfície, não duas.**

E o `proxy.test.ts` pegou o que eu teria enviado: `/products` não estava
em `PROTECTED_PATHS`. Uma rota do painel sem guarda de sessão — o teste
que assere "toda rota do dashboard está protegida" existe exatamente para
esse esquecimento, e funcionou.

### 2. Quem escreve — o meio-termo

Nem o `admin` do plano nem o `agent` que eu tinha feito. **Migração 055**
separa os dois atos que estavam sendo tratados como um:

| Ato | Quem | Como é imposto |
| --- | ---- | -------------- |
| Corrigir preço, medida, descrição | agent | policy de UPDATE |
| Criar um produto | admin | policy de INSERT |
| Aposentar ou restaurar | admin | **gatilho** `products_guard_active` |

O terceiro precisa de gatilho porque "aposentar" é um UPDATE em `active`,
e RLS restringe **linhas**, não colunas — a mesma parede que a 034
encontrou com `account_role` e a 050 com `permission_overrides`.

Na tela: o lápis aparece para o agente, o arquivar só para o admin.
Escondido em vez de desabilitado — um controle que está sempre lá e
sempre recusa ensina a desconfiar da linha, não do botão.

### 3. Medida e espessura viraram colunas

A pergunta 1 do plano foi respondida: **colunas tipadas**, não
`attributes JSONB`.

```
width_cm          NUMERIC(8,2)
height_cm         NUMERIC(8,2)
thickness_micron  INTEGER
material          TEXT
color             TEXT
size_label        TEXT GENERATED  -- "40x60cm"
```

**A unidade está no nome da coluna**, e isso é a decisão que evita o
catálogo com 40 em centímetros numa linha e 400 em milímetros na outra —
as duas "certas", e uma busca por 40x60 que acha metade.

`size_label` é GENERATED para que a lista, o item de orçamento e a
resposta do assistente não possam formatar diferente. E é o que a busca
casa quando alguém digita "40x60", que é como o produto é pedido ao
telefone — a ferramenta de catálogo da IA agora procura por ele também, e
devolve medida e espessura como **números** em vez de um parágrafo.

### O que continua em aberto

- **`unit` com vocabulário controlado** (item 5). O plano queria
  `lib/products/units.ts` espelhando `occurrences/kinds.ts`; hoje é texto
  livre. Não corrigi porque a lista certa — un, cx, kg, milheiro, fardo,
  m — é a mesma pergunta que a tabela de preços real responderia.
- **Busca global e o painel da conversa** — o resto do P1 do plano.
- **P2**: relatório por produto, recompra por produto, importação CSV,
  `/api/v1/products`.
- **A tabela de ligação × array** (item 3) — mantido como array, com a
  ressalva já registrada: se "produto de interesse" precisar de metadado,
  a tabela volta, e é migração nova e não correção.
