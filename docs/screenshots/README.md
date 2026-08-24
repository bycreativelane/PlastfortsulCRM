# Capturas de tela

Pasta vazia de propósito. O `README.md` da raiz **não** referencia
imagem nenhuma hoje — melhor sem seção do que com imagem quebrada. Este
arquivo é o combinado de quando elas forem feitas, com uma conta de
teste.

## Antes de capturar: isto é um CRM de WhatsApp

Uma captura deste sistema mostra **nome, telefone e conversa de
cliente**. Num repositório isso é o mesmo tipo de problema que subir uma
chave: informação que não deveria sair daqui, num lugar onde fica para
sempre e é fácil de esquecer.

- Capture com uma **conta de teste e dados de exemplo**, nunca com a
  operação real.
- Se por algum motivo capturar dado real, **borre antes de salvar**.
  Corrigir num commit seguinte não adianta — o arquivo original
  continua no histórico.
- Confira o que entrou junto sem você reparar: o nome e o e-mail no
  rodapé da barra lateral, a prévia da última mensagem na lista de
  conversas, o telefone no cabeçalho da thread, a aba do navegador, uma
  notificação do sistema aparecendo por cima.

## O que capturar

| Arquivo           | Tela               | O que precisa aparecer                                                                                                                                |
| ----------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visao-geral.png` | `/dashboard`       | A fila "Precisa de você" com itens e o funil na coluna da direita — é a tese do produto numa imagem: o que depende de uma pessoa, e o que não depende |
| `atendimento.png` | `/inbox`           | Os três painéis ao mesmo tempo: lista de conversas, thread aberta, ficha do cliente com as ações rápidas                                              |
| `funil.png`       | `/pipelines`       | O quadro com oportunidades em pelo menos três colunas, e os totais por etapa no topo de cada uma                                                      |
| `clientes.png`    | `/contacts`        | Opcional — a tabela com etiquetas e o painel de detalhe aberto                                                                                        |
| `automacoes.png`  | `/automations/new` | Opcional — o construtor com um fluxo de dois ou três passos montado                                                                                   |
| `relatorios.png`  | `/reports`         | Opcional — os gráficos com série suficiente para não caírem no estado vazio                                                                           |

## Como capturar

- **Largura 1440px**, modo claro (é o padrão do produto). O tema escuro
  vale uma segunda imagem só se quiser mostrá-lo.
- **PNG**, não JPG — a interface é tipografia e linha fina, e o JPG suja
  as bordas.
- Janela sem barra de ferramentas do navegador: `F11`, ou capture só a
  região da aplicação.
- Se um painel estiver carregando, espere. Esqueleto de carregamento
  numa captura de divulgação parece defeito.
- Acima de ~500KB cada, passe num compressor antes de commitar. Elas
  entram no histórico do git para sempre e não são comprimidas por ele.

## Quando as imagens existirem

Cole esta seção no `README.md` da raiz, logo depois da linha
"Desenvolvido e mantido pela **Creative Lane**":

```markdown
## Telas

<p align="center">
  <img src="./docs/screenshots/visao-geral.png" alt="Visão geral" width="900">
</p>

|                                                                              |                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| <img src="./docs/screenshots/atendimento.png" alt="Atendimento" width="440"> | <img src="./docs/screenshots/funil.png" alt="Funil" width="440">      |
| **Atendimento** — a caixa compartilhada, com a ficha do cliente ao lado      | **CRM** — oportunidades em quadro, ligadas à conversa que as originou |

---
```
