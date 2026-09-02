# Verificação

O que foi verificado, como conferir a 065 depois de aplicar, e o roteiro
ponta a ponta que ainda não rodou.

---

## 1. O que rodou, e o resultado

| Comando             | Resultado                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm run typecheck` | limpo                                                                          |
| `npm run lint`      | 0 erros, 42 avisos — todos anteriores a esta passagem                          |
| `npm test`          | 134 arquivos, **1590 testes**, todos passando (82 novos)                       |
| `npm run build`     | compila; o servidor de desenvolvimento usa `.next/dev`, então os dois convivem |
| `prettier --check`  | limpo nos arquivos tocados                                                     |

O que os testes novos provam, em uma linha cada:

- **`engine-deals.test.ts`** — os três gatilhos casam e falham fechados;
  a oportunidade é resolvida só com funil declarado; a regra dura recusa
  a segunda execução com `skipped`/`already_running`; a chave de
  varredura duplicada para antes do primeiro passo; o recuo sem as
  colunas da 065; `move_deal_stage` com os gates de ganho e perda;
  `end` para a partir de um ramo; `cancel_automations` chega ao módulo
  com o escopo certo; as três condições leem a oportunidade e a thread;
  `{{contact.first_name}}` e `{{deal.title}}`; a espera até a data
  parca no instante certo e encerra sem data.
- **`cancel.test.ts`** — só quem pediu é cancelado; o log fecha com o
  motivo; uma linha já `running` não é tocada; o escopo por oportunidade
  e por contato; a lista explícita.
- **`reentry.test.ts`** — cada política, o sujeito certo (oportunidade
  ou contato), e o falhar aberto num banco pré-065.
- **`stage-events.test.ts`** — claim, cancelamento antes do disparo, o
  contexto completo, a oportunidade sem contato, o freio de laço, a
  tabela ausente.
- **`date-sweep.test.ts`** — "hoje" no fuso, a hora configurada, uma
  consulta para duas automações, o formato da chave, os campos de data
  por igualdade e sem `opted_out`.
- **`local-time.test.ts`** — 09:00 em São Paulo é 12:00Z; leste de UTC;
  fuso inválido recua.
- **`validate-rules.test.ts`** — cada passo, gatilho e regra novos; o
  aviso das 24 h soma esperas e entra nos ramos.
- **`templates-funnel.test.ts`** — os dez modelos só enviam templates que
  existem e com exatamente as variáveis que cada template declara; nunca
  texto solto; o resolver por nome, apelido e acento, preferindo o funil
  declarado; o que não acha fica vazio e listado.
- **`send-message-quick-reply.test.ts`** — a resposta rápida é gravada
  e o gatilho da equipe dispara com ela; uma de outra conta é descartada;
  o recuo sem a coluna; a API pública não dispara; o template é nomeado.
- **`outcome.test.ts`** — Em Andamento e Venda Perdida reconhecidos; os
  oito motivos.

## 2. Conferir a 065

No SQL Editor do Supabase, depois de aplicar. Cada consulta tem de
devolver uma linha (ou o número indicado):

```sql
-- a tabela e os dois gatilhos
select to_regclass('public.deal_stage_events');
select tgname from pg_trigger
 where tgname in ('trg_deals_record_stage_event', 'trg_deals_stage_entered_at');  -- 2 linhas

-- as colunas
select column_name from information_schema.columns
 where table_name = 'automation_pending_executions' and column_name in ('deal_id', 'cancelled_reason');  -- 2
select column_name from information_schema.columns
 where table_name = 'automation_logs' and column_name in ('deal_id', 'end_reason', 'trigger_key');        -- 3
select column_name from information_schema.columns
 where table_name = 'automations'
   and column_name in ('pipeline_id', 'cancel_on_reply', 'cancel_when_stage_in', 'reentry_policy', 'reentry_days'); -- 5
select column_name from information_schema.columns
 where table_name = 'messages' and column_name = 'quick_reply_id';

-- a função da varredura
select proname from pg_proc where proname = 'contacts_with_birthday_on';

-- o gatilho funcionando: mover qualquer oportunidade de etapa e ler
select deal_id, from_stage_id, to_stage_id, changed_by, changed_at, dispatched_at
  from deal_stage_events order by changed_at desc limit 5;
```

`dispatched_at` preenchido na linha mais recente, um minuto depois, é o
cron rodando. Vazio para sempre é o cron parado.

## 3. O roteiro ponta a ponta

Precisa da 065, das etapas, dos atalhos, dos modelos instalados e do
número de teste da Meta. Para não esperar dias, edite as esperas dos
modelos instalados para minutos — o construtor aceita — e volte a dias
antes de ligar para valer. O banco de `.env.local` é de teste e pode ser
resetado à vontade.

| #   | Cenário                                                     | Esperado                                                                                                                                | Onde olhar                                             |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | Contato novo escreve; vendedor manda `/aberto`              | Oportunidade em Em Aberto; log da `/aberto → Em Aberto` com `deal_id`; linha em `deal_stage_events` com `changed_by` nulo (foi o motor) | Histórico da automação; `deal_stage_events`            |
| 2   | Espera de "24 h" (minutos) sem resposta                     | Move para Follow-up; `followup_d1` sai como template; a espera do D3 aparece na agenda                                                  | Agenda da Visão geral; `automation_pending_executions` |
| 3   | Cliente responde durante a sequência                        | Espera `cancelled` com `customer_replied`; oportunidade em Em Negociação; log da sequência `cancelada`                                  | Histórico das duas automações                          |
| 4   | Sequência inteira sem resposta                              | D30 sai; "24 h" depois Geladeira 30D; "30 d" depois Geladeira 60D; nada mais é enviado                                                  | Quadro; histórico                                      |
| 5   | Vendedor move à mão de Follow-up para Em Negociação         | Espera `cancelled` com `stage_entered:…`; nada sai                                                                                      | `automation_pending_executions.cancelled_reason`       |
| 6   | `/andamento` em contato com etiqueta Lead                   | Em Andamento; Lead sai, Cliente entra; segundo `/andamento` não duplica; sem valor, `status` fica `open` e o log diz                    | Ficha do contato; histórico                            |
| 7   | `/atendido`                                                 | Atendido; D20 na agenda; no "D20" o template sai e a oportunidade vai para Pós-venda; D60 e D120 saem com 60 e 120                      | Agenda; histórico                                      |
| 8   | Nova compra do mesmo contato antes do "D120"                | A recompra da compra anterior é `cancelled` com `cancelled_by:<id da /andamento>`                                                       | `automation_pending_executions`                        |
| 9   | Compra Futura com data; data movida pela agenda; data limpa | A espera acompanha a data (nova linha na fila); limpar encerra com `date_cleared`                                                       | Agenda; `automation_logs.end_reason`                   |
| 10  | Mover para Venda Perdida                                    | Motivo obrigatório com os oito; esperas da oportunidade `cancelled`                                                                     | Diálogo de perda; fila                                 |
| 11  | Aniversário hoje; cron chamado duas vezes                   | Um envio, um log, `trigger_key = contact:<id>:<data>`                                                                                   | `automation_logs`                                      |
| 12  | Contato com `opted_out`                                     | Nenhum template de marketing sai; o passo aparece no log como recusado                                                                  | Histórico                                              |
| 13  | Cron parado por uma hora e religado                         | Eventos e esperas acumulados são processados na ordem; nenhum perdido nem duplicado                                                     | `deal_stage_events.dispatched_at`; histórico           |

Duas consultas que respondem "o que a máquina está para fazer" enquanto
o roteiro roda:

```sql
select a.name, p.run_at, p.status, p.cancelled_reason, p.deal_id, p.contact_id
  from automation_pending_executions p join automations a on a.id = p.automation_id
 order by p.run_at;

select a.name, l.status, l.end_reason, l.trigger_key, l.deal_id, l.created_at
  from automation_logs l join automations a on a.id = l.automation_id
 order by l.created_at desc limit 30;
```
