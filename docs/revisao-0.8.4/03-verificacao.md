# O que foi medido, e o que ninguém viu rodando

---

## Medido

Tudo abaixo foi executado nesta máquina, nesta passagem.

| Portão | Comando | Resultado |
| ------ | ------- | --------- |
| Tipos | `npx tsc --noEmit` | limpo |
| Lint | `npx eslint src` | **0 erros**, 35 avisos (todos anteriores a esta passagem) |
| Testes | `npx vitest run` | **1304 passando**, 109 arquivos |
| Build | `npm run build` | exit 0, todas as rotas geradas |

São os quatro portões que o `.github/workflows/ci.yml` roda, na mesma
ordem. O Prettier **não** está entre eles e não está limpo neste
repositório — 280 arquivos divergem, a maioria intocada por esta
passagem.

### Testes de i18n, especificamente

`src/i18n/` tem três guardas e as três passam:

- **paridade** — toda chave do `en.json` existe no `pt-BR.json` e no
  `ko.json`, e nenhum dos dois tem chave órfã;
- **existência** — toda chave literal chamada num componente existe no
  catálogo. Esta é a que pegou dois erros meus em tempo real: as strings
  do interruptor de transcrição foram para `Settings.ai` quando o
  namespace do componente é `Settings.aiConfig`, e as do balão para
  `Inbox.messageBubble` quando é `Inbox.bubble`. Os dois teriam
  renderizado a keypath crua na tela;
- **segurança ICU** — nenhuma chave com ponto no nome.

**127 chaves novas** ao longo da passagem, nos três idiomas. As de
coreano são traduções minhas e merecem revisão de alguém que fale o
idioma.

---

## Não visto rodando

### A tela, autenticada

O servidor de dev sobe e `/` responde com a tela de login em português.
Daí não passa: entrar exige credenciais, e eu não as tenho e não devo
tê-las. **Nenhuma das mudanças de interface desta passagem foi vista com
os próprios olhos.**

O que isso deixa sem confirmação, em ordem de risco:

1. **O painel Acesso e auditoria inteiro.** É a tela mais nova e a mais
   complexa: seletor de pessoa, onze interruptores com três estados
   visíveis cada (vem do cargo / exceção / bloqueado), o log com filtro
   por área e paginação por keyset. Compila e passa no lint; ninguém a
   viu desenhar.
2. **A sala da equipe com edição.** O balão-vira-editor, o menu no hover,
   o "editada", o realtime de UPDATE e DELETE. A lógica otimista tem
   caminho de volta em caso de recusa do banco, e esse caminho nunca
   rodou.
3. **A transcrição no balão.** O `<details>` fechado sob o player. Nunca
   houve uma linha com `media_transcript_status = 'done'` para desenhar.
4. **A linha "Último acesso"** na aba Equipe.
5. **Os gráficos.** As mudanças são de material (gradiente), largura de
   eixo (36 → 40) e layout (uma coluna → duas). São exatamente o tipo de
   coisa que se julga vendo, e eu argumentei por medida.

**O que destravaria isso:** você abrir `/settings?tab=access` e
`/inbox?team=1` numa sessão logada e olhar. Se preferir, eu dirijo o
navegador e faço as capturas — só não posso digitar a senha.

### Medido no navegador, sem sessão

Duas coisas desta passagem foram verificadas com números em vez de com os
olhos, injetando a marcação na folha de estilo real da página de login e
lendo o `getBoundingClientRect`:

- **O alinhamento da auditoria** ([§14](01-worklog.md#14-três-alturas-numa-linha-só)).
  Antes: disco 6px abaixo da frase, hora 2px acima. Depois: offset 0 nos
  três, em linha simples e dupla.
- **As duas molduras no pé da rail**
  ([§13](01-worklog.md#13-a-mesma-cara-duas-vezes-no-pé-da-rail)). O card
  da sala em repouso é `rgba(0,0,0,0)` sem borda; o ladrilho da conta é
  opaco com 1px. São objetos diferentes, não dois iguais.

É menos que ver a tela e mais que argumentar de cabeça.

### O banco

**Nenhuma das quatro migrações — 049, 050, 051, 052 — foi aplicada por
mim em lugar nenhum.** Os prints do último pedido mostram a auditoria
funcionando, então a 050 está aplicada no seu ambiente; as outras três eu
não vi rodar. Não há Docker nesta máquina, então `supabase db reset --local` — o
comando que o `migrations.yml` roda — não pôde rodar aqui. O SQL das
quatro não foi executado por nenhum Postgres sob meu controle.

O que foi conferido à mão, e vale menos que uma execução:

- ordem das instruções nos dois arquivos (a coluna antes da função que a
  escreve, a função antes do gatilho que a chama);
- `is_account_member(uuid, 'admin')` casa a assinatura de 017
  (`min_role account_role_enum`) — é a mesma forma que as políticas de
  046 já usam;
- `verify-schema.sql` continua sendo **uma única instrução**: um `DO $$
  … $$;`. É um requisito real do `supabase db query --file`, e este
  arquivo já foi queimado por ele antes (commit f91a6c8).

As **dezoito** asserções novas no CI são o que transforma "aplicou" em
"aplicou e fez alguma coisa" — inclusive as duas que verificam coisas
invisíveis de fora: uma **ausência** (nenhuma política de UPDATE ou
DELETE no log de auditoria) e um **backfill** (toda conta tem exatamente
uma sala padrão). As duas são o tipo de propriedade que uma migração
aplica limpa e mesmo assim não entrega.

### As chamadas aos provedores

`transcribeAudio` e `describeImage` **nunca foram executadas contra a
OpenAI nem contra a Anthropic**. O formato das duas requisições foi
escrito a partir da documentação e da forma dos adaptadores que já
existem no repositório (`providers/openai.ts`, `providers/anthropic.ts`),
não de uma resposta observada.

O ponto de maior risco, nomeado: **a extensão do arquivo de áudio.** O
endpoint de transcrição da OpenAI lê o NOME do arquivo para decidir o
container, e um áudio de WhatsApp chega como `audio/ogg; codecs=opus`.
`audioExtension()` mapeia isso para `.ogg`. Se estiver errado, a falha é
um 400 do provedor, capturada, registrada como `failed`, e invisível na
interface — que é o comportamento certo para o cliente que está
esperando e o pior possível para descobrir o problema. **O primeiro áudio
recebido depois de aplicar a 049 merece uma olhada no log do servidor.**

---

## Um defeito encontrado e corrigido antes de sair

Vale registrar porque quase passou.

A primeira versão da rota de permissões escrevia assim:

```ts
await ctx.supabase.from('profiles')
  .update({ permission_overrides: overrides })
  .eq('user_id', userId)
```

`profiles_update` (017) é `auth.uid() = user_id` no `USING` **e** no
`WITH CHECK`. Um admin escrevendo na linha de um colega casa **zero
linhas e não retorna erro**. A tela mostraria "Permissões salvas", o
toast verde apareceria, e nada teria mudado — descobrível só recarregando
e vendo a chave onde estava.

Virou `set_member_permissions()`, SECURITY DEFINER, no mesmo formato de
`set_member_role` (018). E o CI passou a asserir que a função existe,
justamente porque o sintoma da ausência dela é sucesso silencioso.


---

## Adendo — o que a passagem 14–17 deixou sem ver

Mesma limitação de antes, itens novos:

1. **A aba Atribuição inteira.** Três cartões de estratégia, três regras,
   e a lista de quem está no rodízio com o estado "abaixo do piso"
   desabilitado. A lógica do motor tem oito testes; a tela tem zero, e
   ninguém a viu desenhar.
2. **A aba Salas.** Criar, renomear, descrever, arquivar, restaurar. O
   caso que mais quero ver é o de renomear a sala padrão e depois limpar o
   campo — deve voltar a se chamar "Minha equipe" pelo catálogo, e esse
   caminho passa por um `null` que o `updateTeamRoom` escreve de
   propósito.
3. **O seletor de salas no cabeçalho da sala**, que só existe a partir da
   segunda sala.
4. **As três linhas no card da rail.** Especialmente a regra de omitir o
   nome em mensagens seguidas do mesmo autor, que é o que faz aquilo ler
   como conversa.
5. **O badge com o número**, e o que ele faz com 100+.

**A checagem de 30 segundos, se quiser fazer:** aplique a 051 e a 052,
abra Configurações › Salas, renomeie a sala padrão, mande três mensagens
seguidas na sala e olhe o card na barra lateral. Isso exercita 16 e 17
inteiros e metade do 15.

---

## Adendo — a passagem noturna (18–26)

### Medido

| Portão | Resultado |
| ------ | --------- |
| `npx tsc --noEmit` | limpo |
| `npx eslint src` | **0 erros**, 34 avisos (todos anteriores) |
| `npx vitest run` | **1316 passando**, 110 arquivos |
| `npm run build` | exit 0 |

**Doze testes novos** em `lib/contacts/tax-id.test.ts` — incluindo os
dígitos verificadores de um CNPJ real contra um forjado, e os
`111.111.111-11` que passam na aritmética mod-11 e não são documento
nenhum.

### Medido no navegador

Sem sessão, com a folha de estilo real:

- **375px (celular):** a página não tem overflow horizontal; a faixa de
  métricas cabe em 375; `pb-safe-3` computa `padding-bottom: 12px` num
  aparelho sem inset — o mesmo valor de antes — e cresce nos que
  reportam um.
- **768px (tablet):** sem overflow; a faixa vira 2×2 com células de
  351px; a linha de um passo do assistente cabe em 704px.

### Não visto rodando

**Nenhuma tela desta leva foi vista autenticada** — mesma limitação de
sempre. Em ordem de risco:

1. **O assistente de configuração da IA.** Seis passos, salvamento por
   passo, e um acordeão que decide sozinho onde abrir conforme a conta já
   esteja configurada ou não. É a tela mais nova e a mais complexa da
   passagem.
2. **O painel de sugestão na mensagem.** Ele chama a rota ao abrir, e o
   caminho que mais quero ver é o de um áudio: a sugestão deve sair da
   **transcrição**, o que exige a 049 aplicada e um áudio recebido depois
   disso.
3. **As ferramentas da IA.** `transcribeAudio` e `describeImage` já eram
   código nunca executado contra um provedor; agora o laço de
   tool-calling das duas provedoras também é. O formato foi escrito
   contra a documentação e contra os adaptadores que já existiam, não
   contra uma resposta observada.
4. **Itens de linha num negócio.** O caminho que importa é criar um
   negócio **novo** com linhas: elas são gravadas depois que o insert
   devolve o id, e é o único lugar da passagem onde duas escritas
   precisam acontecer na ordem.
5. **O público "por produto"** num disparo. Uma lista de destinatários
   errada é o pior defeito que este produto pode ter, e por isso o recuo
   pré-054 é lançar erro em vez de cair para "todo mundo".

### O que eu conferiria primeiro, ao acordar

```bash
supabase db push
```

Depois, nesta ordem, porque cada uma destrava a seguinte:

1. **Configurações › Produtos** — cadastre dois produtos com código.
   Tente repetir um código: deve avisar, não gravar.
2. **Um negócio no funil** — adicione duas linhas. O valor acima deve
   ficar somente-leitura e bater com o total.
3. **Configurações › Agente IA** — percorra os seis passos. O passo 4
   (ferramentas) é o que nunca rodou.
4. **Uma conversa** — abra o menu de uma mensagem do cliente e peça
   sugestão. Confira se as fontes aparecem.
5. **Um contato** — digite um CNPJ com dígito errado; depois o de outro
   cadastro.

---

## Adendo — itens 38 a 41

### Medido

| Portão | Resultado |
| ------ | --------- |
| `npx tsc --noEmit` | limpo |
| `npm run lint` | **0 erros**, 42 avisos (todos anteriores a esta passagem) |
| `npx vitest run` | **1443 passando**, 119 arquivos |
| `npm run build` | exit 0, `/admin` fora da lista de rotas |

Testes novos desta leva: 23 em `lib/dashboard/period.test.ts`, 17 em
`components/settings/section-links.test.ts`, 7 em
`lib/supabase/paged.test.ts`, e um em `previous-window.test.ts` que
afirma que a consulta paginada é **ordenada**.

### Medido no navegador, sem sessão

Tudo abaixo com a folha de estilo real e o viewport de verdade
(`resize_window` — a primeira medição foi refeita porque redimensionar
uma `div` não move a media query, só o viewport move).

**A barra de cima do Relatórios**, com o controle de período no slot de
ações:

| viewport | cabeçalho | largura do bloco do título |
| -------- | --------- | -------------------------- |
| 1280px | 88px | 943px |
| 768px | 88px | 431px |
| 390px | 208px → **134px** | 53px → **358px** |
| 360px | 248px → **154px** | 23px → **328px** |

A 390px a descrição virava sete linhas de uma palavra cada, porque o
bloco do título era `min-w-0 flex-1` e as ações `shrink-0` — o título
encolhia até sumir em vez de as ações quebrarem a linha. `max-sm:basis-full`
corrige, e vale para toda página com ações.

**O trilho de Configurações**, depois da fusão das duas áreas:

| | valor |
| - | ----- |
| 18 linhas + 3 cabeçalhos de grupo | **796px** de conteúdo |
| viewport de teste | 800px |
| caixa depois do teto `calc(100vh-4rem)` | 736px |
| rola por dentro | sim |
| última linha alcançável | sim |
| overflow horizontal fantasma | não |

Um `sticky` mais alto que o viewport deixa de ser sticky em silêncio, e
796 num viewport de 800 não cabe depois do respiro de 24px do topo.

**Os tokens das etiquetas**, convertidos para sRGB por canvas — a
tentativa de reproduzir o defeito relatado no light:

| | light | dark |
| - | ----- | ---- |
| `--muted` contra `--card` | 1.14:1 | 1.09:1 |
| `--secondary-foreground` sobre `--muted` | 7.02:1 | 9.26:1 |

Fraco nos dois modos, legível nos dois. Nada que quebre só no light.

### Medido por HTTP

Os redirecionamentos de config, depois de remover a rota `/admin`:

```
/admin                → 307  location: /settings
/admin?tab=whatsapp   → 307  location: /settings?tab=whatsapp
/admin?tab=members    → 307  location: /settings?tab=members
/agents               → 307  location: /settings?tab=ai
```

A query atravessa sozinha porque o destino não tem query própria.

### Não visto rodando

Mesma limitação de sempre: nada autenticado. Em ordem de risco:

1. **O trilho de Configurações com um atendente de verdade.** A filtragem
   por permissão tem dezessete testes, e nenhum deles é um navegador. O
   que quero ver é um atendente logado abrindo `/settings` e encontrando
   sete linhas que funcionam — e o mesmo atendente digitando
   `?tab=whatsapp` na barra e caindo no Overview em vez de numa tela que
   recusa.
2. **O menu de contexto na mensagem.** O primitivo é o mesmo da lista de
   conversas e dos cards do funil, que funcionam — mas o gesto foi
   relatado como quebrado e a correção nunca foi vista funcionando.
   Conferir os dois gestos: botão direito no desktop, pressionar-e-segurar
   no celular.
3. **O período livre.** A aritmética tem 23 testes. O que nenhum deles
   cobre é o `<input type="date">` em pt-BR num navegador real, nem o que
   acontece quando alguém escolhe um ano inteiro numa conta movimentada e
   encontra o teto de 40 páginas.
4. **O score.** A 060 entrou — o `CHECK` aceita `best_score`, conferido
   por escrita e desfeito. O que continua sem ter rodado é o caminho
   inteiro: escolher o modo, chegar uma mensagem, a conversa ir para quem
   tem o melhor score.

### O que eu conferiria primeiro

As treze migrações já estão no banco; não há `db push` pendente.

1. **Configurações** com cada papel. Dono, admin, atendente e leitor:
   contar as linhas do trilho e tentar uma URL de seção fechada.
2. **Uma mensagem** — botão direito. Deve abrir um menu com reações,
   Responder, Copiar e o grupo de IA; não a barra de hover.
3. **Relatórios › Personalizado** — escolher o mês passado inteiro.
   Conferir se o chip passa a mostrar as datas e se o subtítulo do
   Desempenho da equipe diz o mesmo período.
4. **Configurações › Atribuição** — escolher "Melhor desempenho" e gravar,
   e então mandar uma mensagem. A 060 está no banco; o que nunca rodou é
   a conversa chegando em quem tem o melhor score.
