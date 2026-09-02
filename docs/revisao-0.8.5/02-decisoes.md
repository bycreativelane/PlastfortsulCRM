# Decisões

Cinco chamadas desta passagem precisaram de argumento e não de
preferência. Cada uma registra a alternativa rejeitada, porque decisão
sem alternativa é só afirmação.

---

## 1. Um herói, não quatro células iguais

**Escolhido:** um herói a 32px em tinta `--primary`, ao lado de uma faixa
de três leituras a 24px, na proporção 2/5 · 3/5.

> Começou como um bloco **preenchido** em `--primary` e virou tinta sobre
> o mesmo card do strip. Dois quintos da linha mais larga da página na
> cor mais saturada do tema liam como laje — no modo escuro, painel
> aceso. A hierarquia nunca veio do fundo: vem de 32px contra 24, acento
> contra foreground, e dois quintos contra um quinto. Ver
> [01-worklog.md §11](01-worklog.md#11-superfície-neutra-em-todo-lugar).

**Rejeitado:** manter as quatro células iguais, só maiores.

Quatro células **iguais** afirmam que os quatro números importam igual.
Num painel de 1300px isso rende uma faixa larga com quatro figuras
pequenas boiando: o topo da página é a coisa maior da tela e a mais
silenciosa. Todas as cinco referências resolvem isso do mesmo jeito — um
número é o motivo de você ter aberto a página, é desenhado três ou quatro
vezes mais pesado, e o resto recua atrás dele.

O dinheiro é o herói porque é a única leitura ali que sobrevive à
pergunta "por que você abriu Relatórios". Conversas ativas, novos
contatos e mensagens enviadas são contagens da operação rodando; R$ em
aberto é a razão de ela rodar.

**Meio a meio foi rejeitado junto:** daria ao herói o mesmo peso que as
três leituras somadas, que é a hierarquia plana da qual se estava saindo.

**Por que `--primary` e não um neutro invertido.** `bg-foreground
text-background` dá uma laje escura no claro e uma laje branca no escuro
— o acento que a conta escolheu não aparece no elemento mais alto da
página, e a versão escura é um farol. `--primary` / `--primary-foreground`
é par que o `theme-contrast.test` já afirma a 4,5:1, resolve por acento
**e** por modo, e a doutrina tem lugar para ele: primary é ênfase, não
sinal. Âmbar seria sinal, e o bloco não está pedindo nada a ninguém.

`--primary` sobre `--card` é par que o `theme-contrast.test` já afirma a
4,5:1, então a figura pode ser lida no acento cheio sobre a mesma
superfície de todo o resto — o que é a razão de a remoção do fundo não
ter custado nada.

---

## 2. A medida muda, não as marcas

**Escolhido:** o tempo de primeira resposta passa a ser lido em
**múltiplos da meta** — `36× a meta` — como texto, com a barra escalada
pelo dia mais lento.

**Rejeitado:** três formas de continuar plotando minutos.

| Alternativa                | O que ela não resolve                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Meta como linha tracejada  | A 2,5% da altura do plot ela fica um pixel acima do eixo x e **é lida como o eixo**    |
| Meta como faixa preenchida | Legível, e ainda uma lasca no chão sob sete colunas de altura parecida                 |
| Eixo logarítmico           | Separa 72 de 180 honestamente, e não é coisa de entregar a quem toca uma distribuidora |

As colunas pareciam da mesma altura porque **são**, na resolução daquele
gráfico: 72 minutos e 180 minutos são ambos "muito acima da meta", e um
eixo linear gasta a amplitude inteira separando duas respostas que são a
mesma resposta.

Nenhum conjunto novo de marcas conserta isso, porque o problema não está
nas marcas — está na grandeza. Trocar a grandeza é a única jogada
disponível, e ela responde melhor: `36×` é acionável de um jeito que
`178m` não é.

Um dia que **bate** a meta não imprime `0×`. Ganha o tom confirmado e as
palavras, porque é outro **estado**, não um número menor — e o dia em que
isso começa a acontecer é a razão de o painel existir.

---

## 3. Agregar, e dizer que agregou

**Escolhido:** até 14 pontos, uma barra por dia; até 70, por semana;
acima, por mês. O subtítulo do painel nomeia a unidade.

**Rejeitado:** desenhar sempre por dia, e deixar o leitor filtrar.

Trinta dias × duas séries são sessenta marcas num painel de 690px. Todas
corretas, e o painel lê como cerca de estacas que você varre em vez de
gráfico que você lê. As referências desenham cinco grupos de dois — e
isso não é elas terem menos dado, é elas decidirem que um painel mensal
responde uma pergunta sobre semanas.

**O subtítulo dinâmico é a metade que torna isso honesto.** Um gráfico que
troca de dias para semanas em silêncio quando o período cresce é um
gráfico que mudou a pergunta sem avisar, e o leitor estaria comparando
cinco barras contra a lembrança de trinta.

Duas salvaguardas:

- **Os totais da legenda são somados dos pontos crus**, nunca dos baldes.
  Agregação não pode mexer num total.
- **Os baldes são cortados do fim mais recente para trás.** Cortando do
  início, o balde parcial fica na direita — que é a barra que todo mundo
  lê primeiro, e ela ficaria curta por um motivo que não é queda de
  volume.

A invariante está fixada em `bucket-series.test.ts`, e é o único teste
desta passagem que protege contra um erro **invisível**: um fatiamento
errado renderiza um gráfico plausível dos números errados.

---

## 4. O raio de superfície não mora em `--radius`

**Escolhido:** `--radius` fica em `0.5rem`; as superfícies pedem
`rounded-xl` (1,4× a base) uma a uma.

**Rejeitado:** subir `--radius` para `0.75rem`, que foi o que se fez
primeiro.

A escada é um número só: `rounded-lg` é `var(--radius)`, e tanto `Panel`
quanto `Input`, `Select`, `Textarea` e `Button` pedem o mesmo token. Subir
a base entrega os dois efeitos juntos e só um deles era desejado — 12px
num painel de 400px é superfície macia, 12px num campo de 32px é 38% da
altura.

Empilhadas quatro num formulário, cápsulas são a coisa mais pesada da
tela, e faziam a borda 3:1 (que vem de outra passagem, e está correta)
parecer mais pesada ainda: contorno fechado e arredondado lê como
**objeto**, onde retângulo lê como **aresta**.

**Rejeitado também: aliviar a borda em vez do raio.** O calibre está
encostado no limite — `--muted` dá 3,00:1 no claro e 3,01:1 no escuro — e
esses campos são `bg-transparent`, então a borda é o único limite que
existe. Clarear `--input` **naquele momento** quebraria o teste, e por um
motivo real. A alavanca honesta era a que esta passagem tinha
introduzido, e foi a que se puxou.

> A borda foi decidida depois, e não por afrouxamento: o token se
> dividiu em `--input` (campo, leve) e `--control` (checkbox e radio,
> 3:1), e os quatro pares do teste foram re-apontados em vez de
> removidos. Ver
> [01-worklog.md §12](01-worklog.md#12-a-borda-dos-inputs-decidida).

`--radius-xl` é derivado da base, então uma mudança futura em `--radius`
ainda move o painel junto com todo o resto em vez de deixá-lo órfão —
que é o ponto de ser token e não oito valores soltos.

---

## 5. Bucket privado para os anexos da equipe

**Escolhido:** um bucket novo, `team-media`, privado, com leitura só para
membro da conta. O caminho guardado na coluna e a URL assinada na hora.

**Rejeitado:** reusar o `chat-media`, que resolveria sem SQL nenhum.

Ele já aceita imagem, vídeo, áudio e documento, já tem política de escrita
por membro, e o `upload-media.ts` já monta o caminho `account-<uuid>/`
que a RLS dele confere. Zero trabalho.

E ele é **público**. Tem que ser: a Meta busca a URL na hora de enviar, e
um objeto lá é lido por qualquer um com o link.

Isso está certo para anexo que o cliente vai receber de qualquer jeito, e
errado para a sala interna. A migração 046 se recusou a guardar mensagem
interna em `conversations` porque estaria "a um `IF` de distância de ser
entregue a um cliente"; print interno em balde público é a mesma
frouxidão por outro caminho — não precisa do `IF`, basta o link vazar.

**Rejeitado junto: guardar a URL na coluna.** Balde privado significa URL
assinada, e URL assinada expira. Um campo que fica errado sozinho depois
de uma hora é o próximo bug. A coluna guarda o caminho.

O `verify-schema.sql` afirma que o bucket existe **e que `public = false`**
— ali é vazamento, não diferença de estilo, então o CI trava se alguém
inverter.
