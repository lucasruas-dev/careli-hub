# Asaas — cobrança de pré-venda (PIX e boleto) e a hora que ordena a fila

> Levantado em 21/jul/2026 por estudo multi-agente (33 agentes) com verificação adversarial:
> cada afirmação foi conferida contra a documentação por um segundo agente.
>
> ⚠️ DOIS ACHADOS DECIDEM O DESENHO:
> 1. O webhook do Asaas NÃO traz HORA do pagamento (`paymentDate` é `date`, não `date-time`).
>    Ordenar a fila por ele empataria ~120 pessoas no mesmo valor.
> 2. SEM chave PIX própria na conta, o QR Code EXPIRA às 23:59 do mesmo dia.
>
> Contexto: `prometeu_credenciados.pago_em` alimenta `ordem_fila`, que define a ordem de
> atendimento presencial no evento de 01/08.

ry": "Estuda a API do Asaas para gerar a cobranÃ§a de prÃ©-venda (PIX e boleto) e capturar a hora do pagamento",
  "agentCount": 33,
  "logs": [
    "28 afirmaÃ§Ãµes; 22 confirmadas"
  ],
  "result": {
    "confirmados": 22,
    "desenho": "# DESENHO DA INTEGRAÃÃO, PRÃ-VENDA R$ 1.000 (Asaas â Apolo â Prometeu)

## 1. O QUE FICOU CLARO (sÃ³ o confirmado na doc)

**Cliente.** `POST /v3/customers`. ObrigatÃ³rios: `name`, `cpfCnpj`. Opcionais relevantes: `email`, `mobilePhone`, `externalReference` (https://docs.asaas.com/reference/criar-novo-cliente). O Asaas **permite cliente duplicado**: `externalReference` nÃ£o Ã© chave Ãºnica, quem deduplica somos nÃ³s, guardando o `id` retornado ou consultando antes (https://docs.asaas.com/docs/criando-um-cliente).

**CobranÃ§a.** `POST /v3/payments`. ObrigatÃ³rios: `customer` (id `cus_...`), `billingType`, `value`, `dueDate` (https://docs.asaas.com/reference/criar-nova-cobranca). `billingType` aceita `UNDEFINED`, que habilita PIX e boleto na MESMA cobranÃ§a, desde que ambos os meios estejam habilitados na conta. Ã exatamente o cenÃ¡rio da prÃ©-venda: uma cobranÃ§a por pessoa, o cliente escolhe.

**PIX.** O QR Code **nÃ£o** vem na criaÃ§Ã£o. Ã chamada separada: `GET /v3/payments/{id}/pixQrCode`, que devolve `encodedImage` (base64), `payload` (copia e cola), `expirationDate` e `description` (https://docs.asaas.com/reference/obter-qr-code-para-pagamentos-via-pix.md). Funciona para cobranÃ§as `PIX`, `BOLETO` ou `UNDEFINED`. GET tem que ir com body vazio, senÃ£o pode voltar 403.

**Armadilha de validade, crÃ­tica.** Com chave PIX prÃ³pria cadastrada na conta, o QR dinÃ¢mico vale 12 meses apÃ³s o vencimento. **Sem chave PIX cadastrada**, o Asaas vincula a uma instituiÃ§Ã£o parceira e o QR **expira Ã s 23:59 do mesmo dia**, exigindo novo QR a cada atualizaÃ§Ã£o da cobranÃ§a (https://docs.asaas.com/docs/payments-via-pix-or-dynamic-qr-code). Se as ~120 cobranÃ§as forem geradas com dias de antecedÃªncia sem chave prÃ³pria, todos os QRs morrem na virada do dia.

**Webhook.** 29 eventos de cobranÃ§a documentados (https://docs.asaas.com/docs/webhook-para-cobrancas). DefiniÃ§Ãµes literais:
- `PAYMENT_CONFIRMED` = "CobranÃ§a confirmada (pagamento efetuado, porÃ©m, o saldo ainda nÃ£o foi disponibilizado)"
- `PAYMENT_RECEIVED` = "CobranÃ§a recebida. (Valor disponÃ­vel na conta Asaas)"

Fluxos documentados: **PIX sem atraso = `PAYMENT_CREATED` â `PAYMENT_RECEIVED`** (nÃ£o passa por CONFIRMED). PIX com atraso = `PAYMENT_CREATED` â `PAYMENT_OVERDUE` â `PAYMENT_RECEIVED`. Boleto = `PAYMENT_CREATED` â `PAYMENT_CONFIRMED` â `PAYMENT_RECEIVED`.

**Sandbox.** Painel em https://sandbox.asaas.com, API em `https://api-sandbox.asaas.com` (produÃ§Ã£o `https://api.asaas.com`, jÃ¡ default em `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub\apps\hub\lib\guardian\asaas.ts`, linha 182). Conta independente, chave prÃ³pria, sem movimentaÃ§Ã£o real. Chave de um ambiente na URL do outro dÃ¡ 401 `invalid_environment` (https://docs.asaas.com/docs/authentication). Ao setar `ASAAS_API_BASE_URL` para sandbox, usar sÃ³ o host, sem `/v3`, porque o cÃ³digo concatena `/v3` por chamada.

**AutenticaÃ§Ã£o jÃ¡ resolvida no cÃ³digo:** header `access_token`, cliente HTTP em `apps/hub/lib/guardian/asaas.ts`. NÃ£o reescrever.

---

## 2. A HORA DO PAGAMENTO (o ponto que decide a fila)

**A documentaÃ§Ã£o NÃO garante hora do pagamento.** Isso Ã© o achado mais importante do estudo.

No exemplo oficial de payload do webhook, os campos de pagamento vÃªm **como data pura, sem hora**: `confirmedDate: "2021-01-01"`, `paymentDate: "2021-01-01"`, `clientPaymentDate: "2021-01-01"`. Confirmado de forma independente pelo schema OpenAPI de listagem de cobranÃ§as, onde `paymentDate`, `clientPaymentDate` e `creditDate` sÃ£o `"format": "date"`, nÃ£o `date-time` (https://docs.asaas.com/reference/list-payments.md).

**ConsequÃªncia direta:** ordenar a fila por `paymentDate` empata as ~120 pessoas no mesmo valor no dia 01/08. A ordem viraria arbitrÃ¡ria. Isso Ã© o cenÃ¡rio do problema na frente do cliente.

Existe um campo com hora no payload: o `dateCreated` da **raiz** do evento (irmÃ£o de `event`, `payment` e `account`), formato `2024-06-12 16:45:03`. AtenÃ§Ã£o Ã  armadilha: hÃ¡ **dois** `dateCreated` no mesmo JSON, e o de dentro de `payment` Ã© sÃ³ data e se refere Ã  criaÃ§Ã£o da cobranÃ§a. Ressalva de honestidade: a doc **nÃ£o descreve** o significado do `dateCreated` da raiz, nÃ£o hÃ¡ tabela de atributos naquela pÃ¡gina. Que ele seja "a hora em que o Asaas gerou o evento" Ã© leitura da estrutura, nÃ£o afirmaÃ§Ã£o do Asaas.

### DecisÃ£o recomendada

**Chave primÃ¡ria de ordenaÃ§Ã£o da fila: `received_at`, carimbado por nÃ³s, com `clock_timestamp()` no handler do webhook, precisÃ£o de milissegundos.** Ã o Ãºnico dado sob nosso controle, com hora garantida, e nÃ£o depende de contrato nÃ£o documentado.

**Chave secundÃ¡ria (desempate e auditoria): `asaas_event_created_at`**, lido do `dateCreated` da raiz, quando presente.

**TerciÃ¡ria:** ordem de INSERT (id sequencial).

**Evento a escutar: ambos, `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`, gravando o carimbo do PRIMEIRO que chegar por cobranÃ§a e nunca sobrescrevendo.** Justificativa: PIX sem atraso vai direto para `RECEIVED` (entÃ£o sÃ³ CONFIRMED nÃ£o basta), e boleto passa por `CONFIRMED` antes (entÃ£o sÃ³ RECEIVED atrasaria quem pagou boleto). A doc nÃ£o garante ordem de entrega entre os dois, por isso a regra "primeiro que chega vence, os demais sÃ£o ignorados para efeito de ordenaÃ§Ã£o".

**Grau de confianÃ§a:** alto quanto ao mecanismo (Ã© nosso relÃ³gio), mÃ©dio quanto Ã  latÃªncia. `received_at` Ã© hora de notificaÃ§Ã£o, nÃ£o o instante exato do PIX no Bacen. Para PIX a defasagem Ã© de segundos, o que Ã© aceitÃ¡vel quando o espaÃ§amento real entre pagamentos de 120 pessoas Ã© de minutos. **Mas Ã© vulnerÃ¡vel a retentativa**: um webhook que falhe e volte 10 minutos depois entraria fora de ordem. MitigaÃ§Ã£o no item 4.

---

## 3. DESENHO

### 3.1 Tabelas (migration nova, seguindo a regra jÃ¡ aprendida)

Estado operacional **nÃ£o** vai em `apolo_entities.metadata`, porque o sync do C2X substitui o metadata inteiro (foi assim que sumiram 122 CADs em 20/07). Tabelas prÃ³prias:

**`prometeu_cobrancas`**
- `id` (pk)
- `apolo_entity_id`, `cad_id` (origem da CAD)
- `asaas_customer_id`, `asaas_payment_id` (unique)
- `idempotency_key` (unique, ver 3.3)
- `valor`, `billing_type`, `due_date`
- `pix_payload` (copia e cola), `pix_qr_base64`, `pix_expiration_date`
- `status` (`criada` | `aguardando` | `paga` | `vencida` | `cancelada` | `estornada`)
- **`paid_received_at` (timestamptz, precisÃ£o ms, NULL atÃ© o primeiro evento de pagamento)** â chave da fila
- `paid_event_created_at` (timestamptz, do `dateCreated` da raiz)
- `paid_event_name` (`PAYMENT_RECEIVED` ou `PAYMENT_CONFIRMED`)
- `paid_date_asaas` (date, o `paymentDate`, sÃ³ conferÃªncia)
- `created_at`, `updated_at`

**`prometeu_webhook_events`** (log cru, append-only, nunca sobrescreve)
- `id`, `asaas_event_id` (unique, o `id` da raiz do payload) â base da idempotÃªncia
- `event`, `asaas_payment_id`
- `payload_raw` (jsonb, o JSON inteiro)
- `received_at` (timestamptz default `clock_timestamp()`)
- `processed_at`, `process_error`

OrdenaÃ§Ã£o da fila:
```sql
ORDER BY paid_received_at ASC NULLS LAST, paid_event_created_at ASC, id ASC
```

### 3.2 Da CAD atÃ© o PIX (fluxo)

1. CAD validada no Apolo (proponente correto, atenÃ§Ã£o ao caso das fichas com pessoa trocada).
2. BotÃ£o "Gerar cobranÃ§a de prÃ©-venda". Busca `asaas_customer_id` jÃ¡ gravado na entidade. Se nÃ£o houver: consulta por `cpfCnpj` no Asaas; se nÃ£o achar, `POST /v3/customers` com `externalReference = apolo_entity_id`. Grava o `id` retornado na entidade. **Nunca criar customer novo a cada cobranÃ§a.**
3. `POST /v3/payments` com `customer`, `billingType: "UNDEFINED"`, `value: 1000.00`, `dueDate`, `description` ("PrÃ©-venda lanÃ§amento 01/08"), `externalReference = prometeu_cobrancas.id`.
4. `GET /v3/payments/{id}/pixQrCode`, grava `payload` e `encodedImage`.
5. Envio do link/copia e cola **pela Iris**, nÃ£o por disparo do Asaas (regra do Lucas: disparo tem custo).

### 3.3 IdempotÃªncia na criaÃ§Ã£o (evitar cobranÃ§a duplicada)

NÃ£o confiar em header de idempotÃªncia do Asaas (nÃ£o verificado como existente). Fazer do nosso lado:

- Gerar `idempotency_key = hash(apolo_entity_id + "pre_venda_lancamento_2026_08_01")`, com **unique constraint**.
- Inserir a linha em `prometeu_cobrancas` com status `criada` **antes** de chamar o Asaas. Se o unique estourar, a cobranÃ§a jÃ¡ existe: devolve a existente, nÃ£o chama a API.
- Em timeout na chamada ao Asaas, **nÃ£o** repetir cegamente. Consultar `GET /v3/payments?externalReference={nosso_id}` e sÃ³ criar se nÃ£o existir.

### 3.4 Webhook

Endpoint prÃ³prio no hub, ex. `/api/webhooks/asaas/prometeu`. Handler em duas fases, e essa separaÃ§Ã£o Ã© a proteÃ§Ã£o principal:

**Fase 1, sempre, o mais rÃ¡pido possÃ­vel:**
1. Valida o token do header (ver item 5).
2. `INSERT` em `prometeu_webhook_events` com `received_at = clock_timestamp()` e `payload_raw` inteiro. `ON CONFLICT (asaas_event_id) DO NOTHING`.
3. Responde **200 imediatamente**.

Motivo: o `received_at` que ordena a fila tem que ser gravado antes de qualquer processamento, e a resposta 200 rÃ¡pida evita entrar em retentativa e em penalizaÃ§Ã£o de fila do Asaas.

**Fase 2, processamento (mesma request apÃ³s o commit, ou job):**
- Se `event` â {`PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`} e a cobranÃ§a ainda tem `paid_received_at IS NULL`: grava `paid_received_at` (o `received_at` do evento), `paid_event_created_at`, `paid_event_name`, `paid_date_asaas`, `status = 'paga'`.
- **`UPDATE ... WHERE paid_received_at IS NULL`**, condicional no prÃ³prio SQL. Isso torna o segundo evento inofensivo sem lÃ³gica de aplicaÃ§Ã£o.
- Atualiza a esteira (`apolo_esteira`) para a etapa de prÃ©-venda paga.
- Emite notificaÃ§Ã£o (hub_notifications) e, se for o caso, Realtime para o telÃ£o.

### 3.5 A fila do Prometeu

A Central do Prometeu lÃª `prometeu_cobrancas` ordenada como em 3.1, junta com a entidade do Apolo, e materializa a posiÃ§Ã£o. **RecomendaÃ§Ã£o forte:** no dia 01/08, congelar a posiÃ§Ã£o num campo `posicao_fila` gravado explicitamente (com um botÃ£o "fechar fila"), em vez de recalcular a cada render. Fila que se reordena sozinha na frente do cliente porque um webhook atrasado chegou Ã© o pior cenÃ¡rio possÃ­vel.

---

## 4. RISCOS E O QUE FAZER

**Webhook perdido (nosso endpoint fora do ar, deploy no momento errado).** ConsequÃªncia: pessoa pagou e nÃ£o aparece na fila. MitigaÃ§Ã£o: **cron de reconciliaÃ§Ã£o a cada 5 minutos** varrendo `GET /v3/payments?status=RECEIVED&paymentDate=...` e comparando com nossas cobranÃ§as sem `paid_received_at`. Para as encontradas por reconciliaÃ§Ã£o, gravar `paid_received_at` com flag `origem = 'reconciliacao'` e sinalizar na UI, porque o horÃ¡rio Ã© impreciso (sÃ³ temos a data). Essas pessoas precisam de decisÃ£o manual de posiÃ§Ã£o. **Congelar deploys no dia 01/08 e nas 48h anteriores.**

**Evento duplicado.** Coberto por duas travas: unique em `asaas_event_id` e o `WHERE paid_received_at IS NULL`. Duplicata Ã© no-op.

**CobranÃ§a duplicada.** Coberto pelo `idempotency_key` unique + consulta por `externalReference` antes de recriar. DetecÃ§Ã£o: relatÃ³rio diÃ¡rio de entidades com mais de uma cobranÃ§a de prÃ©-venda ativa.

**Pagamento fora do horÃ¡rio / muito prÃ³ximo do evento.** Definir corte com o Lucas (ex.: pagamentos apÃ³s X do dia 31/07 entram no fim da fila, nÃ£o na ordem cronolÃ³gica). Regra tem que ser escrita e visÃ­vel na tela, nÃ£o improvisada na mesa.

**Dois pagamentos com `received_at` idÃªntico ao milissegundo.** Praticamente impossÃ­vel, mas o desempate por `id` garante determinismo.

**QR expirado.** Se a chave PIX prÃ³pria nÃ£o estiver cadastrada, todos os QRs gerados com antecedÃªncia morrem Ã s 23:59. **Verificar isso na conta de produÃ§Ã£o antes de emitir qualquer cobranÃ§a.** Ã bloqueador.

**Boleto pago perto do evento.** Boleto tem compensaÃ§Ã£o; `PAYMENT_CONFIRMED` pode chegar dias depois do pagamento real. RecomendaÃ§Ã£o: **fechar boleto alguns dias antes de 01/08** e aceitar sÃ³ PIX na reta final, senÃ£o a fila mistura ordens incomparÃ¡veis.

**Cliente aparece no evento sem estar na fila.** Precisa de procedimento manual definido: quem decide, com base em quÃª (comprovante do PIX com horÃ¡rio), e onde registra.

---

## 5. O QUE FALTA PERGUNTAR OU DECIDIR

**Ao Asaas (suporte, nÃ£o a doc, porque nÃ£o estÃ¡ documentado):**
1. Existe algum campo, em qualquer endpoint, com o **horÃ¡rio** (HH:MM:SS) da liquidaÃ§Ã£o do PIX? A doc sÃ³ entrega data. Perguntar especificamente sobre a API de transaÃ§Ãµes PIX.
2. Qual Ã© o **mecanismo de autenticaÃ§Ã£o do webhook**? Existe token configurÃ¡vel e em qual header ele chega? NÃ£o foi encontrado na documentaÃ§Ã£o verificada. **Isso Ã© lacuna aberta e precisa ser resolvido antes de subir o endpoint.**
3. **PolÃ­tica de retentativa**: quantas tentativas, em que intervalo, e em que condiÃ§Ã£o a fila Ã© pausada ou penalizada. A doc de eventos referencia pÃ¡ginas "PenalizaÃ§Ã£o de filas" e "Fila pausada" que nÃ£o foram lidas neste estudo. **Ler antes de ir a produÃ§Ã£o.**
4. Existe header de **idempotÃªncia** na criaÃ§Ã£o de cobranÃ§a?
5. **Tarifas** de PIX e de boleto na conta da Careli. **NÃO ENCONTRADO NA DOCUMENTAÃÃO** tÃ©cnica; Ã© informaÃ§Ã£o comercial da conta. 120 Ã R$ 1.000 = R$ 120.000, a diferenÃ§a de tarifa entre PIX e boleto Ã© material.
6. **Rate limit** da API. NÃ£o verificado. Importa se as 120 cobranÃ§as forem geradas em lote.

**Com o Lucas:**
- PIX e boleto, ou sÃ³ PIX? Boleto complica a ordenaÃ§Ã£o por compensaÃ§Ã£o.
- Data de corte do boleto.
- `dueDate` das cobranÃ§as: qual data?
- Fila congelada ou viva? (recomendo congelada, com botÃ£o)
- Regra para pagamento de Ãºltima hora e para pagamento nÃ£o capturado por webhook.
- Conta Asaas: a mesma do Hades (Guardian) ou conta separada para o lanÃ§amento? Isso muda a chave e o webhook.

---

## 6. PRIMEIRO PASSO CONCRETO EM SANDBOX

Objetivo Ãºnico: **descobrir se o payload real do webhook de PIX traz hora**. Tudo o mais Ã© secundÃ¡rio.

1. Criar conta em https://sandbox.asaas.com, gerar API Key de sandbox.
2. Rodar o hub local com `ASAAS_API_BASE_URL=https://api-sandbox.asaas.com` (sem `/v3`) e a chave de sandbox.
3. Subir um endpoint temporÃ¡rio que **grava o JSON cru inteiro** e responde 200, exposto por tÃºnel. Cadastrar como webhook no painel de sandbox, assinando `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`.
4. `POST /v3/customers` â guardar o `cus_...` e **registrar o JSON cru da resposta**, porque os campos de resposta desse endpoint nÃ£o estÃ£o documentados na pÃ¡gina de referÃªncia (o bloco Ã© placeholder do ReadMe). Mesmo procedimento que fizemos com o contrato do MOST iOCR.
5. `POST /v3/payments` com `billingType: "UNDEFINED"`, `value: 1000.00`.
6. `GET /v3/payments/{id}/pixQrCode` â confirmar que voltam mesmo `encodedImage`, `payload`, `expirationDate`.
7. Confirmar o pagamento em sandbox e **capturar o payload cru do webhook**.
8. **Verificar item a item:** `paymentDate`, `confirmedDate`, `clientPaymentDate` vieram com hora ou sÃ³ data? O `dateCreated` da raiz veio com HH:MM:SS? Qual header trouxe token de autenticaÃ§Ã£o? Qual evento chegou primeiro no PIX?
9. Registrar o JSON cru como referÃªncia canÃ´nica no repo (padrÃ£o do `reference_mostqi_iocr_contract`).

**SÃ³ depois desse passo 8** Ã© que a arquitetura da fila deve ser fechada. Se o payload real trouxer hora onde a doc mostra sÃ³ data, muda a chave primÃ¡ria de ordenaÃ§Ã£o. Se nÃ£o trouxer, `received_at` nosso estÃ¡ confirmado como Ãºnica opÃ§Ã£o, e aÃ­ a robustez do endpoint (uptime, resposta rÃ¡pida, reconciliaÃ§Ã£o) vira o requisito mais crÃ­tico do projeto inteiro.

ObservaÃ§Ã£o de ambiente: sandbox tem limitaÃ§Ã£o declarada em "alguns cenÃ¡rios especÃ­ficos envolvendo QR Code Pix", e o horÃ¡rio de confirmaÃ§Ã£o lÃ¡ Ã© o da simulaÃ§Ã£o. O teste valida o **contrato** (nomes e formatos dos campos), nÃ£o a latÃªncia real. Antes de 01/08, fazer **um PIX real de valor baixo em produÃ§Ã£o** para medir a defasagem entre pagamento e chegada do webhook.",
    