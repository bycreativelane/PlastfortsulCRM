# Personalização por perfil — o estudo

> Pedido: **"Estudar melhorias para ter mais personalização por perfil."**
> Isto é o estudo. **Nada aqui foi implementado** — a lista no fim diz o
> que custa cada coisa, para a decisão ser sua e não minha.

---

## O achado, numa frase

**Todas as preferências pessoais deste produto moram no navegador, não na
pessoa.**

Levantamento completo de onde cada escolha é guardada hoje:

| O que a pessoa escolheu | Onde fica | Sobrevive a trocar de máquina? |
| ----------------------- | --------- | ------------------------------ |
| Tema (accent) | `localStorage` — `use-theme.tsx:89` | não |
| Claro / escuro | `localStorage` — `use-theme.tsx:102` | não |
| Barra lateral recolhida | `localStorage` — `use-nav-collapsed.ts:61` | não |
| Assinatura nas mensagens | `localStorage` — `use-signature.ts:51` | não |
| Painel do cliente aberto | `localStorage` — `inbox/page.tsx:317` | não |
| Aviso de janela fechada | `localStorage` — `use-window-notice.ts:46` | não |
| Última release lida | `localStorage` — `releases.ts:176` | não |
| Sala da equipe lida até | `localStorage` — `team/messages.ts:216` | não |
| Último e-mail no login | `localStorage` — `login/page.tsx:195` | não |

Nove escolhas, zero no banco. A tabela `profiles` guarda nome, foto,
e-mail, `beta_features`, `account_id`, `account_role` — e desde a 050,
`last_sign_in_at` e `permission_overrides`. Nenhuma delas é uma
preferência.

O que isso significa na prática, e é mais concreto do que soa: **o Vitor
configura o CRM do jeito dele no computador da fábrica e, quando abre no
notebook de casa, é um usuário novo.** Tema padrão, barra expandida,
assinatura desligada, e a sala da equipe com o ponto aceso em mensagens
que ele já leu. Ninguém reporta isso como bug — reporta como "o sistema
esqueceu", uma vez, e depois para de personalizar.

### Por que está assim, e por que estava certo

Não foi descuido. `localStorage` é a escolha certa para três dos nove:

- **Painel do cliente aberto** é geometria de tela. Um monitor de 27" e
  um notebook de 13" querem respostas diferentes, e sincronizar isso
  entre os dois piora os dois.
- **Último e-mail no login** é pré-sessão. Não existe perfil ainda.
- **Aviso de janela fechada** é um "não me mostre isso de novo" que só
  faz sentido na tela onde foi dispensado.

Os outros seis são propriedades da PESSOA, guardadas na MÁQUINA. É aí que
está o ganho.

---

## O que dá para fazer

### 1. `profiles.preferences JSONB` — a base de tudo

Uma coluna, um `{}` de padrão, o mesmo formato que a 050 já usa para
`permission_overrides`. Nada quebra: cada hook continua lendo o
`localStorage` primeiro (que é síncrono e pinta antes do primeiro frame,
que é o motivo de o script de boot no `layout.tsx` existir) e passa a
gravar nos dois. Na primeira carga em uma máquina nova, o valor do perfil
preenche o `localStorage` e a experiência segue idêntica dali em diante.

Ordem de leitura, e ela importa: **`localStorage` ganha do perfil no boot,
o perfil ganha do vazio.** Inverter isso significa um flash de tema errado
em toda carga, porque o perfil chega pela rede e o `localStorage` não.

Custo: uma migração de uma coluna, um hook `usePreference(key, default)`,
e a conversão de seis chamadas. É o item que destrava todos os outros.

### 2. Assinatura por pessoa, no perfil e não no navegador

`use-signature.ts` guarda se as mensagens saem assinadas. Isso é
identidade profissional — o cliente vê "*Gabriel*" antes do texto — e
está numa chave de navegador. Uma pessoa que atende do celular e do
desktop assina em um e não no outro, com o mesmo cliente, na mesma
conversa.

Além de mover para o perfil, vale um campo de **texto** da assinatura:
hoje é sempre o `full_name` em negrito. "Gabriel — Comercial" e "Gabriel
| PlastfortSul" são coisas que as pessoas querem escrever e não podem.

### 3. Notificações por pessoa

Hoje não existe nenhuma preferência de notificação. O `notifications`
(027) e o `new-message` (046) decidem quem recebe por regra fixa: o dono
da conversa, ou o rodízio. Não há como alguém dizer:

- "me avise de mensagem nova só das conversas que são minhas"
- "não me avise nada fora do horário comercial"
- "quero e-mail além do sininho"

O primeiro é o mais pedido em CRM compartilhado e o mais barato: uma
chave no `preferences` e um `IF` em `lib/notifications/new-message.ts`.
O terceiro é um projeto (precisa de um serviço de e-mail), não um ajuste.

### 4. Página inicial por pessoa

O app sempre abre em `/dashboard`. Para quem atende o dia inteiro, o
`/dashboard` é uma parada obrigatória no caminho do `/inbox` — cinco
segundos por login, todo dia, para ver números que não são o trabalho
dessa pessoa. Uma preferência "abrir em" com as rotas que a pessoa pode
ver resolve, e conversa direto com as capacidades da 050: a lista de
opções É a lista de capacidades que ela tem.

### 5. Densidade da lista

O produto tem um tamanho de linha só. Uma pessoa que trabalha em um
monitor grande cabe 40% mais conversas na tela com uma variante compacta;
uma que trabalha em um notebook em pé numa fábrica quer o contrário. É
uma classe no `<html>`, do mesmo jeito que o tema já é — e o
`type-scale.test.ts` já garante que a escala tipográfica não se desmancha.

Isto responde de lado o pedido antigo de "aumentar a fonte", que foi
respondido com não em 23/08: o problema ali não era a fonte base, era a
densidade — e densidade é preferência, enquanto a escala tipográfica é
sistema.

### 6. Idioma por pessoa

`APP_LOCALE` é uma variável de build (`lib/i18n/locale.ts`), igual para a
instalação inteira. Existem três catálogos completos e mantidos em
paridade por teste — `pt-BR`, `en`, `ko` — e nenhuma forma de uma pessoa
escolher entre eles. Numa conta com alguém que não fala português isso é
a diferença entre usar e não usar o sistema.

Custo real: `next-intl` já está montado por request; o que muda é de onde
o locale vem. É o item mais caro da lista e o de maior alcance.

---

## A ordem que eu proporia

| # | Item | Custo | Por quê nessa posição |
| - | ---- | ----- | --------------------- |
| 1 | `profiles.preferences` + `usePreference` | baixo | Nada mais na lista funciona sem isto |
| 2 | Tema, modo, barra, sala-lida no perfil | baixo | Cai de graça depois do 1; é o "o sistema esqueceu" |
| 3 | Assinatura no perfil + texto próprio | baixo | O cliente VÊ a diferença |
| 4 | Página inicial por pessoa | baixo | Cinco segundos por login por pessoa por dia |
| 5 | Notificação só das minhas conversas | médio | Mexe no fan-out; precisa de teste |
| 6 | Densidade | médio | Precisa de uma passada de QA em todas as telas |
| 7 | Idioma por pessoa | alto | Vale, mas é uma passagem inteira |

Nada disso foi feito. O 1 e o 2 juntos são uma sessão curta e resolvem a
reclamação que a pessoa realmente tem.
