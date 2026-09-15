# Operação — pedidos no Bling

O roteiro de quem opera a integração do CRM com o Bling: como ligar sem
susto, o que cada estado quer dizer, e o que fazer quando algo sai do
normal. O plano técnico (decisões, fases, contrato da API) está em
[spec-orcamentos-bling.md](./spec-orcamentos-bling.md); as variáveis, o cron e o
webhook em [configuracao-env.md](./configuracao-env.md#bling--opcional).

> **Nada disto foi exercitado contra o Bling de verdade.** Todo o código foi
> escrito contra o contrato da API v3 e testado com dublês — não há aplicativo
> cadastrado ainda. A primeira conexão real é a homologação (passo 2 abaixo),
> e é nela que o contrato se confirma.

---

## 1. Antes de ligar

| # | O quê | Quem |
| --- | --- | --- |
| 1 | Aplicativo cadastrado no Bling, com os escopos definidos **antes** de conectar (mudar escopo depois pode revogar a autorização) | Gabriel |
| 2 | `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_OAUTH_REDIRECT_URI` no servidor | Gabriel |
| 3 | Cron **a cada minuto** em `/api/bling/cron` com o `AUTOMATION_CRON_SECRET` | Gabriel |
| 4 | Webhooks `order` e `product` apontando para `/api/bling/webhook` (URL pública HTTPS) | Gabriel |
| 5 | Migrações até a **091** aplicadas | quem aplica migração |
| 6 | Conta ou protocolo de homologação (D9) — o Bling não tem sandbox | Gabriel + financeiro |

## 2. Implantação gradual (Fase 7)

**Semana 1 — só lendo.** Conectar em Configurações › Bling. Nenhum pedido é
criado enquanto **Pedidos no Bling** estiver desligado.

1. Esperar os cadastros de referência sincronizarem (ou "Atualizar agora").
2. Confirmar os papéis: módulo de vendas, as cinco situações, a raiz
   "Venda direta", a categoria padrão, as formas de pagamento que o CRM oferece.
3. Importar os produtos; resolver as pendências (sem código, código repetido).
4. Mapear família → categoria de receita e marcar as exceções e os itens
   auxiliares.
5. Configurações › Oportunidades e moeda › **Transportadoras**: ligar cada uma ao
   contato dela no Bling (ou marcar "É retirada pelo cliente").
6. Configurações › Equipe › **Vendedor no Bling**: ligar cada vendedor.
7. Preencher os dados fiscais dos clientes que vão comprar na semana seguinte.

A matriz de saúde deve ficar verde. Enquanto isso, nenhum pedido existe no
Bling por causa do CRM.

**Homologação da matriz (antes do piloto).** Para cada passagem — Em aberto →
Em andamento, → Atendido, → Cancelado, e Em aberto ↔ Compra futura —, num
pedido de teste da conta de homologação (ou do protocolo combinado com o
financeiro):

1. mudar a situação pelo CRM ("Mudar situação");
2. conferir no Bling se as contas a receber e o estoque foram lançados (ou
   estornados) **uma vez**;
3. anotar o resultado. O CRM lê as ações configuradas em cada transição do
   Bling e só chama `lançar/estornar` explicitamente quando a transição não o
   faz — a homologação é o que confirma que essa leitura bate com o que o
   Bling faz de fato.

**Semana 2 — piloto.** Ligar **Pedidos no Bling** (admin, com confirmação).
Um vendedor, poucos pedidos. Para cada pedido registrado, conferir à mão no
Bling: cliente, itens com os produtos certos, categoria de receita, parcelas
(valor, vencimento, forma), transportadora, frete, vendedor, e o número que o
CRM mostra.

**Depois — todos.** Com o piloto limpo, o resto da equipe.

**O freio:** desligar **Pedidos no Bling**. Nada mais é escrito no Bling; a
fila para de processar operações novas (as que já estão lá falham com
"pedidos desligados" e podem ser repetidas depois); a leitura continua.

---

## 3. Os estados do pedido na oportunidade

| Selo | Quer dizer | O que fazer |
| --- | --- | --- |
| *(nenhum)* / **Não enviado** | A oportunidade ainda não é pedido no Bling | Nada |
| **Sincronizando** | Há operação na fila ou rodando | Esperar; o cron retenta sozinho (30 s, 2 min, 10 min, 30 min, 1 h) |
| **Sincronizado** | O Bling tem o pedido como o CRM | Nada |
| **Envio pendente** | O pedido foi registrado e o orçamento **não** chegou ao cliente | Enviar de novo; o pedido é atualizado, nunca recriado |
| **Erro** | O Bling recusou, ou faltou dado | Ler a mensagem na área Pedido, corrigir, "Registrar/Atualizar no Bling" de novo |
| **Divergente** | O Bling diz outra coisa que o CRM | Ver o motivo abaixo |

### Erro — as mensagens mais prováveis

- **"O cliente precisa de CPF ou CNPJ válido"** — completar a ficha do contato
  (seção Dados fiscais e endereço).
- **"Há mais de um cliente com este documento no Bling"** — o CRM não escolhe
  por nome ou telefone (D5). Resolver no Bling (inativar o duplicado) e
  registrar de novo.
- **"O cliente vinculado não existe mais no Bling"** — o contato do Bling foi
  apagado. Limpar o vínculo exige um admin no banco (`contacts.bling_contact_id
  = null`), e o próximo registro procura pelo documento.
- **"O Bling respondeu 400: …"** — a mensagem é a do Bling, como veio (forma
  de pagamento inválida, produto inativo, etc.). Corrigir o cadastro e repetir.
- **"O limite diário de chamadas ao Bling acabou"** — só amanhã. A fila espera.
- **"O pedido mudou desde a última vez que foi para o Bling"** — ao pedir Em
  andamento. O Bling lança as contas do pedido que **ele** tem; o CRM só deixa
  com o pedido sincronizado e igual. A gaveta atualiza no Bling sozinha quando
  recebe esta resposta e pede de novo; se a atualização falhar (a lista
  "Pronto para o Bling" incompleta, por exemplo), corrigir e repetir. Uma
  mudança para Em andamento que ficou pela metade (a situação mudou lá e o
  lançamento caiu) pode ser pedida de novo sem esta exigência: a repetição
  completa o que faltou.
- **"O Bling só aceita atualizar o pedido Em aberto"** — o pedido está em
  Compra futura. Voltar para Em aberto, atualizar, e seguir.
- **"A operação parou no meio várias vezes e foi abandonada"** — o processo
  caiu na última tentativa (deploy, servidor reiniciando). Repetir.

Repetir é seguro: criar pedido tem **uma** chave por oportunidade
(`CRM-ORC-…`), e toda tentativa procura o pedido por essa chave antes de criar.
A fila processa **uma operação por vez** e confere que ainda é a dona dela
antes de cada escrita no Bling — dois processos (o envio e o cron) não
escrevem a mesma operação.

### Divergente — os motivos

- **"O pedido no Bling ficou diferente em: total"** — alguém mudou valores no
  Bling, ou o Bling arredondou diferente. Conferir os dois lados; se o CRM
  estiver certo e o pedido ainda Em aberto, "Atualizar no Bling".
- **"No Bling o pedido está em outra situação"** — mudaram a situação lá. A
  conferência de 15 minutos (ou o webhook) traz a situação para o CRM; a
  mudança pedida aqui não é repetida em cima.
- **"O pedido saiu de Em aberto no Bling"** — atualizar não é mais possível
  (alteração depois de lançamento está fora do MVP).
- **"O pedido não existe mais no Bling"** — foi apagado lá. Exclusão está fora
  do escopo; decidir com o financeiro.
- **"Há dois pedidos no Bling com a chave deste orçamento"** — alguém duplicou
  à mão (ou uma criação incerta passou duas vezes). Nada do duplicado é
  aplicado à oportunidade — nem o número, nem um cancelamento dele. **Apagar**
  o duplicado no Bling resolve; cancelá-lo deixa o aviso.
- **"O Bling ainda mostra contas a receber vivas deste pedido depois do
  estorno"** — ao cancelar. A situação foi para Cancelado, mas a conferência
  do Contas a Receber ainda acha contas abertas da venda. Conferir no Bling e
  estornar à mão o que sobrou; o carimbo de contas lançadas continua na
  oportunidade até isso.

Uma falha que não se resolve repetindo **depois** que a situação mudou no Bling
(o estoque recusado ao atender, por exemplo) leva a situação para o CRM junto
com o erro — o histórico registra qual lançamento falhou. O CRM não repete o
lançamento sozinho: resolver no Bling.

---

## 4. Os alertas (Configurações › Bling › Pedidos no Bling)

| Alerta | Causa | O que fazer |
| --- | --- | --- |
| **Acesso revogado** | O refresh token foi recusado | "Conectar de novo" com a **mesma** empresa |
| **O Bling parou de avisar o CRM** | A conferência achou mudança que o webhook não trouxe — webhook desabilitado depois de três dias de falha, ou nunca cadastrado | Reabilitar o webhook na aba Webhooks do aplicativo. Enquanto isso, a conferência de 15 minutos mantém o CRM certo |
| **Renovações falhando** | Três ou mais renovações seguidas falharam | Ver o último erro da conexão; se persistir, reconectar |
| **Operações na fila há mais de meia hora** | Cron parado, limite diário, ou Bling fora do ar | Conferir o agendador e o `AUTOMATION_CRON_SECRET`; o log do servidor mostra `[bling]` |
| **Operações falharam nas últimas 24 h** | Recusas do Bling | Abrir as oportunidades com selo **Erro** |

Para investigar no banco (service role, **só leitura**):

```sql
-- As operações de uma oportunidade, da mais nova para a mais velha
select kind, status, attempts, error, next_attempt_at, created_at
  from bling_operations where deal_id = '<id>' order by created_at desc;

-- O histórico do pedido, com a origem de cada passo
select kind, from_status, to_status, source, detail, created_at
  from deal_order_events where deal_id = '<id>' order by created_at desc;

-- Webhooks pendentes ou que falharam
select event, resource_id, status, attempts, error, received_at
  from bling_webhook_events where status in ('pending','processing','failed')
 order by received_at desc limit 50;
```

---

## 5. Situação, contas e estoque

- **Mudar situação** é sempre ação explícita na área Pedido (D1 = B), com a
  confirmação dizendo o efeito ("isto lança R$ … no Contas a Receber").
- **Em andamento** lança as contas **uma vez**: o CRM consulta o Contas a
  Receber pela origem da venda antes de chamar o lançamento, e carimba
  `accounts_launched_at`. Um job repetido três vezes lança uma.
- **Atendido** lança o estoque (pela transição do Bling, ou explicitamente).
- **Cancelado** estorna o que foi lançado e leva a oportunidade para **Venda
  Perdida** com o motivo **Pedido cancelado** (D3).
- **Compra futura** ↔ **Em aberto**: sem lançamento (D4).
- A etapa do funil **acompanha** a situação, no mesmo funil da oportunidade.
  Com o pedido no Bling, os botões Ganho/Perdido do topo da gaveta ficam
  apagados: o desfecho vem da situação.
- No quadro, um pedido com contas lançadas só fica na etapa da situação dele.
- A **recusa** do Bling aparece como veio, e nada muda no CRM.

**Ainda não fazem parte:** alterar pedido depois de lançado, excluir pedido,
NF-e, boleto/PIX, os atalhos `/andamento` e `/atendido` mudarem a situação, e
o quadro perguntar se é para mudar o pedido ao arrastar para uma etapa mapeada.

---

## 6. Dados pessoais e retenção

- O webhook guarda só ids e números do evento, nunca o corpo inteiro.
- Erros e históricos passam pelo sanitizador (CPF, CNPJ, telefone, e-mail e
  tokens viram marcadores).
- Retenção, uma vez por dia pelo cron: eventos de webhook processados saem
  com **30 dias**; operações terminadas com **180**. Operações que ainda podem
  andar nunca saem.
