# C2X — API de escrita: contrato completo (28/jul/2026)

O sistema C2X é do Lucas; a API foi pedida enxuta de propósito. O de-para inteiro foi resolvido
**seguindo os relacionamentos do banco** (`prod_careli`, MySQL, READ-ONLY via `GUARDIAN_DB_*`),
não pela documentação. Os testes de escrita rodaram contra `https://teste.careli.adm.br`.

## Arquitetura (importante)
- **Leitura** (`GUARDIAN_DB_*`) aponta para **produção** (`prod_careli`, ~4.147 users). Uso só
  para MAPEAR os valores das FKs — que são tabelas de domínio (seed), idênticas em teste e prod.
- **Escrita** vai para `https://teste.careli.adm.br/api/v1/users` (banco de teste, separado — um
  registro criado lá NÃO aparece na leitura de produção).
- Regra de ouro mantida: nunca escrevo no banco. Escrita é sempre via a API REST.

## O endpoint
- `POST https://teste.careli.adm.br/api/v1/users` (Rails/Passenger). Só `users` existe.
- Header: `Authorization: <chave>` (a chave veio pelo helpdesk).

## Contrato de resposta
- **Sucesso:** `{"status":"success","token":"<32 hex>"}` — ⚠️ devolve **`token`, não `id`** (ver
  ponto em aberto abaixo).
- **Erro de validação:** `{"status":"failed","errors":{campo:[msgs]},"errors_message":"..."}`.
- ⚠️ **O status HTTP é sempre 201**, inclusive no erro. Diferenciar sucesso/erro pelo campo
  `status` do corpo, NÃO pelo código HTTP.
- A validação é **em camadas e por perfil**: preenchendo os obrigatórios, ela revela a próxima
  leva. Foi assim que o schema abaixo foi levantado.

## Schema do CLIENTE (profile_id = 2) — obrigatórios
| campo API | coluna users | de-para |
|---|---|---|
| `name` | name | |
| `email` | email | único por pessoa |
| `password` | password_digest | a API faz o digest; precisamos gerar uma |
| `profile_id` | profile_id | **2** |
| `cpf` | cpf | validado (rejeita inválido) |
| `document_type_id` | document_type_id | ver tabela abaixo |
| `identification_number` | identification_number | nº do RG/CNH |
| `birthday` | birthday | `YYYY-MM-DD` |
| `civil_state_id` | civil_state_id | ver tabela |
| `phone` | phone | |
| `schooling_id` | schooling_id | ver tabela |
| `salary_range_id` | salary_range_id | ver tabela |
| `naturalness` | naturalness | cidade natal |
| `nacionality` | nacionality | (sic, com um "c") |
| `mother_name` | mother_name | |
| `vinculed_by_id` | vinculed_by_id | **id do corretor/imobiliária que captou** — o cliente não entra solto |
| `user_status_id` | user_status_id | mandar **2** (Aprovado), como combinado na devolutiva |

Os outros perfis (corretor 7 / imobiliária 6 / incorporador 3) têm obrigatórios diferentes,
inferíveis pelas colunas que cada um usa (corretor: `creci_number`/`creci_validate`; imobiliária:
`cnpj`/`social_name`/`fantasy_name`/`person_type_id=2`). Confirmar caso a caso testando.

## De-para das FKs (lido do banco — vale teste e prod)

**profile_id:** 1 Administrador · **2 Cliente** · **3 Incorporador** · 4 Usuário acesso incorporador ·
5 Coordenadora de venda · **6 Imobiliária** · **7 Corretor** · 8-13 coordenação/análise.

**document_type_id:** 1 CNH · 2 CPF · 3 RG · 4 OAB · 5 Passaporte.

**civil_state_id:** 1 Solteiro · 2 Casado · 3 Divorciado · 4 Separado judicialmente · 5 Viúvo ·
6 União Estável.

**property_regime_id** (regime de bens — quando casado): 1 Comunhão parcial · 2 Comunhão universal ·
3 Separação · 4 Participação final nos aquestos · 5 Regime misto · 6 Pacto antenupcial.

**person_type_id:** 1 Física · 2 Jurídica. · **sex_id:** 1 Masculino · 2 Feminino · 3 Não informar.

**schooling_id:** 1 Analfabeto · 2 Fund. incompleto · 3 Fund. completo · 4 Médio incompleto ·
5 Médio completo · 6 Superior incompleto · 7 Superior completo · 8 Mestrado · 9 Doutorado.

**salary_range_id:** 1 Abaixo de 1 · 2 1 a 3 · 3 3 a 6 · 4 6 a 9 · 5 9 a 12 · 6 Acima de 12.

**user_status_id:** 1 Aguardando aprovação · 2 Aprovado · 3 Reprovado.

## Cônjuge / segundo proponente
No banco o cônjuge vive na tabela **`spouses`** (polimórfica: `ownertable_type='User'`,
`ownertable_id`= id do titular), com `name, cpf, cellphone, birthday, email, document_type_id,
identification_number, sex_id, profession_id`. **O schema do POST /users não expõe cônjuge** — a
API só cria o titular. Como anexar o cônjuge (campo aninhado no POST? rota própria?) é o único
item de contrato que o banco não responde.

## Pontos em aberto (decisão / confirmação)
1. 🔴 **`token` vs `id`.** A API devolve `token`, não o `id` do C2X. Para casar identidades
   Apolo↔C2X precisamos de uma chave estável. Opções: (a) guardar o `token` como referência; (b)
   reconsultar o user por CPF depois (mas o GET dá 401 hoje); (c) a API passar a devolver o `id`.
2. **Cônjuge**: como o POST recebe o segundo proponente.
3. **Rota sem token**: POST sem `Authorization` roda a validação igual. Decisão do Lucas: sistema
   é dele, API pedida enxuta — fica como nota, não como bloqueador.

## Pronto para construir (lado Panteon, não depende de mais nada)
- Cliente de escrita com o mapeamento acima + fila de envio + idempotência (guardar cada
  requisição e o `token`/id quando aplicado), `metadata.source="apolo"`.
- Empurrar as CADs em validação e pré-venda desta ação de lançamento.
