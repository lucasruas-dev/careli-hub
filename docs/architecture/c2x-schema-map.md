# Mapa do C2X (banco legado `prod_careli`)

Referência da estrutura do C2X (MySQL AWS RDS, **READ-ONLY** via `lib/guardian/db.ts`).
130 tabelas, 1107 colunas. Aqui estão organizadas por domínio, com as chaves e relações
que importam pro Apolo. Dump bruto completo pode ser regerado (script em `_schema.mjs`).

Convenções: PK = chave; `*_id` = FK; tabelas **polimórficas** usam `ownertable_type`
(ex.: 'User', 'Enterprise', 'LegalRepresentative', 'Spouse') + `ownertable_id`.

---

## 1. Pessoas & cadastro (a entidade central do Apolo)

**`users`** (~3.951) — a pessoa/empresa. É a tabela mestre do CRM.
- Identidade: `name`, `social_name` (razão social PJ), `fantasy_name` (nome fantasia PJ), `cpf`, `cnpj`, `rg`, `identification_number`, `document_type_id`, `user_code`, `person_type_id` (1=PF, 2=PJ), `foreigner`.
- Pessoais (PF): `birthday`, `sex_id`→sexes, `civil_state_id`→civil_states, `property_regime_id`→property_regimes, `profession_id`→professions, `schooling_id`→schoolings, `salary_range_id`→salary_ranges, `naturalness`, `nacionality`, `mother_name`.
- PJ: `user_nire`, `municipal_inscription`, `open_company_date`, `social_contract_updated_at`, `company_size_id`.
- Corretor/imob: `creci_number`, `creci_validate`.
- **Papéis/vínculos (FKs no próprio user):** `profile_id`→profiles, `incorporador_id`, `coordenador_id`, `imobiliaria_id`, `vinculed_by_id` (**comprador → imobiliária que o cadastrou**), `who_registered_id`, `user_incorporador_profile_id`.
- Contato direto: `phone`, `cellphone`, `email` (mas o canônico é polimórfico, ver abaixo).
- Status/plano: `user_status_id`, `current_plan_id`, `is_gestora_recebiveis`, asaas (`asaas_account_id`, `asaas_wallet_id`).

**Polimórficas ligadas a `users` (ownertable_type='User'):**
- **`addresses`** (~5.535) — endereço. `zipcode`, `address`(logradouro), `district`(bairro), `number`, `complement`, `reference`, `state_id`→states, `city_id`→cities. (Também serve LegalRepresentative/Spouse/Enterprise.)
- **`phones`** (~3.700) — `phone_code`, `phone`, `is_whatsapp`, `responsible`, `phone_type_id`.
- **`emails`** (~0, quase não usada) — `email`, `email_type_id`.
- **`spouses`** (~1.448) — **cônjuge**: `name`, `cpf`, `cellphone`, `birthday`, `email`, `sex_id`, `profession_id`, `document_type_id`, `identification_number`, `nacionality`.
- **`legal_representatives`** (~517) — **representante legal**: `name`, `cpf`, `cellphone`, `birthday`, `email`, `civil_state_id`, `document_type_id`, `identification_number`. (Polimórfica — pode estar em User OU Enterprise.)
- **`data_banks`** (~0) — dados bancários; **`cards`** (~0) — cartões (encrypted).
- **`signers`** (~4.748) — **pessoas para assinatura** cadastradas por user: `user_id`, `name`, `email`, `document_type_id`, `identification_number`.
- **`cpf_validations`** (~88) — validação Receita: `nome_receita`, `situacao_cadastral`, `ano_obito`, `birthdate`.

**Lookups de pessoa:** `person_types`(2), `sexes`(3), `civil_states`(6), `property_regimes`(6), `professions`(234), `schoolings`(9), `salary_ranges`(6), `company_sizes`(6), `document_types`(5), `user_statuses`(3), `profiles`(13), `user_incorporador_profiles`(2).

---

## 2. Empreendimentos & unidades

**`enterprises`** (~27) — o empreendimento/loteamento. `name`, `divulgation_name`, `code` (sigla, ex.: VAL), `enterprise_type_id`, `city_id`, `expected_delivery_date`, `focal_name/phone/email`.
- **Papéis do empreendimento (FKs):** `incorporador_id`, `coordenador_id`, `manager_id` (**= Coordenador de Vendas real**, o label C2X mente), `captivator_id` (**Captador**), `asaas_master_account_id`.
- Contratos/planos padrão: `short_plan_id`, `investor_plan_id`, `normal_plan_id`, `draft_contract_*`.

**`enterprise_unities`** (~3.912) — a unidade/lote. `enterprise_id`, `block`(quadra), `lot`, `area`, `price`, `registration`(matrícula), `sale_status_id`→sale_statuses, `sale_blocked` (flag real de bloqueio; `sale_status_id` não distingue estágio fino).

**Lookups:** `enterprise_types`(2), `enterprise_unity_types`(2), `enterprise_tables`(2), `sale_statuses`(5: disponível/reservado/negociação/vendido…), `enterprise_sale_status_colors`.

---

## 3. Vendas — propostas & contratos

**`acquisition_requests`** (~4.084) — a **proposta/venda** (o "negócio"). Uma unidade pode ter várias (revenda).
- `code`, `enterprise_unity_id`, `client_id` (**comprador**), `corretor_id`, `acquisition_request_stage_id`→acquisition_request_stages, `acquisition_request_type_id`.
- Co-compradores: `client_2_id`..`client_5_id` + `percentage_client_1..5`.
- Datas: `act_date` (ato), `sign_date` (assinatura), `billing_date` (faturamento).
- Plano: `commercial_plan_id`, `custom_commercial_plan` (flag), `approved_custom_commercial_plan`, `quantity_signal_parcels`, `first_signal_payment`, `due_day_id`.
- Workflow: `approval_status`, `rejection_reason`, `observation`, `registered_by_id`, `last_updated_by_id`.

**`acquisition_request_stages`** (11) — os estágios. **Ordem do funil ≠ ordem do id:** 1 Reservado, 9 Proposta realizada, 2 Análise de crédito, 3 Contrato gerado, 5 Em assinatura, 4 Faturado, 6 Finalizado; terminais: 7 Cancelado, 8 Reprovado análise, 10 Em distrato, 11 Distratado.

**`acquisition_request_historics`** (~7.155) — histórico de mudança de estágio: `old_/new_acquisition_request_stage_id`, `user_id`, `billing_date`, `created_at`. (Data de faturamento = max(created_at) com new_stage=4.)

**`acquisition_request_contracts`** (~2.615) — o contrato gerado: `complete_text`, `signature_date`, `draft_contract_id`, `acquisition_request_contract_status_id`. **`draft_contracts`** (~56) = modelos. **`contract_adjustment_schedules`** (~72) = régua de reajuste (índice/juros).

---

## 4. Assinatura digital (D4Sign)

**`contract_signatures`** (~3.197) — o processo de assinatura: `acquisition_request_contract_id`, `contract_signature_status_id`, **`uuidDoc`** (id permanente do doc no D4Sign — usar pra baixar PDF fresco), `link_pdf_signed_file` (link que EXPIRA), flags de etapa (get_safe/create_folder/upload_document/…).
**`contract_signers`** (~17.586) / **`contract_signature_signers`** (~16.946) — os assinantes daquele contrato (`signer_id`, `user_name`, `user_document`, `email`, `date_signed`, `signed`). **`signers`** = cadastro-base do assinante (ver §1).
Lookups: `contract_signature_statuses`(7), `contract_signature_types`(3).

---

## 5. Planos comerciais & política

**`commercial_plans`** (~2.804) — o plano da proposta: `name` (ex.: "10% ENTRADA +120 VEZES"), `initial_input_value` (**é % de entrada, não R$**), `parcels`, `financing_interest_rate`, `correction_rate`, `contractual_interest`. Padrão: `enterprise_id` set. Custom: `acquisition_request_id` set (linha amarrada à proposta).
**`commercial_plan_values`**(7) / **`commercial_plan_people`**(7) / **`signal_commercial_plans`**(~933, parcelas de sinal).
**`commercial_policies`** (~26) — comissionamento por papel: `commissioning_corretor/imobiliaria/coordenador/gerente/captador/incorporador/careli`, multas (`non_compliance_*`), `max_signal_parcels`.
**`index_monetary_corrections`**(5) + `_values`, `parcel_types`(3), `due_days`(44).

---

## 6. Financeiro / pagamentos

**`payments`** (~82.951) — a parcela/boleto. `acquisition_request_id`, `parcel_type_id`, `payment_status_id` (**5 Liquidada, 6 A vencer, 7 Vencida**; carteira = 5,6,7), `initial_value`, `interest_value`, `mulct_value`, `paid_value`, `due_date`, `payment_date`, `reference_date` (competência!), `current_total_parcel`/`total_parcels`, `payment_to_delete` (flag; excluir do cálculo), asaas (`payment_asaas_url`, `payment_asaas_invoice_url`), escrow.
Lookups/infra: `payment_statuses`(7), `payment_types`(3), `payment_transactions`, `payment_admin_fees`, `banks`(24), `asaas_integrations`(~2.120), `asaas_master_accounts`(2).

---

## 7. Splits (rateio de comissão)

`split_enterprises`(~17) → `split_enterprise_groups`(~69) → `split_enterprise_group_values`(~318, `split_profile_id`+`user_id`+`percent`/`fixed_value`). Lookups: `split_profiles`(7), `split_group_names`(4).

---

## 8. Papéis & vínculos (a chave da arquitetura de grafo do Apolo)

Além das FKs em `users`/`enterprises`/`acquisition_requests`, há tabelas de junção:
- **Comprador**: `acquisition_requests.client_id` (+ client_2..5). Comprador vigente = última proposta da unidade em stage 4/6 **com pagamento** (ver [[project-apolo-empreendimento-tela]]).
- **Imobiliária**: `users.imobiliaria_id` (comprador→imob), `imobiliarias_users`(37), `enterprises_imobiliarias`(626), `acquisition_requests_imobiliarias`(19), `users.vinculed_by_id`.
- **Corretor**: `acquisition_requests.corretor_id`, `corretores_enterprises`(51), `acquisition_requests_corretores`(0, vazia), `users.profile_id`=corretor. CRECI em users.
- **Coordenador de Vendas**: `enterprises.manager_id` (o `coordenador_id` do C2X é dado errado), `coordenadores_users`(6), `users.coordenador_id`.
- **Captador**: `enterprises.captivator_id`.
- **Incorporador**: `enterprises.incorporador_id`, `incorporadores_users`(12), `users.incorporador_id`.
- **Unidade↔user**: `enterprise_unities_users`(1.269), `clients_enterprises`(0).

---

## 9. Geografia (lookups)

`countries`(252), `states`(27; **`acronym`**=UF), `cities`(5.664; `name`+`state_id`+`ibge_code`), `address_areas`(0), `address_types`(44).

---

## 10. Auditoria, storage e institucional (pouco relevante pro Apolo)

- Auditoria/logs: `audits`(~13.535, `audited_changes` json), `action_logs`(~4.896, `details` json), `csv_exports`(344).
- Storage (anexos): `active_storage_attachments`(~11.500) + `active_storage_blobs`(~12.308), `attachments`(~7.452, polimórfica).
- Institucional/SaaS (majoritariamente vazias/sem uso): `plans`, `subscriptions`, `orders`, `products`, `services`, `banners`, `faqs`, `teams`, `testimonies`, `newsletters`, `messages`, `rooms`, `discount_coupons`, `system_configurations`(1; inclui `d4_sign_*`).

---

## Notas de uso pro Apolo
- **Contato canônico** vem das polimórficas (`phones`/`addresses`), não das colunas soltas em `users`.
- **Enricher da ficha** (`fetchC2xCadastroByEntity` em `lib/apolo/server.ts`) já lê users + lookups + addresses ao vivo.
- **Representantes / assinantes / cônjuge** → viram Relacionamento no Apolo (grafo). Fontes: `legal_representatives`, `signers`/`contract_signature_signers`, `spouses`.
- Governança de empreendimentos (códigos excluídos, grupos) fica em `lib/guardian/c2x-analytics.ts`.
