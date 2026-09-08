**Raiz verificada:** `D:\wacrm\wacrm`. Tudo abaixo foi conferido no código; onde digo "já existe", há arquivo e comentário citados.

---

## O eixo que decide quase tudo

Quatro diferenças, e quase todo veredito sai delas:

1. **Uma pessoa × uma fila compartilhada.** Nos três apps o eixo primário é *o dia*, porque só há um dono e tudo cabe num dia. Aqui o eixo primário é *urgência + dono*: `D:\wacrm\wacrm\src\lib\tasks\board.ts` agrupa em `overdue / today / tomorrow / week / later / someday` e defende isso — *"uma lista ordenada só por data enterra o que venceu na semana passada acima do que vence hoje"*. Uma faixa de sete dias não tem onde pôr "sete atrasadas", que é exatamente o argumento que `tasks-page.tsx` já usa contra o calendário.
2. **Dedo sem teclado × ponteiro com teclado.** Preset e faixa de dias existem no celular porque digitar data é caro e o alvo mínimo é 44px. No desktop digita-se; o preset continua valendo por *velocidade*, a faixa de dias deixa de valer por *custo de banda vertical*.
3. **Uma tela por vez × tudo visível.** Abas de tempo ("Recently | Today | Upcoming | Later") existem porque o celular só mostra uma faixa. No desktop as seis faixas cabem juntas — e transformá-las em abas esconderia "Atrasadas", a única banda para a qual a tela foi construída.
4. **Dado que existe × dado inventado.** `Task` (`D:\wacrm\wacrm\src\types\index.ts:645`) não tem porcentagem, não tem prioridade, tem **um** `assigned_to` e não tem comentários. Metade dos enfeites das referências não é uma decisão de UX aqui, é uma coluna que não existe.

---

## TRANSFEREM

**1. Preset antes do campo livre — transfere, já está, e está escrito à mão.**
`D:\wacrm\wacrm\src\components\tasks\task-dialog.tsx` já faz o padrão inteiro e melhor que as referências: "Hoje / Amanhã / Em 3 dias / Semana que vem" antes do `DateField`, com `presetDue` lendo o expediente da conta — *"'amanhã', numa sexta às 19h, tem de ser segunda às 08:00"*. O defeito é a escrita: os quatro botões são `<button className="rounded-md px-2 py-1 text-xs font-medium">` com estado ativo `bg-primary-soft text-primary`. Isso é literalmente o `FilterChip` **menos o anel de foco e menos o alvo de ponteiro grosso** — e `D:\wacrm\wacrm\src\components\ui\filter-chip.tsx` documenta ter removido exatamente esse defeito *desta mesma tela*: *"O funil tinha o `OwnerChip` e `/tasks` tinha um `<button>` cru... foco: anel do `Button` · nenhum; toque: alvo de 44px · 26px"*. É a única instância remanescente. Cabe: trocar os quatro (e o "sem prazo") por `FilterChip` não-`subtle` — é a pergunta "qual", que é o modo padrão do componente.

**2. Progresso como barra fina, nunca como par de números — transfere, e já é doutrina.**
`D:\wacrm\wacrm\src\components\pipelines\deal-card.tsx` desenha `h-1 rounded-full` sobre `bg-muted` com `bg-human-strong`, e o comentário já responde à referência: *"uma régua fina diz 'quanto falta' sem que ninguém leia dois números. Âmbar enquanto falta, porque um passo de playbook é trabalho de uma pessoa — e ela some quando acaba, em vez de virar verde: concluído é a ausência de uma cobrança, não um segundo anúncio."* Onde cabe **mais**: em lugar nenhum de `/tasks` — uma tarefa não tem 85%, tem `open/done/cancelled`. E onde parece caber mas não cabe: o `StatusBadge` "3/5" no cabeçalho do `playbook-checklist.tsx` é um par de números solto, mas ali a lista de passos está visível logo abaixo; a barra só ganha da dupla de números quando os passos **não** estão na tela, que é o caso do cartão. Manter.

**3. Chip de categoria em todo cartão — transfere, já está, e a casa melhora a referência.**
`tasks-board.tsx:364` já cita as referências para justificar a fileira de chips, e `task-row.tsx` faz o mesmo na lista. A melhoria que não deve ser desfeita: as referências usam **um** chip para prioridade, categoria e estado; aqui forma é o segundo canal — taxonomia é retângulo (`Tag`), estado é pílula (`StatusBadge`), e são só 20px/18px. Copiar o chip único das referências apagaria essa distinção e (no caso de "Priority") pintaria de âmbar algo que não é "uma pessoa precisa agir".

**4. Botão primário largo no fim do formulário — transfere só abaixo de `sm`, e já é o comportamento.**
`D:\wacrm\wacrm\src\components\ui\dialog.tsx:132` é `flex-col-reverse gap-2 … sm:flex-row sm:justify-end`: sem `items-*`, os filhos esticam, então **no celular o par já é dois botões largos empilhados com o primário em cima**; de `sm` para cima vira o par à direita. `sheet.tsx:166` (`flex flex-col gap-2 p-4`) é largo sempre. O botão largo no desktop seria uma regressão dupla: um alvo de 480px para um cursor com precisão de pixel, e a perda da hierarquia cancelar/salvar no canto inferior direito que 78 rodapés do app já ensinam.

**5. O slot tracejado no pé da coluna — transfere (e é o substituto do FAB).**
`D:\wacrm\wacrm\src\components\pipelines\board-lane.tsx:154` já o tem, com a nota *"O SLOT TRACEJADO das referências, e ele fica FORA do corpo que rola… a peça é a das referências, o lugar não"*. `TasksBoard` já recebe `onCreate`. É criar onde o olho já está, sem flutuar sobre o conteúdo.

**6. A faixa de sete dias — transfere como *relance*, não como navegação primária.**
Já existe: `D:\wacrm\wacrm\src\components\layout\calendar-strip.tsx`, montada em `header.tsx:152` sob `hidden xl:flex`, com a decisão escrita — *"SEVEN DAYS, NOT A CHIP… A row of dates you can read without clicking is worth more than one you can only reach through a control"* — e o corte em `xl` justificado (*"finding a customer beats reading a date"*). A segunda encarnação legítima é o cabeçalho de semana do `WeekView` (`size-7 rounded-full`, hoje em `bg-primary`), que é a mesma imagem da referência. O que **não** transfere é promovê-la a controle de data de `/tasks`: ela cobraria uma banda inteira da fila para responder uma pergunta que a fila responde melhor por faixa de urgência.

---

## NÃO TRANSFEREM

**FAB amarelo redondo.** Não há FAB em lugar nenhum do app (procurei). No desktop não existe arco do polegar; no celular, `mobile-tab-bar.tsx` já gastou essa faixa em navegação de propósito (*"Four, and the fourth is the drawer"*, e ela some dentro de uma conversa). Além disso, âmbar é a única "venha aqui" do sistema — um botão de criar permanentemente âmbar competiria com atrasadas todo dia. **Substitui:** o `<Button size="sm">` com `Plus` no cabeçalho de `/tasks` (o toolbar é o FAB do desktop) + o slot tracejado do item 5.

**Pilha de avatares "+4".** Não é escolha de UX, é o modelo: `Task.assigned_to` é **um** id (`types\index.ts:667`), e o filtro "Minhas / Todas / pessoa" de `filterTasks` depende disso. Uma tarefa com quatro donos não tem dono. **Substitui:** o `MemberAvatar size="2xs"` único no fim da linha e do cartão, que já é a regra da casa (*"numa equipe, reconhecer quem é pela foto é mais rápido que ler o nome"*). A pilha com excedente já existe onde tem material de verdade — presença de equipe, `online-members.tsx:98` (`-space-x-2`, `ring-card ring-2`, `+{overflow}`).

**"2 Comments" no cartão.** Não há comentários em tarefa; há `completion_note` e os vínculos `contact_id / deal_id / conversation_id`. Construir uma thread na tarefa seria uma segunda caixa de entrada dentro de um produto cuja primeira tela é uma caixa de entrada — recusa que `board.ts` já registra. **Substitui:** o link para a ficha do contato que `TaskRow` já imprime (`contact.href`), e a conversa do WhatsApp como o lugar da conversa.

**Grade de categorias (quatro ladrilhos verde-limão/azul/rosa/roxo com "10 Task").** Três motivos: (a) `color-doctrine.test.ts` reprova `purple/pink/violet/lime` direto, e mesmo com tokens seria cor sem significado — o oposto da doutrina; (b) a tela já filtra por tipo **em contexto**, com seis `FilterChip` que não fazem ninguém sair da fila; (c) "quantas ligações existem" não é pergunta de fila de trabalho. **Substitui:** os `FilterChip` de tipo já montados; e, quando um ladrilho contado é mesmo o objetivo, `StatTile`/`IconTile` no `/dashboard`, onde o tom é `human` só quando algo espera por uma pessoa.

**Segmentado de três vias com contagem ("To Do 4 / Doing 2 / Done 4").** O `SegBar` até suporta `count` e `tone: 'human'`, mas em `/tasks` ele é o seletor de **visão** (lista/quadro/calendário) — contar visões não significa nada — e um quarto controle de status brigaria com as colunas do quadro. **Substitui, e já está em três lugares:** a contagem no cabeçalho de cada raia (`BoardLane count`), a mesma bolinha+nome+contagem no cabeçalho de faixa da lista, e a linha de resumo do cabeçalho alimentada por `summarize()` ("N atrasadas · M hoje"), que é a versão desktop do controle contado: uma frase, não três abas.

**Timeline vertical (trilho, bolinhas, hora à direita).** É um day view com menos capacidade: não mostra sobreposição, nem sábado fechado, nem faixa de dia inteiro. `tasks-calendar.tsx` já reutiliza `DayView/WeekView/MonthView` inteiros e defende isso — *"Escrever uma segunda grade daria duas implementações do eixo de horas, dois tratamentos da faixa de 'dia todo' e duas chances de o sábado fechado ser desenhado de dois jeitos."* No celular a timeline ganha porque a grade de horas não cabe; no desktop cabe e carrega mais. **Substitui:** `DayView`.

**Abas de texto sem caixa como filtro de tempo.** Esconderiam cinco sextos da fila — inclusive "Atrasadas". **Substitui:** as seis faixas de `TASK_BUCKETS` empilhadas num scroll só, com faixa vazia removida.

**Carrossel horizontal de cartões.** Rolagem lateral no desktop pede shift+roda e não tem affordance. O quadro já rola de lado por **coluna nomeada**, que é outra coisa. Nada a substituir.

**Cabeçalho com foto + nome + cargo do próprio usuário.** O `header.tsx` declara o contrário — *"The top bar carries what belongs to the APP"*. Num CRM de equipe o rosto que importa não é o meu, é o de quem é dona da linha. **Substitui:** `OnlineMembers` (quem mais está aqui) + o avatar do responsável em cada linha.

**Switch "Get alert for this task ON".** O `OptionSelect` de `REMINDER_CHOICES` (0/15/30/60/120/1440) já é estritamente mais expressivo, e vem com a linha que avisa que sem hora o lembrete cai na abertura do expediente. Um booleano não sabe dizer "30 min antes". Não trocar.

**Pílula de duas vias "Priority Task / Daily Task".** Não existe campo de prioridade; `kind` é TEXT com catálogo de seis (068). Não inventar um eixo de prioridade só para ter a pílula.

---

## Um achado adjacente, honesto, que a referência expõe

O chip de relógio "48h" das referências tem contraparte real aqui e ela está **invisível**: `duration_minutes` existe em `Task`, é selecionado nas queries e na API v1, e `D:\wacrm\wacrm\src\lib\calendar-sync\google\map.ts:228` usa `task.duration_minutes ?? 30` para calcular o fim do evento na Google. Mas `task-dialog.tsx` não tem campo nenhum para ele — ou seja, toda tarefa com hora vira um bloco de 30 minutos na agenda da empresa e ninguém consegue mudar isso. O lugar certo não é um chip no cartão (o rodapé do cartão já está no teto de metadado que `deal-card.tsx` defende), é um controle ao lado do `TimeField` no diálogo.