# Assinatura de contratos no C2X: o mapa para montar o painel

> Levantado em 13/08/2026 para o painel do cenário de assinatura do Vale do Ouro (pedido do Lucas).
> Fonte: leitura direta do C2X (read-only). Os dumps crus do estudo estão nos scripts
> `scripts/apolo/estudo-assinaturas-*.mjs`, que podem ser rodados de novo a qualquer momento.

## 1. Como o contrato caminha

```
acquisition_requests                    a PROPOSTA (uma unidade, um ou mais clientes)
  │   enterprise_unity_id ──► enterprise_unities ──► enterprises   (é assim que se chega no empreendimento)
  │   acquisition_request_stage_id ──► acquisition_request_stages  (Reservado, Contrato gerado, Em assinatura…)
  │
  ├─ acquisition_request_historics      cada MUDANÇA de estágio, com data e quem fez
  │
  └─ acquisition_request_contracts      o CONTRATO gerado (texto completo, minuta usada)
       │   acquisition_request_contract_status_id ──► statuses (1 Em aberto, 2 Fechado)
       │   draft_contract_id ──► draft_contracts     a MINUTA, que é por empreendimento
       │   is_to_use_position_to_sign                se a assinatura é EM ORDEM
       │
       ├─ contract_signers               quem DEVE assinar (a lista montada no C2X)
       │    signer_id ──► signers ──► users
       │    contract_signature_type_id ──► contract_signature_types
       │
       └─ contract_signatures            o ENVIO para a D4Sign
            │   contract_signature_status_id ──► contract_signature_statuses
            │   uuidDoc, uuidSafe, uuidFolder      os identificadores na D4Sign
            │   link_pdf_signed_file               o PDF assinado, quando termina
            │   get_safe, create_folder, upload_document, send_document_signature…
            │                                      os passos da integração, um flag cada
            │
            └─ contract_signature_signers  o signatário DENTRO do envio
                 signed, date_signed              QUEM ASSINOU E QUANDO
                 after_position                   a POSIÇÃO NA FILA
                 user_name, user_document, email  cópia congelada no momento do envio
```

**A cadeia canônica**, a que todo número do painel vai usar:

```sql
from acquisition_requests ar
join enterprise_unities u   on u.id  = ar.enterprise_unity_id
join enterprises e          on e.id  = u.enterprise_id
join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
                           and cs.contract_type = 'default'      -- ⚠️ ver seção 3
join contract_signature_signers ss on ss.contract_signature_id = cs.id
```

## 2. As tabelas, uma a uma

| Tabela | Uma linha é | Linhas hoje |
|---|---|---|
| `acquisition_request_contracts` | um contrato de uma proposta | 2.926 |
| `contract_signatures` | um envio do contrato para assinatura | 3.656 |
| `contract_signature_signers` | um signatário dentro de um envio | 19.937 |
| `contract_signers` | um signatário previsto no contrato | 21.737 |
| `signers` | uma pessoa que pode assinar (ligada a `users`) | 5.983 |
| `contract_signature_statuses` | os 7 estados do envio | 7 |
| `contract_signature_types` | o papel: parte, testemunha, apenas assinar | 3 |
| `draft_contracts` | a minuta, por empreendimento | 67 |
| `contract_adjustment_schedules` | o reajuste contratual da proposta | 88 |

**Os 7 estados do envio** (`contract_signature_statuses`): 1 Processando · 2 Aguardando Signatários ·
3 Aguardando Assinaturas · 4 Finalizado · 5 Arquivado · 6 Cancelado · 7 Em aberto.
Na prática só quatro aparecem: **4 Finalizado** (1.817), **7 Em aberto** (1.463),
**3 Aguardando Assinaturas** (343) e **6 Cancelado** (33).

**Os 3 papéis** (`contract_signature_types`): 1 Apenas assinar · 2 Assinar como parte ·
3 Assinar como testemunha.

**Os 11 estágios da proposta** (`acquisition_request_stages`): 1 Reservado · 2 Análise de crédito ·
3 Contrato gerado · 4 Faturado · 5 Em assinatura · 6 Finalizado · 7 Cancelado ·
8 Reprovado análise de crédito · 9 Proposta realizada · 10 Em distrato · 11 Distratado.

## 3. As armadilhas

### 3.1 O envio fantasma (`contract_type` NULL)

`contract_signatures` tem **dois tipos de linha**, e só uma delas é um envio de verdade:

| `contract_type` | linhas | uuidDoc | subiu o documento | signatários | estado |
|---|---|---|---|---|---|
| `'default'` | 2.520 | sim | sim | 12 a 15 | o estado real |
| `NULL` | 1.136 | **nenhuma** | **nenhuma** | **zero** | 100% em "Em aberto" |

O registro NULL é criado junto e nunca sai do lugar: não tem uuid, não subiu documento, não tem
signatário, e na base inteira **todos os 1.136 estão no status 7**. Contar linhas de
`contract_signatures` sem filtrar dobra a contagem de contratos.

> O código que já existe no repo (`lib/apolo/server.ts`, `lib/apolo/carteira.ts`) chega no mesmo
> lugar por outro caminho: filtra `trim(coalesce(cs.uuidDoc,'')) <> ''`. Dá quase o mesmo
> resultado, mas exclui também os `default` que ainda não foram disparados, que é justamente o
> caso que o painel precisa mostrar como "gerado e não enviado".

### 3.2 Não somar VLO + VOL + VOC

VLO (35) é o masterplan comercial e VOL (36) / VOC (37) são as carteiras. As unidades do VLO são
cópia, e ele carrega 125 propostas históricas com apenas 1 contrato. **O painel de assinatura é
VOL + VOC**; o VLO entra só se for para olhar o histórico anterior à divisão de 02/08.

### 3.3 `signature_date` não mede assinatura

`acquisition_request_contracts.signature_date` está preenchida em **505 de 2.926** contratos,
contra 1.817 envios finalizados. No Vale do Ouro está nula em toda a amostra. É campo de
digitação, não o resultado da D4Sign. **A verdade está em `contract_signature_status_id = 4`**, e
a prova cruzada é perfeita: os 1.817 finalizados são exatamente os 1.817 com
`link_pdf_signed_file` preenchido.

### 3.4 Contar eventos de histórico ≠ contar propostas

`acquisition_request_historics` registra cada transição, e proposta que volta de estágio gera
mais de uma linha: **55 casos** no Vale do Ouro (36 no VOC, 19 no VOL). Sempre
`count(distinct acquisition_request_id)`.

### 3.5 "Fechado" não quer dizer assinado

`acquisition_request_contract_statuses` tem só dois valores: 1 Em aberto e 2 Fechado. **204 dos
210 contratos do Vale do Ouro estão como "Fechado" e nenhum deles tem uma assinatura sequer.**
"Fechado" ali significa que o contrato foi montado e travado para edição, não que foi assinado.
É a armadilha que mais engana, porque é a palavra certa no lugar errado.

### 3.6 Doze signatários não são doze pessoas

A média é de **12,4 linhas por envio, mas 10,4 documentos distintos**. A Lino e Cecílio
Participações entra três vezes no mesmo contrato, uma por e-mail de sócio. Qualquer conta de
"quantas pessoas faltam" precisa decidir se conta linha ou pessoa, e as duas respostas são
diferentes.

### 3.7 Dois filtros diferentes, dois propósitos

| Quero | Filtro |
|---|---|
| o envio que o fluxo criou | `cs.contract_type = 'default'` → 184 no VDO |
| o envio que **chegou** na D4Sign | `trim(coalesce(cs.uuidDoc,'')) <> ''` → 179 |

A diferença de 5 são contratos que travaram entre criar o registro e despachar. Para o painel
operacional os dois importam: um é "está na mão dos assinantes", o outro é "travou antes de sair".

### 3.8 O join multiplica

`contract_signers` (previstos) e `contract_signature_signers` (enviados) penduram no mesmo
contrato. Juntar as duas na mesma consulta faz produto cartesiano: ~12 × ~12 por contrato. Use
subconsulta ou `count(distinct)`.

## 4. A fila de assinatura, que é o coração do painel

Um contrato do Vale do Ouro tem **12 a 15 signatários**, organizados em degraus
(`after_position`). Exemplo real de um contrato do VOC:

| Degrau | Quem | Papel |
|---|---|---|
| 1 | o corretor / imobiliária | parte |
| 2 | os compradores (titular e cônjuge) | parte |
| 3 | duas testemunhas da Cecílio Rocha | testemunha |
| 4-5 | Lino e Cecílio Participações (3 e-mails de sócios) + testemunha | parte |
| 6 | dois anuentes | parte |
| 7-8 | duas pessoas da Careli | parte |

**A ordem importa**: `is_to_use_position_to_sign = 1` em **181 dos 210** contratos do Vale do Ouro,
contra 640 de 2.926 na base inteira. Quando está ligado, o degrau seguinte só é chamado depois que
o anterior fecha. Por isso a métrica útil não é "quantos faltam assinar", e sim
**em que degrau o contrato parou e de quem se está esperando**.

O cálculo: `min(after_position)` entre os signatários com `signed = 0` de cada envio.

## 5. O cenário do Vale do Ouro em 13/08/2026

O lançamento começou em **01/08**. Doze dias de operação.

### O funil (propostas distintas, pelo histórico de estágio)

| Etapa | VOC (Cecílio) | VOL (Lino) | Total |
|---|---|---|---|
| Reservado | 174 | 175 | 349 |
| Proposta realizada | 108 | 108 | 216 |
| Contrato gerado | 105 | 103 | 208 |
| Em assinatura (o estágio) | 90 | 93 | 183 |
| Faturado | 1 | 0 | 1 |
| Cancelado | 82 | 82 | 164 |

### A aritmética dos contratos, que fecha exata

⚠️ **O estágio "Em assinatura" (183) não é o número de contratos na D4Sign.** Ele é o rótulo da
proposta; o que conta é o envio. Contando pelo contrato:

```
210  contratos gerados (105 VOC + 105 VOL, de 208 propostas — duas têm dois contratos)
 23  sem nenhum envio criado
  3  só com o registro fantasma (contract_type NULL)
  5  com envio criado mas sem identificador na D4Sign
179  efetivamente na D4Sign  ←  e são exatamente os 179 "Aguardando Assinaturas"
  0  finalizados
```

**31 dos 210 contratos nunca chegaram à D4Sign.** Não é um número que aparece em lugar nenhum
do C2X; ele só existe quando se soma as três formas de o contrato ficar pelo caminho.

**Nenhum contrato do Vale do Ouro foi assinado até hoje.** Zero envios finalizados, zero PDFs.

### ⚠️ O que esse zero significa, e o que não significa

Um contrato leva, na casa inteira, **16,2 dias em média** entre o envio e a última assinatura
(1.816 contratos finalizados). A distribuição:

| Fechou em | Contratos | % |
|---|---|---|
| até 5 dias | 192 | 11% |
| 6 a 12 dias | 628 | 35% |
| 13 a 30 dias | 854 | 47% |
| mais de 30 dias | 142 | 8% |

Os envios do Vale do Ouro têm **2,6 dias de idade média** (o mais antigo tem 12), e 22% das
assinaturas já foram dadas. **É cedo para chamar de travamento**: mais da metade dos contratos
da casa leva mais de 12 dias para fechar.

> ⚠️ Cuidado com `updated_at`. Calculando o tempo por ele, a média dá 1,9 dia e o Vale do Ouro
> parece catastroficamente atrasado. É falso: `updated_at` é anterior à última assinatura em
> praticamente todos os casos. A data real é `max(date_signed)` dos signatários.

O que **é** problema real, e não depende de tempo:

- **31 contratos que nunca chegaram à D4Sign** e não aparecem em nenhuma tela.
- **~6 dias entre gerar o contrato e mandar assinar**, antes de a fila sequer começar.
- **A fila trava do lado de quem vende**, não do comprador (seção seguinte).

### Onde os contratos param

| Degrau | Contratos parados | Valor das unidades |
|---|---|---|
| 1 (corretor) | 14 | R$ 2,14 mi |
| 2 (comprador) | 54 | R$ 7,58 mi |
| 3 (testemunhas Cecílio) | 39 | R$ 5,58 mi |
| 4 (vendedor) | 30 | R$ 4,35 mi |
| 5 (sócios / testemunha) | 43 | R$ 6,32 mi |
| 6 (anuentes) | 2 | R$ 0,44 mi |

**R$ 25,97 milhões** em unidades esperando assinatura (R$ 12,38 mi no VOC, R$ 13,59 mi no VOL).

### Quem trava a fila

| Quem | Papel | Contratos parados nele |
|---|---|---|
| Rafael Gonzaga de Oliveira (`administrativo@ceciliorocha.com.br`) | testemunha | 102 |
| Yasmin Louize Aparecida Lopes (`financeiro02@ceciliorocha.com.br`) | testemunha | 89 |
| Lino e Cecílio Participações | vendedor | 53 |

Taxa de assinatura por degrau: **92% no degrau 1** e **62% no degrau 2**, despencando para 35%,
28% e 3% do terceiro em diante.

E o corte por lado da mesa não deixa dúvida:

| Quem | Linhas de assinatura | Assinaram |
|---|---|---|
| Cliente e corretor | 985 | 385 (**39%**) |
| Lino e Cecílio (vendedor) | 549 | 91 (17%) |
| Equipe Cecílio Rocha | 366 | 20 (5%) |
| Equipe Careli | 369 | 3 (**1%**) |

O comprador está assinando. A trava está do lado de quem vende, e a Careli é o último degrau —
não chega a ser chamada porque a fila trava antes.

## 6. O que o painel precisa mostrar

### Topo (o cenário em cinco números)

1. **Contratos em assinatura** e quanto valem — hoje 183 e R$ 25,97 mi.
2. **Assinados** (envio finalizado, com PDF) — hoje 0.
3. **Gerados e ainda não enviados** — hoje 23.
4. **Tempo médio parado** desde o envio.
5. **Contratos parados há mais de N dias** (o alerta).

### O corte que resolve: de quem estamos esperando

Uma barra por degrau, com o nome de quem trava e quantos contratos. É o gráfico que responde
"o que preciso fazer hoje para destravar" — e é o que muda a conversa com o incorporador, porque
mostra em números que o comprador não é o gargalo.

### A lista operacional

Uma linha por contrato: empreendimento, quadra e lote, cliente, corretor, valor, dias desde o
envio, quantos de quantos assinaram, e **de quem se está esperando agora**. Ordenada pelos mais
antigos. Filtro por empreendimento e por quem trava.

### Alertas que o painel levanta sozinho

- Contrato gerado há mais de X dias e nunca enviado.
- Envio parado no mesmo degrau há mais de X dias.
- Contrato cancelado com unidade ainda marcada como vendida.

Erro de integração **não** vale a pena como alerta: em 3.656 envios existem 7 mensagens de erro
no total (6 no upload, 1 no envio). A integração com a D4Sign não falha, ela espera.

### Uma pergunta a levar para o time do C2X

`contract_signatures.create_webhook` está **em zero nos 3.656 envios** — nenhum webhook da D4Sign
foi registrado. Ainda assim o status muda (os finalizados fecham em 1 a 6 dias), então existe
outro caminho de atualização que o banco não revela. Vale confirmar com eles **de quanto em quanto
tempo o status é atualizado**, porque isso define se o painel mostra o agora ou o de ontem.

### O que NÃO dá para responder com o que existe hoje

- **Quantas vezes o signatário foi lembrado**: a D4Sign guarda o reenvio, o C2X não.
- **Se o cliente abriu o e-mail**: não existe no banco.
- **Motivo do cancelamento do envio**: `statusComment` e `whoCanceled` existem e estão vazios nos
  3.656 envios, inclusive nos 33 cancelados.
- **Ligar o signatário ao cliente da proposta com 100% de certeza**: o casamento é por documento,
  e em ~3 de 10 casos da amostra o CPF do titular da proposta não aparece na lista de signatários
  (o contrato é assinado pelo cônjuge ou por outro titular). Para o painel isso é aceitável, mas
  não serve como chave.



