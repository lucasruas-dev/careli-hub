# Iris: o que os dados mostram antes de mexer no código

> Levantado em 14/08/2026, no início da frente de modernização da Iris pedida pelo Lucas.
> **Tudo aqui é medição no banco de produção, não leitura de código.** A análise do código está
> rodando em paralelo e entra depois.

## O pedido do Lucas, nas palavras dele

> "quero agora atualizar a iris, pessoal está me relatando muitos bugs, e uma desorganização.
> (…) as mensagens estão demorando para ir, estamos com um pequeno delay nas mensagens, o nome
> que está no cockpit tem que está no board das mensagens (para aqueles que tem cadastro no
> apolo). Além de corrigir esses bugs quero criar a central de atendimento que focará atendimento
> ao cliente e usará o telefone 4143. (…) E vamos criar a central de atendimento as imobiliárias
> e corretores. e vamos usar o telefone que hoje está no direct (…) Eu preciso ganhar
> assertividade no atendimento por isso a separação da entrada facilitará entrega de um contexto
> para a Cacá."

E, em seguida, a decisão que muda a arquitetura:

> "agora o cadastro está totalmente no apolo, nada vai nascer no c2x, podemos alterar essa
> lógica de acessar o c2x"

## 1. O delay é real, e tem número

Do momento em que a mensagem é gravada até o provedor aceitar (`sent_at - created_at`), últimos
7 dias:

| Canal | Saídas | Mediana | p90 | p99 | Acima de 3s |
|---|---|---|---|---|---|
| WhatsApp Atendimento (4143) | 1.644 | **2,17s** | 3,38s | 9,88s | **242 (15%)** |
| WhatsApp Gurgel | 12 | 2,34s | 3,50s | 3,76s | 5 |
| Relacionamento (Evolution) | 1.512 | **−0,91s** | −0,02s | −0,02s | 0 |

Duas leituras:

- **2,17 segundos de mediana no 4143 é o "pequeno delay"** que o time relata. Num chat, o
  operador clica e fica 2s sem retorno; em 15% das vezes, mais de 3s.
- **O Relacionamento tem `sent_at` ANTERIOR ao `created_at`.** Ou seja, aquele canal manda
  primeiro e grava depois, enquanto o 4143 grava, espera a Meta e só então libera a tela. São
  duas arquiteturas para o mesmo problema dentro do mesmo produto — e a mais rápida já está lá.

Cuidado ao medir: `delivered_at - created_at` dá mediana de 5,5s e p95 de 48 minutos, mas isso
inclui o tempo do celular do destinatário (desligado, sem sinal). Não é o nosso delay.
A Evolution não reporta entrega (`delivered_at` nulo em 1.512 de 1.512).

## 2. O nome errado no board: causa medida

`caredesk_contacts.c2x_user_id` está **nulo em 100%** dos contatos das filas Atendimento e
Direct. O contato do WhatsApp nasce com telefone e o nome que a pessoa configurou no aparelho,
sem vínculo com cadastro nenhum. O cockpit resolve na hora, por outro caminho; o board não.

**Quanto dá para corrigir hoje**, casando o telefone do contato com `apolo_entity_identifiers`:

| Fila | Contatos (30d) | Com cadastro no Apolo |
|---|---|---|
| Atendimento (4143) | 794 | **361 (45%)** |
| Direct | 248 | **3 (1%)** |
| Financeiro | 28 | 6 (21%) |
| Gurgel | 17 | 0 |

A chave que funciona: `identifier_type = 'phone'` e o telefone **sem o 55 do início**.

```
value_hash = sha256('apolo-identifier:phone:' || telefone_sem_55)
```

Medido: com o 55, casam 36; sem o 55, casam 369. O hash é SHA-256 puro, sem segredo
(`hashIdentifier` em `lib/apolo/server.ts:4908`), então dá para resolver em lote no banco, sem
uma consulta por linha — o que importa, porque o board carrega centenas de conversas.

## 3. ⚠️ A premissa das duas centrais precisa de um ajuste

O plano é separar a entrada para dar contexto à CACÁ: 4143 = cliente, Direct = corretor e
imobiliária. O volume sustenta a separação:

| Porta | Tickets (30d) | Contatos | Mensagens |
|---|---|---|---|
| 4143 · Atendimento | 1.551 | 794 | 14.155 |
| Relacionamento · Direct | 635 | 248 | 9.135 |

**Mas só 3 dos 248 contatos do Direct têm cadastro no Apolo.** E não é por falta de cadastro do
outro lado: **imobiliária tem telefone em 431 de 433 (100%)** e **corretor em 68 de 72 (94%)**.

Ou seja: quem fala no Direct hoje **não é** o corretor cadastrado — ou fala de outro número
(celular pessoal em vez do comercial), ou é um público diferente do imaginado. Há 248 contatos
distintos no Direct em 30 dias, contra 72 corretores cadastrados no total.

**Consequência prática:** separar a porta, sozinho, não entrega contexto à CACÁ na central de
corretores. Ela vai atender 99% de gente que não sabe quem é. Antes de construir, é preciso
descobrir quem são esses 248 — e provavelmente ligar o telefone de quem fala ao cadastro,
que é o mesmo trabalho do item 2.

Na central do cliente o quadro é bem melhor: 45% já casam, e a CACÁ teria contexto real em quase
metade dos atendimentos desde o primeiro dia.

## O que fazer com isso

1. **Não começar pelas centrais.** Começar pela identidade do contato (item 2), que conserta o
   bug do nome E é pré-requisito para o contexto da CACÁ nas duas centrais.
2. **O delay do 4143** provavelmente se resolve copiando o que o Relacionamento já faz: responder
   à tela antes da confirmação do provedor, e reconciliar depois. A análise do código dirá se há
   overhead nosso além da chamada à Meta.
3. **Investigar os 248 do Direct** antes de desenhar a central de corretores.

Com o cadastro agora vivendo inteiramente no Apolo (decisão do Lucas, 14/08), a resolução de
identidade deve olhar para `apolo_entities` e parar de depender de `c2x_user_id`, que nunca foi
preenchido nesses contatos.


---

# Parte 2: a leitura do código (12 agentes, 664 leituras)

66 achados criticos ou altos, todos com arquivo e linha. O bruto esta em
`iris-diagnostico-2026-08-bruto.json`. Aqui fica o que decide a ordem do trabalho.

## As duas causas do "delay", e são diferentes uma da outra

**Ao RECEBER — o realtime da Iris está morto.** Nenhuma tabela `caredesk_*` foi publicada em
`supabase_realtime`; os 5 `postgres_changes` de `IrisPage.tsx:919-957` são código morto. A
mensagem chega ao banco em ~1s e a tela só descobre no **polling de 90 segundos**
(`IrisPage.tsx:996-998`). Quatro agentes confirmaram por conta própria em `pg_publication_rel`.

⚠️ **Não basta publicar as tabelas.** As policies de SELECT são `USING (true)` para todo
`authenticated`, e o cliente da Iris roda no navegador (`iris-data-client.ts:2`). Publicar sem
fechar a leitura transforma um problema de UX em vazamento de dado. A ordem é: fechar a policy,
depois publicar.

**Ao ENVIAR — o caminho é síncrono e serial.** A UI monta uma `optimisticMessage` mas só a
mostra DEPOIS da resposta (`IrisPage.tsx:2998-3057`), com o composer desabilitado no meio. Antes
de a mensagem sair rodam **15 idas ao banco em série, 12 delas antes do envio**
(`meta/messages/route.ts:180-533`), sendo que `hub_users` é lido duas vezes e cinco `await`
independentes estão enfileirados. Mídia sobe **duas vezes em série** (Storage e depois Graph).
E **nenhum fetch para a Graph API tem timeout** (`meta-whatsapp.ts:470,715,1895,...`), enquanto o
cliente da Evolution já usa AbortController de 30s.

O canal Relacionamento já faz o certo (envia primeiro, grava depois), e por isso aparece com
`sent_at` negativo. A arquitetura rápida já existe dentro do produto.

## O nome no board: a causa é outra do que parecia

O nome do Apolo no board é um **overlay client-side que expira em 4s e não sobrevive ao F5**
(`iris-data-client.ts:39-54,714-778`). Não é persistido em lugar nenhum. **205 das 364 conversas
na tela** estão divergentes. Board e cockpit usam cascatas de prioridade diferentes, e uma delas
chega a trocar o titular pelo cônjuge (`phone-match/route.ts:309-338`).

## ⚠️ As duas centrais: quatro impedimentos que o plano não previa

1. **A CACÁ é Meta-only por construção.** O único ponto de auto-reply está em
   `meta-inbound-processor.ts:430-438`; o processador da Evolution não tem nenhuma chamada a ela.
   **Separar a entrada não coloca a CACÁ no número das imobiliárias.**
2. **A fila Direct não tem canal e herda o 4143.** Abrir atendimento na fila Direct dispara pelo
   número errado (`tickets/route.ts:1572-1655`). O Setup até deixa vincular a fila ao número
   Relacionamento, e o servidor descarta em silêncio (`iris-setup-view.tsx:786-802`).
3. **89-91% do que sai do número do Direct não passa pela Iris** — é respondido do celular. A
   Iris é espectadora do número que viraria a Central de Corretores.
4. **9.185 mensagens do Direct estão gravadas no canal `whatsapp-grupo`**, que não tem número,
   nem fila, nem flag da CACÁ. E o processador do Direct nem lê a config do canal: fila, canal e
   instância são constantes no código (`evolution-inbound-processor.ts:24-28`).

Some-se o dado da Parte 1: só 3 dos 248 contatos do Direct têm cadastro no Apolo.

## Medida de assertividade, que era o objetivo do Lucas

**43,6% dos turnos sob a CACÁ no 4143 ficam sem nenhuma resposta em 5 minutos**
(`meta-inbound-processor.ts:2178-2213`, duas guardas que fazem `return false` sem registrar
evento). E **~15% do uso de ferramentas no 4143 já é trilha de corretor/CAD**, dentro do prompt
de cliente — a mistura que o Lucas quer separar já acontece e é mensurável.

O webhook da Meta roda o turno da CACÁ **dentro da requisição HTTP**, sem `maxDuration`
(`meta/webhook/route.ts:176-193`), e por isso a Meta desiste de esperar: **580 re-entregas em 30
dias**, com a retry correndo em paralelo com o processamento original.

## 🚨 Achado operacional urgente

`git status` mostra **5 arquivos da CACÁ modificados e não commitados** no working tree
(`meta/webhook/route.ts`, `caca/agent.ts`, `caca/persona.ts`, `meta-inbound-processor.ts`,
`meta-whatsapp.ts`) mais um teste novo. **Produção roda código antigo da CACÁ.** Isso é trabalho
de outra sessão em andamento; não foi tocado aqui.

## A ordem que os achados impõem

1. **Fechar a policy de SELECT das tabelas `caredesk_*`** — é pré-requisito de segurança do passo 2
   e da separação das centrais (hoje a separação seria só visual).
2. **Publicar as tabelas no realtime** e aposentar o polling de 90s. Resolve o delay de recepção.
3. **Tornar o envio otimista e paralelizar as 12 consultas**, com timeout nos fetches da Meta.
   Resolve o delay de envio.
4. **Persistir a identidade do contato** (telefone → Apolo, em lote), em vez do overlay de 4s.
   Resolve o nome no board e é a fundação do contexto da CACÁ.
5. **Dar canal próprio à fila Direct** e fazer o processador ler a config em vez das constantes.
6. **Só então** as duas centrais, com a CACÁ ganhando contexto por porta de entrada.


---

## Autoria no número do Relacionamento (definido com o Lucas em 15/08)

**O registro do que sai do celular JÁ EXISTE.** Medido em 30 dias no canal `whatsapp-grupo`:
3.247 mensagens de saída sem operador (celular, 537 conversas) contra 814 pela Iris (116
conversas). A Evolution captura o que o time digita no aparelho desde a v1.39.0. **80% daquele
atendimento existe no banco e é invisível para métrica**, só por falta de autor.

**Quem responde o quê**, segundo o Lucas:

| Pessoa | Onde atua | Pela Iris (30d) |
|---|---|---|
| **Raiane Oliveira** — coordenadora | grupos e, principalmente, 1:1 com corretor/imobiliária. **Única que responde pelo celular** | 124 |
| Nivea Careli | só grupos | 439 |
| Cinthia Cruz | só grupos | 248 |
| Lucas Ruas | teste | 3 |

**A regra é POR FILA, e isso importa:**

- **Direct** (1:1 com corretor/imobiliária): saída órfã é da Raiane. Atribuir é seguro, porque só
  ela atende ali pelo celular. O `defaultAssigneeUserId` da fila **já está configurado com o id
  dela**.
- **Grupo**: três pessoas respondem. **Não atribuir a ninguém.** Atribuição errada vira métrica
  falsa e apaga o trabalho de quem fez.

⚠️ **O mecanismo existe e está no lugar errado.** `donoPadraoDaFila`
(`lib/iris/evolution-inbound-processor.ts:475`) grava o dono no TICKET (`assigned_to_user_id`,
linha 522) e nunca na MENSAGEM (`sender_user_id`). Daí a conversa ter dono e as mensagens não.

**Conserto:** carimbar o dono padrão também na mensagem de saída que chega pelo webhook sem
autor, **só quando a fila tiver dono padrão** — condição que exclui o Grupo sozinha, sem regra
especial. Cabe backfill nas 3.247 já gravadas, restrito ao Direct.

Isso entra junto com o passo 5 (dar canal próprio ao Direct), e é o que faz aquele atendimento
aparecer em SLA e produtividade pela primeira vez.
