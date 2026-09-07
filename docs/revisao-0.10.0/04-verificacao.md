# Verificação

O que foi verificado, **como**, e — a parte que importa mais — o que **não**
foi.

---

## 1. O que passou

| Verificação | Resultado |
| --- | --- |
| `npm test` | 1781 testes, 146 arquivos |
| `npm run typecheck` | limpo |
| `npm run lint` | 0 erros, 42 avisos preexistentes |
| `npm run build` | compila; saída de produção ~81 MB |
| CI · Lint, typecheck, test, build | passa |
| CI · Apply to a clean database | passa — aplica as 69 migrações do zero |

Testes escritos nesta entrega: 20 nas contas da agenda, 21 no mapeamento com
a Google, 13 no OAuth, 17 nas regras de sincronização, 8 no prazo em dias
úteis, 15 na API pública.

### `npm run format:check` falha, e é falso positivo

Acusa ~433 arquivos — quase o repositório inteiro, incluindo o que ninguém
tocou. A causa é `core.autocrlf=true` entregando CRLF ao prettier, que exige
LF. Verificado: `tsconfig.json` tem 34 CR em disco, os arquivos escritos
pelo editor têm zero, e **todos os blobs commitados estão em LF**.

A CI não roda esse comando. Não "conserte" — um `format --write` produziria
um diff de 433 arquivos sem nenhuma mudança de conteúdo.

---

## 2. Conferir a `069`

Ela **não foi aplicada** ao banco de desenvolvimento. Depois de aplicar, a
checagem mais barata é pedir cada tabela pela API REST:

```bash
node --env-file=.env.local -e '
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const t = ["calendar_connections","calendar_sources","calendar_events","task_calendar_links"];
(async () => { for (const n of t) {
  const r = await fetch(`${url}/rest/v1/${n}?select=*&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  console.log(String(r.status).padEnd(4), n, r.ok ? "EXISTE" : "FALTA");
} })();'
```

Quatro `200` e a migração entrou. Um `404` com `PGRST205` significa que a
tabela não existe.

As asserções da `066`, `067` e `068` já estão em
`supabase/ci/verify-schema.sql`, que a CI roda.

---

## 3. O que NÃO foi verificado

Esta seção é o ponto deste documento. Três coisas foram escritas, testadas
contra dublês, e **nunca exercitadas de verdade**.

### 3.1 O fluxo OAuth nunca falou com a Google

Nenhuma chamada real foi feita: falta o app no Cloud Console. O que existe
são testes contra dublês, que provam a lógica e **não** provam o contrato.

O que só um teste real revelaria:

- Se a URI de redirecionamento bate caractere por caractere.
- Se o refresh token chega mesmo na segunda autorização (é o que
  `prompt=consent` deve garantir).
- Se os escopos pedidos bastam para `calendarList` e para escrever evento.
- Se o id determinístico é aceito. O alfabeto foi corrigido depois que um
  teste pegou o `w` fora do base32hex, mas ninguém viu a Google aceitar um.

**Roteiro, quando as credenciais existirem:**

1. Configurações › Agendas → "Conectar com a Google". Autorize.
2. A tela deve voltar dizendo "Agenda conectada" e listar as agendas da
   conta, com só a principal habilitada e nenhuma publicando.
3. "Sincronizar agora". Um evento marcado na Google deve aparecer em
   `/agenda` como linha cinza, sem botão de concluir e com link para fora.
4. Marque uma agenda como "Importar e publicar".
5. Crie uma tarefa com prazo e hora. O evento deve aparecer na Google em
   segundos.
6. Conclua a tarefa. O título do evento deve ganhar `✓` e **não** sumir.
7. Cancele outra tarefa. Aí sim o evento some.
8. Mova o evento na Google. No próximo tique do cron (5 min), o prazo da
   tarefa deve acompanhar — **e não voltar** no tique seguinte. Se voltar, o
   `etag` não está sendo gravado antes do envio.

O passo 8 é o que mais vale testar: é a regra 2 do §D5, e o modo de falha
dela é um ricochete que move o compromisso sozinho a cada cinco minutos.

### 3.2 A `/agenda` nunca foi vista desenhada

A rota redireciona para `/login` sem sessão — o que confirma que a proteção
funciona e impede a verificação visual. O build prerenderiza a rota, os
testes cobrem as contas puras, e ninguém olhou a grade.

Com o `npm run dev` de pé e uma sessão aberta, vale conferir: o eixo
começando uma hora antes do expediente e terminando uma depois; a faixa de
"dia todo" aparecendo só quando há o que pôr nela; um sábado desenhado como
fechado em vez de sumir; e o deep link `?d=2026-09-10&v=day`.

### 3.3 O realtime da `067` não foi confirmado na entrega

A publicação foi conferida em 3 de setembro por SQL
(`pg_publication_tables`), mas a entrega ao vivo depende do app com sessão
real — e sondar `postgres_changes` do Node com a service key não recebe
nada. Ver a nota em `realtime-nao-testavel-com-service-role` na memória.

---

## 4. Quatro erros que os testes de guarda pegaram

Vale registrar, porque é o argumento para mantê-los:

| Teste | O que pegou |
| --- | --- |
| `proxy.test.ts` | `/agenda` fora de `PROTECTED_PATHS` — **rota autenticada sem guarda** |
| `type-scale.test.ts` | `text-[11px]` e `text-[10px]` fora da escala |
| `keys-exist.test.ts` | `Calendars.connected` chamada sem existir no catálogo |
| `docs.test.ts` | Duas rotas de escrita sem exemplo de corpo |

O primeiro é o que mais importava: uma rota nova, autenticada, que teria ido
para produção sem proteção porque quem a criou esqueceu de registrá-la.
