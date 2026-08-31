# Revisão 0.8.4 — 24 de agosto de 2026

Onze pedidos numa lista só, com quatro prints junto — e um décimo
segundo e um décimo terceiro depois, mais cinco na sequência, e por fim
uma lista de sete pedidos de uma vez com a instrução de concluir tudo sem
perguntar nada. Esta passagem responde os vinte e seis.

## Os documentos

| Arquivo | O que tem dentro |
| ------- | ---------------- |
| [01-worklog.md](01-worklog.md) | Cada mudança, agrupada pelo pedido que a causou |
| [02-pendencias.md](02-pendencias.md) | O que **não** foi feito, e o que falta aplicar |
| [03-verificacao.md](03-verificacao.md) | O que foi medido e o que ninguém viu rodando |
| [04-personalizacao.md](04-personalizacao.md) | O estudo pedido no item 7 — nada dele implementado |
| [05-plano.md](05-plano.md) | O plano da passagem noturna (itens 18–26) |
| [06-mercado-brasileiro.md](06-mercado-brasileiro.md) | O que falta, para o mercado brasileiro — análise, nada implementado |
| [07-plano-produtos-comparado.md](07-plano-produtos-comparado.md) | O plano de Produtos (uma sessão de chat, não um arquivo) contra o que foi construído |
| [08-auditoria-front.md](08-auditoria-front.md) | Auditoria geral: o que estava no banco e não chegava na tela, e o sistema de identificação e posição |

## O pedido, item por item

| # | Pedido | Onde foi parar |
| - | ------ | -------------- |
| 1 | Foto do perfil não puxa aqui nem no chat da equipe | Feito — [§1](01-worklog.md#1-a-foto-que-existia-e-não-aparecia) |
| 2 | Nome acima menor, foco na mensagem | Feito — [§2](01-worklog.md#2-o-nome-era-um-título-virou-legenda) |
| 3 | Otimizar e liberar a edição da Minha equipe | Feito — [§3](01-worklog.md#3-editar-e-apagar-na-sala-da-equipe) |
| 4 | Transcrição automática de áudio e imagem | Feito — [§4](01-worklog.md#4-palavras-para-as-mensagens-que-não-têm-nenhuma) · **migração 049** |
| 5 | Gráficos dos relatórios mais harmônicos | Feito — [§5](01-worklog.md#5-os-gráficos-falando-a-mesma-língua) |
| 6 | Caixas de texto do chat + status no avatar | Feito — [§6](01-worklog.md#6-a-caixa-de-texto-e-o-ponto-no-avatar) |
| 7 | Estudar personalização por perfil | **Estudo entregue**, nada implementado — [04](04-personalizacao.md) |
| 8 | Auditoria de conta | Feito — [§8](01-worklog.md#8-auditoria-de-conta) · **migração 050** |
| 9 | Último acesso | Feito — [§9](01-worklog.md#9-último-acesso) |
| 10 | Remover a aba que abre no avatar | Feito — [§10](01-worklog.md#10-o-painel-na-equipe-agora-saiu) |
| 11 | Configuração de visibilidade e permissões | Feito — [§11](01-worklog.md#11-acesso-e-permissões) · **migração 050** |
| 12 | Logo do WhatsApp onde for referente a ele | Feito — [§12](01-worklog.md#12-o-logo-do-whatsapp-onde-é-whatsapp) |
| 13 | Foto repetida no pé da barra lateral | Feito — [§13](01-worklog.md#13-a-mesma-cara-duas-vezes-no-pé-da-rail) |
| 14 | Ajuste de alinhamento na auditoria | Feito — [§14](01-worklog.md#14-três-alturas-numa-linha-só) |
| 15 | Aba própria para a atribuição automática | Feito — [§15](01-worklog.md#15-atribuição-automática-ganha-uma-aba) · **migração 051** |
| 16 | Nome, descrição e novas salas internas | Feito — [§16](01-worklog.md#16-salas-internas-com-nome-e-descrição) · **migração 052** |
| 17 | Três linhas e o número de mensagens no card | Feito — [§17](01-worklog.md#17-três-linhas-e-um-número-no-card-da-equipe) |
| 18 | Nome do autor acima da mensagem, não ao lado | Feito — [§18](01-worklog.md#18-o-nome-acima-da-mensagem) |
| 19 | Agente IA robusto: tools, RAG, prompt, passos | Feito — [§19](01-worklog.md#19-o-agente-ia-em-profundidade) · **migração 053** |
| 20 | IA de apoio ao atendente, na mensagem do cliente | Feito — [§20](01-worklog.md#20-ia-de-apoio-na-mensagem-do-cliente) |
| 21 | Produtos | Feito — [§21](01-worklog.md#21-produtos) · **migração 054** |
| 22 | CNPJ conferido e duplicata avisada | Feito — [§22](01-worklog.md#22-cnpj-conferido-e-a-duplicata-avisada) |
| 23 | Relatórios com outro desenho | Feito — [§23](01-worklog.md#23-relatórios-outro-desenho) |
| 24 | Mobile e tablet | Feito — [§24](01-worklog.md#24-mobile-e-tablet) |
| 25 | Harmonia nas outras seções | Parcial — [§25](01-worklog.md#25-harmonia-nas-outras-seções) |
| 26 | O que falta no mercado brasileiro | **Análise** — [06](06-mercado-brasileiro.md) |
| 27 | Analisar o plano de Produtos marcado | Feito, e três divergências corrigidas — [§26](01-worklog.md#26-o-plano-de-produtos-encontrado--e-as-divergências-corrigidas) · **migração 055** |
| 28 | Envio no modelo do WhatsApp: tique e nome de quem respondeu | Feito — [§27](01-worklog.md#27-o-modelo-do-whatsapp-na-lista--e-a-autoria-que-nunca-foi-gravada) · **migração 056** |
| 29 | Pipeline sem paleta de cores para modificar | Feito — [§28](01-worklog.md#28-a-paleta-de-cores-que-estava-lá-o-tempo-todo-fora-da-caixa) |
| 30 | Toda mensagem nova vai para Esperando | Regra já existia; os dados semeados é que a contrariavam — corrigidos os dados **e** o seeder |
| 31 | Separar as funções de IA do Agente IA | Feito — [§29](01-worklog.md#29-a-ia-de-apoio-sai-de-dentro-do-agente-ia) · **migração 057** |
| 32 | Auditoria geral do front + UX e posição das ferramentas | [08](08-auditoria-front.md) — quatro buracos fechados, vocabulário de ícones unificado |
| 33 | Refatorar o UX do mobile | Feito — [§30](01-worklog.md#30-a-navegação-do-celular-desceu-para-o-polegar) |
| 34 | Refazer os gráficos dos relatórios | Feito — [§31](01-worklog.md#31-os-gráficos-o-funil-e-a-legenda-que-virou-leitura) · [§32](01-worklog.md#32-a-comparação-com-o-período-anterior) |
| 35 | Caixa do navegador ao apagar mensagem da equipe | Feito — os **oito** diálogos nativos viraram um do produto · [§33](01-worklog.md#33-os-oito-diálogos-do-navegador) |
| 36 | Webhook de entrada para Typebot/n8n, com segurança | Feito — [§34](01-worklog.md#34-a-porta-de-entrada-typebot-n8n-e-o-gclid) · **migração 058** |
| 37 | Tela de entregas, logs e API para personalização e automação | Feito — [§35](01-worklog.md#35-a-tela-de-entregas-e-a-api-que-faltava) · **migração 059** |
| 38 | Menu de administrador, score de atendentes, repasse por ausência, permissões dinâmicas, botão direito com IA | Feito — [§36](01-worklog.md#36-administração-separada-score-repasse-e-o-menu-de-ia) · **migrações 060 e 061** |
| 39 | Nove pontos de UX: etiquetas no light, relatórios, visão geral, CRM e funil, calendário, contatos, renomear Clientes, rotas de configuração, botão direito | **Parcial — quatro dos nove** — [§37](01-worklog.md#37-o-botão-direito-contatos-as-rotas-que-não-iam-a-lugar-nenhum-e-o-período-livre) |
| 40 | Juntar Administração e Configurações numa área só, limitada por permissão | Feito — [§38](01-worklog.md#38-a-porta-dupla-desfeita-configurações-volta-a-ser-uma-só) |
| 41 | Procurar defeitos nas mudanças novas | Feito — **sete achados e corrigidos**, três deles escritos por mim — [§39](01-worklog.md#39-revisão-das-mudanças-sete-defeitos-três-deles-meus-por-escrito) |

## O que esta versão é

**Numa frase: o produto sabia coisas sobre as pessoas e não usava
nenhuma.**

A foto de perfil está na `profiles.avatar_url` desde a migração 001 e
quatro telas desenhavam iniciais em cima dela, porque quatro `SELECT`
diferentes pediam `user_id, full_name` e mais nada. A presença está na
`member_presence` desde a 024 e a sala da equipe não a lia. O
`edited_at` está na `team_messages` desde a 046 e ninguém escrevia nele —
estava listado nas pendências como peso morto, e não era morto, era só
não ligado.

Áudio e imagem são a mesma história um nível acima: a mensagem chega, é
guardada, e todo o resto do sistema — a prévia da conversa, a busca, cada
gatilho de automação por palavra, o motor de fluxos, a própria porteira
da resposta automática — lê `content_text`, que num áudio está vazio. O
cliente falou; o CRM registrou silêncio.

E o cargo era o sistema de permissões inteiro: quatro níveis, iguais para
todo mundo que os tem, sem nenhum registro de quem mudou o quê.

## As três decisões que o Gabriel tomou nesta passagem

1. **A aba do avatar** era o popover "Na equipe agora". Saiu; as bolinhas
   com o ponto de presença ficam.
2. **Permissões por pessoa**, sobre o cargo — não uma matriz por cargo.
3. **Transcrição automática, com interruptor** para desligar.

## O que ficou de fora, e por quê

- **Item 7 é um estudo e foi entregue como estudo.** Sete propostas,
  ordenadas por custo, nenhuma implementada. Ver [04](04-personalizacao.md).
- **As treze migrações estão no banco.** A 060 e a 061 entraram depois
  desta linha ter sido escrita e foram sondadas em 31 de agosto de 2026.
  O que sobrou delas não é aplicação, é código: o painel da 061 e as
  asserções de CI das duas. Ver [02](02-pendencias.md).
- **O painel das permissões personalizadas não foi construído.** A
  migração, o resolvedor e os doze testes estão prontos; a tela não — e
  sem a tela o resolvedor não é chamado por ninguém, então a 061 está
  aplicada e inerte.
- **Cinco dos nove pontos do item 39 seguem abertos** — visão geral, CRM
  e funil, calendário, lista de contatos e tipografia, e as cores dos
  gráficos. As etiquetas no light continuam esperando o print: os tokens
  foram medidos e não há nada que quebre **só** no light.
- **Nada foi visto rodando numa sessão autenticada.** O servidor sobe, o
  build passa, os 1443 testes passam — e a tela de login é onde a
  verificação automática para. O que dava para medir sem sessão foi
  medido com `getBoundingClientRect` e `elementFromPoint`, e está em
  [03](03-verificacao.md).
