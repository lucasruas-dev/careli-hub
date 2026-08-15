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
