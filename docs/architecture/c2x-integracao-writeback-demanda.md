# Integração Apolo ↔ C2X — demanda para o time do C2X

> Documento para solicitar ao time que faz a gestão do C2X. Descreve o que precisamos,
> como precisamos, e as melhorias na comunicação entre o **Apolo (Careli Hub)** e o
> **C2X (sistema legado, Rails + MySQL)**. Autor: engenharia do Panteon/Careli Hub.

## 1. Contexto (por que estamos pedindo isso)

O **Apolo** é o CRM 360 do Careli Hub. Hoje ele **só lê** o C2X (acesso read-only ao
banco) e monta a "vida do cliente" (cadastro, carteira, relacionamentos).

A direção definida: **o Apolo passa a ser o CRM oficial** — onde a equipe **cadastra e
edita** os clientes. A partir daí:

- **Volta pro C2X** apenas o que tem ligação direta com a **geração de proposta e
  contrato** (a entidade cliente e seus dados cadastrais essenciais). Isso é o **write-back**.
- **Fica só no Apolo** o resto (ex.: relacionamentos de contato — mãe, tio, cônjuge,
  amigo; anotações; vínculos que o C2X não conhece).

Hoje **não existe** nenhum caminho de escrita do Apolo para o C2X. É isso que precisamos
construir, junto com o time do C2X.

## 2. O que precisamos (demanda principal): um canal de escrita com aprovação

Queremos que toda **inclusão ou alteração** originada no Apolo chegue ao C2X como uma
**requisição** que o time do C2X **cria/aceita** (revisão antes de aplicar), não como uma
escrita direta e silenciosa no banco.

### 2.1. Modelo proposto: fila de requisições de mudança

```
Apolo  ──(1) cria requisição──▶  C2X: fila de requisições (pending)
                                        │
                                (2) time do C2X revisa
                                        │
                          ┌─────────────┴─────────────┐
                     aceita (aplica)              rejeita (com motivo)
                          │                            │
              (3) C2X grava nas tabelas reais    (3') volta motivo
                  (users, addresses, phones…)         pro Apolo
                          │
              (4) devolve o id do registro C2X + status pro Apolo
```

### 2.2. O que o time do C2X precisa criar

1. **Um recurso de "requisição de mudança"** (tabela + endpoints), com no mínimo:
   - `id` da requisição (único, gerado pelo Apolo — para **idempotência**: reenvio não duplica).
   - `origem` = "apolo", `solicitante` (usuário do Hub), `data`.
   - `tipo` = `criar` | `atualizar`.
   - `alvo`: tabela (`users`, `addresses`, `phones`, `emails`, …) + `id` do registro no
     C2X (vazio quando é criação).
   - `payload`: os campos e valores a gravar (JSON).
   - `status`: `pendente` → `aceita` → `aplicada` | `rejeitada` (com `motivo`).
   - `resultado`: o `id` do registro criado/atualizado no C2X (para o Apolo casar de volta).

2. **Endpoints REST autenticados** (token de serviço para o Apolo):
   - `POST /api/apolo/change-requests` — Apolo cria a requisição. Retorna o `id` e o status.
   - `GET  /api/apolo/change-requests/:id` — Apolo consulta o status (aceita/aplicada/rejeitada + resultado).
   - (Opcional) `POST /webhooks/apolo/change-request-updated` — C2X **avisa** o Apolo quando o status muda (evita polling).

3. **Uma tela/fila no C2X** para o time revisar as requisições pendentes e **aceitar ou
   rejeitar** (aplicando a mudança nas tabelas reais quando aceita).

### 2.3. Escopo dos dados que o Apolo vai escrever (fase 1)

Só o que é essencial para proposta/contrato:

- **`users`** (PF/PJ): `name`, `cpf`/`cnpj`, `rg`, `person_type_id`, `birthday`,
  `civil_state_id`, `sex_id`, `profession_id`, `social_name`/`fantasy_name` (PJ),
  `mother_name`, etc.
- **Polimórficas do cliente**: `addresses`, `phones`, `emails` (via `ownertable_type='User'`).

**Fora do write-back** (fica só no Apolo): relacionamentos de contato (mãe, tio, cônjuge,
amigo…), anotações e vínculos que o C2X não modela.

### 2.4. Requisitos não-funcionais

- **Idempotência**: o `id` da requisição vem do Apolo; reenvio não duplica.
- **Auditoria**: cada requisição registra quem/quando/o quê (dos dois lados).
- **Validação no C2X**: o C2X valida antes de aplicar (CPF, obrigatórios, unicidade) e
  devolve erro claro se rejeitar.
- **Contrato estável**: um contrato de API versionado — o Apolo **não** deve depender do
  schema interno do C2X para escrever.

## 3. Análise: outras frentes da comunicação C2X (aproveitar e pedir junto)

Além do write-back, hoje a comunicação tem pontos frágeis que vale melhorar de uma vez:

### A. Leitura hoje é acesso direto ao banco (MySQL)
- **Como é**: o Apolo lê o MySQL do C2X direto (read-only). Qualquer mudança de schema no
  C2X (renomear coluna, mudar tipo) **quebra o Apolo sem aviso**.
- **Pedido**: (mínimo) **avisar previamente** mudanças de schema; (ideal) uma **API oficial
  de leitura** OU uma **read-replica dedicada** ao Apolo, com contrato estável.

### B. Sincronização hoje é por varredura (polling)
- **Como é**: o Apolo varre o C2X periodicamente para detectar mudanças. Tem atraso e
  gera carga.
- **Pedido**: **webhooks/eventos** do C2X nos fatos que importam — proposta **faturada**,
  **novo cliente**, **distrato**, mudança de estágio — para o Apolo reagir na hora e
  reduzir a varredura.

### C. Conexões escassas
- **Como é**: o banco do C2X tem `max_connections` limitado, compartilhado com o Rails de
  produção. O Apolo precisa segurar as conexões ao mínimo.
- **Pedido**: uma **read-replica dedicada** (ou a API oficial), para o Apolo não competir
  com o Rails de produção por conexão.

## 4. Do nosso lado (Apolo) — o que já vamos preparar

- **Marca de origem**: todo registro **criado ou editado no Apolo** fica marcado (`source =
  apolo`, com autor e data). Serve para dois fins: (1) o sync do C2X **não sobrescrever** o
  que nasceu no Apolo; (2) sabermos exatamente **o que enviar como requisição** ao C2X.
- **Fila de saída**: o Apolo mantém a lista de requisições enviadas e o status (pendente/
  aceita/aplicada/rejeitada), casando o `id` do C2X quando aplicado.

## 5. Resumo do pedido (uma frase por item)

1. Criar um **recurso de requisição de mudança** no C2X (tabela + `POST`/`GET`) que o time
   **aceita/rejeita** antes de aplicar em `users`/`addresses`/`phones`/`emails`.
2. **Token de serviço** para o Apolo autenticar nesses endpoints.
3. (Ideal) **Webhook** do C2X avisando quando a requisição muda de status.
4. **Avisar mudanças de schema** do C2X (enquanto a leitura for direta no banco).
5. (Ideal) **Webhooks de eventos** (faturado/novo cliente/distrato) e **read-replica
   dedicada** para reduzir polling e disputa por conexão.
