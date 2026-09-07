# Decisões

As chamadas que precisaram de argumento, com a alternativa rejeitada. Uma
decisão sem a alternativa registrada é uma decisão que a próxima pessoa
desfaz achando que ninguém pensou nela.

---

## 1. Dia e hora são colunas separadas, não um `TIMESTAMPTZ`

**A alternativa:** `due_at TIMESTAMPTZ`, como quase todo sistema faz.

**Por que não.** A ausência de hora **é** informação. "Ligar hoje" não é
"ligar às 00:00", e um timestamp não sabe dizer a diferença sem uma segunda
coluna booleana — que é a mesma coluna, com um nome pior.

Some-se que é o modelo da própria Google Agenda (`start.date` para o dia
inteiro, `start.dateTime` para o marcado), e que a fase 5 publica tarefas
lá: guardar como timestamp obrigaria a adivinhar, na exportação, se aquilo
era um dia ou um instante.

Isso atravessa a release inteira — chega até a API pública, onde `due_on` e
`due_time` saem separados.

## 2. `AgendaItem.owner` é obrigatório, e a oportunidade fica de fora

**A alternativa:** `owner?: string | null`, opcional, preenchido onde desse.

**Por que não.** Opcional significa que cada fonte nova herda `undefined` em
silêncio, e o filtro "Minhas" passa a esconder coisas por engano. Obrigatório
faz o compilador exigir uma decisão de cada uma das oito fontes.

A oportunidade ficou **deliberadamente** de fora, e essa é a parte que
custou: `deals.assigned_to` referencia `profiles.id` (migração 002) e
`tasks.assigned_to` referencia `auth.users` (migração 068). São dois espaços
de identificador. Compará-los sem o `join` de `profiles` filtraria errado
**sem avisar** — e filtrar errado em silêncio é pior do que não filtrar.

Quando a oportunidade entrar, ela entra pelo `user_id`.

## 3. Um item sem dono nunca é escondido pelo filtro "Minhas"

**A alternativa:** "Minhas" mostra só o que tem `owner === eu`.

**Por que não.** Aniversário, campanha e automação agendada não são de
ninguém. Escondê-los faria "Minhas" responder à pergunta "de quem é isto?"
com "de ninguém, então some" — quando a resposta útil é "de ninguém, então
fica".

## 4. Reconciliar com a Google, e não "enviar"

**A alternativa:** `onCreate`, `onUpdate`, `onComplete` — um caminho por
verbo.

**Por que não.** Exige que quem chama acerte qual é o caso, e erra em
silêncio quando dois acontecem juntos: concluir e reagendar no mesmo
salvamento. `reconcileTask` lê o estado atual e faz a Google combinar com
ele, o que a torna idempotente por construção — chamar duas vezes é igual a
chamar uma, e chamar depois de uma falha é a própria recuperação.

## 5. O eixo de horas vai dos limites do expediente, não de 00h a 24h

**A alternativa:** o dia inteiro, como o Google Calendar desenha.

**Por que não.** Dois terços da altura ficariam em horas em que a empresa
está fechada, espremendo as oito de trabalho na faixa do meio. `dayBounds`
lê o expediente da conta e ainda recebe os **dias em tela** — uma exceção de
sábado não estica a grade de uma semana que não mostra sábado.

## 6. A faixa de "dia todo", acima do eixo

**A alternativa:** desenhar tudo às 00:00.

**Por que não.** Metade da agenda não tem hora. Empilhar sete itens no canto
superior inventa uma precisão que o dado não tem, além de ser ilegível.

## 7. Tarefa continua sem rota; só o empurrão tem

**A alternativa:** criar `/api/tasks` e mover tudo para o servidor.

**Por que não.** A fase 2 decidiu que o CRM escreve `tasks` direto do
navegador sob RLS, como já faz com `deals`. Uma rota seria um segundo
caminho para a mesma tabela, com uma segunda regra de permissão para manter.

Mas publicar na Google precisa do refresh token, que mora numa tabela com
RLS ligada e **nenhuma política**, e um token que abre a agenda da empresa
não vai para o navegador por conveniência de arquitetura. Então a tarefa é
salva como sempre, e só o empurrão passa por `/api/calendar/publish`.

O mesmo vale para o gatilho `task_completed`, em
`/api/automations/task-completed`.

## 8. `calendar_connections` com RLS ligada e nenhuma política

**A alternativa:** uma política de leitura para a conta, como as outras três
tabelas da `069`.

**Por que não.** Uma política é uma concessão **permanente** a todo
navegador de todo membro, para sempre, por causa de uma tela. A linha guarda
um refresh token. O estado da conexão sai por rota, com os campos escolhidos
à mão e sem os dois cifrados — o que não é lido não vaza depois num
`console.log` distraído.

Mesmo padrão de `automation_pending_executions`.

## 9. As agendas entram sem publicar, e só a principal habilitada

**A alternativa:** habilitar tudo o que a conta Google enxerga.

**Por que não.** A lista traz feriados, aniversários e agendas
compartilhadas de colegas. Importar tudo enche a tela de ruído no primeiro
minuto; escrever em tudo publica compromissos da empresa na agenda pessoal
de alguém que não pediu isso.

O padrão de `direction` é `in` porque importar não escreve nada do outro
lado — o lado conservador de errar numa integração é o que só lê.

## 10. Prazo relativo em dias ÚTEIS, por padrão

**A alternativa:** dias corridos, que é o que `addDays` faz de graça.

**Por que não.** Uma automação que dispara numa sexta e marca "+2 dias" põe
a ligação no domingo. O sintoma aparece longe da causa: uma tarefa que nasce
vencida na segunda, sem que ninguém entenda por quê. A `066` já sabe que
dias a empresa atende.

## 11. Concluir na API é `PATCH`, não `/complete`

**A alternativa:** `POST /api/v1/tasks/{id}/complete`, mais descoberto.

**Por que não.** Seria uma segunda porta para a mesma transição, com uma
segunda regra para manter em sincronia com a primeira. `status: "done"`
carimba `completed_at` do mesmo jeito que a tela carimba.

`DELETE` existe e é a única operação da API que apaga de verdade: a 068
decidiu que tarefa concluída FICA, mas uma integração que criou uma por
engano precisa de caminho de volta, e `cancelled` deixaria na lista uma
linha que nunca deveria ter existido.

## 12. O prefixo do id de evento é `crm`, e não `wacrm`

**A alternativa:** o que o plano sugeria.

**Por que não.** `w` **não existe em base32hex** — o alfabeto para em `v`. A
Google recusaria todo id determinístico, e recusaria no envio e não na
compilação: a integração falharia inteira, só contra a API real.

O teste que fixa o alfabeto é o que pegou isso.

## 13. Rebase no merge, e não squash

**A alternativa:** squash, que dá um commit por release.

**Por que não.** A `main` é linear (zero merge commits), então rebase
mantém a forma. E são 14 commits com mensagens que explicam o porquê de cada
decisão — colapsá-los numa só jogaria fora o registro que este documento
existe para preservar.
