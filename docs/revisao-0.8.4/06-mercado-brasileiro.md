# O que falta, para o mercado brasileiro

> Pedido: *"depois quero que tu analise se dentro do escopo do produto
> falta algo que seja crucial no mercado brasileiro"*.
>
> Isto é análise. **Nada aqui foi implementado** — o que foi feito nesta
> passagem está no [worklog](01-worklog.md).

---

## Começo pelo que a sua pesquisa acertou

A sua ressalva metodológica é a parte mais importante do que você
levantou, e vale repeti-la antes de qualquer conclusão: **HubSpot,
Ploomes, Clint e Smark vendem exatamente a solução que as estatísticas
deles justificam.** "79% dos dados nunca chegam ao CRM" é uma pesquisa
própria, não auditada, publicada por quem lucra com o número ser alto.

A evidência primária limpa são as reclamações. E nelas o padrão dominante
**não é WhatsApp desconectado** — é:

1. fragmentação de dados entre módulos da mesma empresa;
2. duplicidade sem trava;
3. integração que quebra ou pune o usuário;
4. pós-venda ausente;
5. contrato punitivo.

Três desses cinco não são problema de produto. São problema de
**operação e contrato**. Isso importa para a análise: se você construir
só produto, ganha em 1, 2 e 3 e continua exposto em 4 e 5 — que são
metade das reclamações.

E a sua tese central está certa, e é a única que vale construir em cima:

> **A dor estrutural é o CRM não conseguir se manter verdadeiro sem
> trabalho humano.**

---

## Onde este produto está, contra essa tese

Honestamente, contra os três muros que você nomeou:

### Muro 1 — técnico da Meta: **passado**

WABA de verdade, webhook com assinatura verificada, template com
aprovação, opt-out inbound que respeita `SAIR` e o botão da Meta. Não há
atalho aqui que pudesse gerar o ban do caso Kommo.

**Mas falta a Coexistence** — ver o item 3 da lista abaixo. Hoje conectar
o número ao CRM ainda significa o vendedor perder o WhatsApp do celular,
que é o motivo #1 de um time sabotar a adoção.

### Muro 2 — captura ≠ estruturação: **meio passado, e hoje andou**

Antes desta passagem o produto arquivava a conversa, como Kommo e Clint.
Nesta passagem ele passou a **transcrever áudio e ler imagem
automaticamente** (049).

Isso é maior do que parece, e é exatamente o degrau que você descreveu:
num CRM de WhatsApp brasileiro, uma parte enorme do que o cliente diz é
falada, não digitada. Antes da 049 aquele conteúdo entrava como
`[audio]` — invisível para a busca, para o gatilho de palavra-chave, para
o fluxo e para a própria porteira da resposta automática. Depois dela, a
conversa vira **texto pesquisável sem o vendedor digitar nada**.

**O que ainda não existe é o segundo passo: extrair ESTADO da conversa.**
Ter o texto de "vou querer 200 caixas até sexta, mas o preço da última
vez tava melhor" não é o mesmo que ter `etapa = negociação`, `valor =
X`, `objeção = preço`, `próximo passo = sexta`. Isso ainda é digitação
manual — aqui e em praticamente todos.

Ver o item 1 da lista. É o que eu construiria primeiro, e o produto está
a uma peça de distância.

### Muro 3 — incentivo: **não é resolvível por produto, e dá para atenuar**

Comissão paga negócio fechado, não campo preenchido. Nenhum treinamento
vence isso e nenhuma tela também. O que dá para fazer é **reduzir o custo
do preenchimento a quase zero** — que é o item 1 de novo — e parar de
pedir o que já dá para deduzir.

Um exemplo do que foi feito nesta passagem nessa direção, pequeno mas
literal: **`deals.value` deixou de ser um número que alguém digita.** Com
itens de linha (054) o valor é aritmética, e o relatório para de ser tão
verdadeiro quanto a memória do último vendedor.

---

## O que falta, em ordem de importância

### 1. Extrair estado da conversa — **o item que define o produto**

Uma ação na conversa: *"preencher o negócio a partir desta conversa"*.
A IA lê a thread — que agora inclui o que foi **falado**, graças à 049 —
e propõe: etapa, valor com itens do catálogo, objeção, próximo passo e
data. **O vendedor confirma ou corrige.** Nunca grava sozinho.

Por que agora e não antes: as quatro peças que faltavam existem desde
hoje de manhã.

| Peça | Onde |
| ---- | ---- |
| A conversa como texto, incluindo áudio | migração 049 |
| Um LLM com a chave da conta | 029, aprofundado na 053 |
| Ferramentas de leitura no CRM | `lib/ai/tools.ts` (053) |
| Um catálogo com preço para o valor casar | migração 054 |
| Itens de linha para escrever o valor | migração 054 |

Custo: **médio.** Uma rota que monta o prompt, um schema de saída, e um
diálogo de confirmação. Não precisa de migração nova.

Risco a nomear: uma IA que preenche o CRM sozinha e erra é pior que um
CRM vazio, porque o gestor confia no relatório. Por isso: **proposta com
confirmação, sempre**, e o registro de que foi a IA que propôs.

### 2. LGPD — consentimento, acesso e apagamento

O produto tem opt-out de marketing (que é ótimo e é a metade que a Meta
exige). **Não tem** o que a LGPD pede de um controlador:

- registro de **quando e como** o titular consentiu;
- exportar tudo que existe sobre um titular, a pedido;
- apagar, a pedido, sem quebrar o histórico da conta.

Para vender para qualquer empresa de porte médio no Brasil isso deixa de
ser diferencial e vira **pré-requisito de contrato**. É a pergunta que o
jurídico do cliente faz antes da assinatura.

Custo: **médio.** Uma tabela de eventos de consentimento, uma rota de
exportação por contato, e uma decisão difícil sobre o que "apagar"
significa quando a mensagem também é registro fiscal.

### 3. Coexistence — o vendedor mantém o WhatsApp no celular

Você mesmo nomeou: *"antes da Coexistence, conectar o número ao CRM
significava que as mensagens paravam de chegar ao celular"*.

Esse é o motivo mais comum de um time boicotar a migração, e não é
técnico — é que você está tirando o telefone da mão do vendedor. A Meta
abriu o caminho; o produto ainda não o usa.

Custo: **médio-alto**, e é integração com a Meta, não interface.

### 4. Pix na conversa

Distribuidora brasileira fecha no WhatsApp e cobra no Pix. Gerar a
cobrança dentro da thread, e **marcar o negócio como pago quando cai**,
fecha o ciclo que hoje sai do sistema — e é o momento em que o CRM para
de ser um lugar onde se anota e passa a ser onde se resolve.

Custo: **médio**, mais uma decisão de parceiro (PSP) que é comercial e
não técnica.

### 5. Histórico de etapa — e o relatório que a gestão pede

Já está registrado nas pendências desta série: `deals` guarda a etapa
**atual** e nada mais. Sem transições não existe funil por período, não
existe tempo em etapa, e a própria tela de Relatórios lista quatro
relatórios que ela não consegue construir e diz isso na cara do usuário.

Isso é o que fecha o loop que você descreveu — *dado incompleto →
relatório mentiroso → gestor cobra preenchimento → vendedor odeia mais a
ferramenta*. Com os itens 1 e 5, o relatório fica verdadeiro **sem
cobrança**.

Custo: **baixo.** Uma tabela `deal_stage_events` e um gatilho. É o melhor
retorno por linha de código desta lista inteira.

### 6. Nota fiscal — o número, não a emissão

Não emitir NF-e. Isso é um produto inteiro e há empresas que só fazem
isso. Mas **amarrar o número da nota ao negócio** transforma "vendemos"
em "faturamos", e é o campo que o dono da distribuidora procura primeiro
quando abre um negócio ganho.

Custo: **baixo** como campo. **Alto** se virar integração.

### 7. Duplicidade por CNPJ — *parcialmente feito hoje*

Era o item 2 da sua lista de reclamações. Nesta passagem entrou
validação de CNPJ/CPF por dígito verificador e **aviso de duplicata** no
cadastro — ver §22 do worklog.

**O que ainda falta:** a mesma checagem na **importação em massa**, que é
exatamente onde a reclamação original acontece ("a plataforma permite
duplicar registros sem restrições na importação"). O `parse-contact-csv`
existe e não conhece CNPJ.

Custo: **baixo.**

### 8. Cadência de follow-up que cobra o VENDEDOR

O produto automatiza mensagem para o cliente. Não automatiza o
lembrete para o vendedor — "esse orçamento está há 9 dias parado na
mesma etapa". As colunas de recompra existem desde a 040 e a consulta
nunca foi escrita (está nas pendências desde então).

Custo: **baixo-médio.** E é o que segura o item 3 dos muros: o vendedor
volta ao CRM porque ele lembra de algo, não porque o gestor cobrou.

---

## Os dois que não são produto

Metade das reclamações que você levantou não se resolve com código, e
vale escrever isso porque é onde um concorrente ganha sem escrever nada:

- **Pós-venda (item 5 da sua lista).** "Vídeos tutoriais genéricos, sem
  canal direto, projeto parado e boleto vencendo." A resposta é um
  processo de onboarding com nome e responsável, não uma tela.
- **Contrato (item 6).** Multa de 30% sobre o restante, em modelo
  pré-pago. Não cobrar isso é um diferencial de venda que custa zero em
  engenharia — e é o tipo de coisa que aparece no Reclame Aqui do
  concorrente e nunca no seu.

---

## Se fosse escolher três

1. **Extrair estado da conversa** (item 1) — é a tese inteira, e as peças
   já estão no lugar.
2. **Histórico de etapa** (item 5) — o melhor retorno por linha de código
   da lista, e o que faz o relatório parar de mentir.
3. **LGPD** (item 2) — porque sem ele existe um teto de tamanho de
   cliente, e o teto aparece na mesa de negociação, não no roadmap.

O item 3 (Coexistence) é o que eu colocaria em quarto e o que eu mais
tenho medo de deixar para depois, porque ele não é sobre o CRM ser bom —
é sobre o time deixar de usá-lo na primeira semana.
