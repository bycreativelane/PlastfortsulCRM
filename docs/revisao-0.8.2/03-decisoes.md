# As decisões que precisaram de argumento

Sete. Cada uma tinha uma resposta óbvia que foi recusada, e é a recusa que vale
registrar. Índice: [00-README.md](00-README.md).

---

## 1. Esperando é um estado automático, não uma marcação

**A alternativa óbvia:** deixar "Esperando" ser o que o menu marca, e pronto.

Foi o que implementei primeiro, e está errado por uma razão que só aparece na
operação: uma fila que depende de alguém lembrar de marcar é uma fila que
esvazia sozinha. Numa mesa com dez conversas por hora, o atendente que teria
marcado é exatamente o que não teve tempo.

O estado se move sozinho — cliente escreve, entra; atendente responde, sai — e
o menu virou o **override** por cima disso: devolver para a fila sem responder,
tirar da fila porque a resposta saiu por telefone, finalizar. O controle manual
continua existindo; ele deixou de ser o único caminho.

**O corolário incômodo:** resposta de automação e de fluxo **não** tiram da
fila. Um "recebemos sua mensagem" não respondeu ninguém, e uma conversa que sai
da fila porque um robô falou é precisamente a falha que a fila existe para
impedir. Isso significa que uma conta com auto-resposta ligada vai ver conversas
paradas em Esperando que "já foram respondidas" — e essa é a leitura certa.

---

## 2. A sala da equipe não é uma linha em `conversations`

**A alternativa óbvia:** reusar a tabela. Uma conversa é uma conversa.

Toda coluna daquela tabela é sobre um cliente: `contact_id NOT NULL`,
`unread_count` alimentado pelo webhook, a janela de 24h, `assigned_agent_id`. E
todo caminho de código que a lê assume que há um telefone do outro lado.

Uma nota interna ali dentro estaria a **um `if` de distância** de ser entregue
a um cliente. Para sempre. Não é um risco calculado, é um risco que não precisa
existir: uma tabela separada custa 40 linhas de SQL e torna o acidente
impossível em vez de improvável.

Pelo mesmo motivo a tela é um componente próprio e não o `MessageThread`. São
1500 linhas de WhatsApp — janela de sessão, templates, mídia, ticks,
assinatura, atribuição — e um botão "enviar template" numa sala sem telefone do
outro lado é uma promessa que a tela não pode cumprir.

---

## 3. A notificação é escrita pela aplicação, não por um gatilho

**A alternativa óbvia:** um gatilho. É onde a notificação de atribuição mora
desde a 027, e a simetria é tentadora.

Um `AFTER INSERT ON messages` dispara para toda linha que a tabela recebe —
inclusive as três mil de uma campanha, onde a única coisa que ele pode fazer é
ler `sender_type` e voltar. E no caminho onde tem trabalho, faz esse trabalho
**dentro da transação do insert**, segurando lock enquanto a instrução que
precisa dar certo espera.

A assimetria com a 027 é justificada: aquele gatilho dispara em `UPDATE OF
assigned_agent_id`, um evento raro e barato. Este dispararia na tabela mais
escrita do produto.

---

## 4. `viewer` fica fora do fan-out da notificação

**A alternativa óbvia:** avisar todo mundo da conta.

Quem é só-leitura não pode responder, então a notificação é uma tarefa que a
pessoa não consegue executar — e viewers costumam ser o maior grupo de uma
conta. Incluí-los deixa o fan-out maior e menos útil ao mesmo tempo.

Registrado aqui e não só no código porque é reversível numa linha e alguém vai
querer discutir.

---

## 5. Duas abas, não três

**Reportado como:** _"remove o finalizados dali, não foi solicitado"_ — e ele
está certo, a terceira aba foi invenção minha.

O argumento contra ela, encontrado depois de removê-la: a barra responde "o que
precisa de mim agora". Uma conversa finalizada é, por definição, o que **não**
precisa — então era um terço permanente da largura gasto no único estado que
nunca precisa ser olhado.

Encerradas voltou a ser filtro, mas um filtro especial: ele **substitui** o
escopo em vez de estreitá-lo, junto com Ocultas. Pedir conversas finalizadas
dentro de uma aba que as exclui por definição responderia zero para sempre.

---

## 6. O telefone é mascarado na tela e canônico no banco

**A alternativa óbvia:** guardar formatado. É o que se vê, afinal.

Antes de mascarar qualquer coisa eu verifiquei o que quebraria: a Meta recebe
`sanitizePhoneForMeta` (só dígitos), o matching passa por `normalizePhone` (só
dígitos), e `contacts.phone_normalized` é coluna gerada por
`regexp_replace(phone, '\D', '', 'g')`. **Nada a jusante lê a formatação** — o
índice único que impede contato duplicado é calculado de dígitos qualquer que
seja o conteúdo da coluna.

Ou seja: guardar formatado seria seguro. E mesmo assim guarda E.164, porque a
API pública v1 entrega `phone` para integradores, e entregar uma string com
parênteses faria cada um deles escrever um parser.

**O que a máscara não faz:** impor formato brasileiro a número estrangeiro. Não
existe agrupamento universal correto, e aplicar `(XX) XXXXX-XXXX` a um número
paraguaio produz algo que parece autoritativo e está errado. Melhor um
`+595 991234567` sem estilo que um confiantemente mal agrupado.

---

## 7. A foto do cliente vai no balde `chat-media`, não em `avatars`

**A alternativa óbvia:** o balde chamado `avatars`, que já existe e já guarda
fotos de perfil.

A política dele (008) usa `auth.uid()` como primeira pasta: quem sobe é o único
que pode trocar depois. Foto de cliente é da equipe, não de quem subiu — o
agente B não conseguiria corrigir a foto que o agente A errou.

`chat-media` (023) é escopado por `account-<id>` via `is_account_member`, que é
o mesmo formato do fato. A galeria de mídia da conversa é montada a partir de
`messages`, não de listagem do balde, então a foto do contato não vaza para o
visualizador da conversa.

**E "manual por enquanto" é manual e ponto.** A Cloud API do WhatsApp não
entrega a foto de perfil do cliente — o webhook recebe `contacts[].profile.name`
e nada mais. Não existe versão automática esperando para ser ligada depois, o
que muda quanto vale investir na tela manual: ela é a definitiva.
