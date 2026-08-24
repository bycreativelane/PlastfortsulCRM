# O que não foi feito

As duas correções de banco que bloqueavam o deploy **foram feitas** — ficam
registradas abaixo porque a 048 precisa ser aplicada e a 047 mudou depois de
já ter sido entregue uma vez. O resto é fila.

---

## Banco: feito, falta aplicar

### 1. Migração 047 — o `GRANT` que faltava

`supabase/migrations/047_conversation_media_preview.sql` revogava o acesso à
`bump_conversation_on_inbound` de `PUBLIC`, `anon` e `authenticated` e
**nunca reconcedia ao `service_role`**, apesar de o comentário do próprio
arquivo prometer isso. `DROP FUNCTION` leva a ACL junto, e
`REVOKE ... FROM PUBLIC` remove o EXECUTE padrão que `CREATE FUNCTION`
distribui.

O recuo do webhook não salvava: ele tenta a assinatura de dois argumentos,
que a própria 047 dropou. Aplicada como estava, **toda mensagem recebida
perderia o contador de não lidas e a prévia da conversa**, em silêncio.

**Corrigido no lugar**, porque a 047 ainda não tinha sido aplicada:

```sql
GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT, TEXT, TEXT) TO service_role;
```

### 2. Migração 048 — escrita entre contas no `team_messages`

A política de UPDATE da 046 checava autoria e mais nada:

```sql
USING (auth.uid() = author_id)
WITH CHECK (auth.uid() = author_id)
```

`account_id` é uma coluna comum da linha e o PostgREST aceita um `PATCH`
nela. Então um autor podia mover a própria mensagem para a sala de outra
conta — as duas metades da política passam, porque as duas só perguntavam
"esta mensagem é sua?", e era. Como `team_messages` está na publicação
`supabase_realtime`, a linha aparecia **ao vivo** na sala alheia.

O ramo do autor no DELETE tinha a mesma lacuna.

`048_team_messages_tenant_guard.sql` recria as duas políticas com
`is_account_member(account_id)` nos dois lados. **A 046 já está aplicada**,
então isto é migração nova e não edição.

### Verificação no CI

`supabase/ci/verify-schema.sql` ganhou três asserções novas: que o
`service_role` consegue executar a RPC de quatro argumentos, e que as
políticas de UPDATE e DELETE do `team_messages` mencionam
`is_account_member`. As três falham a build se a migração correspondente não
tiver rodado — o `GRANT` em particular é invisível de fora, porque as colunas
chegam, a função tem a forma certa, e a única evidência do problema é um
`console.error` por mensagem recebida.

### Para aplicar

```bash
supabase db push
```

A ordem importa e o nome dos arquivos já a garante: 047 (com o `GRANT`) antes
da 048.

---

## Fila

### Achados de servidor da auditoria da 0.8.2

Confirmados e não corrigidos — a passagem foi de interface:

| Onde | O quê |
| ---- | ----- |
| `lib/conversations/auto-assign.ts:186` | A atribuição reporta vencedor mesmo quando perde a corrida; a notificação vai para quem não é dono e o dono real não recebe nada. Falta `.select('id')`. |
| `lib/notifications/new-message.ts:99` | A trava de rajada é read-then-insert sem índice único: entregas concorrentes da Meta notificam as duas. |
| `lib/notifications/new-message.ts:163` | Um `viewer` pode vencer o rodízio e ser o único notificado. |
| `app/api/whatsapp/webhook/route.ts:842` | O fan-out de notificação é aguardado **na frente** do motor de fluxos, das automações e da resposta de IA. |
| `lib/notifications/new-message.ts:165` | Releitura sem limite de `profiles` a cada mensagem recebida. |
| `migrations/045:118` | `idx_conversations_visible` não pode ser escolhido — a consulta da lista não tem nenhum dos dois predicados do índice parcial. |
| `lib/team/messages.ts:103,28` | `conversation_id` e `edited_at` são peso morto: escritos por ninguém, lidos por ninguém. |

### A 041 diz duas coisas ao mesmo tempo

O release lista `041_playbooks.sql` como **"deliberadamente não aplicada"**, e
a sonda acima mostra que ela **está aplicada** no projeto do `.env.local`.
Isso pode ser só a diferença entre o banco de teste e o de produção — mas há
um detalhe que faz a diferença importar:

O app **embarca a interface de playbook** (`playbook-checklist.tsx`,
`playbook-editor.tsx`), e ela não tem guarda de tabela ausente. Onde as
ocorrências dizem "esperando uma migração" quando a 042 não rodou, marcar um
passo sem a 041 cai no `toast.error` genérico — "não foi possível", sem dizer
por quê, para uma tela que o release mandou não habilitar.

Então são duas decisões e uma é sua:

1. **A 041 entra nesta versão?** Se entra, a linha do release muda. Se não
   entra, ela precisa da mesma guarda que a 042 tem — senão o release
   descreve uma tela que erra em silêncio.
2. Em qualquer um dos casos, o `docs/playbook-comercial.md` já descreve o
   conteúdo dos playbooks como se o recurso estivesse no ar.

### Os `npm run seed:*` não rodam num clone

Os seis atalhos continuam no `package.json` apontando para
`scripts/seed-plastfortsul.mjs`, `scripts/seed-inbox.mjs`,
`scripts/seed-automations.mjs` e `scripts/seed-notifications.mjs` — e a pasta
`scripts/` **não está no repositório**. Quem clonar recebe
`Cannot find module` nos quatro.

Não é descuido de `.gitignore`: a pasta foi retirada de propósito, e o
conteúdo dos seeds é da PlastfortSul — nomes, empresas, o vocabulário dos
templates. Então a decisão é de quem publica, e não de quem edita. Duas
saídas, e as duas resolvem: devolver a pasta ao repositório, ou tirar os seis
atalhos do `package.json`, que é o que hoje promete um comando inexistente.

### Pedidos

- **Faixas de áudio ao vivo** na gravação (waveform).
- **Bandeira no seletor de moeda.**
- **Cal.com no celular** — é um projeto, não um ajuste.
- **Opções de estilo para o BETA** — foi pedido "vê opções" e só uma foi
  apresentada, na 0.8.2.
- **Clique direito no resto do sistema.** Existe em dois lugares hoje —
  conversa e card do Kanban, os dois consertados nesta versão. Contatos,
  fluxos, automações, disparos e modelos não têm. Cada um precisa da sua
  própria lista de ações, então é trabalho por superfície e não um
  interruptor.

### Verificação

O roteiro em [04-verificacao.md](04-verificacao.md) — nada desta versão foi
visto rodando numa sessão autenticada.
