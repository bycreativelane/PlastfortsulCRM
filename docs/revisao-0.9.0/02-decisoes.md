# Decisões

As oito da Parte 0 do [spec](../spec-automacoes-fluxo.md) foram tomadas
com o padrão recomendado, porque o pedido foi "só faz algo que funcione
tudo solicitado sem prejudicar funcionalidades" — e a segunda metade da
frase é uma decisão em si. Estão aqui as que precisaram de argumento
durante a implementação, com a alternativa rejeitada.

---

## 1. O evento de etapa nasce no banco, não numa rota

**Escolhido:** gatilho Postgres em `deals` gravando `deal_stage_events`;
o cron drena (outbox).

**Rejeitado:** uma rota `POST /api/deals/[id]/stage` que grava e dispara.

Há quatro escritas client-side de `stage_id` e haverá uma quinta. Uma
rota exige que cada uma delas seja lembrada; uma linha que o próprio
banco escreve não pode ser esquecida por ninguém — nem pela API pública,
nem pelo passo `move_deal_stage` do motor. O preço é um tique de cron de
latência, e o menor prazo do fluxo é 24 horas. A rota síncrona fica
possível como otimização por cima, sem mudar o desenho.

## 2. Cancelar por regra da automação, não por passo

**Escolhido:** `cancel_on_reply` e `cancel_when_stage_in[]` na automação,
aplicados pelo webhook e pelo drenador.

**Rejeitado:** um passo "cancelar se o cliente respondeu" no começo de
cada automação, ou um passo de cancelamento nas outras.

A regra do §7 aparece sete vezes no fluxo. Um passo teria de ser lembrado
sete vezes e só funcionaria quando a automação acordasse; a regra vale no
instante em que a mensagem chega, antes de qualquer gatilho, e para a
espera que ainda está dormindo. O passo explícito `cancel_automations`
existe para o que a regra não cobre — a nova compra cancelando a recompra
da anterior.

## 3. Esperar em vez de varrer

**Escolhido:** "D+N depois de entrar na etapa" é gatilho de etapa + `wait`;
Compra Futura é `wait` até a data do campo; só o aniversário varre.

**Rejeitado:** um gatilho "tempo na etapa" avaliado por varredura.

A fila de esperas já existia, o cron já a drenava, a agenda já a
mostrava. Uma varredura teria de inventar a idempotência que a fila já
tem por construção, e "D20 depois de Atendido" numa fila é uma linha que
qualquer pessoa vê na agenda com data e hora. Sobrou uma varredura, a do
aniversário, que se repete e não tem entrada em etapa — e ela é
idempotente por `trigger_key`, para dois tiques serem uma mensagem.

## 4. A oportunidade só entra quando a automação a declara

**Escolhido:** o motor resolve a oportunidade **só** para automações com
gatilho de etapa ou com `pipeline_id`; as outras nem tocam em `deals`.

**Rejeitado:** resolver a oportunidade para toda execução.

Resolver sempre faria a regra dura do §23 ("nunca duas ao mesmo tempo
para a mesma oportunidade") alcançar a "Mensagem de boas-vindas" de uma
conta que tenha uma oportunidade aberta — uma segunda mensagem do cliente
dentro da espera passaria a ser recusada. É melhor comportamento, e é uma
mudança de comportamento; "sem prejudicar funcionalidades" decidiu. Um
passo de oportunidade numa automação sem funil ainda resolve, tarde e com
mensagem clara quando não há o que resolver.

## 5. Ganho sem valor move e não fecha

**Escolhido:** ao mover para uma etapa ganha uma oportunidade com valor
zero, o motor move, deixa `status = open` e escreve no log.

**Rejeitado:** falhar o passo, ou marcar `won` com zero.

O gate da tela pergunta o valor e espera; o motor não tem a quem
perguntar. Falhar o passo pararia o `/andamento` inteiro — a etiqueta
Cliente não entraria — por um número que o vendedor preenche dez segundos
depois. Marcar `won` com zero é a venda que nenhum relatório consegue
contar, o motivo de o gate existir. Mover e dizer é o meio honesto.

## 6. Uma espera dentro de um ramo continua não parando o resto

**Escolhido:** `executeStepsFrom` propaga `ended` (o passo Encerrar) e
**não** propaga `waiting`.

**Rejeitado:** fazer uma espera num ramo parar também os passos depois da
condição.

Sempre foi assim, e há automações montadas nessa forma. Mudar corrigiria
um comportamento estranho ao custo de mudar automações que rodam. O fluxo
oficial mantém as esperas na raiz, onde uma espera para a execução como
se espera; o que precisava de verdade era Encerrar dentro de um ramo
parar tudo — e isso foi feito.

## 7. "cliente" quando não há nome

**Escolhido:** `{{contact.first_name}}` vazio vira "cliente".

**Rejeitado:** deixar vazio.

Um template com parâmetro vazio é recusado pela Meta, e um follow-up que
não sai é pior que um que diz "Olá, cliente". Vale só para `first_name`;
os outros campos ficam vazios, porque "sua empresa cliente" não é
melhor que nada.

## 8. O aviso das 24 horas avisa, não recusa

**Escolhido:** `collectActivationWarnings`, devolvido como `warnings` e
mostrado como toast.

**Rejeitado:** bloquear a ativação.

O modelo "Lembrete de retorno", que já existia, é exatamente uma mensagem
de texto um dia depois de uma espera. Bloquear seria impedir a ativação
de um modelo da própria casa — e uma automação pode legitimamente contar
com o cliente ter escrito no meio.

## 9. Recuar sem a 065 em vez de exigir

**Escolhido:** inserts que esbarram numa coluna ausente são refeitos sem
ela; o cron reporta zero.

**Rejeitado:** assumir a migração aplicada, como a 059 assumiu.

A 059 podia assumir porque quem aplicava a migração era quem fazia o
deploy, no mesmo minuto. Aqui a migração está escrita e não aplicada, e
entre o deploy e a aplicação toda automação da conta escreveria num log
com uma coluna que não existe. O recuo custa um `if` por escrita e
compra o dia inteiro.

## 10. Os gatilhos mortos saem do menu, não do tipo

**Escolhido:** `time_based` e `conversation_assigned` fora de
`TRIGGER_OPTIONS`; o `TriggerCard` acrescenta o tipo atual à lista quando
não está nela.

**Rejeitado:** apagá-los do tipo, ou deixá-los no menu.

Nada os dispara — ofertar um gatilho que nunca dispara é pior que não
ofertar. Mas uma automação salva com um deles tem de abrir no gatilho que
tem, não no primeiro da lista, ou a edição reescreveria o gatilho em
silêncio.
