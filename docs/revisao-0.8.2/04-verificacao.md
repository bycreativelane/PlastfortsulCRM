# O que foi verificado, e o que não foi

Separado em três: o que foi medido, o que só compilou, e o que ninguém viu
rodando. A terceira lista é a que importa. Índice:
[00-README.md](00-README.md).

---

## Automático, a cada mudança

Os quatro passos do CI (`.github/workflows/ci.yml`), rodados repetidamente ao
longo do trabalho e no fim:

| Passo               | Resultado final    |
| ------------------- | ------------------ |
| `npm run lint`      | 0 erros, 37 avisos |
| `npm run typecheck` | limpo              |
| `npm test`          | 1261 passando      |
| `npm run build`     | compila            |

Os 37 avisos são `react-hooks/exhaustive-deps` pré-existentes, nenhum em
arquivo tocado nesta revisão.

### Testes novos

| Arquivo                             | Cobre                                                       |
| ----------------------------------- | ----------------------------------------------------------- |
| `lib/inbox/message-preview.test.ts` | Assinatura e placeholder de mídia, incluindo os casos em que a heurística deve **recusar** |
| `lib/conversations/auto-assign.test.ts` | O rodízio: pula offline, retoma após o último, sobrevive a membro que saiu |
| `lib/notifications/new-message.test.ts` | Fan-out, trava de rajada, e que a função nunca lança         |
| `lib/whatsapp/phone-format.test.ts` | Máscara progressiva e o round-trip com E.164                 |

### Testes reescritos, e por quê

Três arquivos afirmavam o comportamento errado. Um teste que defende um bug é
pior que nenhum teste, então a inversão está registrada dentro de cada um:

- **`reopen.test.ts`** — reescrito **duas vezes**. A primeira versão afirmava
  que `pending` era ignorado (a #409 só se importava com `closed`); a segunda
  afirmava que a mensagem do cliente movia `pending → open`, que era minha
  leitura errada. A terceira é a que bate com os três relatos.
- **`conversation-filters.test.ts`** — afirmava o escopo por responsável.
- **`presence.test.ts`** — fixava os nove literais em inglês que o §13 do
  [02-bugs.md](02-bugs.md) descreve.

### Uma mudança na configuração dos testes

`vitest.config.ts` passou a definir `NEXT_PUBLIC_APP_LOCALE=pt-BR`. Sem isso
`APP_LOCALE` caía no `'en'` do fallback e **toda função de data era exercitada
num idioma que nenhuma instalação usa** — que é como nove strings em inglês
passaram meses numa suíte verde. A troca quebrou exatamente dois testes, os
dois que fixavam os literais.

---

## Medido no navegador

Servidor de desenvolvimento em `localhost:3000`, depois de matar um `next dev`
travado desde o dia anterior que segurava a porta.

| O quê | Como | Resultado |
| ----- | ---- | --------- |
| Cadastro só por convite | `curl` sem seguir redirect | `/signup` → **307**; `/signup?invite=…` → **200** |
| Botão de criar conta | `getBoundingClientRect` a 375px | Campo de senha e linha dos botões terminam os dois em **334px**; overflow horizontal da página **0** |
| Tela de convite | Captura a 800px | Moldura dividida, logo e foto — a mesma das telas de entrar |
| Tela de login | Captura a 375px | Sem botão "Criar conta" |

**Um susto que valeu conferir.** Navegando pelo navegador,
`/signup?invite=…` caiu no login e parecia bug meu. Não era — a ferramenta de
navegação descartava a query string. Confirmado por HTTP direto (307 vs 200)
antes de sair mexendo no código.

---

## Verificado contra o banco

Sondagens REST no projeto do `.env.local` (banco de teste).

- **Antes:** `team_messages` → 404, `conversations.waiting_since` → 400,
  `contacts.name_source` → 400. Era por isso que o chat da equipe não
  funcionava.
- **Depois de o Gabriel aplicar 045 e 046:** todas as colunas que o código usa
  respondem 200 — as sete de `team_messages`, `hidden_by`,
  `auto_assign_cursor`, e `notifications` aceitando `type=new_message`.
- **Bug reproduzido em dado real:** entre 8 conversas havia exatamente uma com
  `status='pending'` **e** responsável — marcada Esperando no cabeçalho,
  aparecendo em Entrada na lista.
- **041** (playbooks) continua não aplicada, como deve.

---

## O que NÃO foi visto rodando

A lista honesta. Tudo aqui compila, tem teste onde é lógica, e **ninguém viu na
tela**, porque exige uma sessão autenticada e eu não tenho a senha:

- As duas abas e a movimentação automática entre elas
- A sala da equipe, a prévia dela na barra lateral, e o ponto de não lida
- Usuários online no cabeçalho
- O menu de contexto da conversa, ocultar e excluir
- A atribuição automática em rodízio
- A máscara de telefone dentro do formulário (a função tem teste; o campo não)
- O cabeçalho da conversa no celular — **o item 10 da lista original, que
  continua sem medição desde o começo**
- O canvas de fluxos e automações depois da mudança de fundo
- A página de Novidades reestruturada

### Uma coisa que não consigo verificar daqui

A 046 mudou de forma no meio do trabalho: a primeira versão criava um gatilho
`on_new_inbound_message`, a final o remove. Se uma cópia antiga foi aplicada
antes da atual, o gatilho pode ter ficado — e a notificação sairia **duas
vezes**. O PostgREST não expõe `pg_trigger`.

```sql
select tgname from pg_trigger where tgname = 'on_new_inbound_message';
```

Zero linhas é o esperado. Se voltar alguma, basta rodar a 046 atual por cima —
ela derruba o gatilho e é idempotente. O `verify-schema.sql` falha o CI se ele
reaparecer.

---

## O roteiro mínimo para provar o principal

Uma sequência, e ela cobre a correção central:

1. Mandar uma mensagem de teste para o número.
2. A conversa cai sozinha em **Esperando**, e o sino toca **uma vez**.
3. Responder por ela.
4. A conversa volta para **Entrada**.

Se o sino tocar duas vezes, o gatilho da 046 antiga ficou para trás.
