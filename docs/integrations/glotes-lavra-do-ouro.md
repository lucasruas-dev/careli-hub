# GLOTES x Lavra do Ouro: entrega de dados da carteira

**Status:** levantamento concluído e conferido. Nada implementado.
**Atualização 25/09/2026:** a API está no ar desde 14/08/2026 (contrato em `docs/integrations/glotes-openapi.yaml`). A carga incremental foi corrigida em 25/09: ver a seção 14.
**Data da conferência:** 07/08/2026 (queries rodadas direto no C2X de produção, somente leitura).
**Fonte:** C2X legado (MySQL AWS RDS), acesso por `apps/hub/lib/guardian/db.ts` (`getHadesDbPool` + `withHadesDbRetry`).
**Mapa de tabelas:** `docs/architecture/c2x-schema-map.md`.

---

## 1. Para quem nunca viu este assunto

A Careli administra a carteira de financiamento do loteamento **Lavra do Ouro**. O cliente (a
loteadora) opera um sistema próprio chamado **GLOTES** e quer receber, do nosso lado, os dados da
carteira dele: loteamentos, clientes, lotes, vendas e recebimentos.

O GLOTES definiu cinco conjuntos de dados e, em cada um, marcou os campos como **obrigatório**,
**recomendado** ou **opcional**. Este documento responde a três perguntas:

1. O que desses campos existe no C2X e onde exatamente ele mora.
2. O que não existe (e é o ponto que trava a entrega).
3. Como entregar, com que frequência, e por qual canal.

O documento não decide nada sozinho. As decisões de negócio estão nas seções 10 e 11.

### Os dois "Lavra do Ouro"

No C2X existem **dois** empreendimentos com o nome idêntico `LAVRA DO OURO`:

| id | code | name | divulgation_name | unidades |
|----|------|------|------------------|----------|
| 1 | `LOU` | LAVRA DO OURO | LAVRA DO OURO | 216 |
| 4 | `LOS` | LAVRA DO OURO | LAVRA DO OURO | 277 |

O que separa os dois é só o `code` (`LOU` e `LOS`). O nome não separa. Toda a numeração de lote
carrega o prefixo (`LOU0101`, `LOS0301`), então o `code` é a chave prática. As quadras também não
se sobrepõem hoje (LOU usa 01, 02, 18, 19, 20, 21, 26, 27; LOS usa 03, 04, 05, 06, 14, 15, 16, 17,
24, 25), mas isso é coincidência operacional, não regra do banco. **Não confiar na quadra para
separar loteamento.**

---

## 2. Recorte de dados (o que entra na carga)

O recorte padrão adotado neste levantamento:

```
enterprise_unities.enterprise_id in (1, 4)      -- os dois Lavra do Ouro
acquisition_requests.open = 1                    -- vendas vigentes
```

Além disso, quando o assunto é dinheiro, a casa filtra parcelas ativas:

```
payments.payment_to_delete is null or payments.payment_to_delete = 0
payments.payment_status_id in (5, 6, 7)          -- Pago, Aguardando pagamento, Atrasado
```

Conferido: no recorte da Lavra do Ouro, **nenhuma** parcela está marcada para deleção e **nenhuma**
está fora dos status 5/6/7. Os dois filtros não mudam o resultado hoje, mas devem entrar na query
mesmo assim, porque protegem a carga contra mudança futura no C2X.

---

## 3. Volumes conferidos (07/08/2026)

| Conjunto | Linhas | Observação |
|----------|--------|------------|
| loteamentos | **2** | enterprise 1 (LOU) e 4 (LOS) |
| lotes | **493** | 216 no LOU + 277 no LOS |
| clientes | **375** | titulares das vendas abertas; sobe para 433 se incluir canceladas |
| vendas | **475** | todas em estágio 4 "Faturado"; 573 se incluir as 98 canceladas |
| recebimentos | **68.356** | 68.481 se incluir as canceladas (que somam só 125 parcelas) |
| cônjuges | **183** | se virar tabela própria |

Quebra dos lotes por status: **475 Vendido**, **18 Disponível**. Nenhum em Reservado, Em negociação
ou Bloqueado para venda. Há **51** unidades com `secured_lot = 1` e **7** com `sale_blocked = 1`
(todas as 7 no empreendimento 1, dentro das 9 disponíveis).

Quebra dos recebimentos por status: **12.530 Pago**, **54.364 Aguardando pagamento**, **1.462
Atrasado**. Por tipo de parcela: **66.805 Parcela**, **1.076 Sinal**, **474 Ato**, **1 Avulso**.
Vencimentos vão de 02/12/2023 a 20/03/2037.

Concentração de clientes: 302 têm 1 venda, 57 têm 2, 12 têm 3, e há um cliente com 4, um com 5, um
com 6 e um com 8. Não existe co-comprador: `client_2_id` a `client_5_id` estão vazios nas 475
vendas, então os campos `percentage_client_*` não importam.

Saldo da carteira pela convenção da casa (seção 8): **R$ 34.567.128,24 devido** e **R$ 9.260.676,26
já pago**. Esses números incluem o saldo fantasma descrito no buraco B4, que precisa ser tratado.

---

## 4. Tabela de-para completa

Legenda de "Temos?": **SIM** = existe e está preenchido no recorte. **PARCIAL** = existe mas com
ressalva. **NÃO** = não existe em lugar nenhum do C2X.

### 4.1 loteamentos

| Campo | Nível | Origem no C2X | Temos? | Observação |
|-------|-------|---------------|--------|------------|
| `codigo_loteamento` | obrigatório | `enterprises.code` | SIM | `LOU` (id 1) e `LOS` (id 4). Preferir `code` ao `id`: é único, legível e não colide com `users.id` nem com `acquisition_requests.id`. |
| `nome` | obrigatório | `enterprises.name` | PARCIAL | Os **dois** registros se chamam exatamente `LAVRA DO OURO`, e `divulgation_name` idem. Sem o `code`, o GLOTES não distingue os dois loteamentos. Sugestão: enviar `LAVRA DO OURO (LOU)` e `LAVRA DO OURO (LOS)`, ou pedir ao cliente o nome comercial correto de cada gleba. |

### 4.2 clientes

| Campo | Nível | Origem no C2X | Temos? | Observação |
|-------|-------|---------------|--------|------------|
| `codigo_cliente` | obrigatório | `users.user_code` | SIM | Formato `CLI146`. Preenchido em 375/375. Sem nenhuma duplicata em toda a base de 4.590 usuários (só 1 usuário na base inteira está sem código, e não é da Lavra). |
| `nome` | obrigatório | `users.name` | SIM | 375/375. **Atenção:** nos 6 clientes PJ, `users.name` traz a pessoa física representante. A razão social está em `users.social_name` e o nome fantasia em `users.fantasy_name`. |
| `cpf_cnpj` | obrigatório | `users.cpf` quando `person_type_id = 1`; `users.cnpj` quando `person_type_id = 2` | SIM | Cobertura efetiva 375/375: 369 PF (todos com CPF) e 6 PJ (todos com CNPJ). Vem **com máscara**: `000.000.000-00` e `00.000.000/0000-00`. Precisa normalizar na saída. |
| `endereco` | recomendado | `addresses.address` + `addresses.number` + `addresses.complement`, com `ownertable_type = 'User'` e `ownertable_id = users.id` | SIM | A tabela é polimórfica; **sem o filtro de `ownertable_type` a query traz endereço de empreendimento junto**. Exatamente 1 endereço por cliente (nenhum com 2 ou mais). Logradouro e número em 375/375; complemento em 125/375 (33%). |
| `bairro` | recomendado | `addresses.district` | SIM | 375/375. |
| `cidade` | recomendado | `cities.name` via `addresses.city_id` | SIM | 375/375. Nome com acento (`Belo Horizonte`, `Mateus Leme`). |
| `uf` | recomendado | `states.acronym` via `addresses.state_id` | SIM | 375/375. MG 373, GO 1, SP 1. |
| `cep` | recomendado | `addresses.zipcode` | SIM | 375/375, mas **todos** no formato pontuado `00.000-000`. Nenhum cru (8 dígitos) nem no formato `30510-690`. Precisa normalizar. |
| `conjuge_nome` | recomendado | `spouses.name` com `ownertable_type = 'User'` | PARCIAL | 183/375 clientes (48,8%) têm cônjuge cadastrado, e desses 183/183 têm nome. **Não é falha de cadastro:** o universo aplicável é 176 casados + 5 em união estável = 181, e todos os 181 têm cônjuge (os 2 restantes são clientes solteiros com cônjuge registrado). Cobertura de quem precisa: 100%. Tabela também polimórfica. |
| `conjuge_cpf` | opcional | `spouses.cpf` | SIM | 183/183 dos que têm cônjuge. Mesma máscara de CPF. |

### 4.3 lotes

| Campo | Nível | Origem no C2X | Temos? | Observação |
|-------|-------|---------------|--------|------------|
| `codigo_lote` | obrigatório | `enterprise_unities.name` | SIM | Formato `code + quadra + lote`: `LOU0101`, `LOS0301`. **493 valores distintos em 493 unidades**, zero colisão. Legível e já usado pelo time. O `id` colide numericamente com `users.id` e `acquisition_requests.id`. |
| `codigo_loteamento` | obrigatório | `enterprise_unities.enterprise_id` (traduzir para `enterprises.code`) | SIM | 493/493. 216 no LOU, 277 no LOS. |
| `quadra` | obrigatório | `enterprise_unities.block` | SIM | 493/493. Texto zero-padded (`01`, `02`). |
| `lote` | obrigatório | `enterprise_unities.lot` | SIM | 493/493. Texto zero-padded (`01` a `40`). O campo `name` confirma a composição: `LOU0101` = `LOU` + `01` + `01`. |
| `status` | obrigatório | `sale_statuses.name` via `enterprise_unities.sale_status_id` | SIM | 493/493, mas só 2 dos 5 valores aparecem: Vendido (475) e Disponível (18). De-para completo: 1 Disponível, 2 Reservado, 3 Em negociação, 4 Vendido, 5 Bloqueado para venda. **O bloqueio real não está aqui:** são as flags separadas `sale_blocked = 1` (7 unidades) e `secured_lot = 1` (51 unidades), que não aparecem no `sale_status_id`. |
| `valor` | obrigatório | `enterprise_unities.price` | SIM | 493/493, decimal, nenhum nulo nem zero. É o preço de tabela do lote. Ver a seção 8.2: ficou **provado** que este é o preço que baseia o contrato. |
| `area_total` | recomendado | `enterprise_unities.area` | SIM | 493/493, decimal em m². Bate com o contrato (a cláusula 1.4 diz "com área global de 444.32 metros quadrados" para o lote LOU0101, que tem `area = 444.32`). |
| `frente` | recomendado | **NÃO TEMOS** | NÃO | Ver buraco B1. |
| `fundo` | recomendado | **NÃO TEMOS** | NÃO | Ver buraco B1. |
| `lado_direito` | recomendado | **NÃO TEMOS** | NÃO | Ver buraco B1. |
| `lado_esquerdo` | recomendado | **NÃO TEMOS** | NÃO | Ver buraco B1. |
| `lado5` | opcional | **NÃO TEMOS** | NÃO | Ver buraco B1. |
| `lado6` | opcional | **NÃO TEMOS** | NÃO | Ver buraco B1. |

### 4.4 vendas

| Campo | Nível | Origem no C2X | Temos? | Observação |
|-------|-------|---------------|--------|------------|
| `codigo_venda` | obrigatório | `acquisition_requests.id` | SIM | **Usar o id.** Não usar `acquisition_requests.code`: ver buraco G1. Não existe chave natural legível para venda nesta base. Recomendo prefixar (`VEN-45`) na saída. |
| `codigo_cliente` | obrigatório | `acquisition_requests.client_id` (traduzir para `users.user_code`) | SIM | 475/475. Sem co-compradores. |
| `codigo_lote` | obrigatório | `acquisition_requests.enterprise_unity_id` (traduzir para `enterprise_unities.name`) | SIM | 475/475. Nas vendas abertas há exatamente 1 venda por unidade. |
| `data_venda` | obrigatório | `acquisition_requests.act_date` | SIM | 475/475 (100%), de 02/12/2023 a 27/11/2024. Alternativas piores: `sign_date` só 40/475 (8,4%) e `billing_date` 275/475 (57,9%). Recomendo `act_date`. |
| `valor_venda` | obrigatório | `enterprise_unities.price` (recomendação) | PARCIAL | **Não existe coluna de valor da venda.** Ver buraco B2. A recomendação é `price`, com prova na seção 8.2. |
| `qtd_parcelas` | obrigatório | `count(payments where parcel_type_id = 3)` | SIM | Contar as linhas, não usar `payments.total_parcels`: os dois divergem em 4 das 475 vendas e há 1 venda sem valor. Distribuição: 456 vendas com 144 parcelas, 8 com 24, e uma cauda de casos avulsos. |
| `valor_parcela` | obrigatório | não existe valor único | PARCIAL | Ver buraco B3. Em 467 das 474 vendas com parcelas, o valor **varia dentro do próprio contrato** (o reajuste já vem embutido no cronograma gerado). Só 7 vendas têm parcela fixa. |
| `data_1o_vencimento` | obrigatório | `min(payments.due_date where parcel_type_id = 3)` | SIM | Derivável em 474/475 (a venda sem nenhuma parcela tipo 3 fica sem). Vai de 10/01/2024 a 09/05/2026. |
| `qtd_sinal` | obrigatório | `count(payments where parcel_type_id = 2)` | SIM | Contar as linhas. O declarado `acquisition_requests.quantity_signal_parcels` bate com a contagem real em 463/475 (diverge em 12). 2 vendas não têm nenhuma parcela de sinal. |
| `valor_sinal` | obrigatório | `sum(payments.initial_value where parcel_type_id = 2)` | SIM | Somar as parcelas de sinal. Se o GLOTES quiser a entrada completa, somar também o tipo 1 (Ato). |
| `data_sinal` | obrigatório | `acquisition_requests.first_signal_payment` | SIM | 475/475. Alternativa: `min(payments.due_date where parcel_type_id in (1,2))`. |
| `indice` | obrigatório | `index_monetary_corrections.name` via `commercial_plans.index_monetary_correction_id`, chegando pelo `acquisition_requests.commercial_plan_id` | PARCIAL | 465/475 resolvem para `IPCA ANUAL`; 10 vendas ficam sem índice (`custom_commercial_plan = 1` com `commercial_plan_id` nulo). Ver buraco M1 sobre a armadilha do join e a divergência com o contrato. |
| `situacao` | opcional | `acquisition_request_stages.name` via `acquisition_requests.acquisition_request_stage_id` | SIM | Campo constante por recorte: as 475 abertas estão todas em estágio 4 "Faturado"; as 98 fechadas estão todas em estágio 7 "Cancelado". |
| `percentual_reajuste` | opcional | ambíguo | PARCIAL | Ver buraco M2. Candidatos: `commercial_plans.contractual_interest` (8,0000 em 457 vendas, 0,0000 nos planos CURTO e INVESTIDOR) ou `commercial_plans.correction_rate` (2,00 nas 207 vendas do empreendimento 1, nulo nas 268 do empreendimento 4). |
| `observacao` | opcional | `acquisition_requests.observation` | NÃO | Preenchido em **0** das 475 vendas. |

### 4.5 recebimentos

| Campo | Nível | Origem no C2X | Temos? | Observação |
|-------|-------|---------------|--------|------------|
| `codigo_venda` | obrigatório | `payments.acquisition_request_id` | SIM | 68.356/68.356. |
| `codigo_cliente` | obrigatório | via `acquisition_requests.client_id` | SIM | Derivado da venda. |
| `numero_parcela` | obrigatório | `payments.current_total_parcel` (tipo 3) / `payments.current_signal_parcel` (tipo 2) | PARCIAL | **Não é único.** Ver buraco B4. A única chave confiável de recebimento é `payments.id`. |
| `tipo_parcela` | obrigatório | `parcel_types.name` via `payments.parcel_type_id` | SIM | De-para: 1 Ato, 2 Sinal, 3 Parcela, 4 Avulso. |
| `data_vencimento` | obrigatório | `payments.due_date` | SIM | 68.356/68.356, nenhum nulo. |
| `valor_parcela` | obrigatório | `payments.initial_value` | SIM | 68.356/68.356, nenhum nulo. Apenas 1 linha com valor zero. |
| `valor_original` | recomendado | `payments.initial_value` | SIM | É a mesma coluna. O C2X não guarda "valor original" separado do "valor atual": o cronograma já nasce reajustado. |
| `data_pagamento` | obrigatório | `payments.payment_date` | SIM | Preenchida em 12.530/12.530 das parcelas pagas. Há **344** parcelas com valor pago sem data (todas em status "Atrasado", pagamento parcial). Ver correção C2. |
| `valor_pago` | obrigatório | `payments.paid_value` | SIM | 12.874 linhas com valor pago maior que zero (12.530 pagas + 344 atrasadas com pagamento parcial). Cuidado: outras 940 linhas têm `paid_value = 0`, que não é pagamento. |
| `valor_juros` | recomendado | `payments.interest_value` | PARCIAL | Ver buraco G2. Decomposto em apenas **361** das 68.356 linhas (0,5%), todas de 2026, somando R$ 4.695,58. |
| `valor_multa` | recomendado | `payments.mulct_value` | NÃO | **Zero em 68.356 de 68.356 linhas.** A Careli não grava multa no C2X. |
| `valor_desconto` | recomendado | **NÃO EXISTE COLUNA** | NÃO | Ver buraco G3. |
| `forma_pagamento` | recomendado | `payment_types.name` via `payments.payment_type_id` | PARCIAL | Constante: `Boleto` em 68.356 de 68.356 (100%). Nenhum PIX ou cartão registrado. Só 1.644 parcelas (2,4%) têm `payment_asaas_id`. |
| `status_parcela` | opcional | `payment_statuses.name` via `payments.payment_status_id` | SIM | 5 Pago, 6 Aguardando pagamento, 7 Atrasado. |
| `nosso_numero` | opcional | **NÃO TEMOS** | NÃO | A tabela `payment_transactions` (que tem `invoice_id`, `invoice_barcode`, `invoice_barcode_formatted`) está com **0 linhas em toda a base**. O único identificador externo é `payments.payment_asaas_id`, em 1.644 de 68.356. |
| `observacao` | opcional | `payments.description` | NÃO | Preenchida em **1** de 68.356 linhas. |

---

## 5. Buracos que travam a entrega

### B1. BLOQUEANTE: o lote não tem medidas

`frente`, `fundo`, `lado_direito`, `lado_esquerdo`, `lado5` e `lado6` **não existem em lugar nenhum
do C2X**. Isso foi confirmado por três caminhos independentes:

1. **Varredura de esquema.** Consulta em `information_schema.columns` sobre as 130 tabelas com o
   regexp `front|frente|fundo|_side|side_|lado|width|largura|comprim|medida|perimet|confront|memorial|dimens|metragem|testada|matricul`
   retornou **zero linhas**.
2. **Varredura de tabelas.** Nenhuma tabela com nome contendo `matric`, `regist`, `cartor`,
   `survey`, `memor`, `plant`, `geo`, `polyg` ou `map`. Não existe estrutura de memorial descritivo,
   matrícula ou polígono.
3. **Texto dos contratos.** Nos 475 contratos das vendas abertas: **0** ocorrências de "medindo",
   **0** de "fundo", **0** de "lado direito". A cláusula 1.4 traz só a área global e a matrícula.
   "Confrontações" aparece apenas na cláusula genérica em que o comprador declara conhecer os
   limites. As 49 ocorrências de "frente" são falso positivo: todas são a frase "responsável pelo
   cumprimento da obrigação **frente** à municipalidade".

Também conferido: `enterprise_unities.extensive_area` (texto) está **0/493 preenchido**, e no
`active_storage` o `EnterpriseUnity` só tem anexo do tipo `image`. Existe `plant_image` (8) e
`map_image` (11) anexados ao `Enterprise`, mas são imagens raster da planta do loteamento, não dado
estruturado. (Registro relacionado: o masterplan SVG do Vale do Ouro sofre do mesmo problema, é
imagem embutida e não vetor.)

**Consequência:** se o GLOTES exigir as medidas para aceitar a carga, a fonte tem que ser externa
ao C2X, ou seja, o memorial descritivo do cartório ou a planta aprovada do loteamento. Isso é um
projeto separado: alguém precisa digitalizar 493 conjuntos de medidas. **Não é trabalho de
integração, é trabalho de cadastro.**

### B2. BLOQUEANTE: `valor_venda` não tem coluna

Não existe campo de valor da venda em `acquisition_requests`. Conferido: `annual_value` está
preenchido em **0** das 475 vendas, e `commercial_plans.annual_value` também em 0.
`commercial_plans.initial_input_value` existe mas é **percentual** (vale `10.0000`, ou seja 10%),
não valor.

Os três candidatos, no lote `LOU0101` (venda 45):

| Candidato | Valor | Como se obtém |
|-----------|-------|---------------|
| Preço de tabela | R$ 85.722,00 | `enterprise_unities.price` |
| Soma do fluxo gerado | R$ 85.832,91 | `sum(payments.initial_value)` da venda |
| "Preço de Venda" no contrato | R$ 80.150,07 | texto da cláusula 1.6.1 |

**A recomendação é `enterprise_unities.price`.** A prova está na seção 8.2.

### B3. BLOQUEANTE: `valor_parcela` não existe como valor único

Em **467 das 474** vendas que têm parcelas do tipo 3, o valor da parcela **varia dentro do mesmo
contrato**. Exemplos: a venda 10 vai de R$ 389,79 a R$ 412,20; a venda 17 vai de R$ 535,99 a R$
584,08. Só 7 vendas têm parcela fixa.

Isso acontece porque o C2X **gera o cronograma inteiro já reajustado**: cada parcela nasce com o
valor que terá no vencimento dela. Não existe um "valor da parcela" que represente o contrato.

O que dá para entregar no campo `valor_parcela` do conjunto `vendas`:

- o valor da **1ª parcela** (é o que o cliente contratou como prestação inicial), ou
- o valor **médio**, ou
- nada, e o GLOTES lê parcela a parcela no conjunto `recebimentos` (que tem o valor certo de cada
  uma).

Isso é pergunta para o cliente, não decisão nossa.

### B4. GRAVE: 236 parcelas duplicadas inflam a carteira em R$ 90.609,84

A combinação `venda + tipo + número de parcela` está duplicada em **155 combinações**, envolvendo
**391 linhas**, das quais **236 são linhas extras**. Elas estão concentradas em **apenas 2 vendas**:

| Venda | Lote | Linhas extras | Valor extra | Parcelas totais hoje |
|-------|------|---------------|-------------|----------------------|
| 242 | LOU1836 | 122 | R$ 46.840,68 | 269 |
| 243 | LOU1835 | 114 | R$ 43.769,16 | 261 |

O padrão é claro: são duplicatas literais, mesmo vencimento, mesmo valor, criadas com poucos
segundos de diferença. Exemplo na venda 242, parcela 66: `payments.id` 161296 (criado às
16:03:16) e 161485 (criado às 16:03:49), ambos com vencimento 20/08/2029 e valor R$ 383,94.

O efeito no dinheiro é visível: essas duas vendas têm soma de fluxo **76%** e **71%** acima do preço
do lote, enquanto as outras 473 batem dentro de mais ou menos 2%. **Se a carga for feita sem
tratar isso, o GLOTES vai receber R$ 90.609,84 de saldo que não existe.**

Duas conclusões práticas:

1. A única chave confiável de recebimento é `payments.id`. `numero_parcela` não serve como chave.
2. Estas 2 vendas precisam ser corrigidas no C2X (ou excluídas da primeira carga) antes do go-live.
   Isso é conserto no legado, fora do escopo desta integração, mas é pré-requisito dela.

### G1. Armadilha: `acquisition_requests.code` NÃO é código de venda

`code` é a sigla do empreendimento mais o ordinal de revenda daquela unidade. Nas 475 vendas
abertas da Lavra do Ouro:

| code | vendas |
|------|--------|
| `LOS1` | 235 |
| `LOU1` | 170 |
| `LOU2` | 30 |
| `LOS2` | 28 |
| `LOU3` | 6 |
| `LOS3` | 2 |
| `LOS4` | 2 |
| `LOU5` | 1 |
| `LOS5` | 1 |

Usar `code` como `codigo_venda` colapsaria 235 vendas em um único registro. **Usar `id`.**

### G2. GRAVE: encargos cobrados mas não decompostos

Nas 12.530 parcelas pagas: **5.213** foram pagas por valor **maior** que o `initial_value`,
somando **R$ 171.477,52** de encargo efetivamente cobrado. Desse total, apenas **R$ 4.695,58**
(361 linhas, todas com vencimento em 2026) estão decompostos em `interest_value`. Os outros
**R$ 166.781,94**, em **4.851** parcelas, estão embutidos no `paid_value` sem separação e são
irrecuperáveis por consulta.

Também: 23 parcelas foram pagas por valor **menor** que o devido (pagamento parcial, não desconto),
e 7.294 pagaram exatamente o valor.

Consequência para o GLOTES: `valor_juros` sai preenchido em 0,5% dos casos e `valor_multa` sai
sempre zero, mas o `valor_pago` **inclui** o encargo. Se o GLOTES fizer a conta
`valor_pago - valor_parcela - valor_juros - valor_multa` esperando bater em zero, não vai bater.

### G3. GRAVE: `valor_desconto` não existe

A coluna não existe em `payments`. Varredura de `information_schema` por
`discount|desconto|abatim|rebate|bonus` só achou `orders.discount_price` e `discount_coupons`,
que são tabelas SaaS institucionais sem uso nesta operação. As 23 parcelas com
`paid_value < initial_value` são pagamento parcial, não desconto registrado.

### G4. Onde vive a regra de encargos (não reinventar)

**O C2X não calcula encargo.** Quem calcula é `apps/hub/lib/hades/dossie/encargos.ts`.

- `extrairEncargosDoContrato()` lê `acquisition_request_contracts.complete_text` e extrai
  multa, juros e índice **da cláusula do contrato daquele cliente**.
- `atualizarParcela()` aplica multa fixa mais juros pro rata die
  (`jurosMesPercent / 100 / 30 * dias`).
- Fallback quando o contrato não declara: 2% de multa e 1% ao mês.

Conferido nos 475 contratos da Lavra do Ouro: **todos os 475** usam a minuta antiga, com a redação
"juros compensatórios de 1% (um por cento) ao mês e multa penal de 2% (dois por cento) sobre o valor
do débito". Nenhum usa a redação nova ("multa moratória... juros de mora"). Os 475 citam
"pro rata die", IPCA e IGPM.

**Detalhe que importa e não estava no levantamento anterior:** a cláusula de inadimplência dos
contratos da Lavra do Ouro corrige o débito **"pelo índice acumulado de reajuste da poupança"**, não
por IPCA. O IPCA ANUAL aparece no quadro-resumo, como índice de reajuste **anual do saldo** (ao lado
de "8,00%"). São duas regras diferentes: reajuste contratual (IPCA anual + 8%) e mora (poupança + 1%
ao mês + 2% de multa).

**Correção monetária é manual.** `index_monetary_correction_values` tem **0 linhas em toda a base**:
ninguém alimenta o percentual mês a mês. Quem gera o dossiê do Hades digita o número na mão.
Portanto **não temos como entregar valor corrigido calculado ao GLOTES** sem inventar número.

### M1. `indice`: a armadilha do join

Existe uma linha em `commercial_plans` com `acquisition_request_id` preenchido para cada uma das
475 vendas, mas **são cascas vazias**: `name` em branco nas 475, `parcels = 0` em 451,
`index_monetary_correction_id` nulo em 451.

**O plano real vem de `acquisition_requests.commercial_plan_id`, nunca do join por
`acquisition_request_id`.** Pelo caminho certo:

| Plano | Índice | contractual_interest | vendas |
|-------|--------|----------------------|--------|
| PLANO-NORMAL | IPCA ANUAL | 8,0000 | 457 |
| PLANO CURTO | IPCA ANUAL | 0,0000 | 6 |
| PLANO INVESTIDOR | IPCA ANUAL | 0,0000 | 2 |
| (sem plano) | nulo | nulo | 10 |

### M2. `percentual_reajuste`: ambíguo

Não há campo com esse nome. Dois candidatos, ambos em `commercial_plans` (o levantamento anterior
atribuiu `correction_rate` a `enterprises`, o que está **errado**: `enterprises` não tem essa
coluna):

- `contractual_interest`: 8,0000 em 457 vendas, 0,0000 nas 8 dos planos CURTO e INVESTIDOR.
- `correction_rate`: 2,00 nas 207 vendas do empreendimento 1 (LOU), **nulo** nas 268 do
  empreendimento 4 (LOS).

O contrato imprime "8,00%" ao lado de "IPCA ANUAL" no quadro-resumo, o que aponta para
`contractual_interest` como o percentual de reajuste contratual. Precisa confirmação do negócio.

### M3. Nomes idênticos dos dois loteamentos

Já descrito na seção 1. Sem o `code`, o GLOTES não distingue.

### M4. `forma_pagamento` sem informação real

`Boleto` em 100% das 68.356 linhas. Se o GLOTES espera diferenciar PIX, boleto e cartão, o C2X não
tem essa informação.

### M5. `nosso_numero` indisponível

`payment_transactions` está vazia em toda a base. Não há linha digitável nem código de barras
persistido.

### M6. Observações vazias dos dois lados

`acquisition_requests.observation`: 0 de 475. `payments.description`: 1 de 68.356.

### M7. Colisão de faixas de id entre tabelas

| Tabela | Faixa de id | Linhas |
|--------|-------------|--------|
| `users` | 1 a 4758 | 4.590 |
| `acquisition_requests` | 2 a 4679 | 4.605 |
| `enterprise_unities` | 3 a 5810 | 4.654 |
| `enterprises` | 1 a 38 | 32 |
| `payments` | 16.784 a 329.346 | 88.740 |

As quatro primeiras se sobrepõem quase por inteiro. Se o GLOTES tiver namespace único de código, ou
se alguém cruzar planilha por número, **o cliente 1127 vira a venda 1127 vira o lote 1127**. Já
houve incidente análogo nesta base (`client_c2x_id` confundido entre `users.id` e
`acquisition_requests.id`).

**Mitigação:** usar as chaves naturais legíveis onde existem (`enterprises.code`,
`enterprise_unities.name`, `users.user_code`) e, para venda (que não tem chave natural), prefixar o
id: `VEN-45`. Se o GLOTES não aceitar prefixo, prefixar mesmo assim no nome do arquivo e documentar.

### M8. `qtd_parcelas` e `qtd_sinal`: contar, não ler a coluna

`payments.total_parcels` bate com a contagem real em 470/475, diverge em 4 e é nulo em 1.
`acquisition_requests.quantity_signal_parcels` bate com a contagem real de parcelas tipo 2 em
463/475, divergindo em 12. Duas vendas não têm nenhuma parcela de sinal e uma não tem parcela de
Ato. **Contar as linhas.**

### M9. Formatos com máscara

CPF vem `000.000.000-00`, CNPJ vem `00.000.000/0000-00`, CEP vem `00.000-000` (pontuado em 375 de
375, nenhum cru). `block` e `lot` vêm zero-padded como texto (`01`, `02`). Tudo isso precisa de
normalização definida na saída.

---

## 6. Correções ao levantamento anterior

O mapa recebido para conferência estava certo na maior parte. Estes pontos foram corrigidos após
rodar as consultas de novo:

| # | O que o mapa dizia | O que a conferência mostrou |
|---|--------------------|-----------------------------|
| C1 | "155 linhas têm a combinação venda + tipo + número duplicada" | São **155 combinações**, **391 linhas** e **236 linhas extras**, todas concentradas em **2 vendas** (242 e 243), valendo **R$ 90.609,84**. O problema é mais localizado e mais caro do que parecia. |
| C2 | "1.284 parcelas têm `paid_value` preenchido sem `payment_date` (925 Aguardando + 359 Atrasado)" | São **344**, todas em status Atrasado. As outras 940 têm `paid_value = 0`, que é o mesmo que não pago. O buraco é 4 vezes menor. |
| C3 | "R$ 166.782,03 de encargo cobrado está embutido no `paid_value` sem separação" (redigido como se fosse o valor decomposto) | O encargo **total** cobrado é **R$ 171.477,52**. Desse total, **R$ 4.695,58** estão decompostos em `interest_value` (361 linhas) e **R$ 166.781,94** estão embutidos sem separação (4.851 linhas). |
| C4 | "`enterprises.correction_rate` = 2,00 no empreendimento 1 e nulo no 4" | **`enterprises` não tem a coluna `correction_rate`.** A coluna é `commercial_plans.correction_rate`. O valor observado é o mesmo (2,00 nas 207 vendas do empreendimento 1, nulo nas 268 do 4), mas a origem estava errada. |
| C5 | "`code` repetido: LOU1 em 208 vendas, LOS1 em 276..." | A distribuição real nas 475 abertas é LOS1 235, LOU1 170, LOU2 30, LOS2 28, LOU3 6, LOS3 2, LOS4 2, LOU5 1, LOS5 1. A conclusão (não usar `code`) fica **mais forte**, não mais fraca. |
| C6 | "468 de 475 vendas têm parcela variável; 7 têm parcela fixa" | 474 vendas têm parcelas do tipo 3 (uma não tem nenhuma). Dessas, **467 variam** e 7 são fixas. |
| C7 | "`acquisition_requests.stage`" e "`enterprises.correction_rate`" citados como colunas | Não existem. As colunas são `acquisition_requests.acquisition_request_stage_id` e `commercial_plans.correction_rate`. |
| C8 | (não mencionado) | **Novo:** ficou provado que `enterprise_unities.price` é a base do contrato. Ver 8.2. |
| C9 | (não mencionado) | **Novo:** a cláusula de mora dos contratos da Lavra do Ouro corrige pelo **índice da poupança**, não por IPCA. O IPCA ANUAL é o reajuste anual do saldo. |
| C10 | (não mencionado) | **Novo:** o "Preço de Venda" do contrato é exatamente `price x 0,935` (desconto fixo de 6,5%) em toda a amostra. Não é informação independente, é derivada. |

---

## 7. Confirmado sem ressalva

Estes pontos do mapa foram reconferidos e batem exatamente:

- 2 empreendimentos, `code` `LOU` (id 1) e `LOS` (id 4), ambos com `name` e `divulgation_name` iguais a `LAVRA DO OURO`.
- 493 unidades, 216 no LOU e 277 no LOS; 475 Vendido e 18 Disponível; 51 com `secured_lot`, 7 com `sale_blocked`.
- `enterprise_unities.name` único: 493 valores distintos em 493 linhas.
- 475 vendas abertas, todas em estágio 4 "Faturado"; 98 canceladas, todas em estágio 7.
- 375 clientes, 369 PF e 6 PJ, 100% com documento válido para o tipo.
- `users.user_code` sem duplicata em 4.590 usuários.
- 1 endereço por cliente, 375/375 com logradouro, número, bairro, cidade, UF e CEP; complemento em 125.
- 183 cônjuges, 100% com nome e CPF; universo aplicável (176 casados + 5 união estável) 100% coberto.
- `act_date` em 475/475; `sign_date` em 40; `billing_date` em 275.
- 68.356 parcelas, 12.530 pagas, 54.364 aguardando, 1.462 atrasadas.
- `mulct_value` zero em 100% das linhas; `interest_value` maior que zero em 361 linhas.
- `payment_type_id = 2` (Boleto) em 100% das linhas.
- `index_monetary_correction_values` e `payment_transactions` com 0 linhas.
- 465 de 475 vendas com índice IPCA ANUAL; 10 sem plano.
- Nenhum co-comprador, nenhuma parcela marcada para deleção, nenhum status fora de 5/6/7.

---

## 8. Convenções de dinheiro (usar as mesmas, senão o GLOTES fecha diferente do Hub)

### 8.1 Saldo devedor e valor pago

A casa repete estas expressões em quatro lugares (`lib/guardian/overview.ts:279`,
`lib/guardian/attendance.ts:144`, `lib/apolo/carteira.ts:15`, `lib/analytics/c2x-builder.ts:56`):

```
devido = initial_value + interest_value + mulct_value
pago   = coalesce(nullif(paid_value, 0), devido)
em aberto = greatest(devido - paid_value, 0)
carteira ativa = payment_status_id in (5, 6, 7) and (payment_to_delete is null or payment_to_delete = 0)
```

**A carga do GLOTES tem que usar exatamente estas expressões.** Se usar outra, o número que o
cliente vê no sistema dele não vai bater com o número que a Careli vê no Hub, e a primeira
divergência vira reunião.

### 8.2 Prova de que `price` é a base do contrato

Este é o argumento que resolve o buraco B2.

`commercial_plans.initial_input_value` guarda o **percentual de entrada** (vale `10.0000` = 10%).
Testando em escala se a entrada real bate com esse percentual aplicado sobre o preço de tabela:

```
entrada real = sum(payments.initial_value) onde parcel_type_id in (1, 2)   -- Ato + Sinal
esperado     = enterprise_unities.price * commercial_plans.initial_input_value / 100
```

Resultado: em **449 das 465** vendas que têm plano com percentual, os dois batem **com diferença
menor que R$ 1,00**. Exemplo no lote LOU0101 (venda 45): `price` R$ 85.722,00, 10% = R$ 8.572,20,
e a entrada real é R$ 800,00 de Ato + R$ 7.772,20 de Sinal = R$ 8.572,20 exatos.

Ou seja: **o C2X gerou o fluxo de pagamento inteiro a partir de `enterprise_unities.price`.** O
preço de tabela não é uma referência solta, é o número que baseou o contrato.

E o "Preço de Venda" que aparece no texto do contrato? Ele é **derivado**, não independente. Em
toda a amostra o fator é exatamente 0,935 (desconto fixo de 6,5%):

| Venda | Lote | `price` | "Preço de Venda" no contrato | Fator |
|-------|------|---------|------------------------------|-------|
| 10 | LOU1817 | 62.366,00 | 58.312,21 | 0,9350 |
| 11 | LOU2112 | 75.611,00 | 70.696,29 | 0,9350 |
| 13 | LOU2113 | 75.677,00 | 70.758,00 | 0,9350 |
| 14 | LOU2616 | 82.412,00 | 77.055,22 | 0,9350 |
| 15 | LOU2114 | 83.201,00 | 77.792,94 | 0,9350 |
| 45 | LOU0101 | 85.722,00 | 80.150,07 | 0,9350 |

Falta descobrir o que esse 6,5% representa (comissão? valor à vista?). É pergunta para o negócio,
mas **não muda a recomendação**: `valor_venda = enterprise_unities.price`, com a soma do fluxo como
número de conferência.

---

## 9. Formato recomendado de entrega

### 9.1 As opções, avaliadas de verdade

**Opção A: arquivo (CSV ou JSON) por empreendimento, em rotina diária.**
Cinco arquivos por dia, entregues em local combinado (SFTP, bucket, ou download autenticado).

- A favor: simples de construir; simples de auditar (o arquivo do dia fica guardado e serve de
  prova do que foi entregue); o GLOTES consome no ritmo dele; não expõe o C2X; 68 mil linhas em CSV
  dá cerca de 8 MB, o que é irrelevante.
- Contra: só uma foto por dia. Se uma parcela é baixada às 9h, o GLOTES só vê no dia seguinte.
- Risco LGPD: **alto se mal feito**. Arquivo com nome, CPF, endereço e cônjuge parado num bucket é
  exatamente o tipo de coisa que vaza.

**Opção B: API que o GLOTES consome.**
Endpoints paginados no Hub (`/api/integrations/glotes/...`), autenticados, o GLOTES puxa quando
quiser.

- A favor: dado sempre atual; o GLOTES controla frequência e escopo; o acesso é rastreável por
  requisição (quem puxou, quando, o quê); dá para filtrar por data de alteração e mandar só o delta;
  nada fica parado em disco.
- Contra: exige que o GLOTES tenha cliente HTTP e trate paginação; precisamos de rate limit para não
  martelar o C2X (que tem `max_connections` escasso e compartilhado com o Rails de produção).
- Risco LGPD: **controlável**. Cada chamada é logada, o token é revogável na hora, e o escopo é
  limitado por token.

**Opção C: webhook por evento.**
A Careli empurra para o GLOTES cada vez que uma parcela é paga.

- A favor: tempo real.
- Contra: **não temos o gatilho**. O C2X é legado read-only, não emite evento, e o Hub descobre
  pagamento por polling (o cron `/api/apolo/sync/c2x/incremental` roda a cada 5 minutos). Ou seja,
  o webhook seria polling disfarçado, com o custo extra de ter que garantir entrega, retry, ordem e
  idempotência do lado deles. Além disso 68 mil parcelas em carga inicial não cabem em webhook.
- Risco LGPD: precisaríamos empurrar dado pessoal para um endpoint do cliente, o que inverte o
  controle: se o endpoint deles estiver aberto, o vazamento é nosso.

### 9.2 Recomendação: **API paginada no Hub, com carga completa e delta, mais um arquivo de conferência mensal**

O desenho:

1. **Cinco endpoints de leitura** no Hub, um por conjunto, sob o prefixo
   `/api/integrations/glotes/`:
   `loteamentos`, `clientes`, `lotes`, `vendas`, `recebimentos`.
2. **Paginação obrigatória** (por exemplo 1.000 linhas por página, com cursor). 68 mil recebimentos
   dão 69 páginas. Nunca devolver a carteira inteira numa resposta.
3. **Parâmetro `alterado_desde`** em `recebimentos` e `vendas`. Sem ele, carga completa. Com ele, só
   o que mudou desde a data informada. `payments.updated_at` existe e serve para isso, mas
   **precisa ser validado antes de prometer**: se o C2X reescreve a linha por outros motivos, o
   delta vem inflado (o que é seguro, só ineficiente) ou, pior, se não atualiza no pagamento, o
   delta vem faltando (o que é grave). **Este teste tem que ser feito antes de fechar o contrato de
   integração com o cliente.** Enquanto não for validado, o padrão é carga completa.
4. **Origem dos dados: o Apolo, não o C2X direto.** O dono já definiu que a integração passa pelo
   Apolo, e isso está certo por três motivos: (a) o Apolo já sincroniza o C2X a cada 5 minutos
   (`/api/apolo/sync/c2x/incremental`) e a cada 6 horas (carga completa), então o dado já está do
   lado de cá; (b) ler do Apolo evita abrir mais conexões no C2X, que tem `max_connections` escasso
   e compartilhado com o Rails de produção; (c) o Apolo já tem a camada de identidade e de
   auditoria. **Ressalva:** é preciso confirmar que o sync do Apolo cobre `payments` no nível de
   detalhe que a integração exige. Se não cobrir, ou o sync ganha esse escopo, ou os endpoints leem
   do C2X com cache curto. Isso é a primeira coisa a verificar no Bloco 1.
5. **Um arquivo de conferência mensal** (CSV, gerado e guardado do nosso lado, entregue por canal
   combinado): a foto do fechamento do mês, para o cliente bater a carteira e para nós termos prova
   do que foi entregue naquele fechamento. Isso resolve o único ponto em que o arquivo ganha da API:
   auditoria.

### 9.3 Autenticação e proteção do dado

Contexto: o Hub protege `/api/*` por Bearer de sessão no `proxy.ts`, com uma allowlist explícita
para rotas de máquina. A integração do GLOTES entra nessa allowlist e **se protege por dentro**,
com segredo próprio, exatamente como fazem os crons e os webhooks hoje.

O desenho de acesso:

- **Token de máquina dedicado ao GLOTES**, guardado em variável de ambiente da Vercel
  (`GLOTES_API_TOKEN`), enviado no header. Nunca em query string: dado pessoal não vai em URL, e o
  token em URL vaza em log de proxy. Um token só para o GLOTES, não reaproveitar token existente.
- **Escopo amarrado ao token.** O token do GLOTES só enxerga os empreendimentos 1 e 4. Isso não é
  filtro na query que o cliente manda, é regra no servidor: mesmo que ele peça
  `enterprise_id = 7`, a resposta é vazia. A carteira dos outros empreendimentos da Careli não pode
  sair por essa porta.
- **Rate limit** por token. O C2X não aguenta martelada, e o Apolo também não deve.
- **Allowlist de IP**, se o GLOTES tiver IP fixo de saída. É a proteção mais barata e mais eficaz.
- **HTTPS obrigatório** (é o padrão da Vercel, mas fica registrado).
- **Log de acesso**: data, token, endpoint, filtros, número de linhas devolvidas. Sem o corpo da
  resposta. Isso é o que permite responder "quem viu o CPF de quem, quando" se um dia perguntarem.
- **Rotação de token** documentada, e revogação imediata em caso de suspeita.

**LGPD, o ponto que precisa de decisão e não de código:** este é dado pessoal de 375 titulares
(nome, CPF, endereço completo, e em 183 casos também nome e CPF do cônjuge). Antes de ligar,
precisa existir:

- **base legal** para o compartilhamento (provavelmente execução de contrato, já que a loteadora é
  parte no contrato de compra e venda, mas isso é o jurídico que diz, não nós);
- **acordo de tratamento de dados** entre Careli e a loteadora, definindo quem é controlador, quem é
  operador, e o que o cliente pode fazer com o dado;
- **minimização**: mandar cônjuge e endereço só se o GLOTES realmente usar. Campo "recomendado" não
  é campo necessário. Se o cliente não souber dizer para que usa o CPF do cônjuge, não mandar.

Isso está na seção 11 como decisão do Lucas, porque é decisão dele e do jurídico, não técnica.

---

## 10. Esforço, em blocos

Ordem proposta. Cada bloco entrega algo verificável sozinho.

**Bloco 0. Destravar os bloqueantes.** (Não é código. É decisão e conserto.)
- Decidir o que fazer com as medidas do lote (B1).
- Decidir o `valor_venda` (B2) e o `valor_parcela` (B3).
- Corrigir ou isolar as 2 vendas com parcelas duplicadas (B4).
- Validar se `payments.updated_at` serve como marca de delta.
- **Sem isto, os blocos seguintes constroem em cima de definição errada.**

**Bloco 1. Camada de leitura e de-para.** (Trabalhoso na conferência, simples no código.)
- Uma função por conjunto, lendo do Apolo (ou do C2X, se o sync não cobrir), aplicando as
  convenções da seção 8, com os filtros de recorte da seção 2.
- Normalização: CPF, CNPJ e CEP sem máscara; data em formato único; decimal com ponto.
- Testes que travam os números conferidos aqui: 2 loteamentos, 493 lotes, 375 clientes, 475 vendas,
  68.356 recebimentos.
- **Entrega:** os cinco conjuntos saem certos numa chamada local.
- **Honestidade:** ler e formatar é a parte fácil. O que consome tempo é conferir de novo cada
  número contra o Hub, porque se divergir depois vira reunião com o cliente.

**Bloco 2. Endpoints paginados e autenticados.**
- Cinco rotas sob `/api/integrations/glotes/`, com cursor, `limit` e `alterado_desde`.
- Entrada na allowlist do `proxy.ts` com validação por dentro, token dedicado, escopo travado nos
  empreendimentos 1 e 4, rate limit e log de acesso.
- **Entrega:** o GLOTES consegue puxar a carteira inteira paginada, autenticado.
- **Honestidade:** simples. O grosso é o cuidado de segurança, não a rota.

**Bloco 3. Documentação para o cliente.**
- Um documento em português para o time do GLOTES: cada campo, o formato, o que significa, o que
  não vem e por quê.
- Exemplos de resposta com dado fictício.
- **Entrega:** o cliente consegue implementar do lado dele sem reunião.
- **Honestidade:** é onde a integração costuma morrer. Vale o tempo.

**Bloco 4. Arquivo de conferência mensal.**
- Job que gera o CSV do fechamento e guarda a foto.
- **Entrega:** prova do que foi entregue em cada fechamento.
- **Honestidade:** simples, reaproveita o Bloco 1.

**Bloco 5 (se e somente se o cliente exigir). Medidas do lote.**
- Levantar 493 conjuntos de medidas do memorial descritivo ou da planta aprovada.
- Definir onde guardar (o C2X é read-only, então seria tabela nova no Supabase do lado do Apolo).
- Tela ou importador para alimentar.
- **Entrega:** `frente`, `fundo` e lados preenchidos.
- **Honestidade: este é o bloco caro e é trabalho de cadastro, não de integração.** Não tem
  atalho técnico: o dado não existe. Ou alguém digita, ou o cliente aceita receber sem.

**Bloco 6 (se o cliente exigir valor corrigido). Encargos.**
- Reaproveitar `lib/hades/dossie/encargos.ts` para calcular multa e juros por parcela vencida.
- **Honestidade:** dá para calcular multa e juros (a regra existe e está testada). **Não dá para
  calcular correção monetária**, porque `index_monetary_correction_values` está vazia e ninguém
  alimenta o índice mês a mês. Prometer valor corrigido é prometer número inventado.

---

## 11. Perguntas para o cliente (só o GLOTES pode responder)

Escrever assim, direto, quando for mandar:

1. **Medidas do lote.** O GLOTES aceita receber a carga sem `frente`, `fundo`, `lado_direito` e
   `lado_esquerdo`? Esses dados não existem no nosso sistema e viriam do memorial descritivo do
   cartório. Se forem obrigatórios para o cadastro funcionar aí, precisamos combinar quem levanta e
   digita as medidas dos 493 lotes.

2. **Valor da venda.** Qual número o GLOTES espera em `valor_venda`? Temos três referências para o
   mesmo lote: o preço de tabela que baseou o contrato, a soma de todo o fluxo de pagamento gerado,
   e o preço impresso no texto do contrato (que é 6,5% menor). Nossa recomendação é o preço de
   tabela, porque foi dele que o sistema gerou o financiamento.

3. **Valor da parcela.** No nosso sistema a parcela varia dentro do mesmo contrato, porque o
   cronograma já nasce reajustado. O GLOTES quer receber, em `valor_parcela`, o valor da primeira
   parcela, o valor médio, ou prefere ignorar esse campo e ler parcela a parcela no conjunto de
   recebimentos (onde cada uma vem com o valor certo)?

4. **Encargos.** Os valores devem vir com ou sem juros e multa? Hoje o valor pago já inclui o
   encargo cobrado, mas na maioria dos casos o encargo não está separado em campo próprio. Se o
   GLOTES fizer a conta valor pago menos valor da parcela menos juros menos multa esperando zero,
   não vai fechar.

5. **Correção monetária.** O GLOTES espera receber o saldo já corrigido pelo índice? Não temos o
   índice acumulado mês a mês no sistema, então não conseguimos entregar valor corrigido calculado.

6. **Carga completa ou só o que mudou.** O GLOTES prefere receber a carteira inteira a cada
   sincronização, ou só o que mudou desde a última? Se for só o que mudou, qual o intervalo
   esperado?

7. **Frequência.** De quanto em quanto tempo o GLOTES pretende buscar os dados? Uma vez por dia,
   de hora em hora, sob demanda?

8. **Formato de data.** `AAAA-MM-DD` ou `DD/MM/AAAA`? E com ou sem hora?

9. **Formato de número.** Ponto ou vírgula como separador decimal? Com ou sem separador de milhar?

10. **Documentos com ou sem máscara.** CPF, CNPJ e CEP: mandar com pontuação ou só os dígitos?

11. **Venda cancelada.** O que o GLOTES faz com venda cancelada? Temos 98 vendas canceladas nos dois
    loteamentos, que somam 125 parcelas e mais 58 clientes. Devemos enviar, enviar marcadas com uma
    situação específica, ou não enviar?

12. **Lote com mais de uma venda no histórico.** 70 lotes já tiveram mais de uma venda (a atual mais
    canceladas anteriores). O GLOTES suporta histórico de venda por lote, ou espera só a venda
    vigente?

13. **Código de venda.** Não temos código legível para venda, só um número interno. O GLOTES aceita
    receber esse número com um prefixo (por exemplo `VEN-45`), para não confundir com código de
    cliente ou de lote?

14. **Os dois loteamentos com o mesmo nome.** Os dois se chamam LAVRA DO OURO no nosso sistema, e o
    que os separa é o código (LOU e LOS). Existe um nome comercial correto de cada um do lado de
    vocês, para usarmos na carga?

15. **Cônjuge e endereço.** O GLOTES usa esses dados para quê? São dados pessoais e só faz sentido
    enviarmos o que o sistema realmente usa.

16. **Acesso.** O GLOTES tem IP fixo de saída? E consegue consumir uma API com autenticação por
    token e paginação, ou precisa mesmo de arquivo?

---

## 12. Decisões para o Lucas (negócio, não técnica)

1. **Mandar dado pessoal de cliente?** Nome, CPF, endereço completo de 375 pessoas e nome mais CPF
   de 183 cônjuges. Precisa de base legal e de acordo de tratamento de dados com a loteadora antes
   de ligar. Vale envolver o jurídico. **Esta é a decisão que trava tudo, mesmo que a técnica esteja
   pronta.**

2. **Mandar cônjuge?** É o dado mais sensível do pacote e é apenas "recomendado" pelo GLOTES. Dá
   para começar sem e adicionar depois se o cliente justificar o uso.

3. **Mandar endereço completo?** Mesma lógica. Se o GLOTES só precisa de cidade e UF para relatório,
   não mandar logradouro e número.

4. **Um loteamento ou os dois?** O contrato do cliente cobre LOU e LOS, ou só um deles? A carga
   inteira depende dessa resposta.

5. **Incluir vendas canceladas?** Recomendo **não** na primeira carga: são 98 vendas, 125 parcelas e
   58 clientes a mais, e trazem dado pessoal de gente que não é mais cliente. Se o cliente pedir
   histórico depois, entra numa segunda fase.

6. **Histórico completo ou a partir de uma data?** A carteira começa em 02/12/2023 e vai até
   20/03/2037. Mandar tudo é o mais simples e o mais correto (o GLOTES precisa do fluxo futuro para
   cobrar). Só faz sentido cortar se o cliente pedir.

7. **Qual é o `valor_venda` oficial da Careli?** Somos nós que temos que dizer qual dos três números
   é o valor da venda. Recomendação técnica: o preço de tabela (`price`), com prova na seção 8.2.
   Mas quem assina isso é o negócio.

8. **O que é o desconto de 6,5% do contrato?** O texto do contrato imprime sempre `price x 0,935`.
   Precisa saber o que esse fator representa antes de responder a pergunta 2 do cliente.

9. **Consertar as 2 vendas com parcelas duplicadas (242 e 243)?** São R$ 90.609,84 de saldo que não
   existe. Isso já contamina o Hades e o Apolo hoje, não só o GLOTES. Vale consertar independente
   desta integração.

10. **Vamos entregar valor corrigido?** Se sim, alguém tem que passar a alimentar
    `index_monetary_correction_values` (ou uma tabela nossa) mês a mês. Hoje ninguém alimenta e o
    dossiê do Hades é digitado na mão.

11. **Quem responde pelo dado do lado do cliente?** Se o GLOTES for operado por um terceiro, o
    acordo tem que alcançar esse terceiro.

12. **Prazo e ordem.** Se o cliente quiser tudo, o caminho crítico é Bloco 0 (decisões) e depois o
    Bloco 5 (medidas), que é levantamento de cadastro e não tem atalho técnico.

---

## 13. Apêndice: como reconferir

As consultas usadas neste levantamento rodaram direto no C2X, somente leitura, via um script que
carrega `apps/hub/.env.local` e abre uma conexão `mysql2`. Os recortes essenciais, para quem
precisar refazer:

```sql
-- os dois loteamentos
select id, code, name, divulgation_name from enterprises where id in (1, 4);

-- recorte de vendas
select ar.open, ar.acquisition_request_stage_id, count(*)
from acquisition_requests ar
join enterprise_unities eu on eu.id = ar.enterprise_unity_id
where eu.enterprise_id in (1, 4)
group by ar.open, ar.acquisition_request_stage_id;

-- as 236 parcelas duplicadas (buraco B4)
select p.acquisition_request_id, p.parcel_type_id, p.current_total_parcel, count(*)
from payments p
join acquisition_requests ar on ar.id = p.acquisition_request_id
join enterprise_unities eu on eu.id = ar.enterprise_unity_id
where eu.enterprise_id in (1, 4) and ar.open = 1
group by p.acquisition_request_id, p.parcel_type_id, p.current_total_parcel, p.current_signal_parcel
having count(*) > 1;

-- prova de que price baseia o contrato (secao 8.2)
select ar.id, eu.price, cp.initial_input_value,
  (select sum(p.initial_value) from payments p
   where p.acquisition_request_id = ar.id and p.parcel_type_id in (1, 2)) as entrada
from acquisition_requests ar
join enterprise_unities eu on eu.id = ar.enterprise_unity_id
join commercial_plans cp on cp.id = ar.commercial_plan_id
where eu.enterprise_id in (1, 4) and ar.open = 1 and cp.initial_input_value > 0;

-- ausencia de medidas: varredura de esquema
select table_name, column_name from information_schema.columns
where table_schema = database()
  and column_name regexp 'front|frente|fundo|_side|side_|lado|width|largura|comprim|medida|perimet|confront|memorial|dimens|metragem|testada|matricul';
```

Regra que vale sempre: **o C2X é somente leitura.** Nenhum `insert`, `update` ou `delete`, em
nenhuma hipótese. A escrita no legado só existe pela API Rails, e não faz parte deste assunto.

---

## 14. 25/09/2026: correção da carga incremental

A API está no ar desde 14/08/2026 e o GLOTES consome com token. Em 10/09 o desenvolvedor do
GLOTES reclamou que "nos recebimentos não tem a coluna da data de atualização". A investigação de
25/09 achou mais que isso: o incremental de `vendas` e `recebimentos` **perdia alterações para
sempre**. Tudo abaixo foi medido no C2X real, somente leitura, em 25/09/2026 (scripts
`apps/hub/scratchpad/glotes-v2-*.ts`, fora do git).

### 14.1 O relógio do C2X

MySQL 8.4.8, `@@session.time_zone = UTC`. As colunas `created_at` e `updated_at` de `payments`,
`acquisition_requests`, `enterprise_unities`, `users`, `addresses`, `spouses` e `phones` são
`datetime` **sem fuso**, gravadas no horário de Brasília, e todas `NOT NULL` (zero nulos no
recorte). A porta (`lerAlteradoDesde`) converte a marca de `alterado_desde` para UTC; `clientes`
convertia de volta para Brasília desde 24/08, `vendas` e `recebimentos` não.

### 14.2 O que estava errado, com os números

**1. Corte deslocado em 3 horas (vendas e recebimentos).** A marca UTC comparada com a coluna
local empurrava o corte 3 horas para a frente. A chamada seguinte já partia de depois, então o que
mudou nessas 3 horas não vinha nunca. Recebimentos (parcelamento do recorte, 66.501 linhas):

| Marca (-03:00) | Código de produção | Só com o fuso certo | Relógio novo (parcela ou venda) |
|---|---|---|---|
| 10/09/2026 00:00 | 534 | 1.564 | 1.705 |
| 14/08/2026 00:00 | 2.850 | 2.850 | 2.988 |
| 25/09/2026 10:00 | 2 | 147 | 147 |

**2. Relógio de vendas estreito demais.** Era só `ar.updated_at`, mas `qtd_parcelas`,
`qtd_sinal`, `valor_sinal`, `valor_parcela` e `data_1o_vencimento` saem das parcelas, e mexer em
parcela não toca a venda. Das 474 vendas abertas:

| Marca (-03:00) | Código de produção | Relógio novo |
|---|---|---|
| 10/09/2026 00:00 | 2 | 459 |
| 14/08/2026 00:00 | 2 | 466 |
| 25/09/2026 10:00 | 0 | 4 |

A unidade (`eu.updated_at`, de onde saem `valor_venda` e `codigo_lote`) entrou no relógio e hoje
não acrescenta nenhuma venda. Parcelas marcadas para apagar (`payment_to_delete`) entram no relógio
porque mudam `qtd_parcelas`: são 3 em todo o C2X e nenhuma no recorte.

**3. Recebimentos sem relógio próprio e cego à venda.** `codigo_cliente` vem do titular da venda.
A troca de titular da VEN-223 em 15/09/2026 17:18:26 **moveu `ar.updated_at`** (conferido: o
audit de `client_id` e a coluna têm o mesmo instante). Das 144 parcelas da venda, só 1 foi tocada
depois; as outras 141 continuavam com o titular antigo do lado do GLOTES. Com o relógio
`greatest(parcela, venda)` as 144 voltam no incremental desde 10/09 (são exatamente as 141 que
separam 1.564 de 1.705 na tabela acima, mais as 3 que já vinham).

**4. `clientes.atualizado_em` sem fuso.** Saía `YYYY-MM-DD HH:MM:SS`, e o contrato manda repassar
o maior valor em `alterado_desde`, que exige fuso: repassar dava 400. E o relógio ignorava
`addresses` e `spouses` (polimórficas, `ownertable_type = 'User'`), de onde saem endereço e
cônjuge. Medido: nenhum cliente do recorte teve, desde 14/08, endereço ou cônjuge mais novo que o
resto do cadastro (lado C2X: 10 clientes alterados desde 14/08 e 5 desde 10/09, com ou sem as duas
tabelas). O buraco existia, ainda sem vítima.

**5. Exclusão some calada.** Parcela apagada deixa de existir e não tem relógio. Audits de
`Payment` com `destroy` no recorte desde 14/08: VEN-65 (140 em 20/08), VEN-570 (18 em 03/09 e 118
em 16/09), VEN-449 (1 avulsa em 18/09), VEN-524 (16 em 24/09) e VEN-81 (145 em 25/09, régua
apagada e recriada entre 12:20 e 12:23). A investigação contou **160 parcelas fantasmas do lado do
GLOTES** (144 da VEN-81 e 16 da VEN-524). O incremental não tem como avisar remoção: a saída
combinada com o Lucas é pedir ao GLOTES UMA CARGA COMPLETA depois da correção e documentar que a
listagem completa é a verdade.

**6. Cancelamento.** As 100 vendas fechadas do recorte (estágio 7, "Cancelado") têm a última
alteração em 20/01/2026 e nenhuma tem audit de `open`. As parcelas que sobram nelas são só pagas
(116 mensais em 7 vendas, 18 de sinal, 9 de ato, 2 avulsas): as não pagas são apagadas depois, em
limpeza sem data. A VEN-65 tem `updated_at` de 05/01/2024 e as 140 exclusões de parcela dela
começaram em 20/08/2026; a VEN-570 tem `updated_at` de 08/08/2024 e as 136 exclusões começaram em
03/09/2026 (nenhum desses 276 audits de `destroy` traz usuário). O código aceita
`incluir_canceladas` junto com `alterado_desde` (a trava `ar.open = 1` sai e o corte por relógio
fica), mas o cancelamento não move relógio nenhum (ver 14.6): o contrato deixou de prometer o
cancelamento pelo incremental. E a carga completa de referência passou a ser feita com
`incluir_canceladas=true` em clientes, vendas e recebimentos: sem ele, remover do lado do GLOTES o
que não veio apagaria a venda cancelada e as 116 parcelas pagas (66.501 parcelas sem o parâmetro,
66.617 com ele; 474 vendas contra 574; 374 clientes contra 434).

**7. `valor_parcela` não é valor corrigido.** É `payments.initial_value`, o valor do cronograma:
só a parcela que recebe boleto é corrigida, a futura fica no valor do contrato. Das 11.977
parcelas pagas do recorte: 5.389 (45%) pagas acima do `valor_parcela`, somando R$ 151.872,85;
6.575 pelo valor exato; 13 abaixo. Só R$ 8.452,53 do excedente (5,6%, em 624 linhas) está em
`interest_value`. 4.065 das pagas acima foram pagas em atraso (R$ 114.027,87, média de 5,98%) e
1.324 em dia (R$ 37.844,98, média de 6,50%): nessas últimas a diferença não é mora. O contrato
anterior dizia "já com o reajuste embutido pelo cronograma", o que não é verdade.

**8. `valor_pago` fantasma: valor do boleto entregue como recebido.** A API mandava `valor_pago`
sempre que `paid_value > 0`, e o contrato descrevia as parcelas com valor e sem data como
"pagamento parcial" (a correção C2 deste levantamento, de 07/08, contou 344). Medido em
25/09/2026, no recorte da API (glebas 1 e 4, mensais, status 5/6/7, vendas abertas):

| Status | `paid_value` contra o valor da parcela | Parcelas | Soma de `paid_value` |
|---|---|---|---|
| Atrasado | igual | 761 | R$ 409.304,99 |
| Aguardando pagamento | igual | 1 | R$ 2.276,33 |
| Pago (sem data) | menor | 1 | R$ 412,20 |

Nenhuma parcial entre as atrasadas: todas com o valor exato da parcela e vencimento entre 20/04 e
21/09/2026. É o valor do boleto emitido, gravado antes do pagamento, a mesma conclusão do extrato
do Apolo ("pago é quem tem data"). O GLOTES somando `valor_pago` via R$ 409 mil que não entraram.
Correção: `valor_pago` só sai com `data_pagamento` ou com status Pago (5); a única Paga sem data
mantém o valor. As linhas 169, 170 e a correção C2 acima ficam como retrato de 07/08: a leitura
"pagamento parcial" estava errada.

### 14.3 O que mudou no código (`apps/hub/lib/integrations/glotes/consultas.ts`)

- `marcaNoRelogioDoC2x`: leva a marca UTC da porta para o relógio de Brasília. Usada em
  `clientes`, `vendas` e `recebimentos`.
- `relogioComFuso`: `atualizado_em` sai em ISO 8601 com o deslocamento de `America/Sao_Paulo`
  daquele instante (`2026-09-25T12:20:00-03:00`; `-02:00` em datas do horário de verão, que
  existiu até fevereiro de 2019), calculado pelo Intl. O valor é aceito de volta pela porta e
  devolve a mesma marca (ida e volta testada). O corte de `clientes` continua comparando no relógio
  local; o fuso entra só na saída.
- Relógio de `vendas`: maior entre `ar.updated_at`, `max(updated_at)` das parcelas de tipo 2 e 3
  (inclusive as marcadas para apagar) e `eu.updated_at`. O mesmo no filtro e no `atualizado_em`
  novo.
- Relógio de `recebimentos`: maior entre `p.updated_at` e `ar.updated_at`. O mesmo no filtro e no
  `atualizado_em` novo.
- Relógio de `clientes` (lado C2X): `users` mais `max(updated_at)` de `phones`, `addresses` e
  `spouses` do usuário, e (depois da revisão, na mesma data) `max(updated_at)` das vendas das duas
  glebas de que ele é titular. Sem isso, o cliente que entra no recorte por venda nova ou troca de
  titular não voltava: o CLI4258 (cadastro de 10/09 15:01:39) virou titular da VEN-5008 em 16/09
  18:55:13, e 88 dos 224 clientes que entraram no recorte em 2024 tinham o cadastro parado mais de
  5 minutos antes da primeira venda. É `ar.updated_at`, e não o relógio da venda, porque as
  parcelas mudam a cada lote de boletos e trariam todos os clientes de volta todo mês.
- `GREATEST` do MySQL devolve NULL se qualquer argumento for NULL: todo argumento leva
  `coalesce(..., '1970-01-01 00:00:00')`, e esse piso sai como `null`, nunca como data.
- `valor_pago`: só com `data_pagamento` ou status Pago (5); valor sem data é boleto emitido, não
  recebimento (ver 14.2, item 8).
- Testes em `apps/hub/lib/integrations/glotes/consultas.test.ts`.

### 14.4 Custo medido (C2X real, pool de 5 conexões, páginas de 1.000)

| Consulta | Produção (v1.377.0) | Corrigida |
|---|---|---|
| vendas, lista completa (474, 1 página) | 896 ms | 1.376 ms |
| vendas, incremental desde 10/09 | 44 ms (2 linhas) | 1.520 ms (459 linhas) |
| recebimentos, lista completa (66.501, 67 páginas) | 26,8 s (pior página 673 ms) | 30,0 s (pior página 764 ms) |
| recebimentos, incremental desde 10/09 | 452 ms (534 linhas) | 838 ms (1.705 linhas, 2 páginas) |
| clientes, lista completa (374, inclui o Panteon) | 1.943 ms | 1.817 ms |
| clientes, incremental desde 10/09 | 1.585 ms (8 linhas) | 1.512 ms (8 linhas) |

Em `clientes` o tempo é dominado pela leitura dos contatos no Panteon; as duas subconsultas novas
(endereço e cônjuge) não aparecem na medição.

O `count` de recebimentos com o filtro `greatest(parcela, venda) >= marca` custa cerca de 200 ms,
o mesmo da lista completa: não há índice em `payments.updated_at`, então a forma com `OR` entre as
duas colunas não tem índice para usar e mediu o mesmo (200 a 520 ms). Ficou o `greatest`, que é a
mesma expressão do `atualizado_em`. Cinco primeiras páginas do incremental de recebimentos em
paralelo (o pool inteiro) terminaram em 2,4 s. O custo extra de `vendas` (cerca de 0,5 s) vem de
calcular o relógio com a subconsulta das parcelas; é uma chamada por sincronização.

Ida e volta no banco real: repassar o maior `atualizado_em` recebido devolve a linha da borda (1
de 1 em cada um dos três conjuntos), o que confirma o `>=` e o formato.

### 14.5 O que o GLOTES precisa fazer

1. UMA carga completa dos cinco conjuntos depois da publicação, com `incluir_canceladas=true` em
   clientes, vendas e recebimentos, removendo do lado deles o `codigo_recebimento` e o
   `codigo_venda` que não vierem (as 160 parcelas fantasmas saem assim; sem o parâmetro, sairiam
   também as vendas canceladas e as 116 parcelas pagas delas).
2. Se acrescentavam `-03:00` ao `atualizado_em` de `clientes`, parar: agora vem com fuso, e
   acrescentar de novo produz data inválida (400). Por isso o contrato subiu para 2.0.0.
3. Guardar o maior `atualizado_em` de cada conjunto e repassar em `alterado_desde` com margem de
   alguns minutos (sugestão: 5), tratando as linhas repetidas como upsert pela chave.
4. Carga completa periódica (sugestão: semanal), também com `incluir_canceladas=true`, para as
   exclusões e os cancelamentos.
5. Depois da carga completa, refazer qualquer soma de `valor_pago` feita antes dela: as 761
   parcelas em atraso que vinham com o valor do boleto passam a vir com `valor_pago` nulo.

### 14.6 O que continua em aberto

- **Remoção no incremental.** Os audits de `destroy` de `Payment` permitiriam uma lista de
  removidos desde a marca: a consulta das parcelas do recorte apagadas desde 10/09 (280 linhas)
  custou 41 ms (há índice em `audits.created_at`; a tabela tem cerca de 37 mil linhas). Não foi
  feito agora: depende de o audit cobrir toda exclusão (só cobre o que passa pelo Rails) e de
  decidir o formato com o GLOTES.
- **Cancelamento não move relógio nenhum.** Medido em 25/09 (somente leitura): dos 1.563 audits
  de update de `AcquisitionRequest` no C2X inteiro, 0 mexem em `open` e 0 levam a etapa a 7,
  enquanto 390 mexem em etapa e 19 em titular: o cancelamento passa por fora dos callbacks do
  Rails. Nenhuma das 100 canceladas do recorte (todas na etapa 7, nenhuma com audit de update) tem
  o relógio combinado (venda, parcelas, unidade) em 12/08 ou depois (o maior é de 15/06/2026), e
  nenhuma foi criada depois disso. O schema não tem tabela de cancelamento, distrato ou rescisão.
  Indício extra: o contrato escrito em 12/08 contava 98 canceladas e hoje são 100, sem relógio
  nenhum andar. O cancelamento só aparece na carga completa; vê-lo no incremental exigiria guardar
  o estado anterior do lado Careli, e essa decisão é do Lucas.
