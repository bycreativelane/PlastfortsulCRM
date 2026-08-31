# Auditoria geral do front

> O pedido: *"analisa tudo que tem de funcionalidade, e identifica se tem
> coisas no front a modificar para funcionar as atualizações e funções,
> pesquisa sobre ux e front end, padrão logico de identificação e posição
> das ferramentas e etc"*.
>
> Este documento tem três partes: **o que estava construído e não
> funcionava**, **o sistema de identificação e posição** (o que a base já
> decide e onde ela se contradizia), e **o que ficou de fora**.

---

## Parte 1 — O que estava no banco e não chegava na tela

O método foi simples e vale repetir: para cada migração recente, checar
se existe alguém no front lendo aquilo. Quatro buracos apareceram, e o
primeiro é grande.

### 1.1 A transcrição era escrita e quase ninguém lia

A migração 049 abriu o próprio arquivo dizendo qual era o problema:

> *"a mensagem chega, é guardada, e todo o resto do sistema — a prévia da
> conversa, a busca, cada gatilho de automação por palavra, o motor de
> fluxos, a própria porteira da resposta automática — lê `content_text`,
> que num áudio está vazio. **O cliente falou; o CRM registrou
> silêncio.**"*

Ela então guardou a transcrição em `media_transcript` e **parou aí**. A
frase continuava verdadeira, agora com a transcrição a uma coluna de
distância.

O motivo é de ordem, não de esquecimento. A transcrição roda no **fim**
do `processMessage`, de propósito — é a coisa mais lenta do handler.
Tudo que lê o texto da mensagem já rodou minutos antes, contra string
vazia, e concluiu corretamente que não havia nada a que reagir:

| Consumidor | Lia | Resultado num áudio |
| ---------- | --- | ------------------- |
| `keyword_match` | `inboundText` | nunca casava |
| resposta automática da IA | `inboundText.trim()` | **nem era chamada** |
| `buildConversationContext` | `.eq('content_type','text')` | o áudio sumia do histórico |
| `matchesSearch` | `last_message_text` | buscar uma palavra falada não achava nada |
| prévia da conversa | `last_message_text` | vinte linhas dizendo "Áudio" |

Um cliente gravando *"quero cancelar o pedido"* não disparava automação
nenhuma e não recebia resposta.

**O que foi feito.** `dispatchInboundMediaUnderstanding` passou a
**devolver** o texto, e o webhook roda um segundo passe estreito com
exatamente o que foi privado de texto — `keyword_match` e a resposta
automática — e **nada além disso**. `new_message_received` não re-dispara:
ele não lê o texto, já rodou, e disparar de novo executaria a automação
de alguém duas vezes pela mesma mensagem. Essa assimetria é o desenho:
**re-disparar o que passou fome, nunca o que só chegou cedo.**

Junto: `buildConversationContext` passou a ler `media_transcript`
(caption digitada ganha da descrição, e o que continua sem palavra
nenhuma segue de fora), e a transcrição é copiada para
`last_message_text` quando ainda é a mensagem mais nova — o que resolve
prévia e busca com um UPDATE só.

### 1.2 Produtos não existiam fora de /produtos

O catálogo foi construído e ficou trancado na própria rota. As duas
telas onde a pergunta *"quanto custa o 40x60"* é realmente feita não
sabiam dele:

- **Busca global** — só contatos. Agora busca produto também, casando
  `size_label`, porque "40x60" é como o produto é pedido ao telefone. As
  duas consultas saem em paralelo (em série, a lista reflui embaixo do
  cursor e o teclado escolhe a linha errada), pessoas sempre primeiro, e
  o preço vem alinhado à direita — é a resposta que motivou a busca.
- **Painel lateral da conversa** — `product_interest` não aparecia em
  lugar nenhum durante o atendimento. Agora aparece, como link para o
  catálogo filtrado.

Ambos degradam em silêncio num banco pré-054: sem catálogo, sem linhas, e
a busca continua achando gente. *"A tabela de produtos ainda não existe"*
não é coisa que se diga a quem digitou o nome de um cliente.

### 1.3 O resto estava ligado

Auditoria (050), atribuição (051), salas (052), ferramentas do agente
(053), itens de negócio (054): todos com componente montado e lendo. A
054 inclusive já alimentava o público de campanha por produto.

---

## Parte 2 — Identificação e posição

### 2.1 A regra que a base já tinha, escrita no `sidebar.tsx`

> *"é um lugar onde você **trabalha**, ou onde você muda **como o
> trabalho se comporta**?"*

Trabalho vira rota no menu; comportamento vira seção em Configurações.
É o critério que moveu Produtos para `/products` (§26) e o que a 0.8.2
usou para desfazer Templates e Etiquetas aparecendo nas duas superfícies.
**Uma superfície, não duas** — e o teste é bom porque é respondível sem
discussão de gosto.

### 2.2 O ⚡ significava quatro coisas

Aqui estava a contradição real, e na tela mais lida do produto.

| Onde | O que o ⚡ queria dizer |
| ---- | ---------------------- |
| Menu lateral → `/automations` | automação |
| Configurações → Respostas rápidas | frase salva |
| Compositor → "Respostas rápidas" | frase salva |
| **Lista de conversas** | **a IA respondeu aqui** |

E o quarto é o pior, porque o produto **já tinha** um marcador para IA: a
bolha usa ✨, e o `settings-sections.ts` diz por escrito que a estrela é
a marca da casa para "isto foi escrito por uma máquina" e não deve ser
emprestada. A lista de conversas — a superfície que um atendente encara o
dia inteiro — usava a marca de outra coisa.

**O que foi feito:**

| Glifo | Passa a significar, e só |
| ----- | ------------------------ |
| ⚡ `Zap` | automação |
| ✨ `Sparkles` | uma máquina escreveu isto |
| 💬 `MessageSquareText` | resposta rápida (frase salva) |
| 🖱 `MousePointerClick` | resposta rápida interativa (o cliente toca) |
| ✅ `CircleCheck` | deu certo |

O convite de membro também devolveu a ✨ que tinha pegado emprestada para
dizer "pronto" — nada ali foi escrito por máquina.

**Onde eu não mexi, de propósito:** o ⚡ no botão "verificar com a Meta" e
os três selos do changelog. Ali o glifo não compete por identificação —
não é marca de navegação nem de estado, é um botão de "faz agora" e um
selo dentro de um conjunto fechado de três. Trocar adicionaria mexida sem
tirar ambiguidade. Uma auditoria também diz o que escolheu não mudar.

### 2.3 Posição: o polegar

O padrão de navegação no celular era hambúrguer no canto superior
esquerdo — **o pior ponto do aparelho** para uma mão só, e este é um app
que se usa em pé no galpão com uma caixa na outra mão. Cada destino
custava dois toques e um deles exigia regripar o telefone.

Virou **barra inferior** com três destinos e "Mais". Ver §30 do worklog
para o desenho e as medições.

---

## Parte 3 — O que ficou de fora

- **Busca dentro da conversa** (procurar uma palavra no meio de uma
  thread longa). A busca da caixa de entrada filtra a lista carregada no
  cliente; procurar dentro das mensagens é consulta nova e tela nova.
- **Relatório por produto** e **recompra por produto** — o P2 do plano de
  Produtos.
- **Importação CSV de tabela de preços** e `/api/v1/products`.
- **`unit` com vocabulário controlado** — depende da tabela de preços
  real da PlastfortSul.
- **WhatsApp em passos** — mais de mil linhas, e é a tela onde um erro
  não é cosmético.
- **CNPJ na importação em massa** — o cadastro confere; a importação
  ainda não.
