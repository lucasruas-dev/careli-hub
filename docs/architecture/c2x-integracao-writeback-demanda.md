# Integração Apolo (CRM) → C2X — API de cadastro de cliente

> Solicitação para a house que desenvolve/mantém o C2X. Objetivo: o **mínimo necessário**
> para o CRM (Apolo) devolver ao C2X os dados de cadastro do cliente. Escopo enxuto de
> propósito — o que não for essencial está marcado como opcional. Autor: engenharia do
> Panteon / Careli Hub.

## 1. Cenário

- O **Panteon (Careli Hub), pelo módulo Apolo, é o CRM oficial** da Careli. É lá que a
  equipe **cadastra e edita** o cliente — é a **fonte da verdade do cadastro**.
- O **C2X é o sistema operacional** (propostas, contratos, financeiro). Ele precisa
  **receber** do CRM os dados de cadastro que usa para gerar proposta e contrato.
- Hoje o Apolo **só lê** o C2X. Falta o caminho de **escrita** (Apolo → C2X).
- A escrita é **automática, via API**: o C2X **valida e grava** na hora. **Não há tela nem
  aprovação manual** — a validação é por regra (CPF, obrigatórios), não por pessoa.

## 2. O que precisamos (fase 1 — o essencial e mais barato)

Uma **API REST autenticada** no C2X para o CRM **criar e atualizar o cliente** e seus
dados de contato. Dois endpoints resolvem:

### `POST /api/apolo/clientes`  — cria um cliente
- Corpo: os campos do `users` (PF ou PJ) + endereço, telefones e e-mails.
- O C2X valida (CPF/CNPJ, obrigatórios, duplicidade), **grava direto** e **retorna o
  `id` do user criado** no C2X.

### `PATCH /api/apolo/clientes/:id`  — atualiza um cliente existente
- Corpo: só os campos que mudaram (user e/ou endereço/telefone/e-mail).
- O C2X valida, aplica e retorna OK (ou erro claro).

### Requisitos (simples, mas importantes)
- **Autenticação**: um **token de serviço** para o Apolo (não usuário humano).
- **Idempotência**: o Apolo manda um `external_ref` (id da operação no Apolo). Se a mesma
  requisição chegar 2x (retry de rede), o C2X **não duplica** — devolve o mesmo resultado.
- **Validação com erro claro**: se rejeitar (CPF inválido, campo obrigatório faltando,
  duplicado), devolver **status + mensagem** dizendo o quê, para o Apolo mostrar ao operador.
- **Sem tela de aprovação**: aplica direto após validar.

### Escopo dos campos (fase 1)
- **`users`**: `name`, `person_type_id` (PF/PJ), `cpf`/`cnpj`, `rg`, `birthday`,
  `civil_state_id`, `sex_id`, `profession_id`, `mother_name`; PJ: `social_name`,
  `fantasy_name`.
- **`addresses`**: logradouro, número, complemento, bairro, cidade, UF, CEP.
- **`phones`**: telefone/celular (com flag WhatsApp).
- **`emails`**: e-mail.

> Fora deste escopo (fica **só no Apolo**, o C2X nem precisa saber): relacionamentos de
> contato (mãe, tio, cônjuge, amigo…), anotações e vínculos que o C2X não modela.

## 3. Opcional (fase 2 — só se couber no orçamento)

Não bloqueia a fase 1; são melhorias de eficiência:

- **Webhooks de eventos**: o C2X avisar o Apolo quando algo relevante muda no operacional
  — proposta **faturada**, **novo cliente**, **distrato**. Hoje o Apolo descobre isso
  varrendo o banco (polling); com webhook fica em tempo real e com menos carga.
- **Aviso de mudança de schema**: enquanto a **leitura** do Apolo for direta no banco do
  C2X, avisar antes de renomear/alterar colunas — hoje uma mudança dessas quebra o Apolo
  sem aviso.

## 4. O que o Apolo faz do seu lado (não é pedido à house)

- **Marca de origem**: todo cadastro criado/editado no Apolo fica marcado como nosso, para
  o Apolo controlar o que enviar ao C2X e não se confundir com o que veio do C2X.
- **Fila de envio + idempotência**: o Apolo guarda cada requisição e o `id` do C2X quando
  aplicada; em caso de falha de rede, reenvia sem duplicar.

## 5. Resumo do pedido (para orçar)

| # | Pedido | Fase |
|---|--------|------|
| 1 | `POST /api/apolo/clientes` — cria user (PF/PJ) + endereço/telefone/e-mail; retorna o id do C2X | 1 (essencial) |
| 2 | `PATCH /api/apolo/clientes/:id` — atualiza os mesmos dados | 1 (essencial) |
| 3 | Token de serviço + idempotência (`external_ref`) + validação com erro claro | 1 (essencial) |
| 4 | Webhooks de eventos (faturado / novo cliente / distrato) | 2 (opcional) |
| 5 | Aviso prévio de mudança de schema do banco | 2 (opcional) |

**Essência**: só os itens 1–3 já destravam o CRM escrevendo no C2X. É o menor pacote
possível — dois endpoints de CRUD de cliente, com token e validação. Sem fila de
aprovação, sem tela, sem processo manual.
