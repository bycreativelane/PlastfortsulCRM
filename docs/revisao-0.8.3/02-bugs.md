# Defeitos: sintoma, causa, correção

Só os que quebravam alguma coisa. Melhorias e pedidos estão em
[01-worklog.md](01-worklog.md); o que ficou por fazer está em
[03-pendencias.md](03-pendencias.md).

---

## 1. Todo clique direito derrubava a tela

**Sintoma.** Clicar com o botão direito numa conversa — ou num card do
Kanban — trocava a página inteira por "Algo quebrou nesta tela".

**Causa.** `ContextMenuLabel` é o `Menu.GroupLabel` do base-ui. Ele lê um
contexto que só `Menu.Group` fornece e **lança** quando não acha:

```
Base UI: MenuGroupContext is missing.
Menu group parts must be used within <Menu.Group> or <Menu.RadioGroup>.
```

O throw acontece durante o render do menu, então o React desenrola até a
fronteira de erro da rota. Não é o menu que falha — é a rota.

Atingia dois arquivos independentes,
`inbox/conversation-menu.tsx` e `pipelines/deal-context-menu.tsx`, e a mesma
armadilha já tinha sido encontrada e escrita em `flows/flow-builder.tsx`
antes dos dois existirem.

**Correção.** `<Group>` em volta do label nos dois. Mais um teste —
`components/ui/menu-label-group.test.ts` — que falha se qualquer arquivo
renderizar um label de menu sem nunca renderizar um grupo. O typecheck não
enxerga isto: as props do label são válidas e o que falta é um ancestral em
tempo de execução.

**Por que só apareceu agora.** O crash do `usePresence` derrubava o dashboard
antes de qualquer menu montar. Consertar aquele revelou este — que estava lá
desde que o menu foi escrito.

---

## 2. O dashboard caía quando dois componentes pediam o não lidas

**Sintoma.** "Algo quebrou nesta tela" ao abrir qualquer rota do painel.

**Causa.** `useTotalUnread` abria o canal com o nome fixo
`total-unread-realtime`. O supabase-js guarda canais por nome, então o
**segundo** componente a chamar o hook recebia o mesmo canal já inscrito, e
`.on()` depois de `.subscribe()` lança. Latente enquanto a barra lateral era o
único consumidor.

**Correção.** Um canal por consumidor (`useId`), igual ao que o `usePresence`
recebeu na 0.8.2 pela mesma razão.

---

## 3. Conversa finalizada era inalcançável

**Sintoma.** "Cadê as conversas encerradas?" Os filtros "Encerradas" e
"Ocultas" apareciam cinzas e não clicavam.

**Causa.** As duas opções eram contadas contra a aba atual, que por definição
não contém nenhuma delas — então contavam zero **sempre**, e o menu
desabilita linha com zero. Dependência circular: para chegar ao filtro era
preciso uma contagem diferente de zero, e para a contagem mudar era preciso
já estar no filtro.

Foi introduzido na 0.8.2 ao rebaixar a aba "Finalizados" para filtro. O
código escrito para deixar essas duas opções alcançarem fora da aba era
inalcançável.

**Correção.** Contadas contra tudo que a busca achou, não contra a aba.

---

## 4. O nome do cliente voltava — em dois caminhos

**Sintoma.** "Salvei o nome e depois de alguns minutos voltou o antigo",
ainda, depois de a 0.8.2 dizer que estava resolvido.

**Causa.** `withManualName` foi ligado no formulário de contato e em mais
nenhum lugar. A edição pela ficha do cliente e a importação por CSV gravavam
`name` sem `name_source`, então o webhook continuava se achando dono do
nome e o trocava na mensagem seguinte.

**Correção.** Os dois caminhos passam por `withManualName`. Na ficha, o
telefone também passou a ser normalizado com `toE164` no mesmo `update` —
gravado cru, ele abriria uma segunda linha para a mesma pessoa no índice de
dedup da migração 022.

---

## 5. Remarcar como esperando enterrava a conversa mais esquecida

**Sintoma.** A fila de Esperando fora de ordem.

**Causa.** `setConversationStatus` carimbava `waiting_since` com a hora atual
sem olhar o estado anterior. A aba Esperando é a **única lista do produto
ordenada da mais antiga para a mais nova**, então remarcar uma conversa que
já esperava desde quinta-feira a mandava para o fim da fila.

**Correção.** O carimbo é pulado quando a conversa já está em `pending`,
espelhando a guarda que `markWaitingOnInbound` sempre teve. O item do menu
correspondente ao estado atual também ficou desabilitado.

---

## 6. "Atribuir a…" não existia

**Sintoma.** O recurso pedido para o clique direito não aparecia.

**Causa.** O item estava escrito no componente e traduzido em três idiomas,
atrás de `onRequestAssign?` — uma prop opcional que **nenhum ponto de chamada
passava**. Código correto, tradução correta, zero pontos de montagem.

**Correção.** Virou um submenu real, com os membros da conta e "Ninguém".

---

## 7. Quatro defeitos na sala da equipe

| Sintoma | Causa |
| ------- | ----- |
| Não dá para sair no celular | A lista some abaixo de `md` e o painel não tinha botão voltar |
| O ponto de não lida não apaga | `localStorage` não é reativo e ninguém era avisado da leitura |
| O card some no trilho recolhido | `data-nav-label` leva o elemento inteiro, ícone e ponto junto |
| O atalho só funciona na primeira vez | Travava num sinalizador; o segundo clique ia para a URL atual |

---

## 8. A linha da conversa mostrava a foto errada

**Sintoma.** Uma resposta automática aparecia na lista com a foto que o
cliente tinha mandado antes.

**Causa.** A migração 047 acrescentou `last_message_kind` e
`last_message_media_url`, e essas colunas **não são limpas** por uma escrita
de texto. O webhook e o envio do agente passaram a preenchê-las; os quatro
caminhos de bot continuaram gravando só `last_message_text`, então herdavam a
mídia da mensagem anterior.

**Correção.** Os quatro passam por `writeLastMessage`, que escreve `null`
explicitamente em vez de omitir — e recua para o formato antigo num banco sem
a 047, preservando a prévia de texto.

---

## 9. Marcar notificação como lida mentia quando falhava

**Sintoma.** Painel todo cinza ao lado de um contador que continuava
contando.

**Causa.** A atualização otimista era aplicada e o erro do servidor
descartado. A página já tratava isso; o painel do sino não.

**Correção.** Erro vira toast e recarrega a lista. E linha de notificação sem
destino deixou de ser `<button>` — um botão que não faz nada é
indistinguível de um botão quebrado.

---

## 10. Número estrangeiro com país inventado

**Sintoma.** `+595 991234567` renderizado como `+59 5991234567`.

**Causa.** `formatPhone` cortava dois dígitos fixos do começo. Os códigos
E.164 têm um, dois ou três dígitos.

**Correção.** O comprimento é derivado (zona 1 e 7 têm um dígito; existe uma
lista fechada de dois; o resto tem três). O teste que afirmava a saída errada
foi reescrito — um teste que defende um bug é pior que nenhum teste, e é como
este passou meses numa suíte verde.

---

## 11. Fluxo novo perdia a grade

**Sintoma.** Um fluxo recém-criado abria sobre um fundo liso; a grade
pontilhada aparecia do nada no primeiro nó adicionado.

**Causa.** O estado vazio era renderizado fora do contêiner que pinta
`editor-grid`.

**Correção.** Envolvido no mesmo contêiner. A divergência de **onde** cada
editor pinta a grade (raiz nas automações, canvas nos fluxos) continua, e
está registrada nos dois arquivos em vez de um comentário afirmando uma
paridade que nunca existiu.
