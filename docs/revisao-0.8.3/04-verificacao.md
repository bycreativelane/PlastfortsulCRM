# O que foi verificado, e o que não foi

A terceira lista é a que importa. Índice: [00-README.md](00-README.md).

---

## Automático, a cada mudança

| Passo               | Resultado final    |
| ------------------- | ------------------ |
| `npm run lint`      | 0 erros, 35 avisos |
| `npm run typecheck` | limpo              |
| `npm test`          | 1296 passando      |
| `npm run build`     | compila            |

Os 35 avisos são `react-hooks/exhaustive-deps` e imports não usados
pré-existentes. São **dois a menos** que a 0.8.2, que fechou em 37: os
arquivos tocados aqui tiveram os seus resolvidos.

### Testes novos

| Arquivo | Cobre |
| ------- | ----- |
| `lib/conversations/actions.test.ts` | O relógio do Esperando: carimba na entrada, **não** recarimba quem já espera, limpa na saída, e sobrevive a um banco sem a 045. Mais `assignConversation`, incluindo `null` como valor real. |
| `lib/conversations/last-message.test.ts` | A prévia da linha: mídia junto do texto, `null` explícito numa mensagem de texto, e o recuo para um banco sem a 047. |
| `lib/notifications/destination.test.ts` | Conversa vence contato, contato é o recuo, e `null` quando não há para onde ir. |
| `lib/color-convert.test.ts` | HSV↔RGB nas seis fatias da roda, ida e volta exata em cada preset, e a matiz que se perde num cinza. |
| `components/ui/menu-label-group.test.ts` | Nenhum arquivo renderiza um label de menu sem grupo — o defeito que derrubava todo clique direito. |

### Testes reescritos

- **`lib/whatsapp/phone-format.test.ts`** — afirmava `+59 5991234567` para um
  número paraguaio, com um comentário defendendo o resultado. Era o bug.
  Reescrito, com a inversão registrada dentro do arquivo, mais um caso novo
  cobrindo código de país de um, dois e três dígitos.
- **`lib/api-keys/scopes.test.ts`** — afirmava "existe uma descrição para
  cada escopo". Agora que o mapa guarda **chaves**, isso deixou de ser algo
  que o arquivo consegue ver sozinho, então passou a validar que cada chave
  resolve nos três catálogos.

### Um teste que ganhou o dia

`src/i18n/keys-exist.test.ts` (que já existia) pegou **dois erros meus** no
meio desta passagem: uma chave de catálogo que eu sobrescrevi sem perceber
(`Interactive.preview` era uma palavra e virou um objeto, apagando o rótulo
"Prévia" do construtor) e duas chaves do seletor de cor que eu chamei antes
de escrever. Nos dois casos o `next-intl` renderiza o caminho da chave na
tela em vez de falhar, o que é exatamente o tipo de defeito que chega ao
cliente.

---

## O que NÃO foi visto rodando

A lista honesta, e ela é a versão inteira. **Nada aqui foi visto numa sessão
autenticada** — exige senha, que eu não tenho:

- A barra do topo reorganizada: online à esquerda, semana no meio
- A semana: os pontos por dia, as setas, o painel do dia
- O visual novo dos usuários online, com o ponto de presença em cada foto
- O clique direito, na conversa e no card do Kanban — **inclusive a
  correção do crash**
- O submenu "Atribuir a…"
- O seletor de cor: o quadrado, o trilho e a prévia
- A sala da equipe no celular, e o ponto apagando ao ler
- A miniatura de mídia numa resposta de fluxo ou automação
- A ficha do cliente com a máscara de telefone
- O painel do cliente recolhendo com a animação nova
- O selo de ocorrência redondo, ao lado do nome

O que **foi** visto: a tela de login renderizando em pt-BR sem erro de
console, e todas as rotas do painel compilando e respondendo 307 (redirect de
autenticação) no servidor de desenvolvimento.

E uma medição que não precisou de sessão: a fila de chips foi renderizada
**isolada**, com o CSS de produção do próprio build, a 4×. Foi assim que se
mediu que o selo quadrado tinha 16px contra os 18 dos vizinhos, em vez de
discutir a captura de tela. A regra gerada foi conferida no CSS compilado:

    .size-4\.5{width:calc(var(--spacing) * 4.5);height:calc(var(--spacing) * 4.5)}

A versão final — redonda, ao lado do nome — **não** foi vista renderizada; o
painel de preview não estava aberto na hora.

---

## O que o banco realmente tem

Medido, não afirmado. Uma sonda pelo `service_role` contra o projeto do
`.env.local`, perguntando a cada migração pela coisa que ela cria:

| Migração | Marcador | Estado |
| -------- | -------- | ------ |
| 040 | `contacts.opted_out` | aplicada |
| 041 | `playbook_steps`, `deal_playbook_progress` | **aplicada** |
| 042 | `contact_occurrences`, `contacts.occurrence_count` | **aplicada** |
| 043 | `deals.lost_reason` | aplicada |
| 044 | `quick_replies.shortcut` | aplicada |
| 045 | `contacts.name_source`, `conversations.hidden_at`, `accounts.auto_assign_mode` | aplicada |
| 046 | `team_messages` | aplicada |
| 047 | `conversations.last_message_kind` | **não aplicada** |
| 048 | políticas do `team_messages` | não aplicada (segue a 047) |

Duas consequências, e as duas mudam o que se lê em outros lugares:

- **A 042 está aplicada**, então o selo de ocorrência da seção 16 do worklog
  lê o contador de verdade, e não o recuo pela etiqueta. O comentário do
  `lib/occurrences/kinds.ts` ainda dizia "escrita e não aplicada"; foi
  corrigido, mas a guarda continua lá — aplicada _aqui_ não diz nada sobre a
  próxima conta que rodar este build.
- **A 041 está aplicada aqui**, e o release a lista como "deliberadamente não
  aplicada". Ver a fila em [03-pendencias.md](03-pendencias.md).

A 048 não tem superfície no PostgREST — política de RLS não se consulta por
API. O CI cobre as duas: `verify-schema.sql` falha a build se qualquer uma
não tiver rodado.

---

## Os dados de teste estão no banco

`seed-inbox.mjs` rodou nesta passagem contra o banco de teste: **9 contatos,
8 conversas, 96 mensagens**, cada persona cobrindo um estado. A janela de 24h
está aberta na do Marcos, fechando na do Rodrigo (âmbar) e expirada na da
Simone; a Juliana tem 60 mensagens para o scroller; a **Fernanda tem
ocorrência**, que é a linha onde o selo novo aparece.

O script não está no repositório — ver a fila em
[03-pendencias.md](03-pendencias.md).

---

## O roteiro mínimo

Curto, e cobre o que esta versão mais arrisca:

1. **Clique com o botão direito numa conversa.** Se a tela não quebrar, o
   defeito principal está fechado. Repita num card do Kanban.
2. **Escolha um responsável pelo submenu.** A linha deve mostrar o novo dono
   sem recarregar.
3. **Edite o nome de um cliente pela ficha** e mande uma mensagem daquele
   número. O nome tem que ficar.
4. **Abra o seletor de cor** de uma etiqueta e arraste no quadrado. A prévia
   acompanha; o hex acompanha.
5. **Olhe a semana no topo** num dia que tenha algo marcado.
6. **Recolha o painel do cliente** numa conversa, pela alça na emenda (só
   acima de 1280px). Ele tem que **deslizar para fora**, não sumir — e a
   conversa cresce no espaço enquanto ele sai.
7. **Ache a linha da Fernanda** na lista. O selo vermelho fica ao lado do
   nome, redondo, e não mais lá embaixo entre os chips.

Se o passo 1 falhar, pare e me mande o texto do erro — é a fronteira de erro
da rota, e ela imprime a mensagem no console do navegador.
