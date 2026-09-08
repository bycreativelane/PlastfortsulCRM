# PlastfortSul CRM — Pacote completo de correções, melhorias e revisão de automações

## Objetivo deste documento

Este arquivo reúne as alterações que precisam ser feitas no CRM da PlastfortSul a partir dos testes reais de uso.

O objetivo é o Claude Code conseguir analisar o projeto atual, localizar a implementação existente e fazer as correções sem reconstruir módulos que já funcionam.

As prioridades são:

1. corrigir bugs reais encontrados no uso;
2. ajustar a experiência de contatos e conversas;
3. garantir que toda conversa nova gere corretamente uma oportunidade em `VENDAS > Novo lead`;
4. corrigir Compra Futura e Aniversário;
5. corrigir rascunhos por conversa;
6. revisar completamente o motor e as automações comerciais;
7. adicionar acesso rápido ao Playbook durante o atendimento;
8. preservar todos os dados e automações existentes.

---

# 1. Regra geral de implementação

Antes de alterar qualquer código:

- analisar a arquitetura atual;
- localizar componentes, services, hooks, actions e tabelas já existentes;
- reutilizar o que já existe;
- não duplicar tabelas, entidades ou fluxos;
- não apagar automações existentes;
- não alterar IDs internos já salvos;
- preservar dados atuais;
- fazer migrations apenas se forem realmente necessárias;
- manter compatibilidade com a WhatsApp Business Cloud API Oficial da Meta;
- manter o visual atual do CRM;
- corrigir os problemas na origem, e não apenas mascarar mensagens de erro na interface.

As alterações devem ser feitas de forma idempotente quando aplicável.

---

# 2. Alerta de histórico de ocorrência — remover descrição curta

## Estado atual mostrado na imagem

Existe um card de alerta com:

**Atenção — cliente com histórico de ocorrência**

E abaixo aparece:

`1 ocorrência no histórico — leia antes de prometer prazo.`

## Alteração desejada

Remover completamente esta descrição curta:

`1 ocorrência no histórico — leia antes de prometer prazo.`

O alerta deve ficar apenas com a informação principal:

**Atenção — cliente com histórico de ocorrência**

Não remover o histórico de ocorrências.

Não apagar os dados de ocorrência.

A mudança é somente visual nesse card de alerta.

---

# 3. Erro ao ativar automação de Novo contato → Novo Lead

## Erro mostrado na imagem

Ao tentar criar/ativar a automação de novo contato para novo lead, aparece:

`Cannot keep automation active with invalid configuration`

## Problema

Uma configuração que deveria ser válida está sendo considerada inválida pelo motor/validador de automações.

Precisamos revisar:

- schema do trigger;
- schema da action `Criar oportunidade`;
- validação do pipeline;
- validação da etapa;
- campos obrigatórios;
- serialização da automação;
- validator usado ao ativar;
- diferença entre o que a UI salva e o que o backend espera.

## Resultado esperado

Uma automação válida para criação automática de oportunidade deve poder ser salva e ativada sem erro.

Se algum campo como `Título` estiver sendo tratado como obrigatório internamente, mas não for obrigatório na UI:

- corrigir a inconsistência;
- preferencialmente gerar automaticamente um título legível.

Sugestão de título automático:

`{nome do contato}`

Fallback:

`{telefone do contato}`

Nunca usar UUID como título visível.

---

# 4. Regra definitiva: toda nova conversa vira oportunidade em Novo Lead

Esta regra substitui a limitação antiga de depender apenas de `Primeira mensagem do cliente`.

## Comportamento desejado

Toda **nova conversa** deve gerar automaticamente uma oportunidade no pipeline:

**VENDAS → Novo lead**

Isso vale para:

- conversa iniciada pelo cliente;
- conversa iniciada por alguém da equipe;
- nova conversa criada manualmente pelo CRM.

## Importante

Não adicionar etiqueta `Lead`.

A etapa `Novo lead` do pipeline já é suficiente para representar esse estado.

## Idempotência

Não criar duas oportunidades para a mesma conversa.

Regra:

- se a conversa acabou de ser criada e ainda não possui oportunidade vinculada no pipeline `VENDAS`, criar;
- se já existe oportunidade vinculada àquela conversa, não criar novamente.

Se for um contato antigo iniciando uma nova conversa comercial, a nova conversa pode gerar uma nova oportunidade, desde que não exista uma oportunidade já vinculada àquela conversa.

## Implementação

Se o trigger atual `Primeira mensagem do cliente` não cobre conversas iniciadas pela equipe, criar ou utilizar um gatilho genérico:

**Conversa criada**

ou equivalente no backend.

Esse gatilho deve funcionar independentemente da direção da primeira mensagem.

---

# 5. Compra Futura — ação rápida deve mover automaticamente o pipeline

## Estado atual mostrado nas imagens

Na conversa existe a ação rápida:

**Compra futura**

Ao clicar, abre o modal:

**Registrar compra futura**

Texto:

`Quando devemos retomar este contato?`

Com atalhos:

- Daqui 15 dias
- Daqui 30 dias
- Daqui 60 dias

E um campo de data.

Também aparece a explicação:

`A data fica na ficha do contato e é o que a automação de recompra lê. Nenhuma tarefa é criada.`

## Alteração desejada

Ao confirmar uma Compra Futura:

1. salvar a data no campo usado pela automação, atualmente `Próxima compra prevista` / `next_purchase_expected`;
2. localizar a oportunidade comercial vinculada à conversa;
3. mover automaticamente essa oportunidade para:

**VENDAS → Compra-futura**

4. não exigir que o vendedor vá até o CRM/Kanban para mover manualmente;
5. registrar a alteração no histórico da oportunidade;
6. não criar tarefa manual.

## Se não existir oportunidade vinculada

Garantir uma oportunidade em `VENDAS` para a conversa e então movê-la para `Compra-futura`.

Não criar duplicatas.

---

# 6. Compra Futura — automação correta

A automação de Compra Futura deve funcionar assim:

## Gatilho

**Oportunidade entrou na etapa**

Pipeline:

`VENDAS`

Etapa:

`Compra-futura`

## Espera

Esperar até a data do contato:

`Próxima compra prevista`

Horário:

`09:00`

Fuso:

`America/Sao_Paulo`

## Ação

Enviar o template Meta aprovado:

`comprafutura`

Idioma:

`pt_BR`

## Resposta do cliente

Se o cliente responder:

- cancelar a espera/automação;
- mover para `Em negociação` através da automação global `Cliente respondeu → Em Negociação`.

---

# 7. Erro #132000 no envio de templates — Aniversário e Compra Futura

## Erro mostrado nas imagens

No histórico da automação `Aniversário` aparece:

`(#132000) Number of parameters does not match the expected number of params`

A falha ocorre em:

`send_template`

No histórico de `Compra Futura` aparece o mesmo erro:

`(#132000) Number of parameters does not match the expected number of params`

A execução mostra, por exemplo:

- `deal_stage_entered`
- `wait — waiting until next_purchase_expected ...`
- `send_template — (#132000) Number of parameters does not match the expected number of params`

## Causa a verificar

Os templates atuais que serão utilizados foram recriados/editados sem variável de nome.

Portanto, templates que possuem **zero parâmetros** não podem receber components/parameters extras no payload enviado para a Meta.

O motor deve montar o payload com base na quantidade real de variáveis do template selecionado.

## Regra de envio

Se o template possui zero variáveis:

- não enviar body parameters;
- não enviar parâmetro vazio;
- não enviar `{{1}}`;
- não enviar array com valor default;
- respeitar exatamente o schema esperado pela Cloud API.

Se o template possui N variáveis:

- enviar exatamente N parâmetros;
- na ordem correta.

## Templates corretos utilizados atualmente

Usar os templates PT_BR aprovados e atuais:

- `followup_orcamento_d1`
- `followup_orcamento_d2`
- `followup_orcamento_d3`
- `followup_orcamento_d30`
- `reativacao30dgeladeira30d`
- `posvenda20d`
- `recompra_60d`
- `recompra_120d`
- `comprafutura`
- `aniversario`
- `atendido`

Templates antigos que não fazem parte do fluxo atual não devem ser usados nas automações:

- `followup_orcamento_d15`
- `posvenda_10d_tudo_certo`
- `reativacao_geladeira_60d`

## Aceite

Os templates `aniversario` e `comprafutura` devem ser enviados com sucesso sem erro #132000.

---

# 8. Aniversário — configuração definitiva

## Gatilho

`Data do contato chegou`

Campo:

`Aniversário`

Horário:

`09:00`

Fuso:

`America/Sao_Paulo`

## Ação

Enviar template:

`aniversario (pt_BR)`

## Regras

- não criar oportunidade;
- não mover pipeline;
- não cancelar outras automações;
- disparar uma vez por ano no aniversário daquele contato;
- não repetir duas vezes no mesmo dia para o mesmo contato.

---

# 9. Contatos — usar a mesma experiência completa de edição existente em Clientes

## Estado atual mostrado nas imagens

Ao abrir um contato pela conversa, o painel atual mostra:

- nome;
- telefone;
- e-mail;
- empresa;
- abas Dados / Etiquetas / Notas / Oportunidades;
- botão `Enviar template`.

Na área de Clientes já existe um editor mais completo chamado:

**Editar contato**

Com:

- foto;
- Nome;
- Telefone;
- E-mail;
- Empresa;
- seção `Dados comerciais`;
- Cargo;
- CNPJ;
- Cidade;
- UF;
- Aniversário;
- Origem;
- Última compra;
- Próxima prevista;
- Ciclo de recompra;
- Ticket médio;
- demais campos comerciais já existentes no componente.

## Alteração desejada

Ao editar um contato a partir de:

- Atendimento;
- CRM;
- painel lateral da conversa;
- página de contatos;

usar/reutilizar o **mesmo componente completo de Editar contato que já existe na área Clientes**.

Não manter duas experiências diferentes para editar o mesmo registro.

Não duplicar campos nem tabelas.

Todos devem editar a mesma entidade e os mesmos dados.

---

# 10. Telefone — +55 automático ao criar/editar contato

## Problema atual

Ao adicionar um contato, o usuário precisa informar manualmente o código do país.

## Alteração desejada

O Brasil deve ser o país padrão.

O usuário deve poder digitar, por exemplo:

`47999549247`

ou:

`(47) 99954-9247`

E o CRM deve normalizar e salvar:

`+5547999549247`

## Regras

- se o número não possui código do país, adicionar `+55`;
- se já começa com `+55`, não duplicar;
- se já foi informado um número internacional explícito começando com `+`, preservar o código informado;
- armazenar em formato compatível com E.164;
- continuar exibindo de maneira amigável na interface.

O usuário não deve precisar digitar `55` manualmente para números brasileiros.

---

# 11. Contato no CRM — botão grande para abrir a conversa

Ao abrir um contato pelo CRM, adicionar uma ação principal, clara e visível:

**Abrir conversa**

Esse botão deve ficar em posição de destaque no painel/modal do contato.

## Comportamento

Se existir conversa vinculada:

- abrir diretamente a conversa correta no Atendimento.

Se houver mais de uma conversa e a arquitetura permitir múltiplas:

- abrir a conversa ativa/mais recente;
- ou apresentar escolha simples somente quando realmente necessário.

Se ainda não existir conversa:

- pode aparecer `Iniciar conversa`;
- ao iniciar, aplicar também a regra automática de criação da oportunidade em `VENDAS → Novo lead`.

O objetivo é reduzir cliques para sair da ficha do contato e ir ao WhatsApp.

---

# 12. Editar oportunidade — campo Contato deve mostrar o nome, não UUID

## Problema mostrado na imagem

No modal:

**Editar oportunidade**

O campo `Contato` mostra algo como:

`eb8d692a-4f2e-4229-beb0-a2c33985b569`

Apesar de, ao abrir o dropdown, a lista mostrar corretamente os nomes dos contatos.

## Alteração desejada

O valor selecionado deve exibir o **nome do contato**.

Exemplo:

`Euclides Fernando Goncalves`

e não o UUID.

## Regra técnica

- manter o UUID/ID como valor interno;
- exibir `contact.name` / display label na interface;
- fallback para telefone se o contato não tiver nome;
- nunca mostrar UUID ao usuário como label normal.

Aplicar o mesmo padrão em qualquer outro select que estiver expondo IDs internos.

---

# 13. Rascunho de mensagem está vazando entre conversas

## Problema mostrado nas imagens

Na conversa X o usuário digita:

`Ola Ana, pode botar para estas mensagens irem pro numero`

mas não envia.

Ao abrir a conversa Y, o mesmo texto aparece no composer da conversa Y.

Isso está errado.

Cada conversa precisa ter seu próprio rascunho.

## Comportamento esperado

Se o usuário digitar na conversa X e mudar para Y:

- o texto de X não pode aparecer em Y;
- Y deve mostrar seu próprio rascunho, se existir;
- se Y não tiver rascunho, o composer deve estar vazio.

Ao voltar para X:

- o texto ainda deve estar salvo como rascunho.

## Chave de armazenamento

O estado do draft deve ser isolado por:

`conversation_id`

Nunca manter um único draft global compartilhado entre todas as conversas.

## Limpeza

O draft deve ser apagado somente quando:

- a mensagem for enviada com sucesso;
- o usuário apagar o texto;
- ou houver uma ação explícita de descarte.

Trocar de conversa não deve apagar o rascunho.

---

# 14. Mostrar “Rascunho:” na lista de conversas como no WhatsApp

## Referência visual enviada

A imagem do WhatsApp mostra na lista:

**Macrosul Embalagens Financeiro**

e abaixo:

`Rascunho: Ola tudo bem`

## Comportamento desejado

Se uma conversa possui texto digitado e ainda não enviado, a lista de conversas deve indicar isso.

Exemplo:

**Larissa Alves da Silva**

`Rascunho: Gostaria de confirmar...`

## Regras

- mostrar `Rascunho:` antes da prévia;
- usar o texto não enviado daquela conversa;
- truncar conforme o espaço disponível;
- ao enviar a mensagem, remover o indicador;
- cada rascunho deve pertencer somente à sua conversa;
- a ordenação das conversas não deve ser quebrada.

---

# 15. Playbook — botão de acesso rápido durante o atendimento

O Playbook já existe e possui conteúdo como:

- Scripts de Vendas;
- Mapa de Objeções;
- Regras da Operação;
- Produtos.

Não recriar o módulo.

## Alteração desejada

Na tela de Atendimento/conversa, criar um botão de acesso rápido:

**Playbook**

Ao clicar, abrir um drawer/modal/painel sem sair da conversa.

O vendedor deve conseguir visualizar rapidamente pelo menos:

- **Scripts**
- **Objeções**
- **Regras**

Se Produtos já estiver integrado ao mesmo Playbook, pode permanecer disponível também.

## Objetivo

Durante a conversa o vendedor não deve precisar sair da tela de Atendimento para consultar:

- como responder uma objeção;
- qual script usar;
- uma regra interna da operação.

## Ações no painel

Onde já existir:

- pesquisar;
- visualizar;
- copiar script;
- copiar resposta de objeção.

Não implementar IA automática nessa etapa.

---

# 16. Revisão completa das automações — modelo comercial oficial

Revisar todas as automações atuais do CRM para garantir que o comportamento abaixo seja exatamente o comportamento real.

Não confiar apenas no nome do card.

Validar:

- trigger salvo;
- regras;
- waits;
- template selecionado;
- stage IDs;
- cancelamentos;
- reentrada;
- actions;
- status ativo/inativo;
- payload final enviado;
- logs de execução.

---

# 17. Automação 1 — Nova conversa → Novo Lead

## Objetivo

Toda conversa nova, inbound ou outbound, deve criar uma oportunidade.

## Gatilho

Preferir:

`Conversa criada`

ou evento equivalente que cubra:

- cliente iniciando;
- equipe iniciando;
- conversa criada manualmente.

## Ação

Criar oportunidade:

- Pipeline: `VENDAS`
- Etapa: `Novo lead`
- Valor: `0`

Não adicionar etiqueta `Lead`.

## Idempotência

Uma oportunidade por conversa.

Não duplicar ao receber novas mensagens na mesma conversa.

## Status final

Esta automação/regra deve conseguir ficar **ATIVA** sem o erro:

`Cannot keep automation active with invalid configuration`

---

# 18. Automação 2 — /aberto → Em Aberto

## Gatilho

`Mensagem enviada pela equipe`

Resposta rápida:

`/aberto`

## Ação

Mover a oportunidade vinculada à conversa para:

`VENDAS → Em aberto`

---

# 19. Automação 3 — Em Aberto, 24 h sem resposta

## Gatilho

`Oportunidade entrou na etapa`

Pipeline:

`VENDAS`

Etapa:

`Em aberto`

## Regras

`Cancelar quando o cliente responder`: ATIVO

Cancelar também se a oportunidade entrar em:

- `Em negociação`
- `Ligação`
- `Em andamento`
- `Atendido`
- `Compra-futura`
- `Venda perdida`

## Fluxo

1. esperar 24 horas;
2. se a execução ainda estiver válida;
3. mover oportunidade para `Follow-up`.

Não enviar D1 nesta automação.

---

# 20. Automação 4 — Follow-up completo

## Gatilho

`Oportunidade entrou na etapa`

Pipeline:

`VENDAS`

Etapa:

`Follow-up`

## Regras

`Cancelar quando o cliente responder`: ATIVO

Cancelar quando entrar em:

- `Em negociação`
- `Ligação`
- `Em andamento`
- `Atendido`
- `Compra-futura`
- `Venda perdida`

## Fluxo definitivo

1. enviar template `followup_orcamento_d1`;
2. esperar 1 dia;
3. enviar template `followup_orcamento_d2`;
4. esperar 1 dia;
5. enviar template `followup_orcamento_d3`;
6. esperar 27 dias;
7. enviar template `followup_orcamento_d30`;
8. mover imediatamente para `Geladeira-30D`;
9. encerrar automação.

## Importante

O fluxo oficial não utiliza mais:

- D15;
- D10;
- mensagens diárias D4–D10.

O modelo atual é:

`D1 → D2 → D3 → D30`

Como são mensagens automáticas fora da janela de 24h, utilizar templates aprovados da Meta.

---

# 21. Automação 5 — Cliente respondeu → Em Negociação

## Gatilho

`Mensagem recebida`

Pipeline:

`VENDAS`

## Executar somente quando a oportunidade estiver em:

- `Em aberto`
- `Follow-up`
- `Compra-futura`
- `Geladeira-30D`
- `Geladeira-60D`

Não aplicar automaticamente em:

- `Novo lead`
- `Em negociação`
- `Ligação`
- `Em andamento`
- `Atendido`
- `Pós-venda`
- `Venda perdida`

## Cancelar automações

Cancelar somente para **esta oportunidade**:

- `Compra Futura`
- `Em Aberto, 24 h sem resposta`
- `Follow-up completo`
- `Geladeira 30D → reativação → Geladeira 60D`

## Ação

Mover para:

`Em negociação`

## Final

Encerrar com motivo técnico:

`cliente_respondeu`

---

# 22. Automação 6 — Geladeira 30D → reativação → Geladeira 60D

## Gatilho

`Oportunidade entrou na etapa`

Pipeline:

`VENDAS`

Etapa:

`Geladeira-30D`

## Regras

Cancelar quando o cliente responder.

Cancelar se entrar em:

- `Em negociação`
- `Ligação`
- `Em andamento`
- `Atendido`
- `Compra-futura`
- `Venda perdida`

## Fluxo

1. esperar 30 dias;
2. enviar template `reativacao30dgeladeira30d`;
3. mover para `Geladeira-60D`;
4. encerrar.

---

# 23. Automação 7 — /andamento → Em Andamento

## Significado

Esse comando representa:

**o cliente comprou.**

## Gatilho

`Mensagem enviada pela equipe`

Resposta rápida:

`/andamento`

## Ações

1. mover oportunidade para `Em andamento`;
2. adicionar etiqueta `Cliente`;
3. cancelar para **esta oportunidade**:
   - `Compra Futura`
   - `Em Aberto, 24 h sem resposta`
   - `Follow-up completo`
   - `Geladeira 30D → reativação → Geladeira 60D`
4. encerrar.

Não adicionar/remover etiqueta `Lead`.

Não duplicar etiqueta `Cliente`.

---

# 24. Automação 8 — /atendido → Atendido

## Gatilho

`Mensagem enviada pela equipe`

Resposta rápida:

`/atendido`

## Ação

Mover oportunidade para:

`Atendido`

## Cancelar para esta oportunidade

- `Compra Futura`
- `Em Aberto, 24 h sem resposta`
- `Follow-up completo`
- `Geladeira 30D → reativação → Geladeira 60D`

---

# 25. Automação 9 — Pós-venda e recompra

## Gatilho

`Oportunidade entrou na etapa`

Pipeline:

`VENDAS`

Etapa:

`Atendido`

## Fluxo correto

1. esperar 20 dias;
2. enviar template `posvenda20d`;
3. mover oportunidade para `Pós-venda`;
4. esperar mais 40 dias;
5. enviar `recompra_60d`;
6. esperar mais 60 dias;
7. enviar `recompra_120d`;
8. encerrar.

## Importante

Os tempos são acumulados desde a entrada em Atendido:

- D20 = Pós-venda
- D60 = Recompra
- D120 = Recompra

Mover para Pós-venda no D20 não pode cancelar os waits D60/D120.

---

# 26. Automação 10 — Compra Futura

Resumo:

`Entrou em Compra-futura → esperar até Próxima compra prevista às 09:00 → enviar comprafutura (pt_BR) → encerrar`

Se responder:

`→ Em negociação`

A ação rápida `Registrar compra futura` deve mover a oportunidade para essa etapa automaticamente.

---

# 27. Automação 11 — Aniversário

Resumo:

`Data do contato chegou → Aniversário → 09:00 America/Sao_Paulo → enviar aniversario (pt_BR)`

Sem mudança de pipeline.

---

# 28. Automação 12 — Venda Perdida

## Gatilho

`Oportunidade entrou na etapa`

Pipeline:

`VENDAS`

Etapa:

`Venda perdida`

## Cancelar para esta oportunidade

- `Compra Futura`
- `Em Aberto, 24 h sem resposta`
- `Follow-up completo`
- `Geladeira 30D → reativação → Geladeira 60D`

## Encerrar

Motivo técnico:

`oportunidade_movida_para_venda_perdida`

---

# 29. Venda Perdida — motivo obrigatório

Ao tentar mover uma oportunidade para:

`Venda perdida`

abrir um modal antes de concluir.

## Motivos

- Preço
- Frete
- Prazo
- Concorrente
- Sem necessidade no momento
- Produto não atende
- Desistiu
- Outro

Se escolher `Outro`:

- exigir descrição.

## Regras

- não permitir concluir sem motivo;
- salvar o motivo na oportunidade;
- registrar no histórico;
- se cancelar o modal, manter a oportunidade na etapa anterior.

---

# 30. Bug conhecido — seletor “Mover oportunidade de etapa”

Durante a configuração das automações ocorreu um bug em que a ação:

`Mover oportunidade de etapa`

não permitia selecionar uma etapa real ou exibia ID/UUID em vez do nome.

Mesmo que já exista uma correção em andamento, revisar antes de concluir este pacote.

## Resultado esperado

No dropdown mostrar nomes legíveis das etapas.

Internamente continuar usando UUID/ID.

Depois da correção, garantir que todas as automações acima possuem `stage_id` real e válido nas actions.

---

# 31. Auditoria final obrigatória das automações

A tela atual possui cards como:

- Venda Perdida
- Aniversário
- Compra Futura
- Pós-venda e recompra
- /atendido → Atendido
- Cliente respondeu → Em Negociação
- Geladeira 30D → reativação → Geladeira 60D
- Follow-up completo
- Em Aberto, 24 h sem resposta
- Novo contato → Novo Lead
- /andamento → Em Andamento
- /aberto → Em Aberto

Verificar em cada uma:

- configuração válida;
- trigger correto;
- pipeline correto;
- etapa correta;
- action stage_id existente;
- template correto;
- idioma correto;
- quantidade correta de parâmetros do template;
- cancelamento correto;
- waits corretos;
- reentrada correta;
- sem loops;
- sem duplicação de oportunidades;
- sem cancelar automações que não devem ser canceladas;
- logs compreensíveis.

Somente ativar automaticamente uma automação se ela estiver 100% válida.

Se houver configuração inválida:

- mostrar qual bloco está inválido;
- mostrar qual campo falta;
- evitar erro genérico sem explicação.

---

# 32. Cenários mínimos de teste

## Cenário A — Cliente novo inbound

1. número novo envia mensagem;
2. conversa é criada;
3. oportunidade é criada uma única vez em `VENDAS → Novo lead`;
4. mensagens seguintes não criam novas oportunidades.

## Cenário B — Equipe inicia conversa

1. equipe cria/inicia nova conversa;
2. oportunidade é criada automaticamente em `VENDAS → Novo lead`;
3. não depende de mensagem recebida do cliente.

## Cenário C — Orçamento

1. equipe envia `/aberto`;
2. oportunidade vai para `Em aberto`;
3. 24h sem resposta;
4. vai para `Follow-up`;
5. D1;
6. D2;
7. D3;
8. D30;
9. move para `Geladeira-30D`.

## Cenário D — Resposta durante Follow-up

1. cliente responde;
2. waits são cancelados;
3. mensagens futuras não são enviadas indevidamente;
4. oportunidade vai para `Em negociação`.

## Cenário E — Geladeira

1. entra em `Geladeira-30D`;
2. espera 30 dias;
3. envia `reativacao30dgeladeira30d`;
4. move para `Geladeira-60D`.

## Cenário F — Compra Futura

1. vendedor usa ação rápida Compra futura;
2. escolhe data;
3. data é salva;
4. oportunidade é movida automaticamente para `Compra-futura`;
5. espera até a data;
6. envia `comprafutura`;
7. sem erro #132000;
8. se responder, vai para `Em negociação`.

## Cenário G — Aniversário

1. contato possui aniversário hoje;
2. 09:00 America/Sao_Paulo;
3. envia `aniversario`;
4. sem erro #132000;
5. não cria oportunidade;
6. não move pipeline.

## Cenário H — Venda

1. equipe envia `/andamento`;
2. oportunidade vai para `Em andamento`;
3. contato recebe etiqueta `Cliente`;
4. follow-up/geladeira/compra futura pendentes são cancelados.

## Cenário I — Atendido/Pós-venda

1. equipe envia `/atendido`;
2. vai para `Atendido`;
3. D20 envia `posvenda20d`;
4. move para `Pós-venda`;
5. D60 ainda executa;
6. D120 ainda executa;
7. último envio usa `recompra_120d`.

## Cenário J — Venda perdida

1. vendedor tenta mover para Venda perdida;
2. modal exige motivo;
3. sem motivo não conclui;
4. com motivo salva e move;
5. automações comerciais pendentes são canceladas.

## Cenário K — Draft por conversa

1. digitar texto na conversa X;
2. não enviar;
3. abrir conversa Y;
4. Y não recebe o texto de X;
5. voltar para X;
6. draft continua em X;
7. lista mostra `Rascunho: ...`;
8. enviar;
9. indicador desaparece.

## Cenário L — Contato

1. abrir contato;
2. editor completo é o mesmo usado em Clientes;
3. telefone brasileiro sem 55 é normalizado para +55;
4. clicar `Abrir conversa`;
5. abrir conversa correta.

## Cenário M — Oportunidade

1. abrir Editar oportunidade;
2. campo Contato exibe nome;
3. não exibe UUID;
4. internamente mantém o ID correto.

---

# 33. Critérios de aceite finais

Considerar o pacote concluído apenas quando:

- o alerta de ocorrência não mostrar mais a frase curta indesejada;
- toda nova conversa gerar uma oportunidade em Novo lead sem duplicar;
- a automação de novo lead puder ficar ativa sem erro de configuração;
- Compra Futura mover automaticamente o pipeline;
- Aniversário funcionar;
- Compra Futura funcionar;
- não existir erro Meta #132000 nos templates atuais;
- o editor de contatos estiver unificado;
- +55 for automático para contatos brasileiros;
- existir CTA grande para abrir conversa;
- o campo Contato em oportunidade mostrar nome e não UUID;
- drafts forem isolados por `conversation_id`;
- `Rascunho:` aparecer na lista de conversas;
- existir acesso rápido ao Playbook na conversa;
- todas as automações do fluxo oficial estiverem válidas e alinhadas;
- nenhum stage_id de automação estiver vazio;
- nenhuma automação depender de template antigo;
- logs de execução mostrarem o passo e erro real quando houver falha.

---

# 34. Ordem recomendada de execução

## P0 — bugs que bloqueiam operação

1. corrigir `Cannot keep automation active with invalid configuration`;
2. corrigir seletor/stage_id de `Mover oportunidade de etapa`;
3. corrigir erro Meta `#132000`;
4. corrigir Compra Futura para mover etapa automaticamente;
5. implementar criação automática de oportunidade para toda conversa nova;
6. revisar/validar todas as automações.

## P1 — experiência de atendimento

7. corrigir drafts por conversa;
8. mostrar `Rascunho:` na lista;
9. unificar editor de contatos;
10. +55 automático;
11. botão grande `Abrir conversa`;
12. corrigir nome do contato em Editar oportunidade.

## P2 — produtividade

13. botão rápido de Playbook no Atendimento;
14. remover descrição curta do alerta de ocorrência;
15. revisão visual final e testes de regressão.

---

# 35. Não fazer

Não:

- criar um segundo pipeline de vendas;
- adicionar etiqueta Lead automaticamente;
- recriar o módulo Playbook;
- recriar a tabela de Produtos;
- criar tarefas para Compra Futura;
- usar templates antigos D15;
- voltar para follow-up D1–D10 diário;
- usar `reativacao_geladeira_60d` no fluxo atual;
- usar `posvenda_10d_tudo_certo` no fluxo atual;
- enviar parâmetros fictícios para templates sem variáveis;
- salvar UUID como texto visível ao usuário;
- compartilhar um único estado de draft entre conversas;
- criar oportunidade duplicada a cada mensagem.

---

# 36. Fluxo comercial oficial resumido

```text
NOVA CONVERSA
      ↓
VENDAS / NOVO LEAD
      ↓
equipe envia /aberto
      ↓
EM ABERTO
      ↓ 24h sem resposta
FOLLOW-UP
      ↓
D1
      ↓ 1 dia
D2
      ↓ 1 dia
D3
      ↓ 27 dias
D30
      ↓
GELADEIRA 30D
      ↓ 30 dias
REATIVAÇÃO
      ↓
GELADEIRA 60D
```

Se o cliente responder enquanto estiver em:

- Em aberto
- Follow-up
- Compra-futura
- Geladeira-30D
- Geladeira-60D

resultado:

```text
RESPOSTA
   ↓
cancelar sequência pendente
   ↓
EM NEGOCIAÇÃO
```

Se comprar:

```text
/andamento
   ↓
EM ANDAMENTO
   ↓
+ etiqueta Cliente
```

Quando o pedido for atendido/enviado:

```text
/atendido
   ↓
ATENDIDO
   ↓
D20 → Pós-venda
D60 → Recompra
D120 → Recompra
```

Se combinar compra futura:

```text
Registrar Compra Futura
   ↓
salvar data
   ↓
mover automaticamente para Compra-futura
   ↓
esperar a data
   ↓
enviar comprafutura
```

Se não for comprar:

```text
Venda perdida
   ↓
motivo obrigatório
   ↓
cancelar automações pendentes
```

---

# 37. Chat Interno — simplificar visual para ficar como “Minha equipe”

## Referência atual

Hoje a área/card de **Chat Interno** aparece como um bloco mais carregado, semelhante a:

- avatar/foto;
- título `Chat Interno`;
- nome da pessoa;
- data;
- prévias de várias mensagens;
- múltiplas linhas de conteúdo.

Exemplo visual transcrito da referência atual:

```text
[avatar] Chat Interno
         Gabriel   2 de set.
         Áudio
         Você      2 de set.
         cude
         Gabriel   08:57
         Aooo potencia
```

Esse formato está visualmente poluído e ocupa espaço demais no menu/atalho.

## Referência desejada

A área deve seguir o mesmo padrão simples já utilizado no card:

**Minha equipe**

Com estrutura semelhante a:

```text
[ícone] Minha equipe
        Conversa interna da PlastfortSul
```

## Alteração desejada

Transformar o card/atalho de `Chat Interno` em um componente simples, compacto e consistente com `Minha equipe`.

Exemplo esperado:

```text
[ícone] Chat Interno
        Conversas internas da PlastfortSul
```

ou, se fizer mais sentido manter o nome atual da área:

```text
[ícone] Minha equipe
        Conversas internas da PlastfortSul
```

A decisão de nomenclatura deve respeitar a rota e arquitetura já existentes, sem quebrar navegação.

## O card NÃO deve mostrar

Remover do card resumido:

- nome da última pessoa;
- data da última mensagem;
- prévia de áudio;
- prévia de texto;
- múltiplas mensagens empilhadas;
- histórico resumido dentro do próprio card;
- avatar/foto individual da última pessoa, se isso deixar o componente diferente de `Minha equipe`.

Essas informações continuam existindo dentro do chat interno ao abrir a área, mas não precisam aparecer no atalho do menu.

## Visual

Reutilizar o componente/estilo já usado em `Minha equipe` sempre que possível:

- mesmo tamanho;
- mesma altura;
- mesmo padding;
- mesma borda;
- mesmo raio;
- mesmo padrão de ícone;
- mesmo alinhamento;
- título em destaque;
- subtítulo curto;
- estado ativo com o mesmo padrão visual;
- responsividade igual.

Não criar um terceiro padrão visual.

## Comportamento

Ao clicar no card:

- abrir a área de chat interno normalmente;
- preservar todas as conversas internas existentes;
- não apagar histórico;
- não alterar participantes;
- não alterar mensagens;
- não alterar permissões.

A mudança é principalmente de apresentação e consistência visual no acesso ao recurso.

## Critério de aceite

Considerar concluído quando:

- `Chat Interno` estiver visualmente tão simples quanto `Minha equipe`;
- não houver várias linhas de prévia no card;
- o card mostrar apenas ícone + título + subtítulo;
- o clique continuar abrindo corretamente o chat interno;
- nenhum histórico interno for perdido.

---

# 38. Nova oportunidade — simplificar formulário e preparar orçamento comercial

Esta alteração deve ser feita agora como base para o próximo passo do projeto: criar o orçamento diretamente pelo CRM e, posteriormente, integrar esse fluxo ao Bling.

A integração automática CRM → Bling **não faz parte desta etapa**. Primeiro estruturar corretamente a oportunidade e o orçamento dentro do CRM.

## Referência atual da tela

Hoje o modal **Nova oportunidade** possui:

- Título
- Contato
- Vincular a uma conversa
- Valor
- Moeda
- Previsão de fechamento
- Etapa
- Responsável
- seção `O que tem nesta oportunidade`
- botão `Adicionar linha`
- Observações

A referência visual enviada mostra também a seção:

`O que tem nesta oportunidade`

com o estado vazio:

`Sem linhas. O valor acima é o que alguém digitou.`

Esse modelo deve ser simplificado.

---

# 39. Trocar “Título” por “Pedido de venda”

No formulário de oportunidade, substituir o campo visível:

`Título`

por:

**Pedido de venda**

Esse campo será utilizado para informar o número do pedido/orçamento que hoje é controlado no Bling.

Exemplo:

`14349`

## Regra

- o label mostrado ao usuário deve ser `Pedido de venda`;
- não exibir `Título da oportunidade`;
- internamente pode continuar usando o campo existente de título se isso evitar migration desnecessária;
- aceitar números e texto;
- neste primeiro momento, o número poderá ser digitado manualmente.

---

# 40. Contato deve vir preenchido automaticamente pela conversa

Quando a oportunidade for criada a partir de uma conversa:

- preencher automaticamente o contato daquela conversa;
- não exigir que o vendedor procure o contato novamente;
- manter o vínculo entre oportunidade, contato e conversa;
- se a tela for aberta fora de uma conversa, permitir selecionar o contato normalmente.

## Resultado esperado

Ao abrir `Nova oportunidade` dentro da conversa de João:

`Contato: João`

já deve aparecer selecionado.

---

# 41. Remover campos que não fazem sentido para o fluxo atual

Remover da interface de criação/edição simplificada:

- `Moeda`
- `Previsão de fechamento`

A moeda utilizada operacionalmente é BRL e não precisa ocupar espaço na interface.

Se o backend precisar continuar armazenando moeda:

- usar `BRL` como padrão;
- manter isso internamente.

Não excluir dados históricos existentes.

---

# 42. Etapa da oportunidade

A etapa continua necessária no modelo do CRM, mas não precisa poluir o novo formulário simplificado.

## Comportamento recomendado

Ao criar uma oportunidade nova:

- usar `VENDAS → Novo lead` como etapa padrão quando não houver etapa explícita;
- se a oportunidade já estiver em outra etapa, preservar a etapa existente ao editar;
- a movimentação principal de etapa continua sendo feita pelo pipeline e pelas automações.

Se a arquitetura atual exigir o campo de etapa no formulário, mantê-lo de forma discreta, sem quebrar a ordem comercial definida abaixo.

---

# 43. Remover “O que tem nesta oportunidade”

Remover da interface a seção atual:

**O que tem nesta oportunidade**

Remover também:

- `Adicionar linha`
- `Sem linhas. O valor acima é o que alguém digitou.`

Essa área será substituída pela nova estrutura objetiva de produto/orçamento.

Não deixar dois sistemas diferentes de itens dentro da mesma oportunidade.

---

# 44. Nova ordem dos campos da oportunidade

Depois do identificador `Pedido de venda` e do contato automático, organizar os campos comerciais nesta ordem:

1. **Produto**
2. **Valor**
3. **Frete**
4. **Transportador**
5. **Responsável**
6. **Observações**

A interface deve ficar limpa, curta e prática para preenchimento durante o atendimento.

---

# 45. Campo Produto

Adicionar/usar um campo claro chamado:

**Produto**

O campo deve utilizar os produtos já cadastrados no CRM.

Não criar uma segunda base de produtos.

## Comportamento desejado

Permitir:

- pesquisar produto;
- selecionar produto;
- visualizar nome;
- utilizar SKU/ID internamente;
- manter vínculo real com o produto cadastrado.

Se uma oportunidade puder possuir mais de um produto, permitir múltiplos itens de forma simples.

Para cada item, preparar a estrutura para armazenar futuramente:

- produto;
- SKU;
- quantidade;
- valor unitário;
- subtotal.

---

# 46. Campo Valor

Campo:

**Valor**

Deve representar o valor comercial dos produtos da oportunidade.

Preferência:

- calcular automaticamente a partir dos itens quando houver quantidade e valor unitário;
- permitir ajuste manual apenas se necessário pela arquitetura atual.

Exibição:

`R$ 625,00`

Não mostrar campo separado de moeda.

---

# 47. Campo Frete

Adicionar campo:

**Frete**

Exemplo:

`R$ 120,00`

O valor do frete deve ficar separado do valor dos produtos para que o orçamento mostre claramente:

- subtotal dos produtos;
- frete;
- total.

Preparar cálculo:

`Total = produtos + frete`

---

# 48. Campo Transportador

Adicionar campo:

**Transportador**

Objetivo:

registrar qual transportadora fará a entrega.

O campo deve preferencialmente reutilizar contatos/cadastros classificados como Transportadora, caso essa estrutura já exista.

Permitir também estados como:

- Cliente retira
- A definir

Não criar uma segunda base de transportadoras sem antes verificar os cadastros existentes.

---

# 49. Campo Responsável

Manter:

**Responsável**

Esse é o vendedor/responsável pela oportunidade.

Deve utilizar a equipe já cadastrada no CRM.

---

# 50. Campo Observações

Manter:

**Observações**

Esse campo será usado para informações comerciais importantes, como:

- prazo;
- condição específica;
- orientação sobre entrega;
- detalhes combinados;
- informações adicionais.

Permitir texto em múltiplas linhas.

---

# 51. Preparar a oportunidade para gerar orçamento dentro do CRM

A nova estrutura da oportunidade deve ser preparada para gerar um orçamento visual diretamente no CRM.

A integração automática com Bling será feita em etapa futura.

## Novo botão

Na oportunidade, adicionar ou preparar a ação:

**Gerar orçamento**

ou:

**Visualizar orçamento**

Não é necessário conectar ao Bling nesta entrega.

O objetivo desta fase é conseguir montar o documento/arte a partir dos dados já preenchidos na oportunidade.

---

# 52. Orçamento atual usado pela PlastfortSul — referência transcrita

Hoje o processo utiliza um print do documento gerado no Bling.

A referência enviada contém:

## Cabeçalho

- logo `PLASTFORT`
- identificação `Embalagens Agrícolas`
- site da empresa
- e-mail
- telefone
- título central `Pedido 14349`
- código de barras

## Dados comerciais

- Cliente
- Vendedor
- Número do pedido
- Data
- Data prevista

## Itens do pedido

Tabela com colunas semelhantes a:

- Descrição do produto/serviço
- Código
- Un.
- Qtd.
- Valor unitário
- Valor total

Exemplos visíveis:

- `Abraçadeira plástica com UV preta - 100 unidades`
- `Sacos para silagem 51x110 branco - 100 unidades`

Também mostra:

- Nº de itens
- Total de produtos
- Total do pedido

## Pagamento

Tabela de parcelas com:

- Dias
- Data vencimento
- Forma de pagamento
- Valor
- Observação

## Transporte

- Transportador
- Nome
- Modalidade do frete

## Observações

Exemplo:

`Prazo:`

## Rodapé

Existe ainda uma área de recebimento/assinatura com:

- data de recebimento;
- assinatura do recebedor;
- número do pedido;
- valor total.

---

# 53. Novo orçamento deve ser mais clean e profissional

Não copiar literalmente o layout antigo do Bling.

Criar um orçamento com visual mais moderno, limpo e adequado para ser enviado pelo WhatsApp.

## Objetivo visual

O cliente deve conseguir entender o orçamento em poucos segundos.

Priorizar:

- identidade da PlastfortSul;
- leitura fácil no celular;
- espaço em branco;
- tipografia clara;
- poucos blocos;
- valores destacados;
- total bem visível;
- sem aparência de formulário administrativo antigo;
- sem excesso de linhas e grades.

---

# 54. Estrutura desejada do novo orçamento

## Cabeçalho

- logo PlastfortSul;
- título **ORÇAMENTO**;
- número do pedido de venda;
- data;
- dados essenciais da empresa.

## Cliente

Exibir:

- nome do cliente;
- empresa, se houver;
- telefone, quando fizer sentido.

## Produtos

Para cada produto:

- nome;
- variação/medida/cor quando aplicável;
- quantidade;
- valor unitário;
- subtotal.

Se possível, preparar suporte para uma pequena imagem do produto no futuro.

## Resumo financeiro

Mostrar claramente:

- Produtos
- Frete
- **Total**

O Total deve ter destaque visual.

## Entrega

Mostrar:

- Transportador
- Prazo de envio/produção
- informação de entrega relevante

## Responsável

Mostrar o vendedor responsável de forma discreta.

## Observações

Mostrar apenas se existir conteúdo.

## Rodapé

- contato da PlastfortSul;
- site;
- mensagem institucional curta, se necessário.

Não incluir área de assinatura física/recebimento no orçamento enviado pelo WhatsApp.

Não incluir código de barras se ele não tiver função real nessa etapa.

---

# 55. Formatos do orçamento

Preparar para gerar pelo menos:

## Visual para WhatsApp

Uma versão otimizada para visualização pelo celular.

Preferência por:

- imagem vertical de boa resolução; ou
- PDF de uma página com proporção amigável.

## PDF

Também gerar PDF profissional para:

- arquivo;
- download;
- envio formal;
- impressão quando necessário.

Imagem e PDF devem utilizar os mesmos dados.

Não manter dois cálculos independentes.

---

# 56. Fluxo desejado nesta fase

```text
CONVERSA / CRM
      ↓
OPORTUNIDADE
      ↓
Pedido de venda
Contato automático
Produto(s)
Valor
Frete
Transportador
Responsável
Observações
      ↓
GERAR ORÇAMENTO
      ↓
prévia clean e profissional
      ↓
enviar ao cliente pelo CRM
```

A integração com o Bling será definida em uma segunda etapa.

---

# 57. Preparação para futura integração com Bling

Embora a integração não deva ser implementada agora, estruturar os dados para facilitar a próxima etapa.

Evitar armazenar tudo apenas como texto solto.

Quando possível, manter campos estruturados para:

- número do pedido de venda;
- contact_id;
- conversation_id;
- responsável;
- produtos;
- product_id/SKU;
- quantidade;
- valor unitário;
- subtotal;
- frete;
- transportador;
- total;
- observações;
- status;
- stage_id.

Posteriormente, esses dados serão utilizados para criar/atualizar o Pedido de Venda no Bling sem o usuário precisar digitar tudo novamente.

Não implementar chamadas à API do Bling nesta fase.

---

# 58. Critérios de aceite desta nova oportunidade

Considerar esta parte concluída quando:

- `Título` tiver sido substituído visualmente por `Pedido de venda`;
- contato vier preenchido automaticamente ao abrir pela conversa;
- `Moeda` não aparecer mais;
- `Previsão de fechamento` não aparecer mais;
- `O que tem nesta oportunidade` tiver sido removido;
- `Adicionar linha` antigo tiver sido removido;
- os dados comerciais estiverem organizados em:
  Produto → Valor → Frete → Transportador → Responsável → Observações;
- produtos reutilizarem a base já existente;
- a oportunidade continuar vinculada corretamente ao pipeline;
- os dados estiverem estruturados para futura integração com Bling;
- existir uma primeira versão de `Gerar/Visualizar orçamento`;
- o orçamento tiver visual mais clean e profissional que o print atual;
- o orçamento puder ser visualizado/enviado a partir do CRM;
- nenhuma integração automática com Bling for adicionada ainda.

---

# 59. Não fazer nesta etapa

Não:

- integrar com a API do Bling ainda;
- criar pedido automaticamente no Bling ainda;
- duplicar produtos;
- duplicar contatos;
- apagar campos históricos do banco apenas porque saíram da interface;
- usar o layout antigo do Bling como novo design;
- adicionar código de barras sem necessidade;
- adicionar assinatura física de recebimento ao orçamento;
- criar um segundo módulo de oportunidade;
- quebrar as automações do pipeline VENDAS existentes.
