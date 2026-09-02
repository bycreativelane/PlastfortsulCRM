# Base de consulta comercial e anexos no Atendimento

Revisão do documento `PlastfortSul_CRM_Playbook_e_Anexos_Claude_Code.md`,
conferido contra o código em **1 de setembro de 2026** (versão 0.8.5).

O original foi escrito como se nada existisse. **A segunda metade dele —
anexos no Atendimento — já está construída em cerca de 80%**, e a
primeira metade colide de nome com um recurso que já existe e já tem
documento de conteúdo próprio.

Este arquivo carrega o que continua válido, corrige o que não está mais,
e marca cada item com o estado real.

| Marca | Significa                                         |
| ----- | ------------------------------------------------- |
| ✅    | Já existe. Não reimplementar                      |
| ⚠️    | Existe parcialmente, ou existe de forma diferente |
| ❌    | Não existe. É trabalho de verdade                 |
| 🔒    | Bloqueado por uma decisão que não é técnica       |

---

# 0. 🔒 A decisão que bloqueia tudo: o nome "Playbook"

**A palavra já tem dono neste produto.**

| Onde                                          | O que "playbook" significa hoje                  |
| --------------------------------------------- | ------------------------------------------------ |
| `supabase/migrations/041_playbooks.sql`       | `playbook_steps` + `deal_playbook_progress`      |
| `components/pipelines/playbook-checklist.tsx` | A lista de passos que aparece numa oportunidade  |
| `components/pipelines/playbook-editor.tsx`    | A edição desses passos, no próprio quadro        |
| `docs/playbook-comercial.md`                  | **"É o conteúdo do recurso de Playbook do CRM"** |

É um **checklist por etapa do funil**: o vendedor abre uma oportunidade
em `Follow-up` e vê o que falta fazer naquela etapa; o card no quadro
mostra o quanto já foi.

O documento original propõe uma coisa **diferente**: uma área no menu com
scripts, objeções, produtos e regras — uma base de consulta, sem vínculo
com etapa nem com oportunidade.

Os dois são recursos legítimos e não são o mesmo recurso. Entregar o
segundo com o nome do primeiro dá dois sentidos à mesma palavra dentro de
um produto onde ela já aparece em quatro lugares — incluindo um documento
que diz, na primeira linha, ser o conteúdo do outro.

**Três saídas, e é preciso escolher uma antes de escrever código:**

1. **A área nova ganha outro nome.** "Base comercial", "Consulta",
   "Material de venda". O checklist de etapa continua sendo o Playbook.
   É a saída mais barata e a que não mexe em nada que existe.
2. **O checklist de etapa é renomeado** para "Passos da etapa" e o nome
   Playbook fica livre para a área nova. Custa uma migração de rename,
   os dois componentes, o `docs/playbook-comercial.md` e as chaves de
   i18n nos três idiomas.
3. **A área nova absorve o checklist** e vira uma seção dentro dela. É a
   mais coerente conceitualmente e a mais cara: os passos são por etapa e
   têm progresso por oportunidade, então a área teria uma seção com
   natureza completamente diferente das outras quatro.

> **Antes de decidir, confirmar uma coisa:** a migração 041 está
> registrada como **em espera** desde 22/08/2026, junto com o seed de
> pipelines/tags e as automações de aniversário/recompra. Construir por
> cima de uma tabela parada é uma decisão diferente de construir por cima
> de uma tabela em uso.

O resto deste documento chama a área nova de **base de consulta** para
não presumir a resposta.

---

# PARTE A — A base de consulta

## A1. ❌ Rota e menu

Não existe `/playbook` nem nada equivalente.

O menu de hoje **é agrupado**, o que o original não sabia:

```
Visão geral
OPERAÇÃO    Atendimento · CRM · Contatos · Produtos
AUTOMAÇÃO   Automações · Campanhas · Fluxos
            Relatórios
            Configurações
```

Então a pergunta não é só a posição, é o **grupo**. Uma base de consulta
pertence a Operação — é coisa que se abre durante o atendimento — e cai
naturalmente depois de Produtos, que é o vizinho com que ela mais
conversa.

## A2. ❌ Scripts de vendas · Objeções · Regras da operação

Nada disso existe. As três seções do original continuam válidas como
escritas: título, categoria, conteúdo, datas, e as ações copiar / editar
/ excluir.

Duas observações que o original não faz:

- **O botão copiar precisa de estado.** "Copiado" por dois segundos, ou
  ninguém sabe se funcionou. É o padrão que o resto do produto já usa.
- **As variáveis `[Nome]`, `[Empresa]` etc. já têm precedente no
  produto** — o inbox tem respostas rápidas com substituição. Vale
  conferir `message-composer.tsx` antes de decidir que aqui elas são só
  orientação visual: se o mecanismo já existe, não usá-lo é a duplicação
  que o §20 do original manda evitar.

## A3. ✅ Produtos — reutilizar, e é viável

`/products` existe, com catálogo, importação e CRUD
(`components/products/product-catalog.tsx`). A instrução do original —
não recriar, apontar para a mesma fonte — é cumprível como está.

## A4. ⚠️ Permissões — o original está desatualizado

O original descreve "Administrador vs Atendentes". **Desde a migração 050
o produto tem capabilities por pessoa**, não papéis fixos: `CAPABILITIES`
em `lib/auth/capabilities.ts`, lido por `useCapability`, configurável em
Configurações › Acesso.

A instrução "reutilizar o sistema existente" continua certa — o que muda
é o que reutilizar. A base de consulta deve declarar uma capability
própria (`playbook.view` / `playbook.edit`, ou o nome que a decisão do §0
determinar) e nada além disso.

## A5. ⚠️ Estrutura de dados

O original propõe `playbook_entries` com um campo `type`, ou três tabelas
separadas, e manda decidir depois de olhar o banco. Olhado:

Não existe base de conhecimento genérica reutilizável. O que mais se
aproxima é `ai_knowledge` (migração 030, com a 032 corrigindo o vínculo
de conta), que é RAG para o agente de IA — tem embeddings e chunks, e
usá-la para consulta humana seria carregar todo o custo de vetorização
por um recurso que só precisa de `LIKE`.

**A tabela única com `type` é a escolha certa aqui**, e o motivo é a
busca do §A6: uma consulta por "frete" tem que varrer os três tipos, e
com três tabelas isso é um `UNION` de três `SELECT`s que alguém vai
esquecer de atualizar quando entrar o quarto tipo.

Produtos ficam fora, como o original manda.

## A6. ❌ Busca

Válido como escrito. Uma observação: busca única sobre a tabela única é
mais simples que três buscas por seção, então a ressalva do original
("se busca global gerar muita complexidade, faça por seção") se inverte
com a decisão do §A5.

## A7. ⚠️ Acesso pelo Atendimento

Continua desejável e continua sendo P1, como o original já dizia. Uma
nota que o original não tem: **a Inbox já tem um painel lateral de
conversa** (`contact-sidebar.tsx`), então existe onde encaixar sem
refatorar a thread. Ele **não** é um componente de abas hoje — é uma
coluna de blocos empilhados —, então a consulta seria um painel próprio
ao lado, ou o `side-panel.tsx` que o produto já tem, e não "mais uma
aba".

---

# PARTE B — Anexos no Atendimento

**Esta é a parte que precisa da maior correção: quase tudo já existe.**

## B1. Inventário do que está pronto

| § do original                 | Estado | Onde                                                                  |
| ----------------------------- | ------ | --------------------------------------------------------------------- |
| 23 Botão de anexo             | ✅     | `message-composer.tsx` — Paperclip + três `<input file>`              |
| 22 Drag and drop              | ✅     | `message-composer.tsx:849-876`, com overlay de destaque               |
| 24 Preview antes do envio     | ✅     | Estado `draft`, com legenda antes de confirmar                        |
| 25 Lightbox de imagem         | ✅     | `media-lightbox.tsx`                                                  |
| 25 Player de vídeo interno    | ✅     | `<video controls>` no balão, sem sair da conversa                     |
| 25 Download explícito         | ✅     | `lib/media/download.ts`                                               |
| 26 Não redirecionar ao Google | ✅     | **Zero** referências a Google em todo o `src`                         |
| 27 Upload e metadados         | ✅     | Bucket `chat-media` (migração 023): MIME, nome, tamanho, autor, data  |
| 21 Tipos aceitos              | ✅     | Imagem, vídeo, documento, áudio — validados contra os limites da Meta |

**E três coisas que o produto tem e o original nem menciona:**

- **Colar arquivo** com `Ctrl+V` direto no compositor.
- **Gravação de áudio** no navegador, com `opus-recorder` vendorizado.
- **Transcodificação no cliente** para um formato que a Meta aceita, sem
  passo de ffmpeg no servidor.

## B2. ❌ O que falta de verdade

### B2.1 Visualizador interno de PDF — o único P0 real

`components/inbox/message-media.tsx`, no `MediaDocumentBubble`: o
documento é um `<a target="_blank">` para a URL do storage. O navegador
abre o PDF na aba nova, com o visualizador dele.

Isso **não viola** a regra do §26 do original — não há Google em lugar
nenhum. Mas contraria o §25: o usuário sai do CRM.

O `media-lightbox.tsx` hoje não trata documento. A correção é ensiná-lo a
receber um PDF e renderizar num `<iframe>` ou `<embed>`, mantendo o botão
de baixar que já existe ao lado.

### B2.2 ❌ Múltiplos anexos

Um arquivo por vez: `dataTransfer?.files?.[0]` no drop, e um `File` por
chamada no `stageUpload`. Continua P1, como o original diz.

### B2.3 ⚠️ Estados de envio

Existe toast de falha no upload. **Não existe "tentar novamente"** — e o
original é explícito: _"não perder silenciosamente o arquivo"_. Hoje o
arquivo não some silenciosamente (tem toast), mas o usuário precisa
arrastar de novo.

### B2.4 ❌ Galeria de mídias da conversa

Não existe. Continua P1.

## B3. 🔒 O §28 precisa ser reescrito — ele é impossível como está

O original diz:

> _"Se o storage utilizar URLs privadas: gerar URLs assinadas/temporárias
> quando necessário; **não tornar os arquivos públicos apenas para
> facilitar o preview**."_

**O bucket `chat-media` é público, e tem que ser.** A Meta busca a URL no
momento do envio; um objeto privado não chega ao cliente. Não é atalho de
preview, é requisito da WhatsApp Cloud API.

A regra correta — e que o produto já pratica desde a migração 063 — é
outra:

| Mídia                            | Balde       | Por quê                                               |
| -------------------------------- | ----------- | ----------------------------------------------------- |
| Sai para o cliente pelo WhatsApp | **público** | A Meta busca a URL. Não há alternativa                |
| Só circula entre a equipe        | **privado** | Ninguém de fora precisa ler, então ninguém de fora lê |

`chat-media` (023) é o primeiro caso. `team-media` (063, a sala da
equipe) é o segundo: privado, leitura só para membro da conta, a coluna
guarda o **caminho** e a URL é assinada na hora de renderizar.

Deixar o §28 como está é pior que apagá-lo: é uma regra que o código
nunca vai poder cumprir, e que alguém um dia vai "consertar" tornando o
`chat-media` privado — o que quebra o envio de mídia inteiro sem erro
nenhum no CRM, porque a falha acontece do lado da Meta.

**O que continua válido do §28:** validar MIME, extensão e tamanho antes
do upload; e um usuário só ver anexo de conversa a que tem acesso.

## B4. Prioridade corrigida

O §33 do original lista doze itens P0. **Nove já estão feitos.** A lista
real é:

### P0

1. Visualizador interno de PDF (§B2.1)
2. "Tentar novamente" na falha de upload (§B2.3)

### P1

1. Galeria de mídias da conversa
2. Múltiplos anexos
3. Navegação entre fotos dentro do lightbox

---

# Regras de implementação que continuam valendo

Do §20 e do §34 do original, sem mudança:

1. Analisar a arquitetura antes de alterar.
2. Reutilizar componentes visuais existentes.
3. Não criar tabela duplicada de produtos.
4. Não criar um segundo sistema de armazenamento.
5. Não transformar anexo em link do Google.
6. Manter a conversa aberta durante upload e visualização.
7. Não mexer em automações, pipelines ou Inbox além do necessário.
8. Não implementar IA interpretando objeção automaticamente.
9. O Playbook não dispara automação.

E uma que o original não tem, aprendida nesta revisão:

10. **Antes de escrever um spec, conferir o que já existe.** Nove dos
    doze P0 deste documento estavam prontos quando ele foi escrito, e a
    palavra central dele já era o nome de outro recurso.
