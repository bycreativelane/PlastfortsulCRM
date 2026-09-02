# Pendências

O que **não** foi feito, o que é de outra passagem, e o que ficou em
aberto esperando decisão.

---

## 1. A borda dos inputs — decidido

**Resolvido.** Gabriel viu as duas versões lado a lado e escolheu a leve.
Implementado separando o token em vez de afrouxar a exigência:

| Token       | Valor             | Quem usa                                      |
| ----------- | ----------------- | --------------------------------------------- |
| `--field`   | claro, /30        | o preenchimento do campo                      |
| `--input`   | **leve** (1,56:1) | borda de input, select, textarea, botão, tabs |
| `--control` | **3:1**           | borda de checkbox e radio (16px)              |

Os quatro pares do `theme-contrast.test.ts` **não foram removidos** — foram
re-apontados de `--input` para `--control`, com o argumento escrito ao lado
deles. O bug original (checkboxes de seleção em massa invisíveis na tabela
de contatos) continua coberto por teste.

A distinção é a palavra "identificar" na WCAG 1.4.11: um quadrado de 16px
vazio **é** a sua borda; um campo de 32px sob um `FieldLabel` visível, com
placeholder dentro e preenchimento próprio, tem quatro canais que o
identificam antes do traço.

Se a chamada for revertida algum dia, o caminho de volta é apontar os
quatro pares para `--input` de novo — não criar um quinto token.

---

## 2. Cinco primitivos de gráfico órfãos

A troca do gráfico de área por barras deixou sem uso, em
`src/components/charts/chart-primitives.tsx`:

`ChartGradient` · `gradientFill` · `LINE_WIDTH` · `DOT_R` · `CURSOR_LINE`

Nenhum tem call site fora do próprio arquivo. Verificar com:

```bash
for s in ChartGradient gradientFill LINE_WIDTH DOT_R CURSOR_LINE; do grep -rn "\b$s\b" src --include=*.tsx --include=*.ts | grep -v chart-primitives.tsx; done
```

Não foram removidos porque não são desta passagem e o bloco de doutrina
do próprio arquivo os enquadra como "o vocabulário compartilhado que os
gráficos falam" — manter alguns pode ser intencional para uma linha ou
área futura. Se ficarem, vale uma nota dizendo que hoje não têm call
site, para o próximo leitor não ter que redescobrir.

Os dois que **eram** desta passagem — `TARGET_ZONE` e `ChartRail` —
foram removidos junto com a versão que os tornou desnecessários.

---

## 3. Duas chaves de mensagem órfãs, anteriores a esta passagem

`Dashboard.conversationsChart.tooltipIncoming` e `tooltipOutgoing`.

Já estavam sem uso antes — o tooltip do gráfico sempre montou as linhas
com `incoming` / `outgoing`. Ficaram nos três catálogos por não serem
desta passagem; as quatro que **esta** passagem orfanou foram removidas.

---

## 4. As traduções em coreano não foram revisadas por falante

As chaves novas em `ko.json` — `windowNow`, `windowToday`, `vsYesterday`,
`times`, `withinTarget`, `biggestDrop`, `per.{day,week,month}` e a
`responseTimeChart.description` reescrita — foram escritas nesta
passagem sem revisão de falante nativo.

O `messages.test.ts` garante **paridade de chaves**, não qualidade de
tradução: uma string ruim passa no teste igual a uma boa. `en` é a fonte
da verdade e `pt-BR` é o idioma da instalação da PlastfortSul, então o
risco prático é baixo — mas está registrado.

---

## 5. Aviso de lint pré-existente

`src/app/(dashboard)/reports/page.tsx` — `react-hooks/exhaustive-deps`
sobre `failSeries`. Está no `HEAD` desde antes desta passagem e não foi
tocado: mexer na lista de dependências desse `useEffect` muda quando as
consultas do painel refazem, o que é mudança de comportamento disfarçada
de correção de lint.

---

## 6. Trabalho de outra sessão na mesma árvore

Quando esta passagem começou havia alterações não commitadas que não são
dela, nos mesmos arquivos ou vizinhos:

- `--input` / `--field` e os oito componentes de formulário
- os quatro pares novos em `theme-contrast.test.ts`
- trabalho anterior em `chart-primitives.tsx`, `conversations-chart.tsx`,
  `pipeline-funnel.tsx` e `response-time-chart.tsx`

Os três últimos foram **reescritos** por esta passagem, depois de ler o
conteúdo anterior por inteiro e preservar as decisões documentadas nele.
`stat-tile.tsx` também tinha trabalho não commitado que foi reescrito
pelo mesmo caminho.

Vale conferir antes de commitar, principalmente se alguma daquelas
sessões ainda estiver aberta.

---

## 7. O bug da seção Novidades — RESOLVIDO

A trilha de Configurações rolava junto com a página. O teto do `sticky`
media a viewport e não a área de rolagem, errando por 1rem em toda
viewport. Detalhe em
[01-worklog.md §16](01-worklog.md#16-bugs-desta-rodada).

<details><summary>O que foi descartado antes de achar</summary>

### (histórico) — não reproduzido

Relatado como um vazio no sidebar, **só em Configurações › Novidades**.
Não achei lendo o código. O que foi descartado, com evidência:

| Hipótese                      | Por que não é                                                         |
| ----------------------------- | --------------------------------------------------------------------- |
| Container query sem ancestral | `settings/page.tsx:133` tem `@container` — `@2xl:grid-cols-2` resolve |
| Shell sem altura de viewport  | `h-vh-100` está definido (`@utility h-vh-*`) e `--zoom: 1` também     |
| Nav com item faltando         | O nav é `flex-1 overflow-y-auto`; o topo do print estava cortado      |
| Rodapé do sidebar solto       | É `shrink-0` depois do nav — fixado embaixo por construção            |

O vão entre o último item do nav e os cards fixados é a folga do
`flex-1`, que é o comportamento correto para um rodapé preso no fundo.
O que **não** se explica é isso acontecer só numa seção.

A pista que destravou foi a do usuário: "quando clica em ver todos ele
faz o side menu subir junto" — o vão não era o sintoma, era o `sticky`
soltando.

</details>

---

## 8. O que foi construído mas não foi visto rodando

Anexos da equipe e Playbook ficam atrás do login, e esta sessão não entra
em conta nenhuma. Os dois passaram por `tsc`, eslint, 1508 testes e
`build`, e **não** por uso.

O que vale exercitar à mão, porque depende do navegador e não do tipo:

| Onde           | O quê                                                                |
| -------------- | -------------------------------------------------------------------- |
| Sala da equipe | Arrastar por cima dos balões — o overlay não pode piscar             |
| Sala da equipe | Gravar e **descartar** — o áudio não pode aparecer depois            |
| Sala da equipe | Colar print com texto já digitado — o texto tem que ficar            |
| Playbook       | Buscar "frete" e ver se acha nas quatro seções                       |
| Playbook       | A ficha de um produto sem medidas — não pode virar uma coluna de "—" |
